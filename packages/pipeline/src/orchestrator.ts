import { copyFile, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { cpus } from "node:os";
import { join, resolve } from "node:path";
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
import { runRenderGrid, type RenderGridOptions } from "./safety/render-grid.js";
import { lintSceneSources, compositionsSrcDir, blocksSrcDir } from "./safety/forbidden-api.js";
import { scaffoldProject, loadManifestAsSpec, admitProjectScenes } from "./authoring/manifest.js";
import { generateAuthoredEntry } from "./authoring/authored-entry.js";
import { synthesizeNarration, type SynthesizeOptions } from "./audio/tts.js";
import { lockSpec } from "./audio/lock.js";
import { checkDeterminism, type DeterminismOptions } from "./render/determinism.js";
import { renderCacheKey, getCachedRender, putCachedRender } from "./render/cache.js";
import { renderVideo, remotionAppRoot, workspaceRoot, type RenderQuality, type RenderVideoOptions, type RenderVideoResult } from "./render/renderer.js";
import { buildReview, type BuildReviewOptions, type ComposeContactSheet, type ReviewArtifacts } from "./review.js";

/**
 * Orchestrator — the one front door for pure AUTHOR mode (author-mode-v2). Two
 * stages mirror the design data-flow:
 *
 *   scaffoldVideoProject : create a self-contained project + empty manifest +
 *                          authored/ dir for the AI to fill.
 *   renderProject        : admit authored scenes → manifest→spec → static grid →
 *                          TTS → lock → build gate → determinism → render
 *                          (per-project authored entry) → render oracles →
 *                          review → clean scratch.
 *
 * Every render operation (determinism, render, review stills) bundles the
 * PER-PROJECT authored entry, so AI-written scenes render exactly like the old
 * built-ins — but the code lives in the project folder, keeping each video
 * self-contained. Every error path records `state: "failed"` before rethrowing.
 */

// --- scaffoldVideoProject --------------------------------------------------

export type ScaffoldVideoProjectOptions = {
  /** Topic/title used to derive the project id + manifest title. */
  prompt: string;
  /** Explicit project id (defaults to a slug derived from the prompt). */
  projectId?: string;
  /** Soft target duration in seconds (drives the N28 duration check); defaults to 60. */
  duration?: DurationPreset;
  tts?: { provider?: TtsProvider; voiceId?: string; speed?: number };
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
  const brief: ProjectBrief = {
    projectId,
    prompt: opts.prompt,
    duration: opts.duration ?? 60,
    styleId: "clean-luxury-tech",
    ratio: "9:16",
    language: "vi",
    aiProvider: "mock" as AiProvider,
    tts: {
      provider: opts.tts?.provider ?? "vivibe",
      voiceId: opts.tts?.voiceId,
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

// --- renderProject ---------------------------------------------------------

/** Fast-draft render fps (fewer frames → faster preview; motion is fps-aware). */
const DRAFT_FPS = 20;
/** Final full-quality render fps. 30 is the deliverable default (60fps doubles
 *  the frame count for little gain on this editorial style). */
const FULL_FPS = 30;

export type RenderProjectDeps = {
  synthesize?: (spec: VideoSpec, opts: SynthesizeOptions) => Promise<TtsManifest | null>;
  render?: (opts: RenderVideoOptions) => Promise<RenderVideoResult>;
  determinism?: (spec: LockedVideoSpec, opts?: DeterminismOptions) => Promise<SafetyReport>;
  review?: (spec: LockedVideoSpec, opts: BuildReviewOptions) => Promise<ReviewArtifacts>;
};

export type RenderProjectOptions = {
  ttsProvider?: TtsProvider;
  voiceId?: string;
  speed?: number;
  bgmPath?: string;
  concurrency?: number;
  onProgress?: (ratio: number) => void;
  checklist?: ReviewChecklist;
  /** Lint the @news/blocks + @news/compositions sources for forbidden APIs (N5) in the build gate. Default on; pass `false` to skip. */
  lintSources?: boolean;
  composeContactSheet?: ComposeContactSheet;
  /** Force a fresh render: bypass the render cache read (R9.4 `--no-cache`). */
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
 * scene, converts the manifest to a spec, runs the Tier-1 static grid as the
 * gate, then TTS → lock → build gate → determinism → render → render oracles →
 * review, finally cleaning up the generated entry/scratch.
 */
export async function renderProject(projectId: string, opts: RenderProjectOptions = {}): Promise<RenderProjectResult> {
  await ensureProject(projectId);
  const paths = projectPaths(projectId);
  const deps = opts.deps ?? {};
  let generatedEntry: string | null = null;

  try {
    const brief = await readBrief(projectId);
    // Draft = fast low-res preview at a lower fps (fewer frames → faster). The
    // motion is fps-aware so the draft is a faithful (just lower-res) preview.
    const isDraft = opts.quality === "draft";
    const renderFps = isDraft ? DRAFT_FPS : FULL_FPS;

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
    if (!opts.skipAuthoring) {
      const admitted = await admitProjectScenes(projectId);
      if (!admitted.ok) {
        await fail(projectId, `Authored admission blocked render: ${errorSummary(admitted.violations)}`);
        throw new Error(`renderProject: ${admitted.violations.length} authored scene(s) rejected by the admission gate.`);
      }
      authoredFiles = admitted.files;
      const spec = await loadManifestAsSpec(projectId);
      await writeJson(paths.spec, spec);
      await appendEvent(projectId, { type: "authored.admitted", components: admitted.componentIds.length });

      // Tier-1 static grid gate (structure + per-component props + content rules).
      const staticReport = runStaticGrid(spec);
      if (!staticReport.ok) {
        await fail(projectId, `Static safety grid blocked render: ${errorSummary(staticReport.issues)}`);
        throw new Error(`renderProject: static grid reported ${errorCount(staticReport.issues)} hard error(s).`);
      }
    }

    const spec = await readJson<VideoSpec>(paths.spec);

    const provider: TtsProvider = opts.ttsProvider ?? brief.tts.provider;
    const voiceId = opts.voiceId ?? brief.tts.voiceId;
    const speed = opts.speed ?? brief.tts.speed;

    // --- (1) TTS. ---
    await setState(projectId, { state: "tts", currentStep: "synthesizing narration", error: null });
    const synthesize = deps.synthesize ?? synthesizeNarration;
    const tts = await synthesize(spec, { projectId, provider, voiceId, speed, bgmPath: opts.bgmPath ?? defaultBgmPath() });
    await appendEvent(projectId, { type: "tts.done", provider, scenes: tts ? Object.keys(tts.byScene).length : 0 });

    // --- (2) Transition-aware lock. ---
    await setState(projectId, { state: "locking", currentStep: "locking timeline" });
    const locked = lockSpec(spec, tts, { fps: renderFps, mixedNarrationSrc: tts?.mixedSrc });
    await writeJson(paths.lock, locked);
    if (tts) await writeJson(paths.ttsManifest, tts);
    await appendEvent(projectId, { type: "lock.written", durationInFrames: locked.durationInFrames });

    // --- (3) Tier-2 build gate (N12/N13 + N5 source lint). ---
    const buildReport = runBuildGridStatic(locked, projectId);
    // N5: lint the shippable @news/blocks + @news/compositions runtime sources
    // for forbidden (nondeterministic/unsafe) APIs on every render. Authored
    // scene modules are gated separately by the AST admission gate. Opt out only
    // by explicitly passing `lintSources: false`.
    const buildReports =
      opts.lintSources === false
        ? [buildReport]
        : [buildReport, lintSceneSources(compositionsSrcDir()), lintSceneSources(blocksSrcDir())];
    const buildGate = gate(buildReports);
    if (!buildGate.ok) {
      await fail(projectId, `Build gate blocked render: ${errorSummary(buildGate.issues)}`);
      throw new Error(`renderProject: build gate reported ${errorCount(buildGate.issues)} hard error(s).`);
    }
    await appendEvent(projectId, { type: "build.ok" });

    // --- Generate the per-project Remotion entry that imports the authored
    //     scenes, so every render op below bundles THOSE scenes. ---
    let renderEntry: { entryPoint?: string; remotionRoot?: string; projectRoot: string } = { projectRoot: paths.root };
    if (!opts.skipAuthoring) {
      generatedEntry = join(paths.authoredDir, "_entry.tsx");
      await generateAuthoredEntry({ entryPath: generatedEntry, authoredFiles, lockJsonPath: paths.lock });
      renderEntry = { entryPoint: generatedEntry, remotionRoot: remotionAppRoot(), projectRoot: paths.root };
    }

    // --- (4) Determinism guard (N16). ---
    const checkDet = deps.determinism ?? checkDeterminism;
    const detReport = await checkDet(locked, renderEntry);
    if (!detReport.ok) {
      await fail(projectId, `Determinism guard failed: ${errorSummary(detReport.issues)}`);
      throw new Error(`renderProject: determinism guard reported ${errorCount(detReport.issues)} hard error(s).`);
    }
    await appendEvent(projectId, { type: "determinism.ok" });

    // --- (5) Render cache → render. ---
    // The cache key includes the authored scene SOURCE (not just the locked
    // spec), so a visual-only edit to a `.tsx` (same id/props/narration) is a
    // cache miss and actually re-renders instead of serving a stale MP4.
    const authoredSources = await readAuthoredSources(authoredFiles);
    const hash = renderCacheKey(locked, authoredSources);
    const mp4Path = join(paths.rendersDir, isDraft ? `${projectId}.draft.mp4` : `${projectId}.mp4`);
    // Drafts never read/write the full-quality cache (different pixels).
    const cachedPath = opts.noCache || isDraft ? null : getCachedRender(hash);
    let cached = false;

    if (cachedPath) {
      await copyFile(cachedPath, mp4Path);
      cached = true;
      await appendEvent(projectId, { type: "render.cached", hash });
    } else {
      await setState(projectId, { state: "rendering", currentStep: isDraft ? "rendering draft MP4" : "rendering MP4" });
      const render = deps.render ?? renderVideo;
      // Drafts push concurrency to all cores for speed (preview, not the master).
      const concurrency = opts.concurrency ?? (isDraft ? Math.max(1, cpus().length) : undefined);
      const result = await render({
        spec: locked,
        outPath: mp4Path,
        concurrency,
        onProgress: opts.onProgress,
        quality: opts.quality,
        ...renderEntry,
      });
      if (!isDraft) await putCachedRender(hash, result.outPath);
      await appendEvent(projectId, { type: "render.done", hash, outPath: result.outPath, draft: isDraft });
    }

    // --- (6) Review loop (N24/N25). ---
    await setState(projectId, { state: "reviewing", currentStep: "building review" });
    const review = deps.review ?? buildReview;
    const reviewArtifacts = await review(locked, {
      projectId,
      mp4Path,
      checklist: opts.checklist,
      composeContactSheet: opts.composeContactSheet,
      renderOptions: renderEntry,
    });

    // --- (7) Tier-3 render oracles over the review keyframes. ---
    const renderGridOptions: RenderGridOptions = {
      // Vietnamese is monosyllabic, so a higher words/sec is normal speech, not
      // rushed pacing; relax N20 for `vi` (still catches gross over-cramming).
      ...(brief.language === "vi" ? { maxWordsPerSecond: 5.0 } : {}),
      // Soft duration target (±tolerance) from the brief, when set.
      ...(brief.duration ? { targetDurationSeconds: brief.duration } : {}),
    };
    const renderGrid = await runRenderGrid(locked, { framesDir: paths.reviewDir, mp4Path }, renderGridOptions);
    await appendEvent(projectId, { type: "render.oracles", ok: renderGrid.ok, issues: renderGrid.issues.length });

    const report = makeReport(
      [...buildGate.issues, ...detReport.issues, ...renderGrid.issues, ...reviewArtifacts.report.issues],
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
    await fail(projectId, errMessage(error));
    throw error;
  } finally {
    // Clean process scratch (R8.3): the generated entry is regenerated each run.
    if (generatedEntry) {
      try {
        await rm(generatedEntry, { force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  }
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
 * Resolve the default background-music track: `default.mp3` at the repo root.
 * Returns undefined when absent so renders simply run without BGM. Callers may
 * override with an explicit `bgmPath`.
 */
function defaultBgmPath(): string | undefined {
  const candidate = join(workspaceRoot(), "default.mp3");
  return existsSync(candidate) ? candidate : undefined;
}
