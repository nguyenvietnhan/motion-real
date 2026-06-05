import { copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_TTS_SPEED, type DurationPreset, type LockedVideoSpec, type VideoSpec } from "@news/schema";
import {
  appendEvent,
  createProjectId,
  ensureProject,
  projectPaths,
  readBrief,
  readJson,
  setState,
  writeBrief,
  writeJson,
} from "./store.js";
import {
  gate,
  makeReport,
  type AiProvider,
  type ProjectBrief,
  type ReviewChecklist,
  type SafetyIssue,
  type SafetyReport,
  type TtsManifest,
  type TtsProvider,
} from "./types.js";
import { runStaticGrid } from "./safety/static-grid.js";
import { runBuildGridStatic } from "./safety/build-grid.js";
import { lintSceneSources } from "./safety/forbidden-api.js";
import { planVideoSpec, type PlanInput, type PlanResult } from "./planner/index.js";
import { synthesizeNarration, type SynthesizeOptions } from "./tts.js";
import { lockSpec } from "./lock.js";
import { checkDeterminism, type DeterminismOptions } from "./determinism.js";
import { specHash, getCachedRender, putCachedRender } from "./cache.js";
import { renderVideo, workspaceRoot, type RenderVideoOptions, type RenderVideoResult } from "./renderer.js";
import { buildReview, type BuildReviewOptions, type ComposeContactSheet, type ReviewArtifacts } from "./review.js";

/**
 * Orchestrator — the one front door that wires planner → safety grid → TTS →
 * lock → build gate → determinism guard → render → cache → review together (the
 * analogue of math_video_tool's `mvlib.build`). Two stages mirror the
 * create/render split in the design data-flow:
 *
 *   createVideoProject : prompt → plan → static grid → persist video-spec.json
 *   renderProject      : TTS → lock → build gate → determinism → render → review
 *
 * Every stage persists project state + lifecycle events through the store, and
 * every error path records `state: "failed"` before rethrowing so a project is
 * never left in a misleading intermediate state (Requirements 8.3 / 8.5). The
 * orchestration itself is deterministic: no Math.random and timestamps only
 * flow through the store helpers.
 *
 * The heavy/external steps (TTS, render, determinism, review) are exposed as
 * injectable seams (`deps`) so they can be faked in unit tests, while the
 * defaults call the real implementations. The render primitives still go through
 * @remotion, which tests mock at the module level.
 */

// --- createVideoProject ----------------------------------------------------

export type CreateVideoProjectOptions = {
  prompt: string;
  duration: DurationPreset;
  aiProvider?: AiProvider;
  tts?: {
    provider?: TtsProvider;
    voiceId?: string;
    speed?: number;
  };
  /** Injectable planner (defaults to the real PICK-mode planner). */
  plan?: (input: PlanInput) => Promise<PlanResult>;
};

export type CreateVideoProjectResult = {
  projectId: string;
  brief: ProjectBrief;
  spec: VideoSpec;
  /** Tier-1 static report (warnings only; errors would have failed the project). */
  report: SafetyReport;
};

/**
 * Plan a video into a fresh project: write the initial brief (state "planning"),
 * run the AI planner, re-run the Tier-1 static grid as the gate, and — only when
 * no hard error is present — persist `video-spec.json` and advance to "planned".
 * If the static grid reports any error the project is marked "failed" and the
 * pipeline does NOT proceed to TTS/lock/render (Requirement 8.3).
 */
