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
import { typecheckAuthoredScenes } from "./safety/typecheck-authored.js";
import { runRenderGrid, checkOverlap, runTruncationForScene, type RenderGridOptions } from "./safety/render-grid.js";
import { lintSceneSources, compositionsSrcDir, blocksSrcDir } from "./safety/forbidden-api.js";
import { scaffoldProject, loadManifest, loadManifestAsSpec, admitProjectScenes, manifestSceneFiles } from "./authoring/manifest.js";
import { PipelineError, RenderCancelledError, isRenderCancelledError } from "./errors.js";
import { generateAuthoredEntry } from "./authoring/authored-entry.js";
import { synthesizeNarration, type SynthesizeOptions } from "./audio/tts.js";
import { lockSpec } from "./audio/lock.js";
import { checkDeterminism, type DeterminismOptions } from "./render/determinism.js";
import { renderCacheKey, getCachedRender, putCachedRender } from "./render/cache.js";
import { renderVideo, measureSceneLayouts, remotionAppRoot, workspaceRoot, type RenderQuality, type RenderVideoOptions, type RenderVideoResult } from "./render/renderer.js";
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
const DRAFT_FPS = 10;
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
 * scene, converts the manifest to a spec, runs the Tier-1 static grid as the
 * gate, then TTS → lock → build gate → determinism → render → render oracles →
 * review, finally cleaning up the generated entry/scratch.
 */
