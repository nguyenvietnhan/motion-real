import { computeScriptEdits, type ManifestScene } from "../script/script-gate-apply.js";
import { buildStoryboard } from "../review/storyboard.js";
import { serializeError } from "@news/pipeline";
import { classifyError } from "../agent/error-classifier.js";
import { toFriendlyError } from "../redact/friendly.js";
import type { AgentHooks, AgentWorker, AuthorInput, RepairOutcome, SceneSnapshot } from "../agent/agent-worker.js";
import type {
  ApplyResult,
  FriendlyStatus,
  ProjectCardVM,
  ProjectStage,
  ScriptEdit,
  ScriptGateModel,
  ScriptLine,
  SceneCard,
  StoryboardModel,
} from "../../shared/types.js";

/** Map a live workspace stage to the gallery's friendly status. */
function stageToFriendlyStatus(kind: ProjectStage["kind"]): FriendlyStatus {
  switch (kind) {
    case "ready":
      return "draft-ready";
    case "published":
      return "done";
    case "error":
      return "error";
    default:
      return "building"; // writing | script | rendering
  }
}

/**
 * Combine a per-scene edit instruction with the video-wide note into ONE intent
 * the AI receives for that scene. Either part may be empty; a scene targeted by
 * a global-note-only edit carries just the note.
 */
function combineIntent(perScene: string, globalNotes: string): string {
  const parts: string[] = [];
  if (perScene.trim()) parts.push(perScene.trim());
  if (globalNotes.trim()) parts.push(`Ghi chú chung cho cả video: ${globalNotes.trim()}`);
  return parts.join("\n\n");
}

/**
 * WorkspaceController (reconcile-main-controllers S4) — the tested home for the
 * staged-workspace orchestration that was inline in `index.ts`
 * (`stages`/`setStage`/`runScript`/`runRender`/`scriptLinesOf`/
 * `storyboardScenesOf`) plus the project/script read handlers
 * (`projects:list/stage/open/delete/reveal`, `script:get/applyEdits/approve`).
 *
 * It reproduces the EXACT Current_Behavior (authoritative, R4.4) and injects all
 * Electron/engine/pipeline access through seams so it is testable without
 * Electron. Validates R2.1–R2.9, R1.4, R1.7, R5.6.
 */

/** A manifest scene as the dashboard needs it (other fields preserved opaquely). */
export type WsScene = { id: string; narration?: string; headline?: string };
export type WsManifest = { scenes: WsScene[] };

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
  settings: { readonly scriptGateEnabled: boolean; readonly maxRepairAttempts: number; readonly visualQaEnabled: boolean };
  /** Gallery cards, already mediaUrl-wrapped + fallback-to-[] at the seam (R1.7). */
  listProjects: () => Promise<ProjectCardVM[]>;
  loadManifest: (projectId: string) => Promise<WsManifest>;
  writeManifest: (projectId: string, manifest: WsManifest) => Promise<void>;
  /** mediaUrl-wrapped path to a scene's review still (`review/<sceneId>.png`). */
  reviewStill: (projectId: string, sceneId: string) => string;
  /** Wrap an absolute still path for the renderer (mediaUrl, falling back to the path). */
  toMedia: (absPath: string) => string;
  /** Whether a scene's review still exists on disk. */
  hasStill: (projectId: string, sceneId: string) => boolean;
  /** Whether the full-quality MP4 has been rendered for this project. */
  hasOutput: (projectId: string) => boolean;
  /** mediaUrl-wrapped path to the full-quality MP4. */
  outputMedia: (projectId: string) => string;
  deleteProject: (projectId: string) => Promise<void>;
  revealProject: (projectId: string) => Promise<void>;
  /** Redact L0 engine tokens from any message before it reaches the UI (R8.5). */
  redact: (message: string) => string;
}

export class WorkspaceController {
  private readonly stages = new Map<string, ProjectStage>();
  /** Remember each project's author input so the error screen can re-run it. */
  private readonly inputs = new Map<string, AuthorInput>();
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

  constructor(private readonly deps: WorkspaceDeps) {}

