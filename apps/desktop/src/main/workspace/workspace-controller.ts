import { authorInputWithCrawledImages, runCreateCrawlThenAuthor } from "./workspace-create-flow.js";
import { canStartThumbnailRender, combineIntent, stageToFriendlyStatus } from "./workspace-helpers.js";
import { clampRenderRatio, renderProgressEventOf, renderingStageOf } from "./workspace-render-flow.js";
import {
  refineBeforeDraft as runRefineBeforeDraft,
  refineEditedScenes as runRefineEditedScenes,
  restoreToPriorDraft as runRestoreToPriorDraft,
  type RefineFlowDeps,
} from "./workspace-refine-flow.js";
import { applyScriptEditsToManifest, runScriptAuthoring, scriptGateModelFromLines } from "./workspace-script-flow.js";
import {
  classifyStageKindTransition,
  shouldLogStageTransition,
  stageFingerprint,
  stageKindOf,
} from "./workspace-stage.js";
import {
  fullRenderStageStart,
  publishErrorStageOf,
  publishedStageOf,
  readyStageOf,
  scriptLinesFromScenes,
  storyboardScenesFromScenes,
} from "./workspace-view-model.js";
import { WorkspaceRepairTrace } from "./workspace-repair-trace.js";
import { createLogger, serializeError, type CrawledImage } from "@motionreal/pipeline";
import { classifyError } from "../agent/error-classifier.js";
import { toFriendlyError } from "../redact/friendly.js";
import {
  AUTHORING_CONTRACT_REF,
  type AgentHooks,
  type AgentWorker,
  type AuthorInput,
  type SceneSnapshot,
} from "../agent/agent-worker.js";
import type {
  ApplyResult,
  ProjectCardVM,
  ProjectStage,
  ScriptEdit,
  ScriptGateModel,
  ScriptLine,
  SceneCard,
  SceneTimeline,
  ScriptEvidenceModel,
  StoryboardModel,
} from "../../shared/types.js";

const log = createLogger("workspace");

/**
 * WorkspaceController — the tested home for the
 * staged-workspace orchestration that was inline in `index.ts`
 * (`stages`/`setStage`/`runScript`/`runRender`/`scriptLinesOf`/
 * `storyboardScenesOf`) plus the project/script read handlers
 * (`projects:list/stage/open/delete/reveal`, `script:get/applyEdits/approve`).
 *
 * It reproduces the previous main-process staged-workspace behavior and injects
 * all Electron/engine/pipeline access through seams so it is testable without
 * Electron.
 */

/** A manifest scene as the dashboard needs it (other fields preserved opaquely). */
export type WsScene = { id: string; narration?: string; headline?: string; eyebrow?: string; image?: { ref: string } };
/**
 * The manifest projection the dashboard reads. `title`/`hashtags` are the publish
 * metadata (the project display name + TikTok hashtags); rename patches `title`
 * and the published stage surfaces both for the Copy panel. Other manifest
 * fields (theme/format/scenes detail) are preserved opaquely across a write —
 * `loadManifest` returns the FULL on-disk object, so spreading it on write keeps
 * them intact.
 */
export type WsManifest = { title?: string; hashtags?: string[]; format?: "tiktok" | "youtube"; scenes: WsScene[] };

/**
 * Title length cap on rename, matching the authoring manifest schema's own
 * `clampStr(160)` (apps/desktop/src/main/authoring/manifest-schema.ts) so a
 * user-typed title can never exceed what the AI-authored one can. A longer paste
 * is trimmed, not rejected.
 */
const TITLE_MAX_CHARS = 160;

export interface WorkspaceEvents {
  progress(e: { projectId: string; ratio: number; phase: "draft" | "full" }): void;
  scene(e: { projectId: string; sceneId: string; stillPath: string }): void;
  status(e: { projectId: string; status: "building" | "draft-ready" | "done" | "error" }): void;
  friendlyError(e: { projectId?: string; message: string; retry?: "draft" | "full" | "create" | "activate" | "connect"; fixable?: boolean }): void;
}

export interface WorkspaceDeps {
  worker: AgentWorker;
  events: WorkspaceEvents;
  /** Live settings reads (SettingsStore). */
  settings: {
    readonly scriptGateEnabled: boolean;
    readonly maxRepairAttempts: number;
    readonly refinePasses: number;
    /** Require TWO consecutive clean vision passes (not one) before stopping early. */
    readonly refineEarlyStop: boolean;
    readonly imageCrawlAiFilter: boolean;
    readonly imageCrawlHumanReview: boolean;
  };
  /** Gallery cards, already mediaUrl-wrapped + fallback-to-[] at the seam. */
  listProjects: () => Promise<ProjectCardVM[]>;
  loadManifest: (projectId: string) => Promise<WsManifest>;
  writeManifest: (projectId: string, manifest: WsManifest) => Promise<void>;
  /** Optional evidence artifact; source review appears only when URL metadata exists. */
  loadEvidence?: (projectId: string) => Promise<ScriptEvidenceModel | undefined>;
  /** mediaUrl-wrapped path to a scene's review still (`review/<sceneId>.png`). */
  reviewStill: (projectId: string, sceneId: string) => string;
  /** mediaUrl-wrapped path to a project asset (`assets/<sha>.<ext>`) for the crawl-review preview. */
  assetMedia: (projectId: string, ref: string) => string;
  /** Wrap an absolute still path for the renderer (mediaUrl, or empty when denied). */
  toMedia: (absPath: string) => string;
  /** Whether a scene's review still exists on disk. */
  hasStill: (projectId: string, sceneId: string) => boolean;
  /** Whether the full-quality MP4 has been rendered for this project. */
  hasOutput: (projectId: string) => boolean;
  /** mediaUrl-wrapped path to the full-quality MP4. */
  outputMedia: (projectId: string) => string;
  /** Whether the low-res draft MP4 (`<id>.draft.mp4`) has been rendered. */
  hasDraft: (projectId: string) => boolean;
  /** mediaUrl-wrapped path to the low-res draft MP4 (for in-app preview). */
  draftMedia: (projectId: string) => string;
  /**
   * Optional locked-timeline projection for storyboard seek/highlight.
   * Missing/torn lock → empty map (still-only review).
   */
  loadSceneTimelines?: (projectId: string) => Promise<Record<string, SceneTimeline>>;
  /** Render a caption-free still of the first authored scene as the cover PNG. */
  renderThumbnail?: (projectId: string) => Promise<{ path: string }>;
  /** Whether the thumbnail PNG (`review/thumbnail.png`) exists on disk. */
  hasThumbnail: (projectId: string) => boolean;
  /** mediaUrl-wrapped path to the thumbnail PNG. */
  thumbnailMedia: (projectId: string) => string;
  deleteProject: (projectId: string) => Promise<void>;
  revealProject: (projectId: string) => Promise<void>;
  /**
   * Rehydrate a project's AuthorInput from its persisted brief when the
   * in-memory copy is gone (after an app restart), so "Thử lại" on a stranded
   * project actually re-authors instead of no-op'ing. Returns null when the
   * brief can't be read. Optional: absent ⇒ retry only works in-session.
   */
  recallInput?: (projectId: string) => Promise<AuthorInput | null>;
  /** Redact L0 engine tokens from any message before it reaches the UI. */
  redact: (message: string) => string;
  /**
   * Best-effort project event append for diagnostics. Must never block or throw
   * into render/authoring critical paths (callers fire-and-forget).
   */
  appendProjectEvent?: (projectId: string, event: { type: string } & Record<string, unknown>) => void;
}

