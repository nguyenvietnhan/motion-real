import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import ts from "typescript";
import type { SafetyIssue } from "../types.js";

/**
 * Warn ONCE that N10 has degraded to a no-op (sources missing / setup failed), so
 * a packaged build that silently lost the typecheck says so in the logs instead
 * of letting wrong-shape props crash render with no trace. Deduped on the reason
 * so a per-render call doesn't spam, but a different cause still surfaces.
 */
const warnedN10Reasons = new Set<string>();
function warnN10Degraded(reason: string): void {
  if (warnedN10Reasons.has(reason)) return;
  warnedN10Reasons.add(reason);
  console.warn(`[N10] authored typecheck degraded to a no-op: ${reason}. Authored prop-shape errors will NOT be caught before render.`);
}

const TYPECHECK_CACHE_CAP = 12;
const typecheckCache = new Map<string, SafetyIssue[]>();
const typecheckCacheStats = { hits: 0, misses: 0 };

/**
 * N10 — TypeScript typecheck of AI-authored scene modules against the REAL
 * @motionreal/blocks + @motionreal/compositions prop contracts. This is the type-level
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
 *    the MotionReal sources themselves are filtered out (they pass their own tsc).
 *  - `noUncheckedIndexedAccess` is deliberately OFF here (it is ON repo-wide):
 *    arr[i] access is ubiquitous in authored scenes and almost always safe at
 *    runtime, so flagging it would block working videos. We keep the rest of
 *    `strict` (so a real wrong-shape prop or a null-deref still trips).
 *  - If the workspace MotionReal sources can't be resolved (an unexpected packaging
 *    layout), the check DEGRADES TO A NO-OP rather than blocking every render
 *    with bogus "cannot find module @motionreal/blocks" errors. It only ever runs when
 *    it can run correctly.
 */

/** @motionreal/* path mapping, mirroring the root tsconfig (sources, not built d.ts). */
function authoredPaths(workspaceRoot: string): Record<string, string[]> {
  const src = (name: string) => [resolve(workspaceRoot, "packages", name, "src", "index.ts")];
  return {
    "@motionreal/schema": src("schema"),
    "@motionreal/theme": src("theme"),
    "@motionreal/blocks": src("blocks"),
    "@motionreal/tts": src("tts"),
    "@motionreal/compositions": src("compositions"),
    "@motionreal/compositions/*": [resolve(workspaceRoot, "packages", "compositions", "src", "*")],
    "@motionreal/pipeline": src("pipeline"),
    "@motionreal/pipeline/*": [resolve(workspaceRoot, "packages", "pipeline", "src", "*")],
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
  // Degrade to a no-op if the MotionReal sources aren't where we expect: better to
  // fall back to the prior (no-typecheck) behavior than to block every render
  // with bogus "cannot find module '@motionreal/blocks'" errors on every authored file.
  // BUT this degrade is a SILENT SAFETY HOLE in a packaged app: a shipped build
  // ships no TS source tree, so N10 would return [] for EVERY project and a
  // wrong-shape prop ({text}[] vs string[]) — the exact crash-class N10 catches —
  // would sail through to render and crash headless Chromium. So warn loudly
  // (once) when it degrades: in dev the sources are present and this never fires,
  // but a packaged build that lost N10 will say so in the logs instead of going
  // quiet. (Warn-once: this runs per render, not per frame, but no need to spam.)
  if (!existsSync(resolve(workspaceRoot, "packages", "blocks", "src", "index.ts"))) {
    warnN10Degraded(`MotionReal sources not found under ${workspaceRoot} — N10 typecheck SKIPPED`);
    return [];
  }

  const cacheKey = typecheckCacheKey(files, workspaceRoot, sceneIdByFile);
  const cached = typecheckCache.get(cacheKey);
  if (cached) {
    typecheckCacheStats.hits += 1;
    typecheckCache.delete(cacheKey);
    typecheckCache.set(cacheKey, cached);
    return cached.map((issue) => ({ ...issue }));
  }
  typecheckCacheStats.misses += 1;

  let program: ts.Program;
  try {
    program = ts.createProgram(files, authoredCompilerOptions(workspaceRoot));
  } catch (e) {
    // A typecheck SETUP failure must never block a render — but, like the missing
    // sources above, a silent skip hides that N10 isn't actually guarding anything.
    warnN10Degraded(`typecheck setup failed (${e instanceof Error ? e.message : String(e)}) — N10 typecheck SKIPPED`);
    return [];
  }

  const authored = new Set(files.map((f) => resolve(f)));
  const issues: SafetyIssue[] = [];
  for (const d of ts.getPreEmitDiagnostics(program)) {
    // Skip global/options diagnostics (no file) and errors inside MotionReal sources.
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
      severity: severityFor(d.code, message),
      path,
      ...(sceneId ? { sceneId } : {}),
      message: `TS${d.code}: ${message}`,
    });
  }
  while (typecheckCache.size >= TYPECHECK_CACHE_CAP) {
    const oldest = typecheckCache.keys().next().value;
    if (oldest === undefined) break;
    typecheckCache.delete(oldest);
  }
  typecheckCache.set(cacheKey, issues.map((issue) => ({ ...issue })));
  return issues;
}

