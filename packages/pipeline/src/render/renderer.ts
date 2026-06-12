import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle, type WebpackOverrideFn } from "@remotion/bundler";
import { ensureBrowser, makeCancelSignal, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import type { CancelSignal, VideoImageFormat } from "@remotion/renderer";
import type { LockedVideoSpec } from "@news/schema";
import { transitionFrames } from "@news/schema";

const DEFAULT_COMPOSITION_ID = "NewsVideo";

type LogLevel = "trace" | "verbose" | "info" | "warn" | "error";

type RenderBaseOptions = {
  compositionId?: string;
  entryPoint?: string;
  remotionRoot?: string;
  projectRoot?: string;
  publicDir?: string | null;
  logLevel?: LogLevel;
  /** Abort the in-flight render(s) when this fires (user pressed "Dừng"). */
  signal?: AbortSignal;
};

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
  const prepared = await prepareComposition(opts.spec, {
    ...opts,
    artifactPath: outPath,
  });

  await mkdir(dirname(outPath), { recursive: true });
  const draft = opts.quality === "draft";
  const cancelSignal = bridgeCancel(opts.signal);
  await renderMedia({
    composition: prepared.composition,
    serveUrl: prepared.serveUrl,
    codec: "h264",
    outputLocation: outPath,
    inputProps: prepared.inputProps,
    concurrency: opts.concurrency ?? null,
    overwrite: true,
    timeoutInMilliseconds: BROWSER_TIMEOUT_MS,
    logLevel: opts.logLevel ?? "warn",
    onProgress: ({ progress }) => opts.onProgress?.(progress),
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
  });

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
  const prepared = await prepareComposition(spec, {
    ...opts,
    artifactPath: stillDir,
  });
  await mkdir(stillDir, { recursive: true });

  const cancelSignal = bridgeCancel(opts.signal);
  const outputs: string[] = [];
  for (const [index, scene] of spec.scenes.entries()) {
    const output = join(stillDir, `${scene.id}.png`);
    const midpoint = scene.startFrame + Math.floor(scene.durationInFrames / 2);
    const frame = Math.min(Math.max(0, midpoint), Math.max(0, spec.durationInFrames - 1));
    await renderStill({
      composition: prepared.composition,
      serveUrl: prepared.serveUrl,
      output,
      frame,
      inputProps: prepared.inputProps,
      imageFormat: "png",
      overwrite: true,
      timeoutInMilliseconds: BROWSER_TIMEOUT_MS,
      logLevel: opts.logLevel ?? "warn",
      ...(cancelSignal ? { cancelSignal } : {}),
    });
    outputs.push(output);

    // Extra late samples (N14 late-drift pass): one still per requested fraction
    // through the CLEAN speech window. Named `<id>.f<pct>.png`; NOT added to the
    // returned list, so the review contact sheet stays one-still-per-scene.
    for (const fraction of opts.extraFractions ?? []) {
      const win = speechWindow(spec, index);
      const lateFrame = clampFrame(win.start + Math.round(fraction * win.frames), spec);
      await renderStill({
        composition: prepared.composition,
        serveUrl: prepared.serveUrl,
        output: join(stillDir, `${scene.id}.${fractionTag(fraction)}.png`),
        frame: lateFrame,
        inputProps: prepared.inputProps,
        imageFormat: "png",
        overwrite: true,
        timeoutInMilliseconds: BROWSER_TIMEOUT_MS,
        logLevel: opts.logLevel ?? "warn",
        ...(cancelSignal ? { cancelSignal } : {}),
      });
    }

    opts.onProgress?.(index + 1, spec.scenes.length);
  }
  return outputs;
}

/** A measured composed-block boundary in canvas pixels (matches the oracle Rect). */
export type MeasuredBlock = { kind: string; x: number; y: number; width: number; height: number };

