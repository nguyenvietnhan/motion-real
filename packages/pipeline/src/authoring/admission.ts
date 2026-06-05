import { readFileSync } from "node:fs";
import { basename } from "node:path";
import ts from "typescript";
import type { SafetyIssue } from "../types.js";

/**
 * AI AUTHOR mode admission gate (N4/N5; Requirement 13). This is the web analogue
 * of math_video_tool's mvlib.lint for free-authored code: BEFORE an AI-authored
 * scene module is ever imported, bundled, or executed, its TSX is parsed to an
 * AST and checked against a strict policy —
 *   - N4: only whitelisted modules may be imported, and the module MUST export a
 *     default (the registerComponent result), a named `schema`, and a named
 *     `example`; it must register exactly one component with a literal id.
 *   - N5: banned, nondeterministic, or unsafe APIs (Math.random, Date/Date.now,
 *     fetch/XMLHttpRequest, eval/Function, require/dynamic import, fs/
 *     child_process/process, window.location/document.cookie,
 *     dangerouslySetInnerHTML) may not appear anywhere in the AST.
 * Authored code reaches the typecheck → registration → bundle steps only after
 * it passes this static gate, so a module referencing a banned API never even
 * gets loaded (defense in depth, exactly like the static lint tier for specs).
 */

export type AdmissionPolicy = {
  /** Only these module specifiers (exact, or a subpath under one) may be imported. */
  allowedImports: readonly string[];
  /** Identifiers / member expressions that are hard-banned anywhere in the AST. */
  bannedApis: readonly string[];
  /** Named exports the module MUST provide (use "default" for the default export). */
  requiredExports: readonly string[];
};

export const DEFAULT_ADMISSION_POLICY: AdmissionPolicy = {
  allowedImports: ["react", "remotion", "@news/design", "@news/compositions", "zod"],
  bannedApis: [
    "Math.random",
    "Date.now",
    "Date",
    "fetch",
    "XMLHttpRequest",
    "eval",
    "Function",
    "require",
    "import(",
    "fs",
    "child_process",
    "process",
    "window.location",
    "document.cookie",
    "dangerouslySetInnerHTML",
  ],
  requiredExports: ["default", "schema", "example"],
};

export type AdmissionResult =
  | { admitted: true; componentId: string }
  | { admitted: false; violations: SafetyIssue[] };

/**
 * Statically admit (or reject) an authored scene module. Pure and side-effect
 * free: it never imports or executes the module. On success it returns the
 * component id parsed from the `registerComponent({ id: "..." })` call.
 */
export function admitAuthoredComponent(
  tsxPath: string,
  policy: AdmissionPolicy = DEFAULT_ADMISSION_POLICY,
): AdmissionResult {
  let text: string;
  try {
    text = readFileSync(tsxPath, "utf8");
  } catch (error) {
    return {
      admitted: false,
      violations: [{ check: "N4", severity: "error", path: tsxPath, message: `Cannot read authored module: ${msg(error)}` }],
    };
  }

  const file = basename(tsxPath);
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: SafetyIssue[] = [];
  const banned = new Set(policy.bannedApis);
  const allowed = policy.allowedImports;
  const exportedNames = new Set<string>();
  let componentId: string | null = null;

  const at = (node: ts.Node): string => {
    const { line } = src.getLineAndCharacterOfPosition(node.getStart(src));
    return `${file}:${line + 1}`;
  };
  const addN4 = (node: ts.Node, message: string): void => {
    violations.push({ check: "N4", severity: "error", path: at(node), message });
  };
  const addN5 = (node: ts.Node, token: string): void => {
    violations.push({
      check: "N5",
      severity: "error",
      path: at(node),
      message: `Authored scene code uses forbidden API "${token}"; scene visuals must be pure functions of the frame (use Remotion's random(seed)).`,
    });
  };

  const importAllowed = (spec: string): boolean =>
    allowed.some((a) => spec === a || spec.startsWith(`${a}/`));

  const visit = (node: ts.Node): void => {
    // --- imports (N4 whitelist) ---
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      if (!importAllowed(spec)) {
        addN4(node, `Import of "${spec}" is outside the authored-code whitelist (${allowed.join(", ")}).`);
      }
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      if (!importAllowed(spec)) {
        addN4(node, `Re-export from "${spec}" is outside the authored-code whitelist.`);
      }
    }

    // --- dynamic import() (N5) ---
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (banned.has("import(")) addN5(node, "import(");
    }

    // --- member-access banned tokens: Math.random, Date.now, window.location, document.cookie (N5) ---
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const dotted = `${node.expression.text}.${node.name.text}`;
      if (banned.has(dotted)) addN5(node, dotted);
      if (node.expression.text === "process" && banned.has("process")) addN5(node, "process");
    }

    // --- new Date(...) / new XMLHttpRequest(...) (N5) ---
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (banned.has(name)) addN5(node, name);
    }

    // --- call callees: fetch(), eval(), Function(), require(), Date() (N5) ---
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (banned.has(name) && name !== "Function") addN5(node, name);
      if (name === "Function" && banned.has("Function")) addN5(node, "Function");
      collectRegisterId(node);
    }

    // --- JSX dangerouslySetInnerHTML (N5) ---
    if (ts.isJsxAttribute(node) && node.name.getText(src) === "dangerouslySetInnerHTML" && banned.has("dangerouslySetInnerHTML")) {
      addN5(node, "dangerouslySetInnerHTML");
    }

    // --- exported names (N4 required exports) ---
    collectExports(node);

    ts.forEachChild(node, visit);
  };

  function collectExports(node: ts.Node): void {
    // export default ...
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      exportedNames.add("default");
      return;
    }
    // export const schema = ... / export const example = ...
    if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) exportedNames.add(decl.name.text);
      }
    }
    // export function/class (possibly default)
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && hasExportModifier(node)) {
      if (hasDefaultModifier(node)) exportedNames.add("default");
      else if (node.name) exportedNames.add(node.name.text);
    }
    // export { a, b as default }
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const el of node.exportClause.elements) exportedNames.add(el.name.text);
    }
  }

  function collectRegisterId(call: ts.CallExpression): void {
    const callee = call.expression;
    const isRegister =
      (ts.isIdentifier(callee) && callee.text === "registerComponent") ||
      (ts.isPropertyAccessExpression(callee) && callee.name.text === "registerComponent");
    if (!isRegister) return;
    const arg = call.arguments[0];
    if (arg && ts.isObjectLiteralExpression(arg)) {
      for (const prop of arg.properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          prop.name.getText(src) === "id" &&
          ts.isStringLiteral(prop.initializer)
        ) {
          componentId = prop.initializer.text;
        }
      }
    }
  }

  visit(src);

  // Required exports (N4).
  for (const required of policy.requiredExports) {
    if (!exportedNames.has(required)) {
      addN4(src, `Authored module is missing required export "${required}".`);
    }
  }

  // A literal registerComponent id is required to reference the component.
  if (componentId === null) {
    addN4(src, `Authored module must call registerComponent({ id: "..." }) with a literal string id.`);
  }

  if (violations.length > 0 || componentId === null) {
    return { admitted: false, violations };
  }
  return { admitted: true, componentId };
}

function hasExportModifier(node: ts.HasModifiers): boolean {
  return (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}
function hasDefaultModifier(node: ts.HasModifiers): boolean {
  return (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
}
function msg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