export class WorkspaceController {
  private readonly stages = new Map<string, ProjectStage>();
  /** Remember each project's author input so the error screen can re-run it. */
  private readonly inputs = new Map<string, AuthorInput>();
  /**
   * Crawled-image pool awaiting the user's review (crawled-image review stage).
   * Set when a brief-link crawl yields images and human-review is ON; the
   * `image-review` stage shows it, and `submitImageReview` consumes it (folding
   * the chosen refs into `AuthorInput.images`) then deletes the entry. Holds the
   * base `AuthorInput` too so authoring can begin with the user's selection.
   */
  private readonly pendingReview = new Map<string, { input: AuthorInput; pool: CrawledImage[] }>();
  /**
   * Per-project render version. Bumped each time a fresh draft is produced so the
   * review stills get a NEW url token (`#r<n>`) only when the pixels actually
   * changed — the UI reloads thumbnails on a real re-render, but stable polling
   * keeps the same url (no flicker).
   */
  private readonly renderVersions = new Map<string, number>();

  /**
   * Per-project in-flight guard: a project can run only ONE author/render/edit/
   * publish loop at a time. Prevents a double-clicked action (or a stale poll)
   * from starting two concurrent loops that would race the manifest, the
   * process-wide component registry, the TTS cache and the output file.
   */
  private readonly inFlight = new Set<string>();
  /** Settling promises for in-flight jobs so delete can await cancel completion. */
  private readonly inFlightTasks = new Map<string, Promise<void>>();

  /**
   * Per-project AbortController for the in-flight job, so "Dừng render" can
   * abort exactly the loop that's running. Created when a guarded job starts and
   * cleared when it settles; `cancel` fires it. The signal is threaded into the
   * worker (render + AI calls), which abort the Remotion encode (cancelSignal)
   * and the fetch chats, then report `cancelled` so we recover the prior stage.
   */
  private readonly aborters = new Map<string, AbortController>();

  constructor(private readonly deps: WorkspaceDeps) {}

  /** Run an exclusive per-project job; ignored if one is already in flight. */
  private guarded(projectId: string, run: () => Promise<void>): void {
    if (this.inFlight.has(projectId)) return;
    this.inFlight.add(projectId);
    this.aborters.set(projectId, new AbortController());
    const task = run().finally(() => {
      this.inFlight.delete(projectId);
      this.aborters.delete(projectId);
      this.inFlightTasks.delete(projectId);
    });
    this.inFlightTasks.set(projectId, task);
    void task;
  }

  /** The in-flight job's abort signal for this project, if one is running. */
  private signalOf(projectId: string): AbortSignal | undefined {
    return this.aborters.get(projectId)?.signal;
  }

  /**
   * "Dừng render": abort the in-flight author/render/edit/publish job for this
   * project. The worker's loops check the signal at each boundary and the live
   * render aborts via Remotion's cancelSignal; the run methods then restore the
   * prior reviewable stage (recover-on-cancel) instead of an error. No-op when
   * nothing is running for the project.
   */
  cancel(projectId: string): void {
    this.aborters.get(projectId)?.abort();
  }

  /**
   * Recover the workspace after a user cancel: a cancel is NOT a failure, so drop
   * the in-memory stage and re-derive the last reviewable stage from disk
   * (ready / script / published / writing) — never an error screen. The engine
   * leaves project state untouched on cancel, so the on-disk artifacts (stills,
   * a prior draft) are authoritative for where to land.
   */
  private async recoverAfterCancel(projectId: string): Promise<void> {
    this.stages.delete(projectId);
    this.setStage(projectId, await this.recoverStage(projectId));
  }

  /** Set + broadcast a stage (status mirrors the kind, as previous main-process behavior). */
  setStage(projectId: string, stage: ProjectStage): void {
    const previous = this.stages.get(projectId);
    this.stages.set(projectId, stage);
    this.deps.events.status({ projectId, status: stageToFriendlyStatus(stage.kind) });
    // Log kind/phase transitions only — percent ticks share a fingerprint and are skipped.
    if (shouldLogStageTransition(previous, stage)) {
      const from = stageFingerprint(previous);
      const to = stageFingerprint(stage);
      log.info({ projectId, from, to }, "workspace stage transition");
      const kindClass = classifyStageKindTransition(stageKindOf(previous), stage.kind);
      if (kindClass === "unknown") {
        log.debug(
          { projectId, from, to, fromKind: stageKindOf(previous), toKind: stage.kind },
          "workspace stage kind hop not in policy table",
        );
      }
    }
  }

