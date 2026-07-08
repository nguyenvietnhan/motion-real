import { readFileSync, readdirSync, type Dirent } from "node:fs";
import { extname, join, relative } from "node:path";
import ts from "typescript";
import { makeReport, type SafetyIssue, type SafetyReport } from "../types.js";
import { workspaceRoot } from "../render/renderer.js";

/**
 * Forbidden-API guard for registered scene code (N5).
 *
 * Registered Remotion scene components must be pure functions of the frame, so
 * they may not reach for nondeterministic or unsafe APIs. Scan composition
 * sources for banned constructs and flag each as a hard error. Randomness must
 * come only from Remotion's `random(seed)`.
 *
 * Matchers are deliberately precise (word-ish boundaries, member-access / call
 * shapes, quoted module specifiers) so legitimate identifiers do not
 * false-positive — e.g. `Math.abs` is fine while `Math.random` is not, and a
 * comment mentioning a "process" is fine while `process.env` is not.
 */

type ForbiddenRule = {
  /** Human-readable token name used in the issue message. */
  token: string;
  /** Precise matcher applied per source line. */
  pattern: RegExp;
  /** Why it is banned + the deterministic alternative. */
  hint: string;
};

const FORBIDDEN_RULES: ForbiddenRule[] = [
  {
    token: "Math.random",
    pattern: /\bMath\s*\.\s*random\b/,
    hint: "Use Remotion's random(seed) for deterministic randomness.",
  },
  {
    token: "Date.now",
    pattern: /\bDate\s*\.\s*now\b/,
    hint: "Scene visuals must be pure functions of the frame; no wall-clock time.",
  },
  {
    token: "new Date(",
    pattern: /\bnew\s+Date\b/,
    hint: "Scene visuals must be pure functions of the frame; no wall-clock time.",
  },
  {
    token: "fetch(",
    pattern: /\bfetch\s*\(/,
    hint: "No network access in scene code.",
  },
  {
    token: "XMLHttpRequest",
    pattern: /\bXMLHttpRequest\b/,
    hint: "No network access in scene code.",
  },
  {
    token: "require(",
    pattern: /\brequire\s*\(/,
    hint: "No CommonJS require in scene code; use static ESM imports.",
  },
  {
    token: "import(",
    pattern: /\bimport\s*\(/,
    hint: "No dynamic import in scene code; use static ESM imports.",
  },
  {
    token: "fs module",
    pattern: /["'](?:node:)?fs(?:\/promises)?["']/,
    hint: "No filesystem access in scene code.",
  },
  {
    token: "child_process module",
    pattern: /["'](?:node:)?child_process["']/,
    hint: "No subprocess access in scene code.",
  },
  {
    token: "process.",
    pattern: /\bprocess\s*\./,
    hint: "No Node process access in scene code; scenes run in the render context only.",
  },
  {
    token: "eval(",
    pattern: /\beval\s*\(/,
    hint: "No dynamic code evaluation in scene code.",
  },
  {
    token: "Function(",
    pattern: /\bFunction\s*\(/,
    hint: "No dynamic Function construction in scene code.",
  },
  {
    token: "dangerouslySetInnerHTML",
    pattern: /\bdangerouslySetInnerHTML\b/,
    hint: "No raw HTML injection in scene code.",
  },
];

/** Absolute path to the registered scene sources (resolved from the workspace root). */
export function compositionsSrcDir(): string {
  return join(workspaceRoot(), "packages", "compositions", "src");
}

/** Absolute path to the @motionreal/blocks sources (also forbidden-API linted). */
export function blocksSrcDir(): string {
  return join(workspaceRoot(), "packages", "blocks", "src");
}

function checkNode(node: ts.Node, src: ts.SourceFile, fileRelPath: string, issues: SafetyIssue[]) {
  const getLoc = (n: ts.Node) => {
    const { line } = src.getLineAndCharacterOfPosition(n.getStart(src));
    return `${fileRelPath}:${line + 1}`;
  };

  if (ts.isPropertyAccessExpression(node)) {
    const obj = node.expression;
    const prop = node.name;
    if (ts.isIdentifier(obj) && obj.text === "Math" && prop.text === "random") {
      issues.push({
        check: "N5",
        severity: "error",
        path: getLoc(node),
        message: `Forbidden API "Math.random" in scene source at ${getLoc(node)}. Use Remotion's random(seed) for deterministic randomness.`,
      });
    }
    if (ts.isIdentifier(obj) && obj.text === "Date" && prop.text === "now") {
      issues.push({
        check: "N5",
        severity: "error",
        path: getLoc(node),
        message: `Forbidden API "Date.now" in scene source at ${getLoc(node)}. Scene visuals must be pure functions of the frame; no wall-clock time.`,
      });
    }
  }

  if (ts.isNewExpression(node)) {
    const expr = node.expression;
    if (ts.isIdentifier(expr) && expr.text === "Date") {
      issues.push({
        check: "N5",
        severity: "error",
        path: getLoc(node),
        message: `Forbidden API "new Date(" in scene source at ${getLoc(node)}. Scene visuals must be pure functions of the frame; no wall-clock time.`,
      });
    }
  }

  if (ts.isIdentifier(node)) {
    const name = node.text;
    if (name === "fetch") {
      issues.push({
        check: "N5",
        severity: "error",
        path: getLoc(node),
        message: `Forbidden API "fetch(" in scene source at ${getLoc(node)}. No network access in scene code.`,
      });
    } else if (name === "XMLHttpRequest") {
      issues.push({
        check: "N5",
        severity: "error",
        path: getLoc(node),
        message: `Forbidden API "XMLHttpRequest" in scene source at ${getLoc(node)}. No network access in scene code.`,
      });
    } else if (name === "eval") {
      issues.push({
        check: "N5",
        severity: "error",
        path: getLoc(node),
        message: `Forbidden API "eval(" in scene source at ${getLoc(node)}. No dynamic code evaluation in scene code.`,
      });
    } else if (name === "Function") {
      let isConstructorOrCall = false;
      if (node.parent && (ts.isCallExpression(node.parent) || ts.isNewExpression(node.parent))) {
        if (node.parent.expression === node) {
          isConstructorOrCall = true;
        }
      }
      if (isConstructorOrCall) {
        issues.push({
          check: "N5",
          severity: "error",
          path: getLoc(node),
          message: `Forbidden API "Function(" in scene source at ${getLoc(node)}. No dynamic Function construction in scene code.`,
        });
      }
    } else if (name === "dangerouslySetInnerHTML") {
      issues.push({
        check: "N5",
        severity: "error",
        path: getLoc(node),
        message: `Forbidden API "dangerouslySetInnerHTML" in scene source at ${getLoc(node)}. No raw HTML injection in scene code.`,
      });
    } else if (name === "require") {
      let isCall = false;
      if (node.parent && ts.isCallExpression(node.parent) && node.parent.expression === node) {
        isCall = true;
      }
      if (isCall) {
        issues.push({
          check: "N5",
          severity: "error",
          path: getLoc(node),
          message: `Forbidden API "require(" in scene source at ${getLoc(node)}. No CommonJS require in scene code; use static ESM imports.`,
        });
      }
    } else if (name === "process") {
      let isMemberAccess = false;
      if (node.parent && ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node) {
        isMemberAccess = true;
      }
      if (isMemberAccess) {
        issues.push({
          check: "N5",
          severity: "error",
          path: getLoc(node),
          message: `Forbidden API "process." in scene source at ${getLoc(node)}. No Node process access in scene code; scenes run in the render context only.`,
        });
      }
    }
  }

  if (node.kind === ts.SyntaxKind.ImportKeyword) {
    if (node.parent && ts.isCallExpression(node.parent) && node.parent.expression === node) {
      issues.push({
        check: "N5",
        severity: "error",
        path: getLoc(node),
        message: `Forbidden API "import(" in scene source at ${getLoc(node)}. No dynamic import in scene code; use static ESM imports.`,
      });
    }
  }

  if (ts.isImportDeclaration(node)) {
    const spec = node.moduleSpecifier;
    if (ts.isStringLiteral(spec)) {
      const val = spec.text;
      if (/^(?:node:)?fs(?:\/promises)?$/.test(val)) {
        issues.push({
          check: "N5",
          severity: "error",
          path: getLoc(node),
          message: `Forbidden API "fs module" in scene source at ${getLoc(node)}. No filesystem access in scene code.`,
        });
      } else if (/^(?:node:)?child_process$/.test(val)) {
        issues.push({
          check: "N5",
          severity: "error",
          path: getLoc(node),
          message: `Forbidden API "child_process module" in scene source at ${getLoc(node)}. No subprocess access in scene code.`,
        });
      }
    }
  }

  node.forEachChild((child) => checkNode(child, src, fileRelPath, issues));
}

/**
 * Lint every `.ts`/`.tsx` source under `dir` (default: the compositions package
 * sources) for forbidden constructs. Each violation becomes a hard N5 error.
 */
export function lintSceneSources(dir: string = compositionsSrcDir()): SafetyReport {
  const issues: SafetyIssue[] = [];
  const files = collectSourceFiles(dir).sort();

  for (const file of files) {
    const rel = relative(dir, file).split("\\").join("/");
    const raw = readFileSync(file, "utf8");
    const src = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    checkNode(src, src, rel, issues);
  }

  return makeReport(issues, ["lint"]);
}

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      // Test fixtures intentionally contain banned constructs; never lint them.
      if (entry.name === "__fixtures__" || entry.name === "__tests__") continue;
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (!entry.isFile()) continue;
    // Skip test/spec files: the lint targets shippable scene/block runtime code,
    // and tests legitimately use mocks / dynamic import.
    if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
    const ext = extname(entry.name);
    if ((ext === ".ts" || ext === ".tsx") && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}
