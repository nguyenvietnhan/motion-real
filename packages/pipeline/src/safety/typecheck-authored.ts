import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import ts from "typescript";
import type { SafetyIssue } from "../types.js";

type RequiredTypecheckPath = {
  label: string;
  path: string;
};

export type TypecheckAuthoredReadiness = {
  ok: boolean;
  workspaceRoot: string;
  missing: RequiredTypecheckPath[];
};

/**
 * Warn ONCE that N10 has degraded to a no-op (sources missing / setup failed),
 * while also returning a structured warning issue for the report path. Deduped
 * on the reason so a per-render call doesn't spam, but a different cause still
 * surfaces.
 */
const warnedN10Reasons = new Set<string>();
function warnN10Degraded(reason: string): void {
  if (warnedN10Reasons.has(reason)) return;
  warnedN10Reasons.add(reason);
  console.warn(
    `[N10] authored typecheck degraded to a no-op: ${reason}. Crash-class unbound names will NOT be caught before render.`,
  );
}

function n10DegradedIssue(workspaceRoot: string, reason: string): SafetyIssue {
  warnN10Degraded(reason);
  return {
    check: "N10",
    severity: "warning",
    path: resolve(workspaceRoot),
    message: `Authored typecheck skipped: ${reason}. N10 degraded to a no-op; crash-class unbound names were not checked before render.`,
  };
}

const TYPECHECK_CACHE_CAP = 12;
const typecheckCache = new Map<string, SafetyIssue[]>();
const typecheckCacheStats = { hits: 0, misses: 0 };

/**
 * N10 — TypeScript typecheck of AI-authored scene modules (B-minimal / crash-only).
 *
 * Policy: only **unbound-name** diagnostics (`TS2304` / "Cannot find name") are
 * emitted as hard errors. Those become `ReferenceError` under the transpile-only
 * render bundler and trip SceneErrorBoundary. Style/CSSProperties noise, excess
 * props, wrong-shape props, and other type diagnostics are **dropped** (no soft
 * warning landfill — normalizer + vision own those classes).
 *
 * Scope + safety (this gate must never block a renderable video for non-crash noise):
 * - Only diagnostics located IN the authored files are considered; MotionReal
 *   package sources are filtered out.
 * - `noUncheckedIndexedAccess` is OFF here (ON repo-wide) so common `arr[i]`
 *   access does not flood diagnostics.
 * - If workspace MotionReal sources can't be resolved, N10 **degrades to a no-op
 *   warning** rather than blocking every render.
 */

/**
 * @motionreal/* path mapping, mirroring the root tsconfig (sources, not built
 * d.ts). Runtime packages are included because `@motionreal/compositions`
 * depends on them transitively, even though authored scenes may not import them.
 */
function authoredPaths(workspaceRoot: string): Record<string, string[]> {
  const src = (name: string) => [resolve(workspaceRoot, "packages", name, "src", "index.ts")];
  const nodeModule = (...parts: string[]) => [resolve(workspaceRoot, "node_modules", ...parts)];
  return {
    // Authored files usually live under VIDEO_TOOL_HOME, which may be outside
    // the repo. Point bare allowed imports at the workspace dependency graph so
    // TypeScript does not search upward from the project folder and false-block
    // with "Cannot find module 'react'".
    react: nodeModule("@types", "react", "index.d.ts"),
    "react/jsx-runtime": nodeModule("@types", "react", "jsx-runtime.d.ts"),
    remotion: nodeModule("remotion", "dist", "cjs", "index.d.ts"),
    zod: nodeModule("zod", "index.d.cts"),
    "@motionreal/schema": src("schema"),
    "@motionreal/theme": src("theme"),
    "@motionreal/blocks": src("blocks"),
    "@motionreal/tts": src("tts"),
    "@motionreal/compositions": src("compositions"),
    "@motionreal/pipeline": src("pipeline"),
    "@motionreal/pipeline/*": [resolve(workspaceRoot, "packages", "pipeline", "src", "*")],
  };
}