  /** Bump the render version so the next storyboard's stills reload exactly once. */
  private bumpRenderVersion(projectId: string): void {
    this.renderVersions.set(projectId, (this.renderVersions.get(projectId) ?? 0) + 1);
  }

  /**
   * Build a `ready` stage, attaching the in-app draft player source when a draft
   * MP4 exists. The draft is the low-res preview (half res, 10fps) the user can
   * play to check pacing/voice without digging through folders; the storyboard
   * stills stay the per-scene edit surface. Every site that lands on `ready`
   * routes through here so the draft player is never silently dropped.
   */
  private readyStage(projectId: string, scenes: SceneCard[], notice?: string): ProjectStage {
    const draftPath = this.deps.hasDraft(projectId) ? this.deps.draftMedia(projectId) : undefined;
    return readyStageOf(scenes, { draftPath, notice });
  }

  /**
   * Build the `published` stage, attaching the publish metadata (title +
   * hashtags) the final-screen Copy panel shows. The title/hashtags live
   * in the manifest (the single source of truth); a failed/absent read degrades
   * to just the video — the panel simply omits the copy affordances rather than
   * blocking the finished video from showing. Every site that lands on
   * `published` routes through here so the Copy panel is wired consistently.
   */
  private async publishedStage(projectId: string, outputPath: string): Promise<ProjectStage> {
    let title: string | undefined;
    let hashtags: string[] | undefined;
    // Format drives the thumbnail UI's aspect (9:16 vs 16:9). Default to tiktok
    // (the historical vertical default) when the manifest is unreadable.
    let format: "tiktok" | "youtube" = "tiktok";
    try {
      const manifest = await this.deps.loadManifest(projectId);
      const t = manifest.title?.trim();
      if (t) title = t;
      if (Array.isArray(manifest.hashtags) && manifest.hashtags.length > 0) hashtags = manifest.hashtags;
      if (manifest.format === "youtube") format = "youtube";
    } catch (e) {
      console.warn(`[workspace] publishedStage: cannot read manifest for ${projectId}:`, e);
    }
    // Surface an already-rendered thumbnail (review/thumbnail.png) if present.
    // Never generated here — the user triggers it from the published screen; this
    // only reflects what exists on disk so a re-entry/recover shows it too.
    const thumbnailPath = this.deps.hasThumbnail(projectId) ? this.deps.thumbnailMedia(projectId) : undefined;
    return publishedStageOf(outputPath, { title, hashtags, format, thumbnailPath });
  }

  private async scriptLinesOf(projectId: string): Promise<ScriptLine[]> {
    const manifest = await this.deps.loadManifest(projectId);
    return scriptLinesFromScenes(manifest.scenes, (ref) => this.deps.assetMedia(projectId, ref));
  }

  private async storyboardScenesOf(projectId: string): Promise<SceneCard[]> {
    const ver = this.renderVersions.get(projectId) ?? 0;
    const [manifest, timelines] = await Promise.all([
      this.deps.loadManifest(projectId),
      this.deps.loadSceneTimelines?.(projectId).catch((error) => {
        log.debug?.({ err: error, projectId }, "scene timelines unreadable; storyboard keeps still-only timing");
        return {} as Record<string, SceneTimeline>;
      }) ?? Promise.resolve({} as Record<string, SceneTimeline>),
    ]);
    return storyboardScenesFromScenes(
      projectId,
      manifest.scenes,
      ver,
      (sceneId) => this.deps.reviewStill(projectId, sceneId),
      timelines && Object.keys(timelines).length > 0 ? timelines : undefined,
    );
  }

  /**
   * Create entry for linked briefs: article image crawl, optional AI image
   * preselection, then — when human-review is on — a blocking crawled-image
   * review stage so the user confirms the set BEFORE a word is authored (so the
   * AI fits content to the approved images). No link, no crawled image, or
   * human-review off all collapse to the existing `beginScript` path.
   */
  beginCreate(projectId: string, input: AuthorInput): void {
    if (this.inFlight.has(projectId)) return;
    this.inputs.set(projectId, input);
    // No link → nothing to crawl; behave exactly as before.
    if (input.urls.length === 0) {
      this.beginScript(projectId, input);
      return;
    }
    this.setStage(projectId, { kind: "writing", phase: "crawl" });
    this.guarded(projectId, () => this.runCrawlThenAuthor(projectId, input));
  }

  private async runCrawlThenAuthor(projectId: string, input: AuthorInput): Promise<void> {
    await runCreateCrawlThenAuthor({
      projectId,
      input,
      signal: this.signalOf(projectId),
      worker: this.deps.worker,
      settings: this.deps.settings,
      setStage: (stage) => this.setStage(projectId, stage),
      recoverAfterCancel: () => this.recoverAfterCancel(projectId),
      runScript: (nextInput) => this.runScript(projectId, nextInput),
      parkReview: (review) => this.pendingReview.set(projectId, review),
      previewUrlOf: (ref) => this.deps.assetMedia(projectId, ref),
      warn: (details, message) => log.warn(details, message),
    });
  }

  /**
   * Resolve a blocking crawled-image review: author with the user's selected
   * crawled refs folded into the author input. An empty selection is valid →
   * author text-only. No-op when nothing is parked (stale/double submit).
   */
  submitImageReview(projectId: string, selectedRefs: string[]): void {
    const parked = this.pendingReview.get(projectId);
    if (!parked) return;
    if (this.stages.get(projectId)?.kind !== "image-review") return;
    this.pendingReview.delete(projectId);
    const allowed = new Set(selectedRefs);
    const chosen = parked.pool.filter((c) => allowed.has(c.ref));
    this.beginScript(projectId, authorInputWithCrawledImages(parked.input, chosen));
  }

