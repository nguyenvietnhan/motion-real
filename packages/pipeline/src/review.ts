import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { open, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { transitionFrames, type LockedVideoSpec } from "@motionreal/schema";
import { makeReport, type ReviewChecklist, type SafetyIssue, type SafetyReport } from "./types.js";
import { appendEvent, ensureProject, projectPaths, writeJson } from "./store/store.js";
import { renderSceneStills, type RenderSceneStillsOptions, type RenderTiming } from "./render/renderer.js";

/**
 * Tier-4 perceptual review loop gate (N24, N25). The automated grid is blind to
 * some layout/audio defects that need human eyes. Before a project may be
 * declared "done" we (1) extract one keyframe per scene, (2) assemble a contact
 * sheet, (3) record a self-critique checklist, and (4) block on a hard process
 * gate until every checklist item is confirmed.
 *
 * - N24 (hard, process gate): keyframes not extracted / contact sheet not built.
 * - N25 (hard, process gate): self-critique checklist not completed.
 *
 * Heavy/native dependencies stay out of the hot path: keyframe extraction
 * reuses the Remotion renderer (`renderSceneStills`) and the contact-sheet
 * compositor is INJECTABLE (`opts.composeContactSheet`). The default compositor
 * shells out to ffmpeg and FAILS SOFT (surfaces an N24 issue, never throws)
 * when ffmpeg is unavailable, so unit tests inject a fake compositor and never
 * require ffmpeg or a real render.
 *
 * Artifact content (keyframe/contact-sheet paths, checklist state) is kept
 * deterministic: paths are stored project-relative and no Date.now/Math.random
 * leaks into review.json. Lifecycle timestamps live only in events.ndjson via
 * the store helpers.
 */

const CONTACT_SHEET_NAME = "contact.jpg";
const REVIEW_JSON_NAME = "review.json";

type ReviewTimingOptions = {
  onTiming?: (timing: RenderTiming) => void;
  timingScope?: string;
};

function roundMs(ms: number): number {
  return Math.round(ms * 100) / 100;
}

function emitReviewTiming(
  opts: ReviewTimingOptions,
  name: string,
  startedAt: number,
  meta?: Record<string, unknown>,
): void {
  if (!opts.onTiming) return;
  const timing: RenderTiming = {
    name: `${opts.timingScope ?? "review-stills"}.${name}`,
    ms: roundMs(performance.now() - startedAt),
  };
  if (meta && Object.keys(meta).length > 0) timing.meta = meta;
  try {
    opts.onTiming(timing);
  } catch {
    /* timing must never affect review artifacts */
  }
}

async function timedReview<T>(
  opts: ReviewTimingOptions,
  name: string,
  fn: () => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await fn();
  } finally {
    emitReviewTiming(opts, name, startedAt, meta);
  }
}

/** Injectable keyframe extractor: write one still per scene into `outDir`, return their paths. */
export type ExtractKeyframes = (spec: LockedVideoSpec, outDir: string) => Promise<string[]>;

/** Injectable contact-sheet compositor: tile `keyframes` into a single sheet at `outPath`. */
export type ComposeContactSheet = (args: {
  keyframes: string[];
  outPath: string;
  width: number;
  height: number;
}) => Promise<void> | void;

export type BuildReviewOptions = {
  /** Project id; artifacts land under `projects/<id>/review/`. */
  projectId: string;
  /** Final MP4 path (reported back when the gate passes). Project-relative or absolute. */
  mp4Path?: string;
  /**
   * Self-critique checklist state. Defaults to an all-false checklist (review
   * not yet completed), which keeps the gate closed (N25) until a human/agent
   * confirms each item.
   */
  checklist?: ReviewChecklist;
  /** Override keyframe extraction (default: per-scene Remotion stills via `renderSceneStills`). */
  extractKeyframes?: ExtractKeyframes;
  /** Override contact-sheet composition (default: ffmpeg tile, fail-soft). */
  composeContactSheet?: ComposeContactSheet;
  /** Forwarded to the default `renderSceneStills` extractor (project root, log level,...). */
  renderOptions?: RenderSceneStillsOptions;
};

export type ReviewArtifacts = {
  /** Absolute paths to the per-scene keyframes that were extracted. */
  keyframes: string[];
  /** Absolute path to the assembled contact sheet (`review/contact.jpg`). */
  contactSheetPath: string;
  /** Absolute path to the recorded self-critique (`review/review.json`). */
  reviewJsonPath: string;
  /** The checklist state that was recorded. */
  checklist: ReviewChecklist;
  /** The reported MP4 path (absolute) when the gate passes, else undefined. */
  mp4Path?: string;
  /** Aggregate review report (N24 artifacts + N25 checklist). ok ⇒ project may be "done". */
  report: SafetyReport;
};

