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
 * Authored code reaches typecheck → bundle only after it passes this static
 * gate; its registerComponent side effect runs later inside the Remotion render
 * entry, never in the Node host.
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
  // Post-freeform-pivot the layout blocks were deleted: the AI bốc pre-made
  // @news/blocks (TitleBlock/KeyPoints/Panel/Story/…) into every scene, which made
  // every video look the same. Cutting @news/blocks (and @news/theme) from the
  // whitelist is the STRUCTURAL lever — not a prompt nudge — that forces the AI to
  // author every scene as 100% bespoke JSX/SVG. The image feature survives because
  // the one sanctioned authored-facing export, SceneImage, is re-exported from
  // @news/compositions (which IS whitelisted and authored scenes must import anyway
  // for registerComponent). @news/blocks still exists as the render runtime the
  // composition layer imports — but a scene can no longer reach it.
  allowedImports: ["react", "remotion", "@news/compositions", "zod"],
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
    // Global ROOTS. A deny-list over an AST cannot enumerate every path to the
    // host, but every escape needs SOME global object to start from. Banning the
    // roots themselves (not just `globalThis.process`) closes the whole class:
    // `global.process.getBuiltinModule("child_process").execSync(...)` is a
    // working host-RCE bypass when only `process` is banned, because `process`
    // sits in a property-NAME position the identifier visitor skips — but `global`
    // (the base) is then flagged. The same ban catches `self["ev"+"al"]` /
    // `window["x"]` since the root identifier is flagged regardless of access form.
    "globalThis",
    "global",
    "self",
    "window",
    "document",
    // Metaprogramming escapes (Reflect.get / a Proxy trap can reach a constructor).
    "Reflect",
    "Proxy",
    "crypto",
    "performance",
    // Base64/char codecs are the usual way to BUILD an obfuscated member name
    // (e.g. `x[atob("Y29uc3RydWN0b3I=")]`); deterministic scenes never need them.
    "atob",
    "btoa",
    "dangerouslySetInnerHTML",
    // Media must reach the screen ONLY through the sanctioned `<SceneImage>`
    // block (fed by the scene's local-only `image` field). Banning Remotion's
    // raw media primitives in authored code closes the remote-URL smuggle hole
    // (e.g. `<Img src="https://…">`) — an authored scene cannot fetch or embed
    // its own media, so the local-only / offline-determinism (N16) invariant
    // holds without trusting AI output.
    "Img",
    "staticFile",
    "Video",
    "OffthreadVideo",
  ],
  requiredExports: ["default", "schema", "example"],
};

export const DEFAULT_TRANSITION_ADMISSION_POLICY: AdmissionPolicy = {
  ...DEFAULT_ADMISSION_POLICY,
  requiredExports: ["default"],
};

export type AdmissionResult =
  | { admitted: true; componentId: string }
  | { admitted: false; violations: SafetyIssue[] };

export type TransitionAdmissionResult =
  | { admitted: true; transitionId: string }
  | { admitted: false; violations: SafetyIssue[] };

type InternalAdmissionResult =
  | { admitted: true; id: string }
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
  const result = admitAuthoredRegistration(tsxPath, policy, "registerComponent", "component");
  if (!result.admitted) return result;
  return { admitted: true, componentId: result.id };
}

/**
 * Statically admit (or reject) an authored boundary-transition module. Pure and
 * side-effect free: it never imports or executes the module. On success it
 * returns the transition id parsed from registerTransition({ id: "..." }).
 */
export function admitAuthoredTransition(
  tsxPath: string,
  policy: AdmissionPolicy = DEFAULT_TRANSITION_ADMISSION_POLICY,
): TransitionAdmissionResult {
  const result = admitAuthoredRegistration(tsxPath, policy, "registerTransition", "transition");
  if (!result.admitted) return result;
  return { admitted: true, transitionId: result.id };
}

