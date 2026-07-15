import { copyFile, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { cpus } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import {
  DEFAULT_TTS_SPEED,

  type DurationTier,
  type LockedVideoSpec,
  type VideoFormat,
  type VideoLanguage,
  type VideoSpec,
} from "@motionreal/schema";
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
} from "./store/store.js";
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
import { typecheckAuthoredScenes } from "./safety/typecheck-authored.js";
import { runRenderGrid, checkLateSafeArea, type RenderGridOptions } from "./safety/render-grid.js";
import { decodePng } from "./safety/png.js";
import { lintSceneSources, compositionsSrcDir, blocksSrcDir } from "./safety/forbidden-api.js";
import {
  scaffoldProject,
  loadManifest,
  loadManifestAsSpec,
  admitProjectScenes,
  manifestSceneFiles,
  type ManifestSceneFile,
} from "./authoring/manifest.js";
import { PipelineError, RenderCancelledError, isRenderCancelledError } from "./errors.js";
import { generateAuthoredEntry } from "./authoring/authored-entry.js";
import { resolveEffectiveDuration } from "./authoring/parse-duration.js";
import { synthesizeNarration, type SynthesizeOptions } from "./audio/tts.js";
import { lockSpec } from "./audio/lock.js";
import { checkDeterminism, type DeterminismOptions } from "./render/determinism.js";
import { checkSceneRuntimeErrors, type SceneRuntimeProbeOptions } from "./render/runtime-probe.js";
import { renderCacheKey, getCachedRender, putCachedRender } from "./render/cache.js";
import { withProjectRenderLock } from "./render/project-lock.js";
import {
  renderVideo,
  remotionAppRoot,
  workspaceRoot,
  type RenderQuality,
  type RenderChromeMode,
  type RenderOpenGlRenderer,
  type RenderTiming,
  type RenderVideoOptions,
  type RenderVideoResult,
} from "./render/renderer.js";
import { buildReview, type BuildReviewOptions, type ComposeContactSheet, type ReviewArtifacts } from "./review.js";
import { bundledDefaultBgmPath } from "./assets/bundled-media.js";

/**
 * Extra per-scene still samples for the late-drift N14 pass, as fractions through
 * each scene's CLEAN speech window. 0.82 sits after entrances settle (so it never
 * false-fires on a still-animating entrance) and before the tail cross-fade (so
 * it never blends two scenes). One point keeps the added render cost to +1
 * still/scene; the list can grow once we trust the false-positive rate.
 */
const LATE_SAFE_AREA_FRACTIONS = [0.82];

/**
 * Orchestrator — the one front door for pure AUTHOR mode (). Two
 * stages mirror the design data-flow:
 *
 * scaffoldVideoProject : create a self-contained project + empty manifest +
 * authored/ dir for the AI to fill.
 * renderProject : admit authored scenes → manifest→spec → static grid →
 * N10 authored typecheck → TTS → lock → build gate →
 * authored entry → N31 runtime probe → determinism →
 * render → review → render oracles → layout N15/N17 →
 * late safe-area → aggregate report → clean scratch.
 *
 * Every runtime/render operation below bundles the PER-PROJECT authored entry,
 * so AI-written scenes render exactly like the old built-ins — but the code
 * lives in the project folder, keeping each video self-contained. Every error
 * path records `state: "failed"` before rethrowing.
 */

// --- scaffoldVideoProject --------------------------------------------------

export type ScaffoldVideoProjectOptions = {
  /** Topic/title used to derive the project id + manifest title. */
  prompt: string;
  /** Explicit project id (defaults to a slug derived from the prompt). */
  projectId?: string;
  /** Soft target duration in seconds (drives the N28 duration check); omit → tier/prompt/default 45s. */
  duration?: number;
  /** Delivery format selected at create time; defaults to the historical vertical path. */
  format?: VideoFormat;
  /** User-selected duration bucket used by authoring word budgets. */
  durationTier?: DurationTier;
  /** Authored video language; defaults to Vietnamese for older callers. */
  language?: VideoLanguage;
  tts?: { provider?: TtsProvider; voiceId?: string; modelId?: string; speed?: number };
};

export type ScaffoldVideoProjectResult = {
  projectId: string;
  brief: ProjectBrief;
  manifestPath: string;
  authoredDir: string;
};

/**
 * Scaffold a fresh AUTHOR-mode project: write the brief (state "scaffolded"),
 * create the `authored/` dir, and write an empty `manifest.json`. The AI then
 * writes scene `.tsx` modules into `authored/` and fills the manifest before
 * `renderProject` is called.
 */