/** The single 9:16 keyframe thumbnail size used when composing the contact sheet. */
const THUMB_WIDTH = 270;
const THUMB_HEIGHT = 480;

/** An all-false checklist: the review has not been completed yet. */
export function emptyReviewChecklist(): ReviewChecklist {
  return {
    safeArea: false,
    alignment: false,
    transitions: false,
    clutter: false,
    hook: false,
    cta: false,
    audio: false,
    richness: false,
  };
}

/** Human-readable label per checklist field, used in N25 issue messages. */
const CHECKLIST_LABELS: Record<keyof ReviewChecklist, string> = {
  safeArea: "safe-area (nothing clipped at 9:16 edges)",
  alignment: "alignment (headings/blocks aligned, no drift)",
  transitions: "transitions (no hard cuts / flicker between scenes)",
  clutter: "clutter (not too many simultaneous blocks)",
  hook: "hook (scene-01 hooks in first 3s, no greeting/definition)",
  cta: "cta (final scene CTA is topic-specific)",
  audio: "audio (voice complete, not cut/rushed, in sync)",
  richness: "richness (long scenes show motion, not just static fades)",
};

/**
 * N25 self-critique gate. Returns a SafetyReport whose `ok` is true ONLY when
 * every checklist field is confirmed. Each incomplete field becomes an N25
 * error issue (hard process gate, Requirement 10.4) naming the missing item.
 */
export function reviewGatePassed(checklist: ReviewChecklist): SafetyReport {
  const issues: SafetyIssue[] = [];
  for (const key of Object.keys(CHECKLIST_LABELS) as Array<keyof ReviewChecklist>) {
    if (checklist[key] !== true) {
      issues.push({
        check: "N25",
        severity: "error",
        path: key,
        message: `Review checklist item not confirmed: ${CHECKLIST_LABELS[key]}. The project is not done until every item is checked.`,
      });
    }
  }
  return makeReport(issues, ["review"]);
}

/**
 * Build the perceptual-review artifacts for a rendered project:
 * 1. extract one keyframe per scene into `review/scene-NN.png` (N24);
 * 2. assemble `review/contact.jpg` (N24, injectable compositor);
 * 3. write `review/review.json` capturing paths + checklist state (N24/N25);
 * 4. return the artifacts + an aggregate SafetyReport. When the gate passes
 * the reported MP4 path is returned so the caller can stop.
 *
 * Never throws on a missing tool: extraction/composition failures fail soft into
 * N24 error issues so the gate blocks "done" without crashing the pipeline.
 */
export async function buildReview(
  spec: LockedVideoSpec,
  opts: BuildReviewOptions,
): Promise<ReviewArtifacts> {
  const { projectId } = opts;
  await ensureProject(projectId);
  const paths = projectPaths(projectId);
  const reviewDir = paths.reviewDir;
  const contactSheetPath = join(reviewDir, CONTACT_SHEET_NAME);
  const reviewJsonPath = join(reviewDir, REVIEW_JSON_NAME);

  const checklist = opts.checklist ?? emptyReviewChecklist();
  const issues: SafetyIssue[] = [];

  // --- (1) Keyframes: one still per scene (default reuses the Remotion renderer). ---
  const extract: ExtractKeyframes =
    opts.extractKeyframes ??
    ((s, dir) =>
      extractReviewFrames(s, dir, {
        projectRoot: paths.root,
        mp4Path: opts.mp4Path,
        renderOptions: opts.renderOptions,
      }));

  let keyframes: string[] = [];
  try {
    keyframes = (await extract(spec, reviewDir)).map((p) => resolve(p));
  } catch (error) {
    issues.push({
      check: "N24",
      severity: "error",
      message: `Keyframe extraction failed: ${errMessage(error)}. Re-render scene stills before review.`,
    });
  }

  // Every scene must contribute a present, non-empty keyframe.
  const presentKeyframes = keyframes.filter((p) => fileSize(p) > 0);
  if (keyframes.length === 0) {
    issues.push({
      check: "N24",
      severity: "error",
      message: "No keyframes were extracted; cannot build a contact sheet for perceptual review.",
    });
  } else if (presentKeyframes.length < spec.scenes.length) {
    issues.push({
      check: "N24",
      severity: "error",
      message: `Expected one keyframe per scene (${spec.scenes.length}) but only ${presentKeyframes.length} were written to disk.`,
    });
  }

  // --- (2) Contact sheet (injectable compositor, fail-soft default). ---
  if (presentKeyframes.length > 0) {
    const compose: ComposeContactSheet = opts.composeContactSheet ?? ffmpegContactSheet;
    try {
      await compose({
        keyframes: presentKeyframes,
        outPath: contactSheetPath,
        width: THUMB_WIDTH,
        height: THUMB_HEIGHT,
      });
    } catch (error) {
      issues.push({
        check: "N24",
        severity: "error",
        path: relProject(paths.root, contactSheetPath),
        message: `Contact-sheet composition failed: ${errMessage(error)}. Provide a composeContactSheet hook or install ffmpeg.`,
      });
    }
  }

  if (fileSize(contactSheetPath) === 0) {
    issues.push({
      check: "N24",
      severity: "error",
      path: relProject(paths.root, contactSheetPath),
      message: `Contact sheet missing or empty at "${relProject(paths.root, contactSheetPath)}".`,
    });
  }

  // --- (3) Record the self-critique (N25) and persist review.json (N24). ---
  const gateReport = reviewGatePassed(checklist);
  issues.push(...gateReport.issues);

  const mp4Abs = opts.mp4Path ? resolveProjectPath(paths.root, opts.mp4Path) : undefined;
  const report = makeReport(issues, ["review"]);

  const reviewJson = {
    projectId,
    mp4Path: mp4Abs ? relProject(paths.root, mp4Abs) : null,
    keyframes: keyframes.map((p) => relProject(paths.root, p)),
    contactSheet: relProject(paths.root, contactSheetPath),
    checklist,
    gate: {
      check: "N25" as const,
      passed: gateReport.ok,
      incomplete: gateReport.issues.map((issue) => issue.path).filter((p): p is string => Boolean(p)),
    },
    ok: report.ok,
    issues: report.issues,
  };
  await writeJson(reviewJsonPath, reviewJson);

  await appendEvent(projectId, {
    type: "review",
    ok: report.ok,
    keyframes: keyframes.length,
    contactSheet: relProject(paths.root, contactSheetPath),
    errors: report.issues.length,
  });

  return {
    keyframes,
    contactSheetPath,
    reviewJsonPath,
    checklist,
    // Only report the MP4 once the review gate is green.
    mp4Path: report.ok ? mp4Abs : undefined,
    report,
  };
}