/**
 * Measure the real DOM layout of every COMPOSED `@news/blocks` unit, per scene,
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
  const prepared = await prepareComposition(spec, { ...opts, artifactPath: resolve(opts.projectRoot ?? ".") });
  const measureProps = { ...prepared.inputProps, measure: true };
  // selectComposition resolves + freezes the props the render uses, so a measure
  // still must RE-SELECT with measure:true — passing it only to renderStill's
  // inputProps leaves the frozen (non-measure) resolved props in place and the
  // probe never mounts. Re-select once here against the same bundle.
  const measureComposition = await selectComposition({
    serveUrl: prepared.serveUrl,
    id: opts.compositionId ?? DEFAULT_COMPOSITION_ID,
    inputProps: measureProps,
    timeoutInMilliseconds: BROWSER_TIMEOUT_MS,
    logLevel: opts.logLevel ?? "warn",
  });
  const byScene: Record<string, MeasuredBlock[]> = {};
  const cancelSignal = bridgeCancel(opts.signal);

  for (const [index, scene] of spec.scenes.entries()) {
    const midpoint = scene.startFrame + Math.floor(scene.durationInFrames / 2);
    const frame = Math.min(Math.max(0, midpoint), Math.max(0, spec.durationInFrames - 1));
    let blocks: MeasuredBlock[] = [];
    try {
      await renderStill({
        composition: measureComposition,
        serveUrl: prepared.serveUrl,
        output: null,
        frame,
        inputProps: measureProps,
        imageFormat: "png",
        overwrite: true,
        timeoutInMilliseconds: BROWSER_TIMEOUT_MS,
        logLevel: opts.logLevel ?? "warn",
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
      });
    } catch {
      /* a scene that fails to measure simply contributes no blocks */
    }
    byScene[scene.id] = blocks;
    opts.onProgress?.(index + 1, spec.scenes.length);
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
  const prepared = await prepareComposition(spec, { ...opts, artifactPath: outA });
  const clamped = Math.min(Math.max(0, Math.floor(frame)), Math.max(0, spec.durationInFrames - 1));
  const cancelSignal = bridgeCancel(opts.signal);

  const result: string[] = [];
  for (const output of [outA, outB]) {
    await mkdir(dirname(output), { recursive: true });
    await renderStill({
      composition: prepared.composition,
      serveUrl: prepared.serveUrl,
      output,
      frame: clamped,
      inputProps: prepared.inputProps,
      imageFormat: "png",
      overwrite: true,
      timeoutInMilliseconds: BROWSER_TIMEOUT_MS,
      logLevel: opts.logLevel ?? "warn",
      ...(cancelSignal ? { cancelSignal } : {}),
    });
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

async function prepareComposition(
  spec: LockedVideoSpec,
  opts: RenderBaseOptions & { artifactPath: string },
): Promise<PreparedComposition> {
  const inputProps = { spec };
  const publicDir = resolvePublicDir(opts);
  assertStaticAudioCanResolve(spec, publicDir);

  await ensureBrowser({ logLevel: opts.logLevel ?? "warn" });
  const serveUrl = await bundle({
    entryPoint: opts.entryPoint ?? remotionEntry(),
    rootDir: opts.remotionRoot ?? remotionAppRoot(),
    publicDir,
    webpackOverride: makeWorkspaceWebpackOverride(workspaceRoot()),
  });
  const composition = await selectComposition({
    serveUrl,
    id: opts.compositionId ?? DEFAULT_COMPOSITION_ID,
    inputProps,
    timeoutInMilliseconds: BROWSER_TIMEOUT_MS,
    logLevel: opts.logLevel ?? "warn",
  });

  if (composition.durationInFrames !== spec.durationInFrames) {
    throw new Error(
      `Selected composition duration ${composition.durationInFrames} does not match locked spec ${spec.durationInFrames}.`,
    );
  }

  return { serveUrl, composition, inputProps };
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
        "@news/design": pkg("design"),
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
