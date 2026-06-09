import { existsSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import type { SafetyIssue } from "../types.js";

/**
 * N10 — TypeScript typecheck of AI-authored scene modules against the REAL
 * @news/blocks + @news/compositions prop contracts. This is the type-level
 * analogue of the AST admission gate (admission.ts): admission proves a module
 * imports only whitelisted packages and exports the right SHAPE; N10 proves the
 * module USES those packages' components with the right prop TYPES.
 *
 * Why it exists: the render bundler (esbuild/webpack) is transpile-only — it
 * strips types without checking them — so a model that writes e.g.
 *   <KeyPoints items={list.map((text) => ({ text }))} />   // {text}[] vs string[]
 * compiles fine and then crashes headless Chromium at runtime (React error #31,
 * "Objects are not valid as a React child"). A real typecheck BEFORE render
 * turns that whole CLASS of model mistakes into a deterministic, pre-render
 * content error the repair loop can self-fix — regardless of which 9router model
 * authored the scene.
 *
 * Scope + safety (this gate must never block a renderable video):
 *  - Only diagnostics located IN the authored files are reported; errors inside
 *    the @news sources themselves are filtered out (they pass their own tsc).
 *  - `noUncheckedIndexedAccess` is deliberately OFF here (it is ON repo-wide):
 *    arr[i] access is ubiquitous in authored scenes and almost always safe at
 *    runtime, so flagging it would block working videos. We keep the rest of
 *    `strict` (so a real wrong-shape prop or a null-deref still trips).
 *  - If the workspace @news sources can't be resolved (an unexpected packaging
 *    layout), the check DEGRADES TO A NO-OP rather than blocking every render
 *    with bogus "cannot find module @news/blocks" errors. It only ever runs when
 *    it can run correctly.
 */

/** @news/* path mapping, mirroring the root tsconfig (sources, not built d.ts). */
function authoredPaths(workspaceRoot: string): Record<string, string[]> {
  const src = (name: string) => [resolve(workspaceRoot, "packages", name, "src", "index.ts")];
  return {
    "@news/schema": src("schema"),
    "@news/design": src("design"),
    "@news/blocks": src("blocks"),
    "@news/tts": src("tts"),
    "@news/compositions": src("compositions"),
    "@news/compositions/*": [resolve(workspaceRoot, "packages", "compositions", "src", "*")],
    "@news/pipeline": src("pipeline"),
    "@news/pipeline/*": [resolve(workspaceRoot, "packages", "pipeline", "src", "*")],
  };
}

function authoredCompilerOptions(workspaceRoot: string): ts.CompilerOptions {
  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    // OFF on purpose — see file header (avoid false-blocking safe arr[i] access).
    noUncheckedIndexedAccess: false,
    esModuleInterop: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    forceConsistentCasingInFileNames: true,
    noEmit: true,
    baseUrl: workspaceRoot,
    paths: authoredPaths(workspaceRoot),
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    types: ["node"],
  };
}

/**
 * Typecheck the given authored `.tsx` files against the workspace block/
 * composition types. Returns one N10 SafetyIssue per diagnostic located in an
 * authored file (path is `file:line:col`). Returns `[]` — never throws and never
 * blocks — when there are no files or the workspace sources can't be resolved.
 *
 * `sceneIdByFile` maps each absolute file path → its manifest scene id so every
 * emitted issue carries a `sceneId`; this is what lets the generate-validate-
 * repair loop ROUTE an N10 failure to a precise scene reauthor (issues without a
 * sceneId are un-targetable and only exhaust the loop). Pass a resolved-path map.
 */
export function typecheckAuthoredScenes(
  files: string[],
  workspaceRoot: string,
  sceneIdByFile?: ReadonlyMap<string, string>,
): SafetyIssue[] {
  if (files.length === 0) return [];
  // Degrade to a no-op if the @news sources aren't where we expect: better to
  // fall back to the prior (no-typecheck) behavior than to block every render
  // with bogus "cannot find module '@news/blocks'" errors on every authored file.
  if (!existsSync(resolve(workspaceRoot, "packages", "blocks", "src", "index.ts"))) return [];

  let program: ts.Program;
  try {
    program = ts.createProgram(files, authoredCompilerOptions(workspaceRoot));
  } catch {
    return []; // a typecheck SETUP failure must never block a render
  }

  const authored = new Set(files.map((f) => resolve(f)));
  const issues: SafetyIssue[] = [];
  for (const d of ts.getPreEmitDiagnostics(program)) {
    // Skip global/options diagnostics (no file) and errors inside @news sources.
    if (!d.file || !authored.has(resolve(d.file.fileName))) continue;
    const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    const abs = resolve(d.file.fileName);
    let path = d.file.fileName;
    if (typeof d.start === "number") {
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
      path = `${d.file.fileName}:${line + 1}:${character + 1}`;
    }
    const sceneId = sceneIdByFile?.get(abs);
    issues.push({
      check: "N10",
      severity: severityFor(message),
      path,
      ...(sceneId ? { sceneId } : {}),
      message: `TS${d.code}: ${message}`,
    });
  }
  return issues;
}

/**
 * A reach for a color token NOT declared on the theme — e.g.
 *   `Property 'ink' does not exist on type 'ThemeColors'.`       (theme.colors.ink)
 *   `Property 'signalRed' does not exist on type 'ThemeColors'. Did you mean 'signal'?`
 *   `Property 'accent' does not exist on type 'Theme'.`          (theme.accent — flat)
 *   `Property 'textSecondary' does not exist on type 'Theme'.`
 * Models read color tokens BOTH through `theme.colors.*` (type `ThemeColors`) and
 * flat off the theme `theme.*` (type `Theme`); the design layer's runtime Proxies
 * resolve both to a safe color, so both are non-fatal. Matched by the EXACT type
 * name (not by TS error code), so the softening stays narrow: a missing prop on a
 * component or any other type is never downgraded.
 */
const MISSING_THEME_COLOR = /does not exist on type 'Theme(Colors)?'/;

/**
 * Decide an N10 diagnostic's severity. Most authored type errors are HARD
 * (severity "error"): a wrong-shape prop (e.g. `{text}[]` where a block wants
 * `string[]`) compiles under the transpile-only bundler and then crashes
 * headless Chromium at runtime — that MUST block the render.
 *
 * The ONE exception is a read of an un-aliased color token off `theme.colors`.
 * The design layer wraps `colors` in a runtime Proxy that resolves any unknown
 * token to a safe on-brand color (never `undefined`), so such a scene renders
 * fine — just with a fallback color and a one-time console hint. Blocking the
 * render over a cosmetic, already-self-healed mismatch would be the false-
 * positive that makes N10 feel un-shippable, so these are WARNINGS: surfaced
 * (and route an advisory reauthor) but never a hard gate. Scoped by the exact
 * `ThemeColors` type name so nothing crash-class is ever downgraded.
 */
function severityFor(message: string): SafetyIssue["severity"] {
  return MISSING_THEME_COLOR.test(message) ? "warning" : "error";
}