export function __resetTypecheckAuthoredCache(): void {
  typecheckCache.clear();
  typecheckCacheStats.hits = 0;
  typecheckCacheStats.misses = 0;
}

export function __typecheckAuthoredCacheStats(): { hits: number; misses: number; entries: number } {
  return { ...typecheckCacheStats, entries: typecheckCache.size };
}

function typecheckCacheKey(
  files: readonly string[],
  workspaceRoot: string,
  sceneIdByFile?: ReadonlyMap<string, string>,
): string {
  const h = createHash("sha256");
  const root = resolve(workspaceRoot);
  h.update(root);
  h.update("\0");
  for (const file of files.map((f) => resolve(f)).sort()) {
    h.update(file);
    h.update("\0");
    h.update(fileFingerprint(file));
    h.update("\0");
    h.update(sceneIdByFile?.get(file) ?? "");
    h.update("\0");
  }
  for (const pkg of ["schema", "theme", "blocks", "compositions"]) {
    h.update(pkg);
    h.update("\0");
    h.update(directoryFingerprint(resolve(root, "packages", pkg, "src")));
    h.update("\0");
  }
  return h.digest("hex");
}

function fileFingerprint(path: string): string {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return "missing";
  }
}

function directoryFingerprint(dir: string): string {
  const h = createHash("sha256");
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        h.update(entry.name);
        h.update(directoryFingerprint(path));
        continue;
      }
      if (!entry.isFile() || ![".ts", ".tsx"].includes(extname(entry.name)) || /\.test\.tsx?$/.test(entry.name)) continue;
      h.update(path);
      h.update(fileFingerprint(path));
    }
  } catch {
    h.update("missing");
  }
  return h.digest("hex");
}

/** Test seam proving contract cache keys depend on bytes, not mutable fs metadata. */
export function __directoryFingerprint(dir: string): string {
  return directoryFingerprint(dir);
}

/**
 * Decide an N10 diagnostic's severity.
 *
 * The per-scene render error boundary keeps a broken authored scene from crashing
 * the whole MP4, but its fallback is intentionally plain (headline-only). That is
 * a last-resort containment net, not an acceptable "clean" draft. Diagnostics
 * that are likely to produce a runtime throw/fallback are hard errors so the
 * repair loop reauthors the scene before the user sees it. Diagnostics known to
 * be runtime-safe stay advisory warnings.
 */
function severityFor(code: number, message: string): SafetyIssue["severity"] {
  // Safe runtime fallbacks:
  // - Theme/ThemeColors unknown tokens resolve through the theme Proxy.
  // - Extra props on surviving render helpers are ignored by React/the component.
  // - Unknown Tone literals hit a safe default arm in the runtime helper.
  if (/does not exist on type 'Theme(?:Colors)?'/.test(message)) return "warning";
  if (/does not exist on type 'IntrinsicAttributes/.test(message)) return "warning";
  if (/is not assignable to type 'Tone/.test(message)) return "warning";

  // These diagnostics only report missing type annotations. TypeScript erases
  // them without changing the emitted JavaScript, so they cannot by themselves
  // cause SceneFallback: implicit parameter, rest-parameter, or binding-element
  // `any`. Keep this allowlist narrow; every other unknown diagnostic stays hard.
  if (code === 7006 || code === 7019 || code === 7031) return "warning";

  // Definitely fallback-prone: an unbound value is erased by transpile-only
  // bundling and throws `ReferenceError` at render time, producing SceneFallback.
  if (code === 2304 || /Cannot find name/.test(message)) return "error";

  // Default to hard: most remaining authored type errors are more likely to throw
  // or corrupt props than to render safely. The repair loop can target sceneId.
  return "error";
}