  /** Stage 1: AI writes the script; then wait for approval unless the gate is off. */
  beginScript(projectId: string, input: AuthorInput): void {
    if (this.inFlight.has(projectId)) return; // a loop is already running for this project
    this.inputs.set(projectId, input);
    this.setStage(projectId, { kind: "writing", phase: "author" });
    this.guarded(projectId, () => this.runScript(projectId, input));
  }

  /**
   * Re-run authoring for a project from its remembered input (the "Thử lại"
   * action). The in-memory input is gone after an app restart, so fall back to
   * rehydrating it from the persisted brief (prompt + delivery metadata).
   * Without this, a project stranded across a restart shows an error screen
   * whose "Thử lại" calls retry → empty inputs → silent no-op → the poll
   * re-derives the same error (an error↔writing flicker). Create-time images
   * aren't persisted, so a rehydrated retry re-authors from
   * text + links only — a degraded but functional recovery, not a dead button.
   */
  async retry(projectId: string): Promise<void> {
    let input = this.inputs.get(projectId);
    if (!input) input = (await this.deps.recallInput?.(projectId)) ?? undefined;
    if (input) this.beginScript(projectId, input);
  }

  private async runScript(projectId: string, input: AuthorInput): Promise<void> {
    await runScriptAuthoring({
      projectId,
      input,
      worker: this.deps.worker,
      scriptGateEnabled: this.deps.settings.scriptGateEnabled,
      redact: this.deps.redact,
      loadScriptLines: () => this.scriptLinesOf(projectId),
      loadEvidence: this.deps.loadEvidence
        ? () => this.deps.loadEvidence!(projectId)
        : undefined,
      setStage: (stage) => this.setStage(projectId, stage),
      runRender: (readyNotice) => this.runRender(projectId, readyNotice),
      friendlyError: (error) => this.deps.events.friendlyError(error),
      logError: (message, error) => console.error(message, error),
      signal: this.signalOf(projectId),
      recoverAfterCancel: () => this.recoverAfterCancel(projectId),
    });
  }

  /** Stage 2: render voice + draft via generate-validate-repair. */
  approve(projectId: string): void {
    this.guarded(projectId, () => this.runRender(projectId));
  }

  /** "Sửa bằng AI": re-run the repair loop on a Content_Error project. */
  fixWithAi(projectId: string): void {
    if (this.stages.get(projectId)?.kind !== "error") return; // only from an error screen; no double-run
    this.guarded(projectId, () => this.runRender(projectId));
  }

  /**
   * "Duyệt & xuất bản": render the final full-quality MP4. Runs from the `ready`
   * review stage, OR as a "Thử lại" on a publish (full-render) error — that error
   * carries `retry: "full"`, so re-running the SAME publish is the right recovery
   * (an infra blip), not a re-author. Any other stage is a no-op.
   */
  publish(projectId: string): void {
    const s = this.stages.get(projectId);
    const canPublish = s?.kind === "ready" || (s?.kind === "error" && s.retry === "full");
    if (!canPublish) return;
    this.guarded(projectId, () => this.runPublish(projectId));
  }

  private async runPublish(projectId: string): Promise<void> {
    this.setStage(projectId, fullRenderStageStart());
    const signal = this.signalOf(projectId);
    try {
      const res = await this.deps.worker.publish(projectId, signal);
      // A user cancel ("Dừng render") during the full render is NOT a failure:
      // the engine threw a RenderCancelledError (no `state: "failed"`) and left
      // the prior draft intact, so recover the reviewable stage, not an error.
      if (signal?.aborted) {
        await this.recoverAfterCancel(projectId);
      } else if (res.ok) {
        this.setStage(projectId, await this.publishedStage(projectId, this.deps.toMedia(res.outputPath)));
      } else {
        const fixable = res.error ? classifyError(res.error) === "content" : false;
        const message = res.error
          ? toFriendlyError(res.error, { projectId, phase: "full" }).message
          : "Xuất bản thất bại. Hãy thử lại.";
        this.setStage(projectId, publishErrorStageOf({ message, fixable }));
        this.deps.events.friendlyError({ projectId, message, retry: "full", fixable });
      }
    } catch (e) {
      const fixable = classifyError(serializeError(e, "render")) === "content";
      console.error(`[workspace] publish failed for ${projectId}:`, e);
      const message = "Có lỗi khi xuất bản video. Hãy thử lại.";
      this.setStage(projectId, publishErrorStageOf({ message, fixable }));
      this.deps.events.friendlyError({ projectId, message, retry: "full", fixable });
    }
  }

  /**
   * Per-scene free-form edit (Canva-style review): re-author the named scenes
   * with the user's natural-language instruction, then re-render the draft. Only
   * runs from the `ready` review stage; an empty instruction set is a no-op.
   */
  submitEdits(projectId: string, edits: { sceneId: string; text: string }[], globalNotes: string): void {
    if (this.stages.get(projectId)?.kind !== "ready") return;
    const named = edits.map((e) => ({ sceneId: e.sceneId, text: e.text.trim() })).filter((e) => e.text.length > 0);
    const notes = globalNotes.trim();
    if (named.length === 0 && notes === "") return; // nothing to do
    this.guarded(projectId, () => this.runSceneEdits(projectId, named, notes));
  }