export async function renderProject(projectId: string, opts: RenderProjectOptions = {}): Promise<RenderProjectResult> {
  await ensureProject(projectId);
  const paths = projectPaths(projectId);
  const deps = opts.deps ?? {};
  let generatedEntry: string | null = null;

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
      throwIfCancelled(); // before the admission/bundle work begins
      const admitted = await admitProjectScenes(projectId);
      if (!admitted.ok) {
        await fail(projectId, `Authored admission blocked render: ${errorSummary(admitted.violations)}`);
        throw new Error(`renderProject: ${admitted.violations.length} authored scene(s) rejected by the admission gate.`);
      }
      // Scope the bundle to exactly the files the manifest references. admitted
      // returns componentIds ↔ files 1:1 in the same order; pair them so a stale
      // orphan .tsx (an earlier authoring batch left behind after a reauthor
      // rewrote the manifest with new ids) is neither bundled nor typechecked —
      // it must not crash or block a render it is no longer part of.
      const componentToFile = new Map<string, string>();
      admitted.componentIds.forEach((id, i) => {
        const file = admitted.files[i];
        if (file) componentToFile.set(id, file);
      });
      const manifest = await loadManifest(projectId);
      const sceneFiles = manifestSceneFiles(manifest, componentToFile);
      authoredFiles = sceneFiles.map((s) => s.file);
      const spec = await loadManifestAsSpec(projectId);
      await writeJson(paths.spec, spec);
      await appendEvent(projectId, { type: "authored.admitted", components: admitted.componentIds.length });

      // Tier-1 static grid gate (structure + per-component props + content rules).
      const staticReport = runStaticGrid(spec);
      if (!staticReport.ok) {
        // Persist the report BEFORE throwing (mirror the N10 gate below) so the
        // repair loop can read the flagged scenes back and reauthor the precise
        // broken scene — otherwise "Sửa bằng AI" re-renders identical code that
        // fails the same deterministic grid, looping forever with no target.
        await persistFailureReport(projectId, staticReport.issues);
        await fail(projectId, `Static safety grid blocked render: ${errorSummary(staticReport.issues)}`);
        throw new Error(`renderProject: static grid reported ${errorCount(staticReport.issues)} hard error(s).`);
      }

      // N10 — typecheck authored scenes against the real @news/blocks +
      // @news/compositions prop contracts. The render bundler strips types
      // without checking them, so a wrong-shape prop (e.g. {text}[] passed to a
      // string[] block) compiles and then crashes headless Chromium at runtime.
      // Checking here — before TTS spends money — turns that class of model
      // mistake into a deterministic, scene-targeted content error the repair
      // loop can self-fix. Each issue carries its sceneId for precise reauthor.
      // Degrades to a no-op when the @news sources can't be resolved; it must
      // never block a render it can't check correctly.
      const sceneIdByFile = new Map(sceneFiles.map((s) => [resolve(s.file), s.sceneId]));
      // The N10 typecheck is SYNCHRONOUS and CPU-heavy (~5-8s) — it blocks the
      // Electron main event loop for its whole duration, during which a queued
      // "Dừng render" IPC message cannot be processed (so the abort can't fire).
      // Check the signal RIGHT BEFORE it: a cancel that fired during the async
      // admission/bundle above skips the typecheck entirely instead of forcing
      // the user to wait out a block they already asked to stop.
      throwIfCancelled();
      const typeIssues = typecheckAuthoredScenes(authoredFiles, workspaceRoot(), sceneIdByFile);
      // Only crash-class diagnostics (severity "error") gate the render — a
      // wrong-shape prop that would crash Chromium at runtime. A missing color
      // token is emitted as a WARNING (the design Proxy already resolves it to a
      // safe color), so it never blocks; it rides along in the report for
      // visibility and an advisory reauthor. Persist whenever there's anything to
      // carry so the repair loop can read it back.
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
    const voiceId = opts.voiceId ?? brief.tts.voiceId;
    const speed = opts.speed ?? brief.tts.speed;

    // --- (1) TTS. ---
    throwIfCancelled(); // before TTS spends money / time
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
    // Thread the cancel signal into every render op below (determinism, review
    // stills, overlap measure) so a "Dừng render" tears down their in-flight
    // headless Chromium too — not just the main encode.
    let renderEntry: { entryPoint?: string; remotionRoot?: string; projectRoot: string; signal?: AbortSignal } = {
      projectRoot: paths.root,
      ...(opts.signal ? { signal: opts.signal } : {}),
    };
    if (!opts.skipAuthoring) {
      generatedEntry = join(paths.authoredDir, "_entry.tsx");
      await generateAuthoredEntry({ entryPath: generatedEntry, authoredFiles, lockJsonPath: paths.lock });
      renderEntry = {
        entryPoint: generatedEntry,
        remotionRoot: remotionAppRoot(),
        projectRoot: paths.root,
        ...(opts.signal ? { signal: opts.signal } : {}),
      };
    }

    // --- (4) Determinism guard (N16). ---
    throwIfCancelled(); // before the (double) determinism render
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
      throwIfCancelled(); // last cheap exit before the expensive encode
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
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...renderEntry,
      });
      if (!isDraft) await putCachedRender(hash, result.outPath);
      await appendEvent(projectId, { type: "render.done", hash, outPath: result.outPath, draft: isDraft });
    }

    // --- (6) Review loop (N24/N25). ---
    throwIfCancelled(); // a cancel during the post-encode oracles still stops promptly
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

    // N15 (block overlap) over the measured composed-block rects. Best-effort and
    // vision-independent: a dedicated measure-mode still emits each tagged
    // @news/blocks unit's getBoundingClientRect, which a flat raster can't carry.
    // Eased in as WARNINGS (not a hard gate) while we observe false-positive rate;
    // a measurement failure must never fail the render, so it's fully guarded.
    const overlapIssues: SafetyIssue[] = [];
    try {
      const layouts = await measureSceneLayouts(locked, { projectRoot: paths.root, logLevel: "error", ...(opts.signal ? { signal: opts.signal } : {}) });
      for (const scene of locked.scenes) {
        const blocks = layouts[scene.id];
        if (blocks && blocks.length > 1) overlapIssues.push(...checkOverlap(blocks, scene.id, "warning"));
        // N17 (text truncation/clipping): run the per-block probe over each
        // measured rect against this scene's rendered still. Same measure pass +
        // same warning posture as overlap; finally wires N17 onto real renders
        // (it needs a content box a flat raster can't carry, so it was never run).
        if (blocks && blocks.length > 0) {
          const stillPath = join(paths.reviewDir, `${scene.id}.png`);
          overlapIssues.push(...(await runTruncationForScene(stillPath, blocks, scene.id, renderGridOptions)));
        }
      }
      await appendEvent(projectId, { type: "render.overlap", scenes: Object.keys(layouts).length, issues: overlapIssues.length });
    } catch (error) {
      await appendEvent(projectId, { type: "render.overlap.skipped", cause: errMessage(error) });
    }

    const report = makeReport(
      [...buildGate.issues, ...detReport.issues, ...renderGrid.issues, ...overlapIssues, ...reviewArtifacts.report.issues],
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

/**
 * Persist a safety report for a PRE-render failure (e.g. N10 typecheck) to the
 * same path the MCP `get_safety_report` tool reads. The render path's normal
 * report is written by the MCP layer AFTER a render returns; an early throw
 * never reaches that, so the repair loop would otherwise read a stale or missing
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
 * Resolve the default background-music track: `default.mp3` at the repo root.
 * Returns undefined when absent so renders simply run without BGM. Callers may
 * override with an explicit `bgmPath`.
 */
function defaultBgmPath(): string | undefined {
  const candidate = join(workspaceRoot(), "default.mp3");
  return existsSync(candidate) ? candidate : undefined;
}
