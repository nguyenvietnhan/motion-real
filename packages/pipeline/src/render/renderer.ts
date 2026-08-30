import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { makeCancelSignal, renderMedia, renderStill } from "@remotion/renderer";
import type { CancelSignal, ChromeMode, ChromiumOptions, VideoImageFormat } from "@remotion/renderer";
import type { LockedVideoSpec } from "@motionreal/schema";
import { transitionFrames } from "@motionreal/schema";
import {
  BROWSER_TIMEOUT_MS,
  chromiumRuntimeOptions,
  prepareComposition,
  timedRender,
  type RenderBaseOptions,
} from "./composition-prep.js";

export {
  __resetBundleCache,
  makeWorkspaceWebpackOverride,
  remotionAppRoot,
  remotionEntry,
  workspaceRoot,
} from "./composition-prep.js";
export type { RenderTiming } from "./composition-prep.js";

export type RenderOpenGlRenderer = NonNullable<ChromiumOptions["gl"]>;
export type RenderChromeMode = ChromeMode;

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
   * unchanged (midpoints only), so render-oracle frame accounting stays stable.
   */
  extraFractions?: number[];
  /**
   * Render stills for ONLY these scene ids (the fast refine loop re-renders just
   * the scenes it edited). The composition still bundles + lays out
   * the WHOLE video (so each scene's frame math is unchanged), we just skip
   * writing a PNG for scenes not in the set. Absent/empty ⇒ every scene (the
   * historical behavior). An id not in the spec is ignored.
   */
  sceneIds?: string[];
};

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
    // returned list, so render-oracle frame accounting stays one-still-per-scene.
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

    timingOpts.onProgress?.(index + 1, spec.scenes.length);
  }
  return outputs;
}

export const RUNTIME_PROBE_FRACTIONS = [0.12, 0.5, 0.82] as const;

export type RenderSceneRuntimeProbeIssue = {
  sceneId: string;
  frame: number;
  message: string;
};

export type RenderSceneRuntimeProbeOptions = RenderBaseOptions & {
  /** Fractions through each scene's clean speech window to sample. */
  fractions?: readonly number[];
  /** Optional scene subset for targeted repair loops. */
  sceneIds?: string[];
  onProgress?: (done: number, total: number) => void;
};

/**
 * Render a few strict still samples for each scene. Unlike production renders,
 * this disables SceneErrorBoundary so runtime-authored crashes (for example an
 * invalid Remotion interpolate inputRange) become scene-targeted failures
 * instead of silently resolving to the graceful fallback.
 */
export async function renderSceneRuntimeProbe(
  spec: LockedVideoSpec,
  opts: RenderSceneRuntimeProbeOptions = {},
): Promise<RenderSceneRuntimeProbeIssue[]> {
  const timingOpts: RenderSceneRuntimeProbeOptions & { strictSceneErrors: true } = {
    ...opts,
    strictSceneErrors: true,
    timingScope: opts.timingScope ?? "runtime-probe",
  };
  const prepared = await prepareComposition(spec, {
    ...timingOpts,
    artifactPath: resolve(timingOpts.projectRoot ?? "."),
  });
  const cancelSignal = bridgeCancel(timingOpts.signal);
  const onlyIds = timingOpts.sceneIds && timingOpts.sceneIds.length > 0 ? new Set(timingOpts.sceneIds) : null;
  const scenesToProbe = spec.scenes
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) => !onlyIds || onlyIds.has(scene.id));
  const fractions = timingOpts.fractions ?? RUNTIME_PROBE_FRACTIONS;
  const issues: RenderSceneRuntimeProbeIssue[] = [];

  for (const [progressIndex, { scene, index }] of scenesToProbe.entries()) {
    const frames = sampleSceneFrames(spec, index, fractions);
    for (const frame of frames) {
      try {
        await timedRender(
          timingOpts,
          "renderStill",
          () =>
            renderStill({
              composition: prepared.composition,
              serveUrl: prepared.serveUrl,
              output: null,
              frame,
              inputProps: prepared.inputProps,
              imageFormat: "png",
              overwrite: true,
              timeoutInMilliseconds: BROWSER_TIMEOUT_MS,
              logLevel: timingOpts.logLevel ?? "warn",
              ...chromiumRuntimeOptions(timingOpts),
              ...(cancelSignal ? { cancelSignal } : {}),
            }),
          { sceneId: scene.id, frame, kind: "strict-runtime-probe" },
        );
      } catch (error) {
        issues.push({ sceneId: scene.id, frame, message: renderErrorMessage(error) });
        break;
      }
    }
    timingOpts.onProgress?.(progressIndex + 1, scenesToProbe.length);
  }

  return issues;
}

function sampleSceneFrames(spec: LockedVideoSpec, index: number, fractions: readonly number[]): number[] {
  const win = speechWindow(spec, index);
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of fractions) {
    const fraction = Math.min(1, Math.max(0, Number.isFinite(raw) ? raw : 0));
    const frame = clampFrame(win.start + Math.round(fraction * Math.max(0, win.frames - 1)), spec);
    if (!seen.has(frame)) {
      seen.add(frame);
      out.push(frame);
    }
  }
  return out;
}

function renderErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 400 ? `${message.slice(0, 397)}...` : message;
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