  private async runSceneEdits(
    projectId: string,
    named: { sceneId: string; text: string }[],
    globalNotes: string,
  ): Promise<void> {
    this.setStage(projectId, { kind: "rendering", percent: 0, phase: "edit" });
    // The reauthor step is an AI rewrite with no measurable progress → show it
    // as an indeterminate "edit" phase (no jumpy percent from emitScenes).
    const editHooks = this.editHooks(projectId);
    const hooks = this.renderHooks(projectId, "draft");
    const signal = this.signalOf(projectId);
    try {
      // Resolve which scenes to re-author: the explicitly-edited ones, or — when
      // ONLY a video-wide note was given — every scene (the note applies to all).
      let entries = named;
      if (entries.length === 0) {
        const manifest = await this.deps.loadManifest(projectId).catch((error) => {
          log.warn({ err: error, projectId }, "edit manifest read failed; no scenes selected for global edit");
          return { scenes: [] as WsScene[] };
        });
        entries = manifest.scenes.map((s) => ({ sceneId: s.id, text: "" }));
      }
      const sceneIds = entries.map((e) => e.sceneId);
      const perSceneIntent = Object.fromEntries(entries.map((e) => [e.sceneId, combineIntent(e.text, globalNotes)]));
      // Snapshot the known-good source of the scenes we're about to edit, so a
      // regressive edit (one the model can't render cleanly) can be rolled back
      // to the draft the user already had — an edit may only IMPROVE or KEEP the
      // draft, never downgrade a passing one to a broken/error state. Mirrors the
      // visual-QA non-regression guard, now extended to user edits.
      const snapshot = (await this.deps.worker.snapshotScenes?.(projectId, sceneIds).catch((error) => {
        log.warn({ err: error, projectId, sceneIds }, "pre-edit snapshot failed; rollback snapshot is empty");
        return [];
      })) ?? [];
      // Apply the user's instruction by re-authoring the scene code…
      const applied = await this.deps.worker.reauthorScenes(
        { projectId, sceneIds, preprompt: { contractRef: AUTHORING_CONTRACT_REF, affectedSceneIds: sceneIds, perSceneIntent, globalNotes } },
        editHooks,
        signal,
      );
      // A cancel during the reauthor AI calls: stop without pretending success;
      // restore the prior reviewable stage (the engine left the project intact).
      if (signal?.aborted) {
        await this.recoverAfterCancel(projectId);
        return;
      }
      const appliedIds = applied.kind === "authored" ? applied.sceneIds : [];
      // If we asked to edit ≥1 scene but EVERY rewrite failed admission (rolled
      // back), the draft is unchanged — do NOT pretend success. Return to the
      // review stage with a visible notice so the user can retry / rephrase.
      if (sceneIds.length > 0 && appliedIds.length === 0) {
        this.setStage(projectId, this.readyStage(
          projectId,
          await this.storyboardScenesOf(projectId),
          "Chưa áp dụng được chỉnh sửa cho cảnh bạn chọn (AI tạo mã chưa hợp lệ). Hãy thử lại hoặc diễn đạt rõ hơn.",
        ));
        return;
      }
      // Stills-first refine (mirror the first-author refineBeforeDraft): render
      // cheap stills for the edited scenes → vision-QA loop → fix on the stills
      // path — all BEFORE any draft MP4. So we no longer dress a full draft (with
      // TTS) just to give vision frames and then re-render. The single draft MP4
      // is rendered ONCE, AFTER vision is clean. A refine that breaks the render
      // (empty stills) returns false → restore the pre-edit draft the user had.
      const stillsOk = await this.refineEditedScenes(projectId, sceneIds, signal);
      if (signal?.aborted) {
        await this.recoverAfterCancel(projectId);
        return;
      }
      if (!stillsOk) {
        // The edit broke admission/render on the cheap stills path. Restore the
        // known-good pre-edit source and re-render the draft the user already had
        // (an edit may only improve or keep the draft, never strand it broken).
        if (await this.restoreToPriorDraft(projectId, snapshot, hooks)) {
          this.setStage(projectId, this.readyStage(
            projectId,
            await this.storyboardScenesOf(projectId),
            "Chưa áp dụng được chỉnh sửa này (làm hỏng bố cục cảnh) — đã giữ lại bản nháp trước đó. Hãy thử diễn đạt khác hoặc chỉnh nhẹ hơn.",
          ));
        } else {
          const message = "Chưa áp dụng được chỉnh sửa sau nhiều lần thử. Bạn có thể thử lại hoặc để AI sửa.";
          this.setStage(projectId, { kind: "error", message, fixable: true, retry: "draft" });
          this.deps.events.friendlyError({ projectId, message, retry: "draft", fixable: true });
        }
        return;
      }
      // …then render the draft ONCE (and auto-repair any new oracle errors).
      this.setStage(projectId, { kind: "rendering", percent: 0, phase: "draft" });
      const outcome = await this.deps.worker.generateValidateRepair(projectId, { maxAttempts: this.deps.settings.maxRepairAttempts }, hooks, signal);
      if (outcome.kind === "cancelled") {
        await this.recoverAfterCancel(projectId);
      } else if (outcome.kind === "passed") {
        this.bumpRenderVersion(projectId);
        // If the user explicitly edited some scenes but a SUBSET failed to apply,
        // say so (the rest did render) so a half-applied batch isn't silent.
        const failedNamed = named.filter((n) => !appliedIds.includes(n.sceneId));
        const notice =
          failedNamed.length > 0
            ? `Đã áp dụng chỉnh sửa, nhưng chưa đổi được ${failedNamed.length} cảnh (AI tạo mã chưa hợp lệ) — bạn có thể thử lại các cảnh đó.`
            : undefined;
        this.setStage(projectId, this.readyStage(projectId, await this.storyboardScenesOf(projectId), notice));
      } else if (outcome.kind === "infra") {
        const message = "Gặp trục trặc hạ tầng khi dựng lại (kết nối hoặc cấu hình). Hãy kiểm tra và thử lại.";
        this.setStage(projectId, { kind: "error", message, fixable: false, retry: "draft" });
        this.deps.events.friendlyError({ projectId, message, retry: "draft", fixable: false });
      } else if (await this.restoreToPriorDraft(projectId, snapshot, hooks)) {
        // The edit produced a draft we couldn't clean up (content errors after
        // every attempt). Rather than strand the user on an error screen with a
        // broken scene, we restored the pre-edit source and re-rendered the draft
        // they already had — the edit only ever improves or keeps the draft.
        this.setStage(projectId, this.readyStage(
          projectId,
          await this.storyboardScenesOf(projectId),
          "Chưa áp dụng được chỉnh sửa này (làm hỏng bố cục cảnh) — đã giữ lại bản nháp trước đó. Hãy thử diễn đạt khác hoặc chỉnh nhẹ hơn.",
        ));
      } else {
        const message = "Chưa áp dụng được chỉnh sửa sau nhiều lần thử. Bạn có thể thử lại hoặc để AI sửa.";
        this.setStage(projectId, { kind: "error", message, fixable: true, retry: "draft" });
        this.deps.events.friendlyError({ projectId, message, retry: "draft", fixable: true });
      }
    } catch (e) {
      const fixable = classifyError(serializeError(e, "render")) === "content";
      console.error(`[workspace] scene edits failed for ${projectId}:`, e);
      const message = "Có lỗi khi áp dụng chỉnh sửa. Hãy thử lại.";
      this.setStage(projectId, { kind: "error", message, fixable, retry: "draft" });
      this.deps.events.friendlyError({ projectId, message, retry: "draft", fixable });
    }
  }