  /** Run an exclusive per-project job; ignored if one is already in flight. */
  private guarded(projectId: string, run: () => Promise<void>): void {
    if (this.inFlight.has(projectId)) return;
    this.inFlight.add(projectId);
    void run().finally(() => this.inFlight.delete(projectId));
  }

  /** Set + broadcast a stage (status mirrors the kind, as Current_Behavior). */
  setStage(projectId: string, stage: ProjectStage): void {
    this.stages.set(projectId, stage);
    this.deps.events.status({ projectId, status: stageToFriendlyStatus(stage.kind) });
  }

  /** Bump the render version so the next storyboard's stills reload exactly once. */
  private bumpRenderVersion(projectId: string): void {
    this.renderVersions.set(projectId, (this.renderVersions.get(projectId) ?? 0) + 1);
  }

  private async scriptLinesOf(projectId: string): Promise<ScriptLine[]> {
    const manifest = await this.deps.loadManifest(projectId);
    return manifest.scenes.map((s, i) => ({ sceneId: s.id, order: i, headline: s.headline ?? "", narration: s.narration ?? "" }));
  }

  private async storyboardScenesOf(projectId: string): Promise<SceneCard[]> {
    const manifest = await this.deps.loadManifest(projectId);
    const ver = this.renderVersions.get(projectId) ?? 0;
    // Reuse the tested buildStoryboard view-model builder (R5.6), mapping each
    // still through the mediaUrl-wrapping seam; append a render-version fragment
    // (ignored by the media protocol) so the still reloads only on a real re-render.
    return buildStoryboard(
      projectId,
      "",
      manifest.scenes.map((s) => s.id),
      "",
      (_root, sceneId) => this.deps.reviewStill(projectId, sceneId),
    ).scenes.map((s) => ({ ...s, stillPath: s.stillPath ? `${s.stillPath}#r${ver}` : s.stillPath }));
  }

  /** Stage 1: AI writes the script; then wait for approval unless the gate is off (R2.1–R2.3, R2.7). */
  beginScript(projectId: string, input: AuthorInput): void {
    if (this.inFlight.has(projectId)) return; // a loop is already running for this project
    this.inputs.set(projectId, input);
    this.setStage(projectId, { kind: "writing" });
    this.guarded(projectId, () => this.runScript(projectId, input));
  }

  /** Re-run authoring for a project from its remembered input (the "Thử lại" action). */
  retry(projectId: string): void {
    const input = this.inputs.get(projectId);
    if (input) this.beginScript(projectId, input);
  }

  private async runScript(projectId: string, input: AuthorInput): Promise<void> {
    const hooks: AgentHooks = { onProgress: () => {}, onSceneProduced: () => {}, onRepair: () => {} };
    try {
      const authored = await this.deps.worker.author({ projectId, input, scriptGate: this.deps.settings.scriptGateEnabled }, hooks);
      if (authored.kind !== "authored") {
        const message = this.deps.redact(authored.message ?? "Chưa tìm được nguồn nội dung phù hợp.");
        this.setStage(projectId, { kind: "error", message, fixable: false });
        this.deps.events.friendlyError({ projectId, message, retry: "create", fixable: false });
        return;
      }
      if (this.deps.settings.scriptGateEnabled) {
        this.setStage(projectId, { kind: "script", lines: await this.scriptLinesOf(projectId) });
      } else {
        await this.runRender(projectId);
      }
    } catch (e) {
      console.error(`[workspace] authoring failed for ${projectId}:`, e);
      const message = "Có lỗi khi viết kịch bản. Hãy thử lại.";
      this.setStage(projectId, { kind: "error", message, fixable: false });
      this.deps.events.friendlyError({ projectId, message, retry: "create", fixable: false });
    }
  }

  /** Stage 2: render voice + draft via generate-validate-repair (R2.4–R2.7, R2.9). */
  approve(projectId: string): void {
    this.guarded(projectId, () => this.runRender(projectId));
  }

  /** "Sửa bằng AI": re-run the repair loop on a Content_Error project (Req 5.2). */
  fixWithAi(projectId: string): void {
    if (this.stages.get(projectId)?.kind !== "error") return; // only from an error screen; no double-run
    this.guarded(projectId, () => this.runRender(projectId));
  }