const execFileAsync = promisify(execFile);

/**
 * Default contact-sheet compositor: scale each keyframe to a uniform 9:16 thumb,
 * concat them into a single stream, and `tile` them into a grid via ffmpeg. This
 * is only used on real runs; unit tests inject a fake compositor. Rejects with a
 * clear error when ffmpeg is unavailable so {@link buildReview} can fail soft
 * into an N24 issue instead of crashing.
 */
export const ffmpegContactSheet: ComposeContactSheet = async ({ keyframes, outPath, width, height }) => {
  if (keyframes.length === 0) {
    throw new Error("No keyframes to compose into a contact sheet.");
  }
  const cols = Math.ceil(Math.sqrt(keyframes.length));
  const rows = Math.ceil(keyframes.length / cols);

  const inputs = keyframes.flatMap((k) => ["-i", k]);
  const scales = keyframes
    .map(
      (_, i) =>
        `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[t${i}]`,
    )
    .join(";");
  const concatInputs = keyframes.map((_, i) => `[t${i}]`).join("");
  const filter = `${scales};${concatInputs}concat=n=${keyframes.length}:v=1:a=0,tile=${cols}x${rows}[out]`;

  try {
    await execFileAsync("ffmpeg", [
      "-y",
      ...inputs,
      "-filter_complex",
      filter,
      "-map",
      "[out]",
      "-frames:v",
      "1",
      outPath,
    ]);
  } catch (error) {
    throw new Error(`ffmpeg contact-sheet tile failed (${errMessage(error)})`);
  }
};

/**
 * Alternative keyframe extractor: grab one frame per scene from a rendered MP4
 * with ffmpeg (instead of re-rendering stills). Inject via
 * `opts.extractKeyframes = (s, dir) => extractKeyframesFromMp4(s, dir, mp4Path)`.
 * The primary path remains {@link renderSceneStills}.
 */
export async function extractKeyframesFromMp4(
  spec: LockedVideoSpec,
  outDir: string,
  mp4Path: string,
  opts: { extraFractions?: number[]; onTiming?: (timing: RenderTiming) => void; timingScope?: string } = {},
): Promise<string[]> {
  const outputs: string[] = [];
  for (const [index, scene] of spec.scenes.entries()) {
    const midpoint = scene.startFrame + Math.floor(scene.durationInFrames / 2);
    const frame = Math.min(Math.max(0, midpoint), Math.max(0, spec.durationInFrames - 1));
    const output = join(resolve(outDir), `${scene.id}.png`);
    await timedReview(
      opts,
      "ffmpegFrame",
      () => extractFrameFromMp4(mp4Path, frame / spec.fps, output, scene.id),
      { sceneId: scene.id, frame, kind: "midpoint" },
    );
    outputs.push(output);

    for (const fraction of opts.extraFractions ?? []) {
      const win = speechWindow(spec, index);
      const lateFrame = clampFrame(win.start + Math.round(fraction * win.frames), spec);
      await timedReview(
        opts,
        "ffmpegFrame",
        () =>
          extractFrameFromMp4(
            mp4Path,
            lateFrame / spec.fps,
            join(resolve(outDir), `${scene.id}.${fractionTag(fraction)}.png`),
            `${scene.id}.${fractionTag(fraction)}`,
          ),
        { sceneId: scene.id, frame: lateFrame, kind: "late", fraction },
      );
    }
  }
  return outputs;
}