function requiredTypecheckPaths(workspaceRoot: string): RequiredTypecheckPath[] {
  const paths = authoredPaths(workspaceRoot);
  const required = [
    "react",
    "react/jsx-runtime",
    "remotion",
    "zod",
    "@motionreal/schema",
    "@motionreal/theme",
    "@motionreal/blocks",
    "@motionreal/tts",
    "@motionreal/compositions",
    "@motionreal/pipeline",
  ];
  return required.flatMap((label) => (paths[label] ?? []).map((path) => ({ label, path })));
}

export function checkTypecheckAuthoredReadiness(workspaceRoot: string): TypecheckAuthoredReadiness {
  const root = resolve(workspaceRoot);
  const missing = requiredTypecheckPaths(root).filter((entry) => !existsSync(entry.path));
  return { ok: missing.length === 0, workspaceRoot: root, missing };
}

export function describeTypecheckAuthoredReadiness(readiness: TypecheckAuthoredReadiness): string {
  if (readiness.ok) return `required source/type paths resolved under ${readiness.workspaceRoot}`;
  const shown = readiness.missing
    .slice(0, 3)
    .map((entry) => `${entry.label} at ${entry.path}`)
    .join("; ");
  const extra = readiness.missing.length > 3 ? `; +${readiness.missing.length - 3} more` : "";
  return `missing ${readiness.missing.length} required source/type path(s): ${shown}${extra}`;
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
 * authored file (path is `file:line:col`). Returns `[]` when there are no files.
 * Returns a non-blocking N10 warning when the workspace sources can't be resolved
 * or typecheck setup fails; it never throws and never hard-blocks a render it
 * cannot check correctly.
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
  const readiness = checkTypecheckAuthoredReadiness(workspaceRoot);
  if (!readiness.ok) {
    return [n10DegradedIssue(readiness.workspaceRoot, describeTypecheckAuthoredReadiness(readiness))];
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
    return [n10DegradedIssue(workspaceRoot, `typecheck setup failed (${e instanceof Error ? e.message : String(e)})`)];
  }

  const authored = new Set(files.map((f) => resolve(f)));
  const issues: SafetyIssue[] = [];
  let droppedNonCrash = 0;
  for (const d of ts.getPreEmitDiagnostics(program)) {
    // Skip global/options diagnostics (no file) and errors inside MotionReal sources.
    if (!d.file || !authored.has(resolve(d.file.fileName))) continue;
    const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    // B-minimal: only unbound names (ReferenceError at render) enter the report.
    // Style/CSSProperties/TS2339 data-field noise is dropped — normalizer + vision
    // own those classes; soft warnings had no consumer and cluttered throughput.
    if (!isN10CrashClassDiagnostic(d.code, message)) {
      droppedNonCrash += 1;
      continue;
    }
    const abs = resolve(d.file.fileName);
    let path = d.file.fileName;
    if (typeof d.start === "number") {
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
      path = `${d.file.fileName}:${line + 1}:${character + 1}`;
    }
    const sceneId = sceneIdByFile?.get(abs);
    issues.push({
      check: "N10",
      severity: "error",
      path,
      ...(sceneId ? { sceneId } : {}),
      message: `TS${d.code}: ${message}`,
    });
  }
  if (droppedNonCrash > 0) {
    // Owner metric only — not a safety-report warning (no repair consumer).
    console.debug(`[N10] B-minimal: dropped ${droppedNonCrash} non-crash diagnostic(s)`);
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
 * B-minimal crash-class filter (E2E + local N31 sample).
 *
 * Hard-block only diagnostics that map to ReferenceError under transpile-only
 * bundling (unbound identifier). Everything else is dropped from the report —
 * style/CSSProperties excess, missing data fields, prop noise — so N10 does not
 * become another soft-warning landfill or throughput rock.
 *
 * Expand this allowlist only with a proven N31/ReferenceError fixture (same
 * discipline as RN AST strip tests). Exported for unit tests.
 */
export function isN10CrashClassDiagnostic(code: number, message: string): boolean {
  return code === 2304 || /Cannot find name\b/.test(message);
}


