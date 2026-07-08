import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { bundle, type WebpackOverrideFn } from "@remotion/bundler";
import { ensureBrowser, selectComposition } from "@remotion/renderer";
import type { ChromeMode, ChromiumOptions } from "@remotion/renderer";
import type { LockedVideoSpec } from "@motionreal/schema";
import { createLogger } from "../log/logger.js";
import { stableStringify } from "./cache.js";

export const DEFAULT_COMPOSITION_ID = "MotionRealVideo";

const log = createLogger("render");
const bundleLog = createLogger("render");

export type LogLevel = "trace" | "verbose" | "info" | "warn" | "error";

export type RenderTiming = {
  name: string;
  ms: number;
  meta?: Record<string, unknown>;
};

export type RenderBaseOptions = {
  compositionId?: string;
  entryPoint?: string;
  remotionRoot?: string;
  projectRoot?: string;
  publicDir?: string | null;
  chromiumOptions?: ChromiumOptions;
  chromeMode?: ChromeMode;
  logLevel?: LogLevel;
  /** Optional sink for render timing instrumentation. Must not affect render behavior. */
  onTiming?: (timing: RenderTiming) => void;
  /** Prefix for timing names (e.g. "video", "review-stills", "determinism"). */
  timingScope?: string;
  /** Abort the in-flight render(s) when this fires (user pressed "Dung"). */
  signal?: AbortSignal;
};

export type StrictSceneErrorOptions = {
  /** Probe mode: render authored scenes without the fallback error boundary. */
  strictSceneErrors?: boolean;
};

export type VideoCompositionInputProps = {
  spec: LockedVideoSpec;
  measure?: boolean;
  strictSceneErrors?: boolean;
};

export type PreparedComposition = {
  serveUrl: string;
  composition: Awaited<ReturnType<typeof selectComposition>>;
  inputProps: VideoCompositionInputProps;
};

/** Browser launch + per-frame resolve timeout. The FIRST render on a cold
 * Windows box can spend >30s just launching chrome-headless-shell (antivirus
 * scan / first-run extraction), so give the browser setup generous headroom. */
export const BROWSER_TIMEOUT_MS = 120_000;

function roundMs(ms: number): number {
  return Math.round(ms * 100) / 100;
}

export function emitTiming(
  opts: Pick<RenderBaseOptions, "onTiming" | "timingScope">,
  name: string,
  startedAt: number,
  meta?: Record<string, unknown>,
): void {
  if (!opts.onTiming) return;
  const timing: RenderTiming = {
    name: `${opts.timingScope ?? "render"}.${name}`,
    ms: roundMs(performance.now() - startedAt),
  };
  if (meta && Object.keys(meta).length > 0) timing.meta = meta;
  try {
    opts.onTiming(timing);
  } catch (error) {
    log.warn({ err: error instanceof Error ? error.message : String(error) }, "render timing sink failed");
  }
}

export async function timedRender<T>(
  opts: Pick<RenderBaseOptions, "onTiming" | "timingScope">,
  name: string,
  fn: () => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await fn();
  } finally {
    emitTiming(opts, name, startedAt, meta);
  }
}

export function chromiumRuntimeOptions(opts: RenderBaseOptions): Pick<RenderBaseOptions, "chromiumOptions" | "chromeMode"> {
  return {
    ...(opts.chromiumOptions !== undefined ? { chromiumOptions: opts.chromiumOptions } : {}),
    ...(opts.chromeMode ? { chromeMode: opts.chromeMode } : {}),
  };
}

export function remotionEntry(): string {
  return join(remotionAppRoot(), "src", "index.ts");
}

export function remotionAppRoot(): string {
  return join(workspaceRoot(), "apps", "remotion");
}

export function workspaceRoot(): string {
  // This file lives at packages/pipeline/src/render/composition-prep.ts -> up 4 to repo root.
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
}

/**
 * Bundle-cache (Phase A render optimization). A serveUrl from `bundle` does
 * NOT depend on the spec -- the spec enters at `selectComposition`/`renderStill`
 * via `inputProps`, never at bundle time. So within ONE `renderProject` the
 * determinism/encode/review passes all bundle the SAME source + publicDir and
 * can reuse one serveUrl; only `selectComposition` (cheap, and where the
 * duration check lives) needs to re-run per pass. Remotion docs call bundling
 * per-render an anti-pattern for exactly this reason.
 *
 * Safe as a module-level Map because renders are strictly SERIAL (bulk is a
 * for-await loop; desktop guards per-project via `inFlight`; no worker-thread
 * render), so an evicted serveUrl is never one a concurrent render is using.
 * If future work enables parallel renders, revisit this cache first: eviction
 * removes bundle dirs without reference counts.
 */