export async function createVideoProject(opts: CreateVideoProjectOptions): Promise<CreateVideoProjectResult> {
  const projectId = createProjectId(opts.prompt);
  await ensureProject(projectId);

  const now = new Date().toISOString();
  const brief: ProjectBrief = {
    projectId,
    prompt: opts.prompt,
    duration: opts.duration,
    styleId: "clean-luxury-tech",
    ratio: "9:16",
    language: "vi",
    aiProvider: opts.aiProvider ?? "mock",
    tts: {
      provider: opts.tts?.provider ?? "vivibe",
      voiceId: opts.tts?.voiceId,
      speed: opts.tts?.speed ?? DEFAULT_TTS_SPEED,
    },
    state: "planning",
    currentStep: "planning",
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  await writeBrief(brief);
  await appendEvent(projectId, { type: "project.created", prompt: opts.prompt, duration: opts.duration });

  try {
    const planner = opts.plan ?? planVideoSpec;
    const plan = await planner({
      prompt: opts.prompt,
      duration: opts.duration,
      aiProvider: brief.aiProvider,
    });

    // Re-run the Tier-1 static grid as the gate (Req 8.3): hard errors block.
    const report = runStaticGrid(plan.spec);
    if (!report.ok) {
      await fail(projectId, `Static safety grid blocked planning: ${errorSummary(report.issues)}`);
      await appendEvent(projectId, { type: "plan.rejected", errors: errorCount(report.issues) });
      throw new Error(`createVideoProject: static grid reported ${errorCount(report.issues)} hard error(s).`);
    }

    await writeJson(projectPaths(projectId).spec, plan.spec);
    const planned = await setState(projectId, { state: "planned", currentStep: "planned", error: null });
    await appendEvent(projectId, {
      type: "spec.created",
      scenes: plan.spec.scenes.length,
      attempts: plan.attempts,
      warnings: report.issues.length,
    });

    return { projectId, brief: planned, spec: plan.spec, report };
  } catch (error) {
    await fail(projectId, errMessage(error));
    throw error;
  }
}

// --- renderProject ---------------------------------------------------------

export type RenderProjectDeps = {
  synthesize?: (spec: VideoSpec, opts: SynthesizeOptions) => Promise<TtsManifest | null>;
  render?: (opts: RenderVideoOptions) => Promise<RenderVideoResult>;
  determinism?: (spec: LockedVideoSpec, opts?: DeterminismOptions) => Promise<SafetyReport>;
  review?: (spec: LockedVideoSpec, opts: BuildReviewOptions) => Promise<ReviewArtifacts>;
};

export type RenderProjectOptions = {
  /** Overrides the brief's TTS provider for this render (e.g. "none" for a silent draft). */
  ttsProvider?: TtsProvider;
  voiceId?: string;
  speed?: number;
  bgmPath?: string;
  concurrency?: number;
  onProgress?: (ratio: number) => void;
  /** Self-critique checklist (defaults to all-false → review gate stays closed). */
  checklist?: ReviewChecklist;
  /** Also lint the registered scene sources for forbidden APIs (N5) in the build gate. */
  lintSources?: boolean;
  /** Forwarded to buildReview so callers/tests can avoid the ffmpeg contact-sheet default. */
  composeContactSheet?: ComposeContactSheet;
  /** Injectable seams (default to the real implementations). */
  deps?: RenderProjectDeps;
};

export type RenderProjectResult = {
  projectId: string;
  mp4Path: string;
  locked: LockedVideoSpec;
  /** Aggregate report across the build gate, determinism guard, and review loop. */
  report: SafetyReport;
  /** True when the MP4 was served from the render cache instead of re-rendered. */
  cached: boolean;
};

/**
 * Render a planned project end-to-end: synthesize narration, lock timing to the
 * measured audio, run the Tier-2 build gate + determinism guard, render (or reuse
 * the cached MP4), then build the perceptual-review artifacts. State advances
 * tts → locking → rendering → reviewing → done; any blocking error marks the
 * project "failed" and stops (Requirements 5.1, 6.5, 8.5).
 */
export async function renderProject(projectId: string, opts: RenderProjectOptions = {}): Promise<RenderProjectResult> {
  await ensureProject(projectId);
  const paths = projectPaths(projectId);
  const deps = opts.deps ?? {};

  try {
    const brief = await readBrief(projectId);
    const spec = await readJson<VideoSpec>(paths.spec);

    const provider: TtsProvider = opts.ttsProvider ?? brief.tts.provider;
    const voiceId = opts.voiceId ?? brief.tts.voiceId;
    const speed = opts.speed ?? brief.tts.speed;

    // --- (1) TTS: synthesize narration (or skip for the no-voice draft). ---
    await setState(projectId, { state: "tts", currentStep: "synthesizing narration", error: null });
    const synthesize = deps.synthesize ?? synthesizeNarration;
    const tts = await synthesize(spec, { projectId, provider, voiceId, speed, bgmPath: opts.bgmPath });
    await appendEvent(projectId, { type: "tts.done", provider, scenes: tts ? Object.keys(tts.byScene).length : 0 });

    // --- (2) Lock timing from the measured audio (durations fall back to the
    //         scene target seconds when there is no narration). ---
    await setState(projectId, { state: "locking", currentStep: "locking timeline" });
    const locked = lockSpec(spec, tts, { mixedNarrationSrc: tts?.mixedSrc });
    await writeJson(paths.lock, locked);
    if (tts) await writeJson(paths.ttsManifest, tts);
    await appendEvent(projectId, { type: "lock.written", durationInFrames: locked.durationInFrames });

    // --- (3) Tier-2 build gate (N12/N13 + optional N5 lint). Any error blocks. ---
    const buildReport = runBuildGridStatic(locked, projectId);
    const buildReports = opts.lintSources ? [buildReport, lintSceneSources()] : [buildReport];
    const buildGate = gate(buildReports);
    if (!buildGate.ok) {
      await fail(projectId, `Build gate blocked render: ${errorSummary(buildGate.issues)}`);
      throw new Error(`renderProject: build gate reported ${errorCount(buildGate.issues)} hard error(s).`);
    }
    await appendEvent(projectId, { type: "build.ok" });

    // --- (4) Determinism guard (N16) BEFORE the full render. ---
    const checkDet = deps.determinism ?? checkDeterminism;
    const detReport = await checkDet(locked, { projectRoot: paths.root });
    if (!detReport.ok) {
      await fail(projectId, `Determinism guard failed: ${errorSummary(detReport.issues)}`);
      throw new Error(`renderProject: determinism guard reported ${errorCount(detReport.issues)} hard error(s).`);
    }
    await appendEvent(projectId, { type: "determinism.ok" });

    // --- (5) Render cache: reuse an identical locked spec, else render + cache. ---
    const hash = specHash(locked);
    const mp4Path = join(paths.rendersDir, `${projectId}.mp4`);
    const cachedPath = getCachedRender(hash);
    let cached = false;

    if (cachedPath) {
      await copyFile(cachedPath, mp4Path);
      cached = true;
      await appendEvent(projectId, { type: "render.cached", hash });
    } else {
      await setState(projectId, { state: "rendering", currentStep: "rendering MP4" });
      const render = deps.render ?? renderVideo;
      const result = await render({
        spec: locked,
        outPath: mp4Path,
        concurrency: opts.concurrency,
        onProgress: opts.onProgress,
        projectRoot: paths.root,
      });
      await putCachedRender(hash, result.outPath);
      await appendEvent(projectId, { type: "render.done", hash, outPath: result.outPath });
    }

    // --- (6) Perceptual review loop (N24/N25). ---
    await setState(projectId, { state: "reviewing", currentStep: "building review" });
    const review = deps.review ?? buildReview;
    const reviewArtifacts = await review(locked, {
      projectId,
      mp4Path,
      checklist: opts.checklist,
      composeContactSheet: opts.composeContactSheet,
      renderOptions: { projectRoot: paths.root },
    });

    const report = makeReport(
      [...buildGate.issues, ...detReport.issues, ...reviewArtifacts.report.issues],
      ["build", "render", "review"],
    );

    // Only declare "done" when the review gate passes; otherwise stay "reviewing".
    if (reviewArtifacts.report.ok) {
      await setState(projectId, { state: "done", currentStep: "done", error: null });
      await appendEvent(projectId, { type: "project.done", mp4Path });
    } else {
      await setState(projectId, { state: "reviewing", currentStep: "awaiting review checklist" });
      await appendEvent(projectId, { type: "review.pending", incomplete: errorCount(reviewArtifacts.report.issues) });
    }

    return { projectId, mp4Path: resolve(mp4Path), locked, report, cached };
  } catch (error) {
    await fail(projectId, errMessage(error));
    throw error;
  }
}

// --- renderSampleDraft (no-voice visual draft) -----------------------------

export type RenderSampleDraftOptions = {
  /** Output MP4 path (defaults under the .video-tool home so the repo root stays clean). */
  outPath?: string;
  concurrency?: number;
  onProgress?: (ratio: number) => void;
  /** Injectable render (defaults to the real renderer; tests mock @remotion). */
  render?: (opts: RenderVideoOptions) => Promise<RenderVideoResult>;
  /** Injectable sample-spec loader (defaults to the bundled apps/remotion fixture). */
  loadSpec?: () => Promise<LockedVideoSpec>;
};

/**
 * Render the BUNDLED SAMPLE locked spec directly to an MP4 with NO TTS and NO
 * Vivibe configuration required (Requirements 12.5 / 14.3). The sample spec is
 * already frame-locked and carries no narration, so it exercises the registry →
 * composition → render path as a verifiable visual draft / smoke render.
 */
export async function renderSampleDraft(opts: RenderSampleDraftOptions = {}): Promise<RenderVideoResult> {
  const spec = await (opts.loadSpec ?? loadSampleSpec)();
  const outPath = opts.outPath ?? defaultSampleOutPath();
  const render = opts.render ?? renderVideo;
  return render({ spec, outPath, concurrency: opts.concurrency, onProgress: opts.onProgress });
}

/** Load the bundled sample LockedVideoSpec from apps/remotion via a file URL. */
async function loadSampleSpec(): Promise<LockedVideoSpec> {
  const specPath = join(workspaceRoot(), "apps", "remotion", "src", "fixtures", "sample-spec.ts");
  const mod = (await import(pathToFileURL(specPath).href)) as { sampleSpec: LockedVideoSpec };
  return mod.sampleSpec;
}

function defaultSampleOutPath(): string {
  // Kept out of the repo root per the hygiene rules (A.3): under .video-tool.
  return join(workspaceRoot(), ".video-tool", "samples", "sample.mp4");
}

// --- internal helpers ------------------------------------------------------

/** Persist a failed state + error, swallowing store errors so the real cause rethrows. */
async function fail(projectId: string, message: string): Promise<void> {
  try {
    await setState(projectId, { state: "failed", error: message });
    await appendEvent(projectId, { type: "error", message });
  } catch {
    /* never mask the original error with a bookkeeping failure */
  }
}

function errorCount(issues: SafetyIssue[]): number {
  return issues.filter((issue) => issue.severity === "error").length;
}

function errorSummary(issues: SafetyIssue[]): string {
  return issues
    .filter((issue) => issue.severity === "error")
    .map((issue) => `${issue.check}${issue.sceneId ? ` (${issue.sceneId})` : ""}: ${issue.message}`)
    .join("; ");
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