async function extractReviewFrames(
  spec: LockedVideoSpec,
  outDir: string,
  opts: { projectRoot: string; mp4Path?: string; renderOptions?: RenderSceneStillsOptions },
): Promise<string[]> {
  const timingOpts: ReviewTimingOptions = { timingScope: opts.renderOptions?.timingScope ?? "review-stills" };
  if (opts.renderOptions?.onTiming) timingOpts.onTiming = opts.renderOptions.onTiming;
  const renderOptions: RenderSceneStillsOptions = { ...(opts.renderOptions ?? {}), timingScope: timingOpts.timingScope };
  const mp4Abs = opts.mp4Path ? resolveProjectPath(opts.projectRoot, opts.mp4Path) : undefined;
  if (mp4Abs && fileSize(mp4Abs) > 0 && (await looksLikeMp4(mp4Abs))) {
    try {
      return await timedReview(
        timingOpts,
        "extractFromMp4",
        () =>
          extractKeyframesFromMp4(spec, outDir, mp4Abs, {
            extraFractions: renderOptions.extraFractions,
            onTiming: timingOpts.onTiming,
            timingScope: timingOpts.timingScope,
          }),
        { scenes: spec.scenes.length, extraFractions: renderOptions.extraFractions?.length ?? 0 },
      );
    } catch {
      // Keep review robust: ffmpeg extraction is an optimization, not a gate.
    }
  }
  return timedReview(
    timingOpts,
    "renderStillFallback",
    () => renderSceneStills(spec, outDir, renderOptions),
    { scenes: spec.scenes.length, extraFractions: renderOptions.extraFractions?.length ?? 0 },
  );
}

async function extractFrameFromMp4(mp4Path: string, seconds: number, output: string, label: string): Promise<void> {
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-ss",
      seconds.toFixed(3),
      "-i",
      mp4Path,
      "-frames:v",
      "1",
      output,
    ]);
  } catch (error) {
    throw new Error(`ffmpeg keyframe extraction for ${label} failed (${errMessage(error)})`);
  }
}

async function looksLikeMp4(path: string): Promise<boolean> {
  const header = Buffer.alloc(12);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "r");
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead < 8) return false;
    return header.subarray(4, 8).toString("ascii") === "ftyp";
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function speechWindow(spec: LockedVideoSpec, index: number): { start: number; frames: number } {
  const n = spec.scenes.length;
  const T = n > 1 ? transitionFrames(spec.fps) : 0;
  const scene = spec.scenes[index]!;
  const headT = index === 0 ? 0 : T;
  const tailT = index === n - 1 ? 0 : T;
  const frames = Math.max(1, scene.durationInFrames - headT - tailT);
  return { start: scene.startFrame + headT, frames };
}

function clampFrame(frame: number, spec: LockedVideoSpec): number {
  return Math.min(Math.max(0, Math.floor(frame)), Math.max(0, spec.durationInFrames - 1));
}

function fractionTag(fraction: number): string {
  return `f${Math.round(fraction * 100)}`;
}

/**
 * Manifest-style placeholder compositor for environments without an image tool.
 * Writes a small JSON listing of the keyframes at `outPath` so a review artifact
 * always exists. Inject via `opts.composeContactSheet = manifestContactSheet`
 * when ffmpeg is unavailable but a recorded sheet stand-in is acceptable.
 */
export const manifestContactSheet: ComposeContactSheet = async ({ keyframes, outPath, width, height }) => {
  const manifest = {
    kind: "contact-sheet-manifest",
    note: "Placeholder: no image compositor available. Lists the per-scene keyframes for review.",
    thumb: { width, height },
    keyframes,
  };
  await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
};

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function resolveProjectPath(root: string, src: string): string {
  return isAbsolute(src) ? resolve(src) : resolve(root, src);
}

/** Project-relative, POSIX-style path for deterministic review.json content. */
function relProject(root: string, abs: string): string {
  return relative(root, abs).split(/[\\/]/).join("/");
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