function admitAuthoredRegistration(
  tsxPath: string,
  policy: AdmissionPolicy,
  registerFunction: "registerComponent" | "registerTransition",
  registerLabel: "component" | "transition",
): InternalAdmissionResult {
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
  let registrationId: string | null = null;
  const constantStrings = collectConstantStrings(src);

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

  const parseDiagnostics = (src as ts.SourceFile & { parseDiagnostics?: readonly ts.DiagnosticWithLocation[] }).parseDiagnostics ?? [];
  for (const diagnostic of parseDiagnostics) {
    const start = diagnostic.start ?? 0;
    const { line } = src.getLineAndCharacterOfPosition(start);
    violations.push({
      check: "N4",
      severity: "error",
      path: `${file}:${line + 1}`,
      message: `Authored module has invalid TSX syntax: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
    });
  }

  const importAllowed = (spec: string): boolean => {
    // A `..` segment escapes the whitelisted package root (e.g.
    // "@news/blocks/../../node:fs" passes a naive startsWith), so reject any
    // specifier containing a parent-dir traversal outright.
    if (spec.split(/[\\/]/).includes("..")) return false;
    return allowed.some((a) => spec === a || spec.startsWith(`${a}/`));
  };

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
    }

    // --- prototype-chain escape: any `.constructor` access (e.g. [].constructor.
    // constructor("…")()) is a classic Function-constructor RCE vector (N5). ---
    if (ts.isPropertyAccessExpression(node) && node.name.text === "constructor") {
      addN5(node, "constructor");
    }

    // --- computed member access (N5). A static string key that names a dangerous
    // member (`window["eval"]`, `x["constructor"]`) is flagged by name. The remaining
    // bypass is a key that BUILDS the dangerous name at runtime so the by-name guard
    // can't see it — `x["con"+"structor"]`, `x[`construct${""}or`]`, `x[atob(...)]`.
    // Reject those name-BUILDING keys (string concat / template / call) while ALLOWING
    // ordinary data indexing (`arr[i]`, `colors[index]`, `arr[i+1]`), which scene
    // dataviz uses constantly — a blanket non-literal ban would roll back valid scenes.
    // (The `atob`/`btoa` codecs and the global roots are already banned as identifiers,
    // so `x[atob(...)]` is doubly caught; this covers the pure string-concat form.) ---
    if (ts.isElementAccessExpression(node)) {
      const keyExpr = node.argumentExpression;
      const key = resolveConstantString(keyExpr, constantStrings);
      if (key !== null) {
        if (isDangerousMemberName(key, banned)) addN5(node, `["${key}"]`);
      } else if (isNameBuildingKey(keyExpr)) {
        addN5(node, "computed member access with a runtime-built string key");
      }
    }

    // --- raw JSX media/network carriers (N5/N9). Authored scenes may render
    // user-provided local images only via <SceneImage>; raw browser elements can
    // fetch arbitrary remote/file URLs from Chromium and break offline
    // determinism, so block the carriers themselves. ---
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName)) {
      const tag = constantStrings.get(node.tagName.text) ?? node.tagName.text;
      if (RAW_MEDIA_TAGS.has(tag)) addN5(node, `<${tag}>`);
    }
    if (ts.isCallExpression(node) && isCreateElementCall(node.expression)) {
      const tagArg = node.arguments[0];
      const tag = tagArg ? resolveConstantString(tagArg, constantStrings) : null;
      if (tag && RAW_MEDIA_TAGS.has(tag)) addN5(node, `createElement("${tag}")`);
    }

    // --- remote/file URL literals (N5/N9). This catches hard-coded URLs in JSX,
    // CSS url(...), and props-like literals; legitimate media must flow through
    // the local-only manifest image.ref + <SceneImage> path. Fragment-only
    // SVG paint-server refs like "url(#bgGradient)" are local to the same SVG
    // document and are allowed; they do not fetch network/file resources.
    if (isStringLikeLiteral(node)) {
      const value = node.text;
      if (isDangerousMemberName(value, banned)) addN5(node, `string literal "${value}"`);
      if (isUrlLikeLiteral(value)) addN5(node, `remote/file URL literal "${truncate(value)}"`);
    }

    // --- import.meta (MetaProperty) leaks the host path / `import.meta.resolve`
    // exists on recent Node; the dynamic-import() check above only sees a call. ---
    if (node.kind === ts.SyntaxKind.MetaProperty) {
      addN5(node, "import.meta");
    }

    // --- dangerous global identifier referenced ANYWHERE (N5). Catches the bare
    // reference, aliasing (`const p = process; p.exit()`), and indirection
    // (`globalThis.process`, `process["env"]`) that the dotted/callee checks miss.
    // Skipped in safe positions: a property NAME (`foo.process`), an object-literal
    // key, a declaration/binding name, an import/export specifier, a type position,
    // and the direct callee/new-target of a call (handled by the blocks below, so
    // we don't double-report). ---
    if (ts.isIdentifier(node) && banned.has(node.text)) {
      const p = node.parent;
      const safePosition =
        (ts.isPropertyAccessExpression(p) && p.name === node) ||
        (ts.isQualifiedName(p) && p.right === node) ||
        (ts.isPropertyAssignment(p) && p.name === node) ||
        (ts.isBindingElement(p) && p.propertyName === node) ||
        ((ts.isVariableDeclaration(p) ||
          ts.isParameter(p) ||
          ts.isFunctionDeclaration(p) ||
          ts.isPropertySignature(p) ||
          ts.isPropertyDeclaration(p)) &&
          (p as { name?: ts.Node }).name === node) ||
        ts.isImportSpecifier(p) ||
        ts.isExportSpecifier(p) ||
        ts.isTypeReferenceNode(p) ||
        ts.isTypeQueryNode(p) ||
        (ts.isCallExpression(p) && p.expression === node) ||
        (ts.isNewExpression(p) && p.expression === node);
      if (!safePosition) addN5(node, node.text);
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
      (ts.isIdentifier(callee) && callee.text === registerFunction) ||
      (ts.isPropertyAccessExpression(callee) && callee.name.text === registerFunction);
    if (!isRegister) return;
    const arg = call.arguments[0];
    if (arg && ts.isObjectLiteralExpression(arg)) {
      for (const prop of arg.properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          prop.name.getText(src) === "id" &&
          ts.isStringLiteral(prop.initializer)
        ) {
          registrationId = prop.initializer.text;
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

  // A literal registration id is required to reference the authored module.
  if (registrationId === null) {
    addN4(src, `Authored ${registerLabel} module must call ${registerFunction}({ id: "..." }) with a literal string id.`);
  }

  if (violations.length > 0 || registrationId === null) {
    return { admitted: false, violations };
  }
  return { admitted: true, id: registrationId };
}

/**
 * Does a computed-member key BUILD a string name at runtime (the obfuscation
 * vector `x["con"+"structor"]` / `` x[`construct${""}or`] `` / `x[atob(...)]`)?
 * Distinguished from ordinary data indexing (`arr[i]`, `arr[i+1]`, `m[k]`), which
 * scene dataviz uses heavily and must stay admitted:
 *  - a string literal anywhere in a `+` chain ⇒ name-building (numeric `i+1` is not);
 *  - a template expression with substitutions, or any string-ish template ⇒ name-building;
 *  - a call expression ⇒ name-building (e.g. a decoder); a bare identifier/index is not.
 */
function isNameBuildingKey(expr: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(expr)) return isNameBuildingKey(expr.expression);
  if (ts.isCallExpression(expr)) return true;
  if (ts.isTemplateExpression(expr)) return true; // `...${x}...` (a NoSubstitution template is a plain literal name, handled by the literal branch)
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return containsStringLiteral(expr);
  }
  return false;
}

/** True if a `+` expression tree contains any string/template literal operand (⇒ string concat, not arithmetic). */
function containsStringLiteral(expr: ts.Expression): boolean {
  if (ts.isStringLiteralLike(expr) || ts.isTemplateExpression(expr)) return true;
  if (ts.isParenthesizedExpression(expr)) return containsStringLiteral(expr.expression);
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return containsStringLiteral(expr.left) || containsStringLiteral(expr.right);
  }
  return false;
}

const RAW_MEDIA_TAGS = new Set(["img", "video", "audio", "iframe", "object", "embed", "source", "track", "link", "script"]);
const DANGEROUS_MEMBER_NAMES = new Set(["constructor", "__proto__", "prototype"]);

function isStringLikeLiteral(node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteralLike(node);
}

function isDangerousMemberName(value: string, banned: ReadonlySet<string>): boolean {
  return DANGEROUS_MEMBER_NAMES.has(value) || banned.has(value);
}

function isUrlLikeLiteral(value: string): boolean {
  if (isSafeSvgFragmentUrl(value)) return false;
  return /(?:https?:\/\/|data:|blob:|file:|url\s*\(|^\/\/)/i.test(value);
}

function isSafeSvgFragmentUrl(value: string): boolean {
  return /^url\(\s*(['"]?)#[A-Za-z_][\w:.-]*\1\s*\)$/i.test(value.trim());
}

function isCreateElementCall(expr: ts.LeftHandSideExpression): boolean {
  return (ts.isIdentifier(expr) && expr.text === "createElement") ||
    (ts.isPropertyAccessExpression(expr) && expr.name.text === "createElement");
}

function truncate(value: string): string {
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}

function collectConstantStrings(src: ts.SourceFile): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  const declarations: ts.VariableDeclaration[] = [];
  const visitConst = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isConstDeclaration(node) && node.initializer) {
      declarations.push(node);
    }
    ts.forEachChild(node, visitConst);
  };
  visitConst(src);
  for (let pass = 0; pass < declarations.length; pass += 1) {
    let changed = false;
    for (const declaration of declarations) {
      const name = (declaration.name as ts.Identifier).text;
      if (out.has(name) || !declaration.initializer) continue;
      const value = resolveConstantString(declaration.initializer, out);
      if (value !== null) {
        out.set(name, value);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

function isConstDeclaration(node: ts.VariableDeclaration): boolean {
  return (ts.getCombinedNodeFlags(node.parent) & ts.NodeFlags.Const) !== 0;
}

function resolveConstantString(expr: ts.Expression, known: ReadonlyMap<string, string>, seen = new Set<string>()): string | null {
  if (ts.isParenthesizedExpression(expr)) return resolveConstantString(expr.expression, known, seen);
  if (ts.isStringLiteralLike(expr)) return expr.text;
  if (ts.isIdentifier(expr)) {
    if (seen.has(expr.text)) return null;
    const value = known.get(expr.text);
    if (value === undefined) return null;
    seen.add(expr.text);
    return value;
  }
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = resolveConstantString(expr.left, known, seen);
    const right = resolveConstantString(expr.right, known, seen);
    return left !== null && right !== null ? `${left}${right}` : null;
  }
  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
    const callee = expr.expression;
    if (ts.isIdentifier(callee.expression) && callee.expression.text === "String" && callee.name.text === "fromCharCode") {
      const chars: number[] = [];
      for (const arg of expr.arguments) {
        if (!ts.isNumericLiteral(arg)) return null;
        chars.push(Number(arg.text));
      }
      return String.fromCharCode(...chars);
    }
  }
  return null;
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