  private appendDiag(projectId: string, event: { type: string } & Record<string, unknown>): void {
    try {
      this.deps.appendProjectEvent?.(projectId, event);
    } catch (_appendError) {
      // diagnostics never block
    }
  }

  /** Hooks for a reauthor step that has no measurable progress (indeterminate). */
  private editHooks(projectId: string, repairTrace?: WorkspaceRepairTrace): AgentHooks {
    return {
      onProgress: () => {},
      onSceneProduced: (sceneId, stillPath) => this.deps.events.scene({ projectId, sceneId, stillPath: this.deps.toMedia(stillPath) }),
      onRepair: (fix) => {
        repairTrace?.noteRepair(fix);
      },
    };
  }

  /** Build callback deps for the extracted refine flow module. */
  private refineDeps(projectId: string, signal: AbortSignal | undefined): RefineFlowDeps {
    return {
      projectId,
      ...(signal ? { signal } : {}),
      settings: this.deps.settings,
      worker: this.deps.worker,
      loadManifest: (id) => this.deps.loadManifest(id),
      setStage: (stage) => this.setStage(projectId, stage),
      editHooks: () => this.editHooks(projectId),
      warn: (details, message) => log.warn(details, message),
    };
  }

  /** Silent refine before first draft MP4 — implementation in workspace-refine-flow. */
  private refineBeforeDraft(projectId: string, signal: AbortSignal | undefined): Promise<SceneSnapshot> {
    return runRefineBeforeDraft(this.refineDeps(projectId, signal));
  }

  /** Edit-path vision refine only — implementation in workspace-refine-flow. */
  private refineEditedScenes(
    projectId: string,
    sceneIds: string[],
    signal: AbortSignal | undefined,
  ): Promise<boolean> {
    return runRefineEditedScenes(this.refineDeps(projectId, signal), sceneIds);
  }

  /** Restore pre-edit source and re-render known-good draft. */
  private restoreToPriorDraft(
    projectId: string,
    snapshot: SceneSnapshot,
    hooks: AgentHooks,
  ): Promise<boolean> {
    return runRestoreToPriorDraft({
      projectId,
      snapshot,
      settings: this.deps.settings,
      worker: this.deps.worker,
      setStage: (stage) => this.setStage(projectId, stage),
      hooks,
      bumpRenderVersion: () => this.bumpRenderVersion(projectId),
    });
  }

  private renderHooks(
    projectId: string,
    phase: "draft" | "full" = "draft",
    repairTrace?: WorkspaceRepairTrace,
  ): AgentHooks {
    return {
      onProgress: (ratio) => {
        this.setStage(projectId, renderingStageOf(phase, { ratio }));
        this.deps.events.progress(renderProgressEventOf(projectId, ratio, phase));
      },
      onSceneProduced: (sceneId, stillPath) => this.deps.events.scene({ projectId, sceneId, stillPath: this.deps.toMedia(stillPath) }),
      onRepair: (fix) => {
        repairTrace?.noteRepair(fix);
      },
    };
  }

  private flushRepairTrace(projectId: string, trace: WorkspaceRepairTrace, outcome: "passed" | "reverted" | "exhausted" | "infra" | "cancelled"): void {
    for (const event of trace.finalize(outcome)) {
      this.appendDiag(projectId, event);
    }
  }

  /**
   * Drive the rendering stage's percent from the renderer's REAL per-frame
   * progress (forwarded from the render tool's onProgress via the Composition_
   * Root). This is the smooth, accurate signal, preserving the active phase.
   */
  reportRenderProgress(projectId: string, ratio: number): void {
    const s = this.stages.get(projectId);
    if (s?.kind !== "rendering") return;
    this.setStage(projectId, renderingStageOf(s.phase, { ratio: clampRenderRatio(ratio) }));
  }