const bundleCache = new Map<string, string>();
/** LRU cap. 2 keeps both live keys warm in one render: the project entry
 * (det/encode/review) and the demo entry the measure pass bundles separately. */
const BUNDLE_CACHE_CAP = 2;
const compositionCache = new Map<string, Pick<PreparedComposition, "serveUrl" | "composition">>();
const COMPOSITION_CACHE_CAP = 8;

/**
 * Cache key for a bundle. Folds in exactly what determines the webpack output:
 * the entry path, the Remotion root, the publicDir PATH, and the entry file's
 * CONTENT hash. `webpackOverride` is a constant so it's omitted. The spec is
 * omitted (bundle is spec-independent). publicDir is keyed by PATH not content:
 * within a render the encode/review steps WRITE outputs (MP4, stills) into the
 * project root = publicDir, so content-hashing it would shift the key mid-render
 * and defeat the cache -- and those outputs are never imported by a scene, so the
 * input assets (audio/images), which exist before the first bundle, are what
 * matters and they don't change within a render.
 *
 * The generated entry carries a content fingerprint of the authored files + lock
 * JSON, so the file only rewrites when those bundle inputs change. The bundle
 * key hashes entry CONTENT, so repeated identical renders stay hot even if the
 * filesystem refreshes the file timestamp.
 */
function bundleKey(entryPoint: string, remotionRoot: string, publicDir: string | null): string {
  const h = createHash("sha256");
  h.update(resolve(entryPoint));
  h.update("\0");
  h.update(resolve(remotionRoot));
  h.update("\0");
  h.update(publicDir ?? "null");
  h.update("\0");
  try {
    h.update(readFileSync(entryPoint));
  } catch {
    // No read (e.g. a virtual/default entry whose file is unreadable): fall
    // back to a path-only key. The default demo entry is a real file on disk,
    // so this only degrades exotic callers, never the production paths.
    h.update("nostat");
  }
  return h.digest("hex");
}

/** Evict the least-recently-used bundle, removing its temp dir best-effort. */
async function evictOldestBundle(): Promise<void> {
  const oldest = bundleCache.keys().next().value;
  if (oldest === undefined) return;
  const serveUrl = bundleCache.get(oldest);
  bundleCache.delete(oldest);
  if (serveUrl) evictCompositionsForServeUrl(serveUrl);
  if (serveUrl && !/^https?:\/\//i.test(serveUrl)) {
    try {
      await rm(serveUrl, { recursive: true, force: true });
    } catch (e) {
      // Best-effort: a leftover temp bundle dir is harmless (the OS reclaims
      // temp eventually); log so a real permission fault stays visible.
      bundleLog.warn({ serveUrl, err: e instanceof Error ? e.message : String(e) }, "bundle cache evict rm failed");
    }
  }
}

/** Test-only: clear the in-memory cache (does NOT rm temp dirs). */
export function __resetBundleCache(): void {
  bundleCache.clear();
  compositionCache.clear();
}

export async function prepareComposition(
  spec: LockedVideoSpec,
  opts: RenderBaseOptions & StrictSceneErrorOptions & { artifactPath: string },
): Promise<PreparedComposition> {
  const inputProps: VideoCompositionInputProps = {
    spec,
    ...(opts.strictSceneErrors ? { strictSceneErrors: true } : {}),
  };
  const publicDir = resolvePublicDir(opts);
  assertStaticAudioCanResolve(spec, publicDir);

  await timedRender(opts, "ensureBrowser", () =>
    ensureBrowser({
      logLevel: opts.logLevel ?? "warn",
      ...(opts.chromeMode ? { chromeMode: opts.chromeMode } : {}),
    }),
  );

  const entryPoint = opts.entryPoint ?? remotionEntry();
  const remotionRoot = opts.remotionRoot ?? remotionAppRoot();
  const key = bundleKey(entryPoint, remotionRoot, publicDir);
  const bundleStartedAt = performance.now();
  let serveUrl = bundleCache.get(key);
  if (serveUrl !== undefined) {
    // Refresh LRU recency: re-insert so this key is now the most-recent.
    bundleCache.delete(key);
    bundleCache.set(key, serveUrl);
    emitTiming(opts, "bundle.cache_hit", bundleStartedAt, { cacheKey: key.slice(0, 12) });
  } else {
    serveUrl = await timedRender(
      opts,
      "bundle",
      () =>
        bundle({
          entryPoint,
          rootDir: remotionRoot,
          publicDir,
          webpackOverride: makeWorkspaceWebpackOverride(workspaceRoot()),
        }),
      { cacheKey: key.slice(0, 12), publicDir: publicDir ?? null },
    );
    while (bundleCache.size >= BUNDLE_CACHE_CAP) await evictOldestBundle();
    bundleCache.set(key, serveUrl);
  }

  const compositionId = opts.compositionId ?? DEFAULT_COMPOSITION_ID;
  const compositionCacheKey = compositionKey(key, compositionId, inputProps);
  const selectStartedAt = performance.now();
  let composition = compositionCache.get(compositionCacheKey)?.composition;
  if (composition) {
    compositionCache.delete(compositionCacheKey);
    compositionCache.set(compositionCacheKey, { serveUrl, composition });
    emitTiming(opts, "selectComposition.cache_hit", selectStartedAt, { compositionId });
  } else {
    composition = await timedRender(
      opts,
      "selectComposition",
      () =>
        selectComposition({
          serveUrl,
          id: compositionId,
          inputProps,
          timeoutInMilliseconds: BROWSER_TIMEOUT_MS,
          logLevel: opts.logLevel ?? "warn",
          ...chromiumRuntimeOptions(opts),
        }),
      { compositionId },
    );
    while (compositionCache.size >= COMPOSITION_CACHE_CAP) evictOldestComposition();
    compositionCache.set(compositionCacheKey, { serveUrl, composition });
  }

  if (composition.durationInFrames !== spec.durationInFrames) {
    throw new Error(
      `Selected composition duration ${composition.durationInFrames} does not match locked spec ${spec.durationInFrames}.`,
    );
  }

  return { serveUrl, composition, inputProps };
}