export async function scaffoldVideoProject(opts: ScaffoldVideoProjectOptions): Promise<ScaffoldVideoProjectResult> {
  const projectId = opts.projectId ?? createProjectId(opts.prompt);
  await ensureProject(projectId);

  const now = new Date().toISOString();
  const format = opts.format ?? "tiktok";
  const duration = resolveBriefDuration(opts, format);
  const brief: ProjectBrief = {
    projectId,
    prompt: opts.prompt,
    duration,
    ...(opts.format ? { format: opts.format } : {}),
    ...(opts.durationTier ? { durationTier: opts.durationTier } : {}),
    ratio: "9:16",
    language: opts.language ?? "vi",
    aiProvider: "mock" as AiProvider,
    tts: {
      provider: opts.tts?.provider ?? "vivibe",
      voiceId: opts.tts?.voiceId,
      modelId: opts.tts?.modelId,
      speed: opts.tts?.speed ?? DEFAULT_TTS_SPEED,
    },
    state: "scaffolded",
    currentStep: "scaffolded",
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  await writeBrief(brief);
  const { manifestPath, authoredDir } = await scaffoldProject(projectId, opts.prompt);
  await appendEvent(projectId, { type: "project.scaffolded", prompt: opts.prompt });

  return { projectId, brief, manifestPath, authoredDir };
}

function resolveBriefDuration(
  opts: Pick<ScaffoldVideoProjectOptions, "duration" | "durationTier" | "prompt">,
  format: VideoFormat,
): number {
  // Desktop: UI tier wins when set. `duration` is an explicit override
  // (highest priority). Prompt length is used only when no tier is set.
  return resolveEffectiveDuration({
    prompt: opts.prompt,
    ...(opts.durationTier !== undefined ? { durationTier: opts.durationTier } : {}),
    ...(opts.duration !== undefined ? { explicitDuration: opts.duration } : {}),
  }).targetSeconds;
}

// --- renderProject ---------------------------------------------------------

/** Fast-draft render fps (fewer frames → faster preview; motion is fps-aware). */
const DRAFT_FPS = 10;
/** Final full-quality render fps. 30 is the deliverable default (60fps doubles
 * the frame count for little gain on this short-form style). */
const FULL_FPS = 30;
const VALID_OPEN_GL_RENDERERS = new Set<RenderOpenGlRenderer>(["angle", "egl", "swiftshader", "swangle", "vulkan", "angle-egl"]);
const VALID_CHROME_MODES = new Set<RenderChromeMode>(["headless-shell", "chrome-for-testing"]);

export type RenderProjectDeps = {
  synthesize?: (spec: VideoSpec, opts: SynthesizeOptions) => Promise<TtsManifest | null>;
  render?: (opts: RenderVideoOptions) => Promise<RenderVideoResult>;
  typecheckAuthored?: typeof typecheckAuthoredScenes;
  determinism?: (spec: LockedVideoSpec, opts?: DeterminismOptions) => Promise<SafetyReport>;
  sceneRuntimeProbe?: (spec: LockedVideoSpec, opts?: SceneRuntimeProbeOptions) => Promise<SafetyReport>;
  review?: (spec: LockedVideoSpec, opts: BuildReviewOptions) => Promise<ReviewArtifacts>;
};

export type RenderProjectOptions = {
  ttsProvider?: TtsProvider;
  /** Explicit selected-provider credential; avoids retaining it in Electron's process.env. */
  ttsApiKey?: string;
  voiceId?: string;
  modelId?: string;
  speed?: number;
  /** Absolute track path; null explicitly disables BGM, undefined keeps the bundled fallback. */
  bgmPath?: string | null;
  concurrency?: number;
  /** Chromium `--gl` renderer. Use env `NEWS_RENDER_GL=angle` to configure globally per machine. */
  chromiumOpenGlRenderer?: RenderOpenGlRenderer | null;
  /** Remotion Chrome mode. Use env `NEWS_RENDER_CHROME_MODE=chrome-for-testing` when needed. */
  chromeMode?: RenderChromeMode;
  onProgress?: (ratio: number) => void;
  checklist?: ReviewChecklist;
  /** Lint the @motionreal/blocks + @motionreal/compositions sources for forbidden APIs (N5) in the build gate. Default on; pass `false` to skip. */
  lintSources?: boolean;
  composeContactSheet?: ComposeContactSheet;
  /** Force a fresh render: bypass the render cache read (`--no-cache`). */
  noCache?: boolean;
  /**
   * Render quality. `draft` produces a fast low-res preview (and never reads or
   * writes the full-quality render cache, nor overwrites a prior full render —
   * it is written to `<id>.draft.mp4`). Defaults to `full`.
   */
  quality?: RenderQuality;
  /**
   * Bypass the draft-first gate: allow a full render without a prior draft.
   * Default false — a full render requires a draft (for this project) first, so
   * the user always reviews a cheap preview before the expensive full render.
   */
  forceFull?: boolean;
  /**
   * Skip admission + per-project authored entry (render the bundled app entry).
   * Used by tests/back-compat where the project already has a video-spec.json
   * and no authored scenes. Defaults to false (full AUTHOR path).
   */
  skipAuthoring?: boolean;
  /**
   * User-cancel signal ("Dừng render"). When it fires, the in-flight render is
   * aborted and `renderProject` throws a `RenderCancelledError` — which is NOT
   * recorded as a `state: "failed"` (a deliberate stop is not a failure). Checked
   * at each stage boundary so a cancel between expensive steps stops promptly.
   */
  signal?: AbortSignal;
  deps?: RenderProjectDeps;
};

export type RenderProjectResult = {
  projectId: string;
  mp4Path: string;
  locked: LockedVideoSpec;
  report: SafetyReport;
  cached: boolean;
};

/**
 * Render a scaffolded project end-to-end. Admits + registers every authored
 * scene, converts the manifest to a spec, runs static grid + N10, then TTS →
 * lock → build gate → authored entry → N31 → determinism → render → review →
 * render/layout/late-sample oracles, finally cleaning up generated scratch.
 */
export async function renderProject(projectId: string, opts: RenderProjectOptions = {}): Promise<RenderProjectResult> {
  await ensureProject(projectId);
  const purpose = opts.quality === "draft" ? "draft" : "full";
  return withProjectRenderLock(projectId, purpose, () => renderProjectUnlocked(projectId, opts));
}

async function renderProjectUnlocked(projectId: string, opts: RenderProjectOptions = {}): Promise<RenderProjectResult> {
  const paths = projectPaths(projectId);
  const deps = opts.deps ?? {};
  let generatedEntry: string | null = null;
  const renderTimings: RenderTiming[] = [];
  const chromiumRuntime = renderChromiumRuntimeOptions(opts);

  const recordRenderTiming = (timing: RenderTiming): void => {
    renderTimings.push(timing);
  };

  const appendTimingEvent = async (name: string, ms: number, meta?: Record<string, unknown>): Promise<void> => {
    try {
      const event: { type: string; name: string; ms: number; meta?: Record<string, unknown> } = {
        type: "render.timing",
        name,
        ms,
      };
      if (meta && Object.keys(meta).length > 0) event.meta = meta;
      await appendEvent(projectId, event);
    } catch {
      /* timing instrumentation must never affect render behavior */
    }
  };

  const appendStageStartEvent = async (name: string, meta?: Record<string, unknown>): Promise<void> => {
    try {
      const event: { type: string; name: string; meta?: Record<string, unknown> } = {
        type: "render.stage_start",
        name,
      };
      if (meta && Object.keys(meta).length > 0) event.meta = meta;
      await appendEvent(projectId, event);
    } catch {
      /* diagnostic breadcrumbs must never affect render behavior */
    }
  };

  const flushRenderTimings = async (): Promise<void> => {
    const pending = renderTimings.splice(0);
    for (const timing of pending) {
      await appendTimingEvent(timing.name, timing.ms, timing.meta);
    }
  };

  const timedPipelineStage = async <T>(
    name: string,
    fn: () => T | Promise<T>,
    meta?: Record<string, unknown>,
  ): Promise<T> => {
    const startedAt = performance.now();
    await appendStageStartEvent(name, meta);
    try {
      return await fn();
    } finally {
      await flushRenderTimings();
      await appendTimingEvent(name, roundMs(performance.now() - startedAt), meta);
    }
  };

  // Throw a RenderCancelledError the moment the user's signal has fired. Called
  // at each stage boundary so a "Dừng render" stops promptly between the
  // expensive steps (TTS, determinism, render, oracles) instead of only at the
  // Remotion encode the cancelSignal aborts directly.
  const throwIfCancelled = (): void => {
    if (opts.signal?.aborted) throw new RenderCancelledError();
  };

  try {
    throwIfCancelled();
    const brief = await readBrief(projectId);
    // Draft = fast low-res preview at a lower fps (fewer frames → faster). The
    // motion is fps-aware so the draft is a faithful (just lower-res) preview.
    const isDraft = opts.quality === "draft";
    const renderFps = isDraft ? DRAFT_FPS : FULL_FPS;
    await setState(projectId, {
      state: "rendering",
      currentStep: isDraft ? "preparing draft render" : "preparing full render",
      error: null,
    });

    // Draft-first hard gate: a FULL render requires a prior draft for this
    // project so the user always reviews a cheap low-res preview first. Drafts
    // are never gated. Override with { forceFull: true } when intentional.
    if (!isDraft && !opts.forceFull) {
      const draftPath = join(paths.rendersDir, `${projectId}.draft.mp4`);
      if (!existsSync(draftPath)) {
        await fail(projectId, "Full render blocked by draft-first: no draft exists for this project.");
        throw new Error(
          "renderProject: full render blocked — render a draft (quality:'draft') and have the user review it first, or pass { forceFull: true }.",
        );
      }
    }

    // --- (0) Admit authored scenes + resolve the spec (manifest → VideoSpec). ---
    let authoredFiles: string[] = [];
    let authoredSceneFiles: ManifestSceneFile[] = [];
    let authoredTypeIssues: SafetyIssue[] = [];
    if (!opts.skipAuthoring) {
      throwIfCancelled(); // before the admission/bundle work begins
      const admitted = await timedPipelineStage("stage.authoring.admission", () => admitProjectScenes(projectId));
      if (!admitted.ok) {
        // Persist scene-targeted issues so generateValidateRepair can reauthor
        // (same "retry does nothing" fix as static-grid / N10 below).
        await persistFailureReport(projectId, admitted.violations);
        await fail(projectId, `Authored admission blocked render: ${errorSummary(admitted.violations)}`);
        const first = admitted.violations.find((i) => i.severity === "error") ?? admitted.violations[0];
        throw new PipelineError({
          stage: "admission",
          cause: `authored admission rejected ${admitted.violations.length} scene module(s): ${errorSummary(admitted.violations)}`,
          check: first?.check ?? "N4",
          ...(first?.sceneId ? { sceneId: first.sceneId } : {}),
          remediation: "Re-author the flagged scene so it passes the authored import/API admission gate.",
        });
      }
      // Scope the bundle to exactly the files the manifest references. admitted
      // returns componentIds ↔ files 1:1 in the same order; pair them so a stale
      // orphan.tsx (an earlier authoring batch left behind after a reauthor
      // rewrote the manifest with new ids) is neither bundled nor typechecked —
      // it must not crash or block a render it is no longer part of.
      const componentToFile = new Map<string, string>();
      admitted.componentIds.forEach((id, i) => {
        const file = admitted.files[i];
        if (file) componentToFile.set(id, file);
      });
      const manifest = await timedPipelineStage("stage.authoring.load_manifest", () => loadManifest(projectId));
      authoredSceneFiles = manifestSceneFiles(manifest, componentToFile);
      authoredFiles = authoredSceneFiles.map((s) => s.file);
      const spec = await timedPipelineStage("stage.authoring.resolve_spec", () => loadManifestAsSpec(projectId), {
        scenes: manifest.scenes.length,
      });
      await timedPipelineStage("stage.authoring.write_spec", () => writeJson(paths.spec, spec));
      await appendEvent(projectId, { type: "authored.admitted", components: admitted.componentIds.length });

      // Tier-1 static grid gate (structure + per-component props + content rules).
      const staticReport = await timedPipelineStage(
        "stage.static_grid",
        () => runStaticGrid(spec, { authoredComponentIds: admitted.componentIds }),
        { scenes: spec.scenes.length },
      );
      if (!staticReport.ok) {
        // Persist the report BEFORE throwing (mirror the N10 gate below) so the
        // repair loop can read the flagged scenes back and reauthor the precise
        // broken scene — otherwise "Sửa bằng AI" re-renders identical code that
        // fails the same deterministic grid, looping forever with no target.
        await persistFailureReport(projectId, staticReport.issues);
        await fail(projectId, `Static safety grid blocked render: ${errorSummary(staticReport.issues)}`);
        throw new Error(`renderProject: static grid reported ${errorCount(staticReport.issues)} hard error(s):\n${formatIssues(staticReport.issues)}`);
      }

      // N10 B-minimal — tsc on authored files; only unbound-name (TS2304) issues
      // hard-block (see isN10CrashClassDiagnostic). Style/type noise is dropped.
      const sceneIdByFile = new Map(authoredSceneFiles.map((s) => [resolve(s.file), s.sceneId]));
      throwIfCancelled();
      const typecheckAuthored = deps.typecheckAuthored ?? typecheckAuthoredScenes;
      const typeIssues = await timedPipelineStage(
        "stage.authored_typecheck",
        () => typecheckAuthored(authoredFiles, workspaceRoot(), sceneIdByFile),
        { files: authoredFiles.length },
      );
      authoredTypeIssues = typeIssues;
      const typeErrors = typeIssues.filter((i) => i.severity === "error");
      if (typeIssues.length > 0) {
        await persistFailureReport(projectId, typeIssues);
      }
      if (typeErrors.length > 0) {
        await fail(projectId, `Authored typecheck (N10) blocked render: ${errorSummary(typeErrors)}`);
        const first = typeErrors[0]!;
        throw new PipelineError({
          stage: "build-gate",
          cause: `authored scene typecheck reported ${typeErrors.length} error(s): ${errorSummary(typeErrors)}`,
          check: "N10",
          ...(first.sceneId ? { sceneId: first.sceneId } : {}),
          remediation: "An authored scene uses a block/component with the wrong prop types. Re-author the flagged scene to match the block's contract.",
        });
      }
    }

    const spec = await readJson<VideoSpec>(paths.spec);

    const provider: TtsProvider = opts.ttsProvider ?? brief.tts.provider;
    const sameProviderAsBrief = provider === brief.tts.provider;
    const voiceId = opts.voiceId ?? (sameProviderAsBrief ? brief.tts.voiceId : undefined);
    const modelId = opts.modelId ?? (sameProviderAsBrief ? brief.tts.modelId : undefined);
    const speed = opts.speed ?? brief.tts.speed;

    // --- (1) TTS. ---
    throwIfCancelled(); // before TTS spends money / time
    await setState(projectId, { state: "tts", currentStep: "synthesizing narration", error: null });
    const synthesize = deps.synthesize ?? synthesizeNarration;
    const selectedBgmPath = opts.bgmPath === undefined ? defaultBgmPath() : opts.bgmPath;
    const tts = await timedPipelineStage(
      "stage.tts",
      () => synthesize(spec, {
        projectId,
        provider,
        ...(opts.ttsApiKey ? { apiKey: opts.ttsApiKey } : {}),
        voiceId,
        modelId,
        speed,
        ...(selectedBgmPath ? { bgmPath: selectedBgmPath } : {}),
      }),
      { provider, scenes: spec.scenes.length },
    );
    await appendEvent(projectId, { type: "tts.done", provider, scenes: tts ? Object.keys(tts.byScene).length : 0 });

    // --- (2) Transition-aware lock. ---
    await setState(projectId, { state: "locking", currentStep: "locking timeline" });
    const locked = await timedPipelineStage(
      "stage.lock",
      async () => {
        const lockedSpec = lockSpec(spec, tts, { fps: renderFps, mixedNarrationSrc: tts?.mixedSrc });
        await writeJson(paths.lock, lockedSpec);
        if (tts) await writeJson(paths.ttsManifest, tts);
        return lockedSpec;
      },
      { fps: renderFps, scenes: spec.scenes.length },
    );
    await appendEvent(projectId, { type: "lock.written", durationInFrames: locked.durationInFrames });

    // --- (3) Tier-2 build gate (N12/N13 + N5 source lint). ---
    const buildGate = await timedPipelineStage(
      "stage.build_gate",
      () => {
        const buildReport = runBuildGridStatic(locked, projectId);
        // N5: lint the shippable @motionreal/blocks + @motionreal/compositions runtime sources
        // for forbidden (nondeterministic/unsafe) APIs on every render. Authored
        // scene modules are gated separately by the AST admission gate. Opt out only
        // by explicitly passing `lintSources: false`.
        const buildReports =
          opts.lintSources === false
            ? [buildReport]
            : [buildReport, lintSceneSources(compositionsSrcDir()), lintSceneSources(blocksSrcDir())];
        return gate(buildReports);
      },
      { lintSources: opts.lintSources !== false },
    );
    if (!buildGate.ok) {
      await persistFailureReport(projectId, buildGate.issues);
      await fail(projectId, `Build gate blocked render: ${errorSummary(buildGate.issues)}`);
      const first = buildGate.issues.find((i) => i.severity === "error") ?? buildGate.issues[0];
      throw new PipelineError({
        stage: "build-gate",
        cause: `build gate reported ${errorCount(buildGate.issues)} hard error(s): ${errorSummary(buildGate.issues)}`,
        ...(first?.check ? { check: first.check } : {}),
        ...(first?.sceneId ? { sceneId: first.sceneId } : {}),
        remediation: "Fix the flagged build/timing/audio issue, or re-run TTS when audio files are missing.",
      });
    }
    await appendEvent(projectId, { type: "build.ok" });

    // --- Generate the per-project Remotion entry that imports the authored
    // scenes, so every render op below bundles THOSE scenes. ---
    // Thread the cancel signal into every render op below (determinism, review
    // stills, overlap measure) so a "Dừng render" tears down their in-flight
    // headless Chromium too — not just the main encode.
    let renderEntry: {
      entryPoint?: string;
      remotionRoot?: string;
      projectRoot: string;
      signal?: AbortSignal;
      onTiming?: (timing: RenderTiming) => void;
      timingScope?: string;
      chromiumOptions?: RenderVideoOptions["chromiumOptions"];
      chromeMode?: RenderVideoOptions["chromeMode"];
    } = {
      projectRoot: paths.root,
      onTiming: recordRenderTiming,
      ...chromiumRuntime,
      ...(opts.signal ? { signal: opts.signal } : {}),
    };
    if (!opts.skipAuthoring) {
      generatedEntry = join(paths.authoredDir, "_entry.tsx");
      await timedPipelineStage(
        "stage.authored_entry",
        () => generateAuthoredEntry({ entryPath: generatedEntry!, authoredFiles, lockJsonPath: paths.lock }),
        { files: authoredFiles.length },
      );
      renderEntry = {
        entryPoint: generatedEntry,
        remotionRoot: remotionAppRoot(),
        projectRoot: paths.root,
        onTiming: recordRenderTiming,
        ...chromiumRuntime,
        ...(opts.signal ? { signal: opts.signal } : {}),
      };
    }

    // N31 — strict authored-scene runtime probe. Production renders keep the
    // graceful SceneErrorBoundary fallback, but a fallback-clean frame is not a
    // clean authored scene. Probe first with the boundary disabled so crash-class
    // authored code gets a scene-targeted repair issue before determinism/cache.
    let runtimeProbeReport = makeReport([], ["render"]);
    if (!opts.skipAuthoring) {
      throwIfCancelled();
      const sceneRuntimeProbe = deps.sceneRuntimeProbe ?? checkSceneRuntimeErrors;
      runtimeProbeReport = await timedPipelineStage(
        "stage.scene_runtime_probe",
        () => sceneRuntimeProbe(locked, { ...renderEntry, timingScope: "runtime-probe" }),
        { scenes: locked.scenes.length },
      );
      await appendEvent(projectId, {
        type: "scene.runtime_probe",
        ok: runtimeProbeReport.ok,
        issues: runtimeProbeReport.issues.length,
      });
      if (!runtimeProbeReport.ok) {
        await persistFailureReport(projectId, runtimeProbeReport.issues);
        await fail(projectId, `Scene runtime probe failed: ${errorSummary(runtimeProbeReport.issues)}`);
        const first = runtimeProbeReport.issues.find((issue) => issue.severity === "error");
        throw new PipelineError({
          stage: "render",
          cause: `scene runtime probe reported ${errorCount(runtimeProbeReport.issues)} error(s): ${errorSummary(runtimeProbeReport.issues)}`,
          check: first?.check ?? "N31",
          ...(first?.sceneId ? { sceneId: first.sceneId } : {}),
          remediation: "Re-author the flagged scene so it renders without relying on SceneErrorBoundary fallback pixels.",
        });
      }
    }

    // --- (4) Determinism guard (N16). ---
    throwIfCancelled(); // before the (double) determinism render
    const checkDet = deps.determinism ?? checkDeterminism;
    const detReport = await timedPipelineStage("stage.determinism", () =>
      checkDet(locked, { ...renderEntry, timingScope: "determinism" }),
    );
    if (!detReport.ok) {
      await persistFailureReport(projectId, detReport.issues);
      await fail(projectId, `Determinism guard failed: ${errorSummary(detReport.issues)}`);
      const first = detReport.issues.find((i) => i.severity === "error") ?? detReport.issues[0];
      throw new PipelineError({
        stage: "determinism",
        cause: `determinism guard reported ${errorCount(detReport.issues)} hard error(s): ${errorSummary(detReport.issues)}`,
        check: first?.check ?? "N16",
        ...(first?.sceneId ? { sceneId: first.sceneId } : {}),
        remediation: "Remove non-deterministic APIs from authored scenes (use Remotion random(seed)).",
      });
    }
    await appendEvent(projectId, { type: "determinism.ok" });

    // --- (5) Render cache → render. ---
    // The cache key includes the authored scene SOURCE (not just the locked
    // spec), so a visual-only edit to a `.tsx` (same id/props/narration) is a
    // cache miss and actually re-renders instead of serving a stale MP4.
    const authoredSources = await timedPipelineStage("stage.read_authored_sources", () => readAuthoredSources(authoredFiles), {
      files: authoredFiles.length,
    });
    // Desktop/tools callers always pass bgmPath as either a selected path or null.
    // Fold that explicit choice into the full-render cache key; otherwise a
    // cached MP4 with music could be reused after the user chooses silence.
    let bgmCacheDiscriminator = "";
    if (opts.bgmPath !== undefined) {
      bgmCacheDiscriminator = "bgm:none";
      if (selectedBgmPath && existsSync(selectedBgmPath)) {
        const bytes = await readFile(selectedBgmPath);
        bgmCacheDiscriminator = `bgm:${createHash("sha256").update(bytes).digest("hex")}`;
      }
    }
    const hash = await timedPipelineStage(
      "stage.render_cache_key",
      () => renderCacheKey(locked, authoredSources, bgmCacheDiscriminator),
      {
        files: authoredSources.length,
        bgm: bgmCacheDiscriminator === "" ? "legacy" : bgmCacheDiscriminator === "bgm:none" ? "none" : "selected",
      },
    );
    const mp4Path = join(paths.rendersDir, isDraft ? `${projectId}.draft.mp4` : `${projectId}.mp4`);
    // Drafts never read/write the full-quality cache (different pixels).
    const cachedPath = opts.noCache || isDraft ? null : getCachedRender(hash);
    let cached = false;

    if (cachedPath) {
      await timedPipelineStage("stage.render.cache_copy", () => copyFile(cachedPath, mp4Path), { hash });
      cached = true;
      await appendEvent(projectId, { type: "render.cached", hash });
    } else {
      throwIfCancelled(); // last cheap exit before the expensive encode
      await setState(projectId, { state: "rendering", currentStep: isDraft ? "rendering draft MP4" : "rendering MP4" });
      const render = deps.render ?? renderVideo;
      // Keep drafts capped for responsive previews, but let full renders use the
      // renderer/Remotion default unless the caller explicitly overrides it.
      // Long real projects showed a fixed cap of 4 can be slower for full encode.
      const concurrency = opts.concurrency ?? (isDraft ? defaultDraftRenderConcurrency() : undefined);
      const result = await timedPipelineStage(
        "stage.render",
        () =>
          render({
            spec: locked,
            outPath: mp4Path,
            concurrency,
            onProgress: opts.onProgress,
            quality: opts.quality,
            ...renderEntry,
            timingScope: "video",
            ...(opts.signal ? { signal: opts.signal } : {}),
          }),
        {
          draft: isDraft,
          quality: opts.quality ?? "full",
          concurrency: concurrency ?? "default",
          gl: chromiumRuntime.chromiumOptions?.gl ?? "default",
          chromeMode: chromiumRuntime.chromeMode ?? "default",
        },
      );
      if (!isDraft) await timedPipelineStage("stage.render.cache_put", () => putCachedRender(hash, result.outPath), { hash });
      await appendEvent(projectId, { type: "render.done", hash, outPath: result.outPath, draft: isDraft });
    }

    // --- (6) Review loop (N24/N25). ---
    throwIfCancelled(); // a cancel during the post-encode oracles still stops promptly
    await setState(projectId, { state: "reviewing", currentStep: "building review" });
    const review = deps.review ?? buildReview;
    const reviewArtifacts = await timedPipelineStage(
      "stage.review",
      () =>
        review(locked, {
          projectId,
          mp4Path,
          checklist: opts.checklist,
          composeContactSheet: opts.composeContactSheet,
          // Render the extra late-sample stills alongside the per-scene midpoint
          // keyframes (same bundle, no extra browser/bundle) so the N14 late pass
          // below has post-midpoint frames to scan. The returned keyframe list is
          // unchanged, so the contact sheet stays one-still-per-scene.
          renderOptions: { ...renderEntry, timingScope: "review-stills", extraFractions: LATE_SAFE_AREA_FRACTIONS },
        }),
      { extraFractions: LATE_SAFE_AREA_FRACTIONS.length },
    );

    // --- (7) Tier-3 render oracles over the review keyframes. ---
    const renderGridOptions: RenderGridOptions = {
      // Vietnamese is monosyllabic, so a higher words/sec is normal speech, not
      // rushed pacing; relax N20 for `vi` (still catches gross over-cramming).
      ...(spec.language === "vi" ? { maxWordsPerSecond: 5.0 } : {}),
      // Soft duration target (±tolerance) from the brief, when set.
      ...(brief.duration ? { targetDurationSeconds: brief.duration } : {}),
    };
    const renderGrid = await timedPipelineStage(
      "stage.render_oracles",
      () => runRenderGrid(locked, { framesDir: paths.reviewDir, mp4Path }, renderGridOptions),
      { keyframes: reviewArtifacts.keyframes.length },
    );
    await appendEvent(projectId, { type: "render.oracles", ok: renderGrid.ok, issues: renderGrid.issues.length });

    const lateIssues = await runLateSafeAreaWarningPass({
      locked,
      format: spec.format,
      reviewDir: paths.reviewDir,
      renderGridOptions,
      fractions: LATE_SAFE_AREA_FRACTIONS,
      timedPipelineStage,
      appendProjectEvent: (event) => appendEvent(projectId, event),
    });

    const report = makeReport(
      [
        ...buildGate.issues,
        ...authoredTypeIssues,
        ...runtimeProbeReport.issues,
        ...detReport.issues,
        ...renderGrid.issues,
        ...lateIssues,
        ...reviewArtifacts.report.issues,
      ],
      ["build", "render", "review"],
    );

    if (reviewArtifacts.report.ok && renderGrid.ok) {
      await setState(projectId, { state: "done", currentStep: "done", error: null });
      await appendEvent(projectId, { type: "project.done", mp4Path });
    } else {
      await setState(projectId, { state: "reviewing", currentStep: "awaiting review checklist" });
      await appendEvent(projectId, {
        type: "review.pending",
        incomplete: errorCount(reviewArtifacts.report.issues) + errorCount(renderGrid.issues),
      });
    }

    return { projectId, mp4Path: resolve(mp4Path), locked, report, cached };
  } catch (error) {
    // A user cancel ("Dừng render") is NOT a failure: leave the project state
    // untouched (no `state: "failed"`) so the gallery/workspace returns to the
    // prior reviewable stage instead of an error screen. Remotion aborts its
    // encode with its own cancel error when the signal fires, so normalize both
    // that and our RenderCancelledError into one cancel throw.
    if (isRenderCancelledError(error) || opts.signal?.aborted) {
      await appendEvent(projectId, { type: "render.cancelled" });
      throw isRenderCancelledError(error) ? error : new RenderCancelledError();
    }
    await fail(projectId, errMessage(error));
    throw error;
  } finally {
    await flushRenderTimings();
    // Clean process scratch: the generated entry is regenerated each run.
    if (generatedEntry) {
      try {
        await rm(generatedEntry, { force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}

type TimedPipelineStage = <T>(
  name: string,
  fn: () => T | Promise<T>,
  meta?: Record<string, unknown>,
) => Promise<T>;

type AppendTimingEvent = (name: string, ms: number, meta?: Record<string, unknown>) => Promise<void>;
type AppendProjectEvent = (event: { type: string } & Record<string, unknown>) => Promise<void>;

type LateSafeAreaWarningPassArgs = {
  locked: LockedVideoSpec;
  format: VideoFormat;
  reviewDir: string;
  renderGridOptions: RenderGridOptions;
  fractions: readonly number[];
  timedPipelineStage: TimedPipelineStage;
  appendProjectEvent: AppendProjectEvent;
};

/**
 * External late-sample N14 warning pass (short-form caption-band scan).
 * Issues are warnings and only land in the aggregate report.
 */
async function runLateSafeAreaWarningPass(args: LateSafeAreaWarningPassArgs): Promise<SafetyIssue[]> {
  const issues = await args.timedPipelineStage(
    "stage.late_safe_area",
    async () => {
      const out: SafetyIssue[] = [];
      for (const scene of args.locked.scenes) {
        for (const fraction of args.fractions) {
          const latePath = join(args.reviewDir, `${scene.id}.f${Math.round(fraction * 100)}.png`);
          try {
            const frame = decodePng(await readFile(latePath));
            out.push(...checkLateSafeArea(frame, scene.id, args.renderGridOptions));
          } catch {
            /* no late still for this scene/fraction -> nothing to scan */
          }
        }
      }
      return out;
    },
    { fractions: args.fractions.length },
  );
  await args.appendProjectEvent({ type: "render.latesafearea", issues: issues.length });
  return issues;
}

function renderChromiumRuntimeOptions(
  opts: Pick<RenderProjectOptions, "chromiumOpenGlRenderer" | "chromeMode">,
): Pick<RenderVideoOptions, "chromiumOptions" | "chromeMode"> {
  const gl = opts.chromiumOpenGlRenderer !== undefined ? opts.chromiumOpenGlRenderer : envOpenGlRenderer();
  const chromeMode = opts.chromeMode ?? envChromeMode();
  return {
    ...(gl !== undefined ? { chromiumOptions: { gl } } : {}),
    ...(chromeMode ? { chromeMode } : {}),
  };
}

function envOpenGlRenderer(): RenderOpenGlRenderer | null | undefined {
  const raw = process.env.NEWS_RENDER_GL?.trim();
  if (!raw) return undefined;
  const normalized = raw.toLowerCase();
  if (normalized === "default" || normalized === "null" || normalized === "none") return null;
  return VALID_OPEN_GL_RENDERERS.has(normalized as RenderOpenGlRenderer) ? (normalized as RenderOpenGlRenderer) : undefined;
}

function envChromeMode(): RenderChromeMode | undefined {
  const raw = process.env.NEWS_RENDER_CHROME_MODE?.trim();
  if (!raw) return undefined;
  const normalized = raw.toLowerCase();
  return VALID_CHROME_MODES.has(normalized as RenderChromeMode) ? (normalized as RenderChromeMode) : undefined;
}

function defaultDraftRenderConcurrency(): number {
  const configured = envDraftRenderConcurrency();
  if (configured) return configured;
  const logicalCpus = Math.max(1, cpus().length);
  return Math.max(1, logicalCpus - 1);
}

function envDraftRenderConcurrency(): number | undefined {
  const raw = process.env.NEWS_DRAFT_RENDER_CONCURRENCY?.trim() || process.env.NEWS_RENDER_CONCURRENCY?.trim();
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function roundMs(ms: number): number {
  return Math.round(ms * 100) / 100;
}

// --- renderSampleDraft (no-voice visual draft) -----------------------------

export type RenderSampleDraftOptions = {
  outPath?: string;
  concurrency?: number;
  onProgress?: (ratio: number) => void;
  render?: (opts: RenderVideoOptions) => Promise<RenderVideoResult>;
  loadSpec?: () => Promise<LockedVideoSpec>;
};

/**
 * Render the BUNDLED SAMPLE locked spec directly to an MP4 with NO TTS and NO
 * Vivibe configuration required. The sample is frame-locked and carries no
 * narration, so it exercises the registry → composition → render path as a
 * verifiable visual draft / smoke render.
 */
export async function renderSampleDraft(opts: RenderSampleDraftOptions = {}): Promise<RenderVideoResult> {
  const spec = await (opts.loadSpec ?? loadSampleSpec)();
  const outPath = opts.outPath ?? defaultSampleOutPath();
  const render = opts.render ?? renderVideo;
  return render({ spec, outPath, concurrency: opts.concurrency, onProgress: opts.onProgress });
}

async function loadSampleSpec(): Promise<LockedVideoSpec> {
  const { pathToFileURL } = await import("node:url");
  const specPath = join(workspaceRoot(), "apps", "remotion", "src", "fixtures", "sample-spec.ts");
  const mod = (await import(pathToFileURL(specPath).href)) as { sampleSpec: LockedVideoSpec };
  return mod.sampleSpec;
}

function defaultSampleOutPath(): string {
  return join(workspaceRoot(), ".video-tool", "samples", "sample.mp4");
}

// --- internal helpers ------------------------------------------------------

async function fail(projectId: string, message: string): Promise<void> {
  try {
    await setState(projectId, { state: "failed", error: message });
    await appendEvent(projectId, { type: "error", message });
  } catch {
    /* never mask the original error with a bookkeeping failure */
  }
}

/**
 * Persist a safety report for a PRE-render failure (e.g. N10 typecheck) to the
 * same path `createTools.get_safety_report` reads. The normal render path
 * writes the report after a successful render returns; an early throw never
 * reaches that, so the repair loop would otherwise read a stale or missing
 * report and fail to route the scene-targeted fix. Best-effort: a persistence
 * failure must never mask the original error.
 */
async function persistFailureReport(projectId: string, issues: SafetyIssue[]): Promise<void> {
  try {
    await writeJson(projectPaths(projectId).safetyReport, makeReport(issues, ["build"]));
  } catch {
    /* best-effort */
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

/**
 * Read the authored scene sources for the render-cache key. Best-effort: an
 * unreadable file contributes its path (so a rename/move still changes the key)
 * rather than throwing — the render path itself already validated admission.
 */
async function readAuthoredSources(files: string[]): Promise<string[]> {
  return Promise.all(
    files.map(async (file) => {
      try {
        return await readFile(file, "utf8");
      } catch {
        return file;
      }
    }),
  );
}

/**
 * Resolve the bundled default background-music track from the desktop asset tree.
 * Returns undefined when absent so renders simply run without BGM. Callers may
 * override with an explicit `bgmPath`.
 */
function defaultBgmPath(): string | undefined {
  const candidate = bundledDefaultBgmPath(workspaceRoot());
  return existsSync(candidate) ? candidate : undefined;
}

function formatIssues(issues: SafetyIssue[]): string {
  return issues.map((i) => `  - [${i.check}] ${i.path}: ${i.message}`).join("\n");
}