  /** "Duyệt & xuất bản": render the final full-quality MP4 (only from the ready review stage). */
  publish(projectId: string): void {
    if (this.stages.get(projectId)?.kind !== "ready") return;
    this.guarded(projectId, () => this.runPublish(projectId));
  }

  private async runPublish(projectId: string): Promise<void> {
    this.setStage(projectId, { kind: "rendering", percent: 0, phase: "full" });
    try {
      const res = await this.deps.worker.publish(projectId);
      if (res.ok) {
        this.setStage(projectId, { kind: "published", outputPath: this.deps.toMedia(res.outputPath) });
      } else {
        const fixable = res.error ? classifyError(res.error) === "content" : false;
        const message = res.error
          ? toFriendlyError(res.error, { projectId, phase: "full" }).message
          : "Xuất bản thất bại. Hãy thử lại.";
        this.setStage(projectId, { kind: "error", message, fixable });
        this.deps.events.friendlyError({ projectId, message, retry: "full", fixable });
      }
    } catch (e) {
      const fixable = classifyError(serializeError(e, "render")) === "content";
      console.error(`[workspace] publish failed for ${projectId}:`, e);
      const message = "Có lỗi khi xuất bản video. Hãy thử lại.";
      this.setStage(projectId, { kind: "error", message, fixable });
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
    try {
      // Resolve which scenes to re-author: the explicitly-edited ones, or — when
      // ONLY a video-wide note was given — every scene (the note applies to all).
      let entries = named;
      if (entries.length === 0) {
        const manifest = await this.deps.loadManifest(projectId).catch(() => ({ scenes: [] as WsScene[] }));
        entries = manifest.scenes.map((s) => ({ sceneId: s.id, text: "" }));
      }
      const sceneIds = entries.map((e) => e.sceneId);
      const perSceneIntent = Object.fromEntries(entries.map((e) => [e.sceneId, combineIntent(e.text, globalNotes)]));
      // Snapshot the known-good source of the scenes we're about to edit, so a
      // regressive edit (one the model can't render cleanly) can be rolled back
      // to the draft the user already had — an edit may only IMPROVE or KEEP the
      // draft, never downgrade a passing one to a broken/error state. Mirrors the
      // visual-QA non-regression guard, now extended to user edits.
      const snapshot = (await this.deps.worker.snapshotScenes?.(projectId, sceneIds).catch(() => [])) ?? [];
      // Apply the user's instruction by re-authoring the scene code…
      const applied = await this.deps.worker.reauthorScenes(
        { projectId, sceneIds, preprompt: { contractRef: "SKILL.md+AGENTS.md", affectedSceneIds: sceneIds, perSceneIntent, globalNotes } },
        editHooks,
      );
      const appliedIds = applied.kind === "authored" ? applied.sceneIds : [];
      // If we asked to edit ≥1 scene but EVERY rewrite failed admission (rolled
      // back), the draft is unchanged — do NOT pretend success. Return to the
      // review stage with a visible notice so the user can retry / rephrase.
      if (sceneIds.length > 0 && appliedIds.length === 0) {
        this.setStage(projectId, {
          kind: "ready",
          scenes: await this.storyboardScenesOf(projectId),
          notice: "Chưa áp dụng được chỉnh sửa cho cảnh bạn chọn (AI tạo mã chưa hợp lệ). Hãy thử lại hoặc diễn đạt rõ hơn.",
        });
        return;
      }
      // …then re-render the draft (and auto-repair any new oracle errors).
      this.setStage(projectId, { kind: "rendering", percent: 0, phase: "draft" });
      let outcome = await this.deps.worker.generateValidateRepair(projectId, { maxAttempts: this.deps.settings.maxRepairAttempts }, hooks);
      // AI visual-QA over ONLY the edited scenes — catch defects the user's
      // instruction may have introduced, without re-checking untouched scenes.
      outcome = await this.withVisualQa(projectId, outcome, hooks, sceneIds);
      if (outcome.kind === "passed") {
        this.bumpRenderVersion(projectId);
        // If the user explicitly edited some scenes but a SUBSET failed to apply,
        // say so (the rest did render) so a half-applied batch isn't silent.
        const failedNamed = named.filter((n) => !appliedIds.includes(n.sceneId));
        const notice =
          failedNamed.length > 0
            ? `Đã áp dụng chỉnh sửa, nhưng chưa đổi được ${failedNamed.length} cảnh (AI tạo mã chưa hợp lệ) — bạn có thể thử lại các cảnh đó.`
            : undefined;
        this.setStage(projectId, { kind: "ready", scenes: await this.storyboardScenesOf(projectId), ...(notice ? { notice } : {}) });
      } else if (outcome.kind === "infra") {
        const message = "Gặp trục trặc hạ tầng khi dựng lại (kết nối hoặc cấu hình). Hãy kiểm tra và thử lại.";
        this.setStage(projectId, { kind: "error", message, fixable: false });
        this.deps.events.friendlyError({ projectId, message, retry: "draft", fixable: false });
      } else if (await this.restoreToPriorDraft(projectId, snapshot, hooks)) {
        // The edit produced a draft we couldn't clean up (content errors after
        // every attempt). Rather than strand the user on an error screen with a
        // broken scene, we restored the pre-edit source and re-rendered the draft
        // they already had — the edit only ever improves or keeps the draft.
        this.setStage(projectId, {
          kind: "ready",
          scenes: await this.storyboardScenesOf(projectId),
          notice: "Chưa áp dụng được chỉnh sửa này (làm hỏng bố cục cảnh) — đã giữ lại bản nháp trước đó. Hãy thử diễn đạt khác hoặc chỉnh nhẹ hơn.",
        });
      } else {
        const message = "Chưa áp dụng được chỉnh sửa sau nhiều lần thử. Bạn có thể thử lại hoặc để AI sửa.";
        this.setStage(projectId, { kind: "error", message, fixable: true });
        this.deps.events.friendlyError({ projectId, message, retry: "draft", fixable: true });
      }
    } catch (e) {
      const fixable = classifyError(serializeError(e, "render")) === "content";
      console.error(`[workspace] scene edits failed for ${projectId}:`, e);
      const message = "Có lỗi khi áp dụng chỉnh sửa. Hãy thử lại.";
      this.setStage(projectId, { kind: "error", message, fixable });
      this.deps.events.friendlyError({ projectId, message, retry: "draft", fixable });
    }
  }

  /** Hooks for a reauthor step that has no measurable progress (indeterminate). */
  private editHooks(projectId: string): AgentHooks {
    return {
      onProgress: () => {},
      onSceneProduced: (sceneId, stillPath) => this.deps.events.scene({ projectId, sceneId, stillPath: this.deps.toMedia(stillPath) }),
      onRepair: () => {},
    };
  }

  /**
   * One AI visual-QA round layered on top of a clean draft: ask the vision model
   * to flag CLEAR layout defects on the stills (overlap/clipping/imbalance the
   * deterministic grid can't catch), reauthor only the flagged scenes, and
   * re-render. `scope` limits the QA to specific scenes (e.g. the ones a user
   * just edited) so post-edit QA stays cheap. Bounded to ONE round (no recursion)
   * to avoid false-positive churn; best-effort (a vision failure is a no-op).
   * Returns the (possibly new) outcome so the caller decides ready vs error.
   */
  private async withVisualQa(
    projectId: string,
    outcome: RepairOutcome,
    hooks: AgentHooks,
    scope?: string[],
  ): Promise<RepairOutcome> {
    if (outcome.kind !== "passed" || !this.deps.settings.visualQaEnabled || !this.deps.worker.visualQa) return outcome;
    const flagged = await this.deps.worker.visualQa(projectId, scope).catch(() => [] as { sceneId: string; issue: string }[]);
    if (flagged.length === 0) return outcome;
    const sceneIds = flagged.map((f) => f.sceneId);
    // Snapshot the known-good source so a regressive QA rewrite can be rolled back.
    const snapshot = (await this.deps.worker.snapshotScenes?.(projectId, sceneIds).catch(() => [])) ?? [];
    this.setStage(projectId, { kind: "rendering", percent: 0, phase: "qa" });
    const perSceneIntent = Object.fromEntries(flagged.map((f) => [f.sceneId, `Tự sửa lỗi bố cục phát hiện qua ảnh: ${f.issue}`]));
    await this.deps.worker.reauthorScenes(
      { projectId, sceneIds, preprompt: { contractRef: "SKILL.md+AGENTS.md", affectedSceneIds: sceneIds, perSceneIntent, globalNotes: "" } },
      this.editHooks(projectId),
    );
    this.setStage(projectId, { kind: "rendering", percent: 0, phase: "draft" });
    const qaOutcome = await this.deps.worker.generateValidateRepair(projectId, { maxAttempts: this.deps.settings.maxRepairAttempts }, hooks);
    if (qaOutcome.kind === "passed") return qaOutcome;
    // QA could NOT produce a clean draft → never regress: restore the pre-QA
    // source and re-render back to the draft that already passed.
    if (snapshot.length > 0 && this.deps.worker.restoreScenes) {
      this.setStage(projectId, { kind: "rendering", percent: 0, phase: "qa" });
      await this.deps.worker.restoreScenes(projectId, snapshot);
      this.setStage(projectId, { kind: "rendering", percent: 0, phase: "draft" });
      await this.deps.worker.generateValidateRepair(projectId, { maxAttempts: this.deps.settings.maxRepairAttempts }, hooks);
      return outcome; // the original passing outcome (known-good draft restored)
    }
    // Couldn't snapshot/restore → fall back to the QA outcome (rare).
    return qaOutcome;
  }

  /**
   * Roll a regressive USER EDIT back to the draft the user already had: restore
   * the pre-edit source from the snapshot and re-render that known-good draft.
   * Returns true when the rollback path ran (so the caller reports "kept the
   * previous draft" rather than stranding the user on an error screen). Returns
   * false when there's nothing to restore (no snapshot / no restore seam), so the
   * caller falls back to the normal error handling. The restored draft was clean
   * before the edit, so its re-render is expected to pass; we don't re-gate it.
   */
  private async restoreToPriorDraft(projectId: string, snapshot: SceneSnapshot, hooks: AgentHooks): Promise<boolean> {
    if (snapshot.length === 0 || !this.deps.worker.restoreScenes) return false;
    this.setStage(projectId, { kind: "rendering", percent: 0, phase: "edit" });
    await this.deps.worker.restoreScenes(projectId, snapshot);
    this.setStage(projectId, { kind: "rendering", percent: 0, phase: "draft" });
    await this.deps.worker.generateValidateRepair(projectId, { maxAttempts: this.deps.settings.maxRepairAttempts }, hooks);
    this.bumpRenderVersion(projectId);
    return true;
  }

  private renderHooks(projectId: string, phase: "draft" | "full" = "draft"): AgentHooks {
    return {
      onProgress: (ratio) => {
        this.setStage(projectId, { kind: "rendering", percent: Math.round(ratio * 100), phase });
        this.deps.events.progress({ projectId, ratio, phase });
      },
      onSceneProduced: (sceneId, stillPath) => this.deps.events.scene({ projectId, sceneId, stillPath: this.deps.toMedia(stillPath) }),
      onRepair: () => {},
    };
  }

  /**
   * Drive the rendering stage's percent from the renderer's REAL per-frame
   * progress (forwarded from the render tool's onProgress via the Composition_
   * Root). This is the smooth, accurate signal, preserving the active phase.
   */
  reportRenderProgress(projectId: string, ratio: number): void {
    const s = this.stages.get(projectId);
    if (s?.kind !== "rendering") return;
    const clamped = Math.max(0, Math.min(1, ratio));
    this.setStage(projectId, { kind: "rendering", percent: Math.round(clamped * 100), phase: s.phase });
  }

  private async runRender(projectId: string): Promise<void> {
    this.setStage(projectId, { kind: "rendering", percent: 0, phase: "draft" });
    const hooks = this.renderHooks(projectId, "draft");
    try {
      let outcome = await this.deps.worker.generateValidateRepair(projectId, { maxAttempts: this.deps.settings.maxRepairAttempts }, hooks);
      // AI visual-QA over ALL scenes' stills before the user reviews (best-effort).
      outcome = await this.withVisualQa(projectId, outcome, hooks);
      if (outcome.kind === "passed") {
        this.bumpRenderVersion(projectId);
        this.setStage(projectId, { kind: "ready", scenes: await this.storyboardScenesOf(projectId) });
      } else if (outcome.kind === "infra") {
        // Not agent-fixable: tell the user to retry / check setup, no "Sửa bằng AI".
        const message = "Gặp trục trặc hạ tầng khi dựng (kết nối hoặc cấu hình). Hãy kiểm tra lại và thử lại.";
        this.setStage(projectId, { kind: "error", message, fixable: false });
        this.deps.events.friendlyError({ projectId, message, retry: "draft", fixable: false });
      } else {
        // exhausted: content defects remain → offer "Sửa bằng AI".
        const message = "Chưa hoàn tất được video sau nhiều lần thử. Bạn có thể thử lại hoặc để AI sửa.";
        this.setStage(projectId, { kind: "error", message, fixable: true });
        this.deps.events.friendlyError({ projectId, message, retry: "draft", fixable: true });
      }
    } catch (e) {
      const fixable = classifyError(serializeError(e, "render")) === "content";
      console.error(`[workspace] render failed for ${projectId}:`, e);
      const message = "Có lỗi khi dựng video. Hãy thử lại.";
      this.setStage(projectId, { kind: "error", message, fixable });
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
        return stage ? { ...c, status: stageToFriendlyStatus(stage.kind) } : c;
      }),
    );
  }

  /** Recover a stage for a project no longer in memory (R2.8). */
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
      if (manifest.scenes.length === 0) return { kind: "writing" };
      if (this.deps.hasOutput(projectId)) return { kind: "published", outputPath: this.deps.outputMedia(projectId) };
      const hasStills = manifest.scenes.some((s) => this.deps.hasStill(projectId, s.id));
      if (hasStills) return { kind: "ready", scenes: await this.storyboardScenesOf(projectId) };
      return { kind: "script", lines: await this.scriptLinesOf(projectId) };
    } catch {
      return { kind: "writing" };
    }
  }

  async open(projectId: string): Promise<StoryboardModel> {
    try {
      return { projectId, scenes: await this.storyboardScenesOf(projectId), globalNotes: "" };
    } catch {
      return { projectId, scenes: [], globalNotes: "" };
    }
  }

  async delete(projectId: string): Promise<void> {
    this.stages.delete(projectId);
    this.inFlight.delete(projectId);
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

  async scriptGate(projectId: string): Promise<ScriptGateModel> {
    const enabled = this.deps.settings.scriptGateEnabled;
    try {
      const lines = await this.scriptLinesOf(projectId);
      return { projectId, enabled, scenes: lines.map((l) => ({ sceneId: l.sceneId, order: l.order, narration: l.narration, headline: l.headline })) };
    } catch {
      return { projectId, enabled, scenes: [] };
    }
  }

  /** Apply confirmed script edits (empty-narration guard first, then write) (R1.4). */
  async applyEdits(projectId: string, edits: ScriptEdit[]): Promise<ApplyResult> {
    try {
      const manifest = await this.deps.loadManifest(projectId);
      // Pure guard over manifest-order scenes (reports the first offending scene).
      const ms: ManifestScene[] = manifest.scenes.map((s) => ({ sceneId: s.id, narration: s.narration ?? "", headline: s.headline }));
      const guard = computeScriptEdits(ms, edits);
      if (!guard.ok) return guard;
      // Apply edits onto the real manifest objects, preserving other fields.
      const byId = new Map(edits.map((e) => [e.sceneId, e]));
      for (const s of manifest.scenes) {
        const e = byId.get(s.id);
        if (!e) continue;
        if (e.narration !== undefined) s.narration = e.narration;
        if (e.headline !== undefined) s.headline = e.headline;
      }
      await this.deps.writeManifest(projectId, manifest);
      if (this.stages.get(projectId)?.kind === "script") {
        this.setStage(projectId, { kind: "script", lines: await this.scriptLinesOf(projectId) });
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: "write-failed" };
    }
  }
}