  private async runRender(projectId: string, readyNotice?: string): Promise<void> {
    const repairTrace = new WorkspaceRepairTrace();
    const hooks = this.renderHooks(projectId, "draft", repairTrace);
    const signal = this.signalOf(projectId);
    try {
      // SILENT refine FIRST : render cheap stills,
      // do the one-shot creative bootstrap + the defect-fixing vision loop — all on
      // the no-TTS/no-MP4 path, hidden from the user — BEFORE the first real MP4
      // draft. So the draft the user eventually sees is already the refined take,
      // and the vision work no longer runs AFTER a 100%-complete MP4 (the old
      // "stuck at 100%" symptom). `preRefine` is the blind pre-refine source we
      // fall back to if the refined draft can't be repaired (never ship worse).
      const preRefine = await this.refineBeforeDraft(projectId, signal);
      if (signal?.aborted) {
        this.flushRepairTrace(projectId, repairTrace, "cancelled");
        await this.recoverAfterCancel(projectId);
        return;
      }

      this.setStage(projectId, { kind: "rendering", percent: 0, phase: "draft" });
      let outcome = await this.deps.worker.generateValidateRepair(projectId, { maxAttempts: this.deps.settings.maxRepairAttempts }, hooks, signal);
      // If the refined draft regresses (the bold/QA rewrites can't be repaired) but
      // the blind source was clean, restore it and re-render — refine must never
      // ship a draft worse than the un-refined one.
      let restored = false;
      if (outcome.kind === "exhausted" && preRefine.length > 0 && this.deps.worker.restoreScenes) {
        this.setStage(projectId, { kind: "rendering", percent: 0, phase: "prepare" });
        await this.deps.worker.restoreScenes(projectId, preRefine);
        restored = true;
        this.setStage(projectId, { kind: "rendering", percent: 0, phase: "draft" });
        outcome = await this.deps.worker.generateValidateRepair(projectId, { maxAttempts: this.deps.settings.maxRepairAttempts }, hooks, signal);
      }
      if (outcome.kind === "cancelled") {
        this.flushRepairTrace(projectId, repairTrace, "cancelled");
        await this.recoverAfterCancel(projectId);
      } else if (outcome.kind === "passed") {
        this.flushRepairTrace(projectId, repairTrace, restored ? "reverted" : "passed");
        this.bumpRenderVersion(projectId);
        this.setStage(projectId, this.readyStage(projectId, await this.storyboardScenesOf(projectId), readyNotice));
      } else if (outcome.kind === "infra") {
        this.flushRepairTrace(projectId, repairTrace, "infra");
        // Not agent-fixable: tell the user to retry / check setup, no "Sửa bằng AI".
        const message = "Gặp trục trặc hạ tầng khi dựng (kết nối hoặc cấu hình). Hãy kiểm tra lại và thử lại.";
        this.setStage(projectId, { kind: "error", message, fixable: false, retry: "draft" });
        this.deps.events.friendlyError({ projectId, message, retry: "draft", fixable: false });
      } else {
        this.flushRepairTrace(projectId, repairTrace, "exhausted");
        // exhausted: content defects remain → offer "Sửa bằng AI".
        const message = "Chưa hoàn tất được video sau nhiều lần thử. Bạn có thể thử lại hoặc để AI sửa.";
        this.setStage(projectId, { kind: "error", message, fixable: true, retry: "draft" });
        this.deps.events.friendlyError({ projectId, message, retry: "draft", fixable: true });
      }
    } catch (e) {
      this.flushRepairTrace(projectId, repairTrace, "infra");
      const fixable = classifyError(serializeError(e, "render")) === "content";
      console.error(`[workspace] render failed for ${projectId}:`, e);
      const message = "Có lỗi khi dựng video. Hãy thử lại.";
      this.setStage(projectId, { kind: "error", message, fixable, retry: "draft" });
      this.deps.events.friendlyError({ projectId, message, retry: "draft", fixable });
    }
  }

  // --- read/IPC operations ------------------------------------------------

  list(): Promise<ProjectCardVM[]> {
    return this.deps.listProjects().then((cards) =>
      cards.map((c) => {
        // Overlay the live in-memory stage so the gallery card matches the
        // workspace (the on-disk brief.state isn't updated on dashboard-level
        // authoring failures, which otherwise showed "building" while the
        // workspace showed "error").
        const stage = this.stages.get(c.projectId);
        if (stage) return { ...c, status: stageToFriendlyStatus(stage.kind) };
        // Recover from disk too. A completed full MP4 (or an existing draft) is
        // more authoritative than a stale brief.state after an app restart or a
        // missed renderer status event; otherwise cards can stay red until the
        // user opens the project, which calls stage and memoizes the recovery.
        if (this.deps.hasOutput(c.projectId)) return { ...c, status: "done" };
        if (this.deps.hasDraft(c.projectId)) return { ...c, status: "draft-ready" };
        return c;
      }),
    );
  }

  /**
   * Rename a project's display title. The manifest is the single source
   * of truth for the title (no denormalized copy in the brief to drift), so we
   * load the FULL on-disk manifest, patch `title`, and write it back — spreading
   * keeps theme/format/scenes intact. The folder id is NEVER touched (renaming a
   * dir would break every artifact path); only the human-facing title changes.
   * If the project is currently on the in-memory `published` stage, we re-emit it
   * with the new title so the open workspace's Copy panel updates live. Returns
   * the saved (trimmed/clamped) title, or null when there's no manifest to rename.
   */
  async rename(projectId: string, newTitle: string): Promise<string | null> {
    const title = newTitle.trim().slice(0, TITLE_MAX_CHARS);
    if (title.length === 0) return null; // an empty title would blank the card
    let manifest: WsManifest;
    try {
      manifest = await this.deps.loadManifest(projectId);
    } catch (e) {
      console.warn(`[workspace] rename: cannot load manifest for ${projectId}:`, e);
      return null;
    }
    try {
      await this.deps.writeManifest(projectId, { ...manifest, title });
    } catch (e) {
      console.warn(`[workspace] rename: cannot write manifest for ${projectId}:`, e);
      return null;
    }
    // Refresh the live published stage so an open workspace's Copy panel reflects
    // the new title without a reload (the gallery re-reads the manifest on its
    // next list poll, so no in-memory card patch is needed).
    const stage = this.stages.get(projectId);
    if (stage?.kind === "published") {
      this.setStage(projectId, { ...stage, title });
    }
    return title;
  }

  /** Recover a stage for a project no longer in memory. */
  async stage(projectId: string): Promise<ProjectStage> {
    const known = this.stages.get(projectId);
    if (known) return known;
    const recovered = await this.recoverStage(projectId);
    // Memoize the recovered stage so subsequent stage-guarded actions
    // (submitEdits/publish, which require an in-memory `ready`) see it — a
    // project whose render finished in a prior session is recovered from disk,
    // and without this its `ready` stage would never reach the map, silently
    // no-op'ing edits/publish. Set directly (no status event) to preserve the
    // read-only observable behavior of a stage poll.
    this.stages.set(projectId, recovered);
    return recovered;
  }

