import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { bundle, type WebpackOverrideFn } from "@remotion/bundler";
import { ensureBrowser, makeCancelSignal, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import type { CancelSignal, ChromeMode, ChromiumOptions, VideoImageFormat } from "@remotion/renderer";
import type { LockedVideoSpec } from "@news/schema";
import { transitionFrames } from "@news/schema";
import { createLogger } from "../log/logger.js";
import { stableStringify } from "./cache.js";
import { transitionSampleFileName, transitionSampleFrame } from "./transition-samples.js";

const DEFAULT_COMPOSITION_ID = "NewsVideo";

const log = createLogger("render");

type LogLevel = "trace" | "verbose" | "info" | "warn" | "error";

export type RenderTiming = {
  name: string;
  ms: number;
  meta?: Record<string, unknown>;
};

type RenderBaseOptions = {
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
  /** Abort the in-flight render(s) when this fires (user pressed "Dừng"). */
  signal?: AbortSignal;
};

export type RenderOpenGlRenderer = NonNullable<ChromiumOptions["gl"]>;
export type RenderChromeMode = ChromeMode;

function roundMs(ms: number): number {
  return Math.round(ms * 100) / 100;
}

function emitTiming(
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

async function timedRender<T>(
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

/**
 * Bridge a caller's AbortSignal to a fresh Remotion cancel token so a "Dừng"
 * press tears down headless Chromium mid-render instead of waiting it out.
 * Returns undefined when there's no signal (so callers spread an empty
 * cancelSignal). An already-aborted signal cancels immediately.
 */
function bridgeCancel(signal?: AbortSignal): CancelSignal | undefined {
  if (!signal) return undefined;
  const cancel = makeCancelSignal();
  if (signal.aborted) cancel.cancel();
  else signal.addEventListener("abort", () => cancel.cancel(), { once: true });
  return cancel.cancelSignal;
}

function chromiumRuntimeOptions(opts: RenderBaseOptions): Pick<RenderBaseOptions, "chromiumOptions" | "chromeMode"> {
  return {
    ...(opts.chromiumOptions !== undefined ? { chromiumOptions: opts.chromiumOptions } : {}),
    ...(opts.chromeMode ? { chromeMode: opts.chromeMode } : {}),
  };
}

/**
 * Render quality. `full` = the final high-quality h264 (slow-ish). `draft` =
 * a fast, low-resolution preview (half scale + ultrafast x264 + jpeg frames) so
 * the AI / user can eyeball motion and pacing quickly in the review loop before
 * committing to the expensive full render. Timing/fps are identical in both, so
 * a draft is a faithful (just softer/smaller) preview of the final cut.
 */
export type RenderQuality = "full" | "draft";

/** Fast-preview encode knobs applied when quality === "draft". */
const DRAFT_ENCODE = {
  scale: 0.5,
  crf: 30,
  jpegQuality: 70,
  imageFormat: "jpeg" as VideoImageFormat,
  x264Preset: "ultrafast" as const,
};

export type RenderVideoOptions = RenderBaseOptions & {
  spec: LockedVideoSpec;
  outPath: string;
  concurrency?: number | string | null;
  onProgress?: (ratio: number) => void;
  /** `draft` renders a fast low-res preview; defaults to `full`. */
  quality?: RenderQuality;
};

export type RenderVideoResult = {
  outPath: string;
  durationInFrames: number;
  fps: number;
};

export type RenderSceneStillsOptions = RenderBaseOptions & {
  onProgress?: (done: number, total: number) => void;
  /**
   * Extra per-scene still samples, as fractions (0..1) through the scene's CLEAN
   * SPEECH window (between the head/tail transition overlaps), in ADDITION to the
   * midpoint keyframe. Used by the late-sample N14 pass to catch content that
   * drifts out of the safe zone AFTER the midpoint (entrances settle by midpoint,
   * so the midpoint still alone never sees late drift). Each extra still is named
   * `<scene.id>.f<pct>.png` (e.g. `scene-03.f82.png`). The returned path list is
   * unchanged (midpoints only), so the review contact sheet is unaffected.
   */
  extraFractions?: number[];
  /** Extra per-transition samples, as fractions through each fixed overlap. */
  transitionFractions?: number[];
  /**
   * Render stills for ONLY these scene ids (the fast refine loop re-renders just
   * the scenes it edited — R4.3/R5.3). The composition still bundles + lays out
   * the WHOLE video (so each scene's frame math is unchanged), we just skip
   * writing a PNG for scenes not in the set. Absent/empty ⇒ every scene (the
   * historical behavior). An id not in the spec is ignored.
   */
  sceneIds?: string[];
};

type PreparedComposition = {
  serveUrl: string;
  composition: Awaited<ReturnType<typeof selectComposition>>;
  inputProps: { spec: LockedVideoSpec };
};

/** Browser launch + per-frame resolve timeout. The FIRST render on a cold
 * Windows box can spend >30s just launching chrome-headless-shell (antivirus
 * scan / first-run extraction), so give the browser setup generous headroom. */
const BROWSER_TIMEOUT_MS = 120_000;

/** Node API path: ensure Chromium, bundle the Remotion app, select composition, render h264 MP4. */
export async function renderVideo(opts: RenderVideoOptions): Promise<RenderVideoResult> {
  const outPath = resolve(opts.outPath);
  const timingOpts: RenderVideoOptions = { ...opts, timingScope: opts.timingScope ?? "video" };
  const prepared = await prepareComposition(opts.spec, {
    ...timingOpts,
    artifactPath: outPath,
  });

  await mkdir(dirname(outPath), { recursive: true });
  const draft = timingOpts.quality === "draft";
  const cancelSignal = bridgeCancel(timingOpts.signal);
  await timedRender(
    timingOpts,
    "renderMedia",
    () =>
      renderMedia({
        composition: prepared.composition,
        serveUrl: prepared.serveUrl,
        codec: "h264",
        outputLocation: outPath,
        inputProps: prepared.inputProps,
        concurrency: timingOpts.concurrency ?? null,
        overwrite: true,
        timeoutInMilliseconds: BROWSER_TIMEOUT_MS,
        logLevel: timingOpts.logLevel ?? "warn",
        onProgress: ({ progress }) => timingOpts.onProgress?.(progress),
        ...chromiumRuntimeOptions(timingOpts),
        ...(cancelSignal ? { cancelSignal } : {}),
        ...(draft
          ? {
              scale: DRAFT_ENCODE.scale,
              crf: DRAFT_ENCODE.crf,
              jpegQuality: DRAFT_ENCODE.jpegQuality,
              imageFormat: DRAFT_ENCODE.imageFormat,
              x264Preset: DRAFT_ENCODE.x264Preset,
            }
          : {}),
      }),
    { quality: timingOpts.quality ?? "full", concurrency: timingOpts.concurrency ?? "default" },
  );

  return {
    outPath,
    durationInFrames: prepared.composition.durationInFrames,
    fps: prepared.composition.fps,
  };
}

/**
 * The CLEAN SPEECH window of scene `i` in COMPOSITION-timeline frames: the span
 * between this scene's head/tail transition overlaps. Mirrors the lock math
 * ([authoring/lock.ts]): a scene's `durationInFrames = speech + headT + tailT`,
 * where `headT`/`tailT` are `T_TRANSITION` (0 at the first/last scene, and 0 for
 * a single-scene video). Sampling inside this window keeps a late still clear of
 * the cross-fade with the neighbouring scene (which would blend two scenes into
 * one frame and false-fire the safe-area oracle).
 */
function speechWindow(spec: LockedVideoSpec, index: number): { start: number; frames: number } {
  const n = spec.scenes.length;
  const T = n > 1 ? transitionFrames(spec.fps) : 0;
  const scene = spec.scenes[index]!;
  const headT = index === 0 ? 0 : T;
  const tailT = index === n - 1 ? 0 : T;
  const frames = Math.max(1, scene.durationInFrames - headT - tailT);
  return { start: scene.startFrame + headT, frames };
}

/** Clamp a composition frame into the valid [0, total) range. */
function clampFrame(frame: number, spec: LockedVideoSpec): number {
  return Math.min(Math.max(0, Math.floor(frame)), Math.max(0, spec.durationInFrames - 1));
}

/** `f82` for 0.82 — the on-disk suffix for an extra-fraction still. */
function fractionTag(fraction: number): string {
  return `f${Math.round(fraction * 100)}`;
}

/** Render one PNG per scene at the scene midpoint for the later review loop. */
export async function renderSceneStills(
  spec: LockedVideoSpec,
  outDir: string,
  opts: RenderSceneStillsOptions = {},
): Promise<string[]> {
  const stillDir = resolve(outDir);
  const timingOpts: RenderSceneStillsOptions = { ...opts, timingScope: opts.timingScope ?? "stills" };
  const prepared = await prepareComposition(spec, {
    ...timingOpts,
    artifactPath: stillDir,
  });
  await mkdir(stillDir, { recursive: true });

  const cancelSignal = bridgeCancel(timingOpts.signal);
  // Optional scene-id filter: the fast refine loop re-renders only the scenes it
  // edited. The composition still lays out the whole video (frame math unchanged);
  // we just skip writing a PNG for scenes outside the set. Empty/absent ⇒ all.
  const onlyIds = timingOpts.sceneIds && timingOpts.sceneIds.length > 0 ? new Set(timingOpts.sceneIds) : null;
  const outputs: string[] = [];
  for (const [index, scene] of spec.scenes.entries()) {
    if (onlyIds && !onlyIds.has(scene.id)) continue;
    const output = join(stillDir, `${scene.id}.png`);
    const midpoint = scene.startFrame + Math.floor(scene.durationInFrames / 2);
    const frame = Math.min(Math.max(0, midpoint), Math.max(0, spec.durationInFrames - 1));
    await timedRender(
      timingOpts,
      "renderStill",
      () =>
        renderStill({
          composition: prepared.composition,
          serveUrl: prepared.serveUrl,
          output,
          frame,
          inputProps: prepared.inputProps,
          imageFormat: "png",
          overwrite: true,
          timeoutInMilliseconds: BROWSER_TIMEOUT_MS,
          logLevel: timingOpts.logLevel ?? "warn",
          ...chromiumRuntimeOptions(timingOpts),
          ...(cancelSignal ? { cancelSignal } : {}),
        }),
      { sceneId: scene.id, frame, kind: "midpoint" },
    );
    outputs.push(output);

    // Extra late samples (N14 late-drift pass): one still per requested fraction
    // through the CLEAN speech window. Named `<id>.f<pct>.png`; NOT added to the
    // returned list, so the review contact sheet stays one-still-per-scene.
    for (const fraction of timingOpts.extraFractions ?? []) {
      const win = speechWindow(spec, index);
      const lateFrame = clampFrame(win.start + Math.round(fraction * win.frames), spec);
      await timedRender(
        timingOpts,
        "renderStill",
        () =>
          renderStill({
            composition: prepared.composition,
            serveUrl: prepared.serveUrl,
            output: join(stillDir, `${scene.id}.${fractionTag(fraction)}.png`),
            frame: lateFrame,
            inputProps: prepared.inputProps,
            imageFormat: "png",
            overwrite: true,
            timeoutInMilliseconds: BROWSER_TIMEOUT_MS,
            logLevel: timingOpts.logLevel ?? "warn",
            ...chromiumRuntimeOptions(timingOpts),
            ...(cancelSignal ? { cancelSignal } : {}),
          }),
        { sceneId: scene.id, frame: lateFrame, kind: "late", fraction },
      );
    }

    if (index < spec.scenes.length - 1) {
      const next = spec.scenes[index + 1]!;
      for (const fraction of timingOpts.transitionFractions ?? []) {
        const transitionFrame = transitionSampleFrame(spec, index, fraction);
        if (transitionFrame === null) continue;
        await timedRender(
          timingOpts,
          "renderStill",
          () =>
            renderStill({
              composition: prepared.composition,
              serveUrl: prepared.serveUrl,
              output: join(stillDir, transitionSampleFileName(scene.id, next.id, fraction)),
              frame: transitionFrame,
              inputProps: prepared.inputProps,
              imageFormat: "png",
              overwrite: true,
              timeoutInMilliseconds: BROWSER_TIMEOUT_MS,
              logLevel: timingOpts.logLevel ?? "warn",
              ...chromiumRuntimeOptions(timingOpts),
              ...(cancelSignal ? { cancelSignal } : {}),
            }),
          { sceneId: next.id, frame: transitionFrame, kind: "transition", fraction, fromSceneId: scene.id },
        );
      }
    }

    timingOpts.onProgress?.(index + 1, spec.scenes.length);
  }
  return outputs;
}

/** A measured composed-block boundary in canvas pixels (matches the oracle Rect). */
export type MeasuredBlock = { kind: string; x: number; y: number; width: number; height: number };

/**
 * Measure the real DOM layout of COMPOSED `@news/blocks` units, per scene,
 * by rendering each scene's midpoint frame in the dedicated MEASURE mode
 * (`measure: true` mounts the `LayoutProbe`, which emits the tagged blocks'
 * `getBoundingClientRect()` as a `layout.json` artifact). This is the
 * vision-independent input the N15 (overlap) / N17 (clipping) oracles need but
 * a flat raster can't carry. Best-effort per scene: a scene whose probe emits
 * nothing (or fails) yields an empty block list and is simply not flagged.
 *
 * It renders the SAME frames as `renderSceneStills` but discards the image
 * (output: null) — only the artifact matters — so it never touches the real
 * `NewsVideo` render path and production pixels stay byte-identical.
 */
export async function measureSceneLayouts(
  spec: LockedVideoSpec,
  opts: RenderSceneStillsOptions = {},
): Promise<Record<string, MeasuredBlock[]>> {
  const timingOpts: RenderSceneStillsOptions = { ...opts, timingScope: opts.timingScope ?? "layout-measure" };
  const prepared = await prepareComposition(spec, { ...timingOpts, artifactPath: resolve(timingOpts.projectRoot ?? ".") });
  const measureProps = { ...prepared.inputProps, measure: true };
  // selectComposition resolves + freezes the props the render uses, so a measure
  // still must RE-SELECT with measure:true — passing it only to renderStill's
  // inputProps leaves the frozen (non-measure) resolved props in place and the
  // probe never mounts. Re-select once here against the same bundle.
  const measureComposition = await timedRender(
    timingOpts,
    "selectComposition.measure",
    () =>
      selectComposition({
        serveUrl: prepared.serveUrl,
        id: timingOpts.compositionId ?? DEFAULT_COMPOSITION_ID,
        inputProps: measureProps,
        timeoutInMilliseconds: BROWSER_TIMEOUT_MS,
        logLevel: timingOpts.logLevel ?? "warn",
        ...chromiumRuntimeOptions(timingOpts),
      }),
    { compositionId: timingOpts.compositionId ?? DEFAULT_COMPOSITION_ID },
  );
  const byScene: Record<string, MeasuredBlock[]> = {};
  const cancelSignal = bridgeCancel(timingOpts.signal);
  const onlyIds = timingOpts.sceneIds && timingOpts.sceneIds.length > 0 ? new Set(timingOpts.sceneIds) : null;
  const scenesToMeasure = spec.scenes
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) => !onlyIds || onlyIds.has(scene.id));

  for (const [progressIndex, { scene, index }] of scenesToMeasure.entries()) {
    const midpoint = scene.startFrame + Math.floor(scene.durationInFrames / 2);
    const frame = Math.min(Math.max(0, midpoint), Math.max(0, spec.durationInFrames - 1));
    let blocks: MeasuredBlock[] = [];
    try {
      await timedRender(
        timingOpts,
        "renderStill",
        () =>
          renderStill({
            composition: measureComposition,
            serveUrl: prepared.serveUrl,
            output: null,
            frame,
            inputProps: measureProps,
            imageFormat: "png",
            overwrite: true,
            timeoutInMilliseconds: BROWSER_TIMEOUT_MS,
            logLevel: timingOpts.logLevel ?? "warn",
            ...chromiumRuntimeOptions(timingOpts),
            ...(cancelSignal ? { cancelSignal } : {}),
            onArtifact: (artifact) => {
              try {
                const text = typeof artifact.content === "string" ? artifact.content : Buffer.from(artifact.content).toString("utf8");
                const parsed = JSON.parse(text) as { blocks?: MeasuredBlock[] };
                if (Array.isArray(parsed.blocks)) blocks = parsed.blocks;
              } catch {
                /* a malformed artifact yields no blocks for this scene */
              }
            },
          }),
        { sceneId: scene.id, frame, kind: "measure" },
      );
    } catch {
      /* a scene that fails to measure simply contributes no blocks */
    }
    byScene[scene.id] = blocks;
    timingOpts.onProgress?.(progressIndex + 1, scenesToMeasure.length);
  }
  return byScene;
}

export type RenderFrameOptions = RenderBaseOptions;

/**
 * Render one frame of the locked spec twice (same bundle, same composition)
 * to two output PNGs. This is the low-level primitive behind the determinism
 * guard (N16): bundling once and rendering the same frame twice means any
 * per-render nondeterminism in scene code (hidden Math.random / Date / time)
 * surfaces as differing bytes. Pixel comparison + reporting lives in
 * determinism.ts so this stays a thin renderer helper.
 */
export async function renderFrameTwice(
  spec: LockedVideoSpec,
  frame: number,
  outputs: readonly [string, string],
  opts: RenderFrameOptions = {},
): Promise<[string, string]> {
  const outA = resolve(outputs[0]);
  const outB = resolve(outputs[1]);
  const timingOpts: RenderFrameOptions = { ...opts, timingScope: opts.timingScope ?? "determinism" };
  const prepared = await prepareComposition(spec, { ...timingOpts, artifactPath: outA });
  const clamped = Math.min(Math.max(0, Math.floor(frame)), Math.max(0, spec.durationInFrames - 1));
  const cancelSignal = bridgeCancel(timingOpts.signal);

  const result: string[] = [];
  for (const [sample, output] of [
    ["a", outA],
    ["b", outB],
  ] as const) {
    await mkdir(dirname(output), { recursive: true });
    await timedRender(
      timingOpts,
      "renderStill",
      () =>
        renderStill({
          composition: prepared.composition,
          serveUrl: prepared.serveUrl,
          output,
          frame: clamped,
          inputProps: prepared.inputProps,
          imageFormat: "png",
          overwrite: true,
          timeoutInMilliseconds: BROWSER_TIMEOUT_MS,
          logLevel: timingOpts.logLevel ?? "warn",
          ...chromiumRuntimeOptions(timingOpts),
          ...(cancelSignal ? { cancelSignal } : {}),
        }),
      { frame: clamped, sample },
    );
    result.push(output);
  }
  return [result[0]!, result[1]!];
}

export function remotionEntry(): string {
  return join(remotionAppRoot(), "src", "index.ts");
}

export function remotionAppRoot(): string {
  return join(workspaceRoot(), "apps", "remotion");
}

export function workspaceRoot(): string {
  // This file lives at packages/pipeline/src/render/renderer.ts → up 4 to repo root.
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
}

/**
 * Bundle-cache (Phase A render optimization). A serveUrl from `bundle()` does
 * NOT depend on the spec — the spec enters at `selectComposition`/`renderStill`
 * via `inputProps`, never at bundle time. So within ONE `renderProject` the
 * determinism/encode/review passes all bundle the SAME source + publicDir and
 * can reuse one serveUrl; only `selectComposition` (cheap, and where the
 * duration check lives) needs to re-run per pass. Remotion docs call bundling
 * per-render an anti-pattern for exactly this reason.
 *
 * Safe as a module-level Map because renders are strictly SERIAL (bulk is a
 * for-await loop; desktop guards per-project via `inFlight`; no worker-thread
 * render), so an evicted serveUrl is never one a concurrent render is using.
 */
const bundleCache = new Map<string, string>();
/** LRU cap. 2 keeps both live keys warm in one render: the project entry
 * (det/encode/review) and the demo entry the measure pass bundles separately. */
const BUNDLE_CACHE_CAP = 2;
const compositionCache = new Map<string, Pick<PreparedComposition, "serveUrl" | "composition">>();
const COMPOSITION_CACHE_CAP = 8;
const bundleLog = createLogger("render");

/**
 * Cache key for a bundle. Folds in exactly what determines the webpack output:
 * the entry path, the Remotion root, the publicDir PATH, and the entry file's
 * CONTENT hash. `webpackOverride` is a constant so it's omitted. The spec is
 * omitted (bundle is spec-independent). publicDir is keyed by PATH not content:
 * within a render the encode/review steps WRITE outputs (MP4, stills) into the
 * project root = publicDir, so content-hashing it would shift the key mid-render
 * and defeat the cache — and those outputs are never imported by a scene, so the
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

async function prepareComposition(
  spec: LockedVideoSpec,
  opts: RenderBaseOptions & { artifactPath: string },
): Promise<PreparedComposition> {
  const inputProps = { spec };
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
  const compositionCacheKey = compositionKey(key, compositionId, spec);
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

function compositionKey(bundleCacheKey: string, compositionId: string, spec: LockedVideoSpec): string {
  const h = createHash("sha256");
  h.update(bundleCacheKey);
  h.update("\0");
  h.update(compositionId);
  h.update("\0");
  h.update(stableStringify(spec), "utf8");
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
 * sources directly: it maps each `@news/*` package to its `src/index.ts` and
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
        "@news/schema": pkg("schema"),
        "@news/theme": pkg("theme"),
        "@news/blocks": pkg("blocks"),
        "@news/compositions": pkg("compositions"),
        "@news/tts": pkg("tts"),
        "@news/pipeline": pkg("pipeline"),
      },
    },
  });
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