function compositionKey(bundleCacheKey: string, compositionId: string, inputProps: VideoCompositionInputProps): string {
  const h = createHash("sha256");
  h.update(bundleCacheKey);
  h.update("\0");
  h.update(compositionId);
  h.update("\0");
  h.update(stableStringify(inputProps), "utf8");
  return h.digest("hex");
}

function evictOldestComposition(): void {
  const oldest = compositionCache.keys().next().value;
  if (oldest !== undefined) compositionCache.delete(oldest);
}

function evictCompositionsForServeUrl(serveUrl: string): void {
  for (const [key, cached] of compositionCache) {
    if (cached.serveUrl === serveUrl) compositionCache.delete(key);
  }
}

function resolvePublicDir(opts: RenderBaseOptions & { artifactPath: string }): string | null {
  if (opts.publicDir !== undefined) return opts.publicDir ? resolve(opts.publicDir) : null;
  if (opts.projectRoot) return resolve(opts.projectRoot);
  return inferProjectRootFromArtifactPath(opts.artifactPath);
}

function inferProjectRootFromArtifactPath(path: string): string | null {
  const dir = dirname(resolve(path));
  const folder = dir.split(/[\\/]/).at(-1);
  return folder === "renders" || folder === "review" ? dirname(dir) : null;
}

function assertStaticAudioCanResolve(spec: LockedVideoSpec, publicDir: string | null): void {
  const narrationSrc = spec.audio?.narrationSrc;
  if (narrationSrc && !/^https?:\/\//i.test(narrationSrc) && !publicDir) {
    throw new Error(
      `Locked spec uses local narration "${narrationSrc}". Pass projectRoot/publicDir or render under a project renders/review directory so Remotion staticFile() can resolve it.`,
    );
  }
}

/**
 * Webpack override that lets the bundler resolve the workspace's TypeScript
 * sources directly: it maps each `@motionreal/*` package to its `src/index.ts` and
 * teaches webpack that `.js` import specifiers may resolve to `.ts`/`.tsx`.
 * Exported so the production bundle build (`npm run build`) reuses the exact
 * same resolution rules as the renderer instead of duplicating them.
 */
export function makeWorkspaceWebpackOverride(root: string): WebpackOverrideFn {
  const pkg = (name: string) => resolve(root, "packages", name, "src", "index.ts");
  return (config) => ({
    ...config,
    resolve: {
      ...config.resolve,
      extensions: unique([".ts", ".tsx", ".js", ".jsx", ...(config.resolve?.extensions ?? [])]),
      extensionAlias: {
        ...(config.resolve?.extensionAlias ?? {}),
        ".js": [".ts", ".tsx", ".js"],
        ".jsx": [".tsx", ".jsx"],
      },
      alias: {
        ...(config.resolve?.alias ?? {}),
        "@motionreal/schema": pkg("schema"),
        "@motionreal/theme": pkg("theme"),
        "@motionreal/blocks": pkg("blocks"),
        "@motionreal/compositions": pkg("compositions"),
        "@motionreal/tts": pkg("tts"),
        "@motionreal/pipeline": pkg("pipeline"),
      },
    },
  });
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