  private async recoverStage(projectId: string): Promise<ProjectStage> {
    try {
      const manifest = await this.deps.loadManifest(projectId);
      // 0 scenes here means NO live job: recoverStage is only reached when the
      // project has no in-memory stage (a running author/crawl job always holds a
      // {kind:"writing"} stage in the map, which `stage` returns first). So a
      // scaffolded-but-unauthored project at this point was stranded — a cancel
      // mid-crawl, or an app restart while authoring/at image-review (the pending
      // review lives in memory and is gone). Landing on "writing" spins forever
      // with no affordance; surface a recoverable error so the user can re-create.
      if (manifest.scenes.length === 0) {
        return {
          kind: "error",
          message: "Dự án chưa kịp tạo kịch bản (có thể bạn đã dừng giữa chừng hoặc đóng app). Hãy tạo lại.",
          fixable: false,
          retry: "create",
        };
      }
      if (this.deps.hasOutput(projectId)) return await this.publishedStage(projectId, this.deps.outputMedia(projectId));
      const hasStills = manifest.scenes.some((s) => this.deps.hasStill(projectId, s.id));
      if (hasStills) return this.readyStage(projectId, await this.storyboardScenesOf(projectId));
      return { kind: "script", lines: await this.scriptLinesOf(projectId) };
    } catch (error) {
      log.warn({ err: error, projectId }, "project recovery read failed; returning recoverable error stage");
      // An unreadable/absent manifest is the same stranded case (scaffold without
      // a manifest yet) — a recoverable error beats a permanent spinner.
      return {
        kind: "error",
        message: "Không đọc được dữ liệu dự án. Hãy tạo lại.",
        fixable: false,
        retry: "create",
      };
    }
  }

  async open(projectId: string): Promise<StoryboardModel> {
    try {
      return { projectId, scenes: await this.storyboardScenesOf(projectId), globalNotes: "" };
    } catch (error) {
      log.warn({ err: error, projectId }, "storyboard open failed; returning empty scene list");
      return { projectId, scenes: [], globalNotes: "" };
    }
  }

  async delete(projectId: string): Promise<void> {
    // Abort then AWAIT the in-flight task so a late author write cannot recreate
    // project files/maps after delete. Then clear maps and remove on disk.
    this.aborters.get(projectId)?.abort();
    const task = this.inFlightTasks.get(projectId);
    if (task) {
      await task.catch(() => undefined);
    }
    this.stages.delete(projectId);
    this.inFlight.delete(projectId);
    this.inFlightTasks.delete(projectId);
    this.inputs.delete(projectId);
    this.pendingReview.delete(projectId);
    this.aborters.delete(projectId);
    this.renderVersions.delete(projectId);
    try {
      await this.deps.deleteProject(projectId);
    } catch (e) {
      // A locked MP4 (Windows EBUSY/EPERM) or fs error must not crash the
      // renderer's invoke; the gallery refresh will simply still show it.
      console.warn(`[workspace] delete failed for ${projectId}:`, e);
    }
  }

  async reveal(projectId: string): Promise<void> {
    await this.deps.revealProject(projectId);
  }

  /**
   * Generate the project's thumbnail/cover PNG and return its media URL.
   * Unlike publish (fire-and-forget, result via stage poll), this RETURNS the url
   * the UI shows, so it awaits directly instead of going through `guarded` (which
   * is void + no-ops when busy). It still respects mutual exclusion: a thumbnail
   * render must not race a draft/full render over the same project's lock/bundle,
   * so we refuse (return null) when the project is in flight — the caller leaves the
   * existing thumbnail (if any) and the user can retry once the render settles.
   * A missing seam (older wiring) or a render throw also degrades to null rather
   * than crashing the published screen.
   */
  async generateThumbnail(projectId: string): Promise<{ thumbnailUrl: string } | null> {
    const renderThumbnail = this.deps.renderThumbnail;
    if (!canStartThumbnailRender({
      isInFlight: this.inFlight.has(projectId),
      hasRenderer: Boolean(renderThumbnail),
    }) || !renderThumbnail) return null;
    this.inFlight.add(projectId);
    try {
      const { path } = await renderThumbnail(projectId);
      // Re-emit the published stage so the freshly-rendered thumbnail surfaces in
      // the UI on the next poll (the stage carries thumbnailPath via publishedStage).
      const stage = this.stages.get(projectId);
      if (stage?.kind === "published" && this.deps.hasOutput(projectId)) {
        this.setStage(projectId, await this.publishedStage(projectId, this.deps.outputMedia(projectId)));
      }
      return { thumbnailUrl: this.deps.toMedia(path) };
    } catch (e) {
      console.warn(`[workspace] generateThumbnail failed for ${projectId}:`, e);
      return null;
    } finally {
      this.inFlight.delete(projectId);
    }
  }

  async scriptGate(projectId: string): Promise<ScriptGateModel> {
    const enabled = this.deps.settings.scriptGateEnabled;
    try {
      return scriptGateModelFromLines(projectId, enabled, await this.scriptLinesOf(projectId));
    } catch (error) {
      log.warn({ err: error, projectId }, "script gate read failed; returning empty scene list");
      return { projectId, enabled, scenes: [] };
    }
  }

  /** Apply confirmed script edits (empty-narration guard first, then write). */
  async applyEdits(projectId: string, edits: ScriptEdit[]): Promise<ApplyResult> {
    try {
      const manifest = await this.deps.loadManifest(projectId);
      const result = applyScriptEditsToManifest(manifest, edits);
      if (!result.ok) return result;
      await this.deps.writeManifest(projectId, manifest);
      if (this.stages.get(projectId)?.kind === "script") {
        this.setStage(projectId, { kind: "script", lines: await this.scriptLinesOf(projectId) });
      }
      return { ok: true };
    } catch (error) {
      log.warn({ err: error, projectId }, "script edits failed; returning typed write-failed result");
      return { ok: false, reason: "write-failed" };
    }
  }
}
