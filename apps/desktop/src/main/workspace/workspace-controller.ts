import { computeScriptEdits, type ManifestScene } from "../script/script-gate-apply.js";
import { buildStoryboard } from "../review/storyboard.js";
import { serializeError } from "@news/pipeline";
import { classifyError } from "../agent/error-classifier.js";
import type { AgentHooks, AgentWorker, AuthorInput } from "../agent/agent-worker.js";
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
  settings: { readonly scriptGateEnabled: boolean; readonly maxRepairAttempts: number };
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
  deleteProject: (projectId: string) => Promise<void>;
  revealProject: (projectId: string) => Promise<void>;
  /** Redact L0 engine tokens from any message before it reaches the UI (R8.5). */
  redact: (message: string) => string;
}

export class WorkspaceController {
  private readonly stages = new Map<string, ProjectStage>();
  /** Remember each project's author input so the error screen can re-run it. */
  private readonly inputs = new Map<string, AuthorInput>();

  constructor(private readonly deps: WorkspaceDeps) {}

  /** Set + broadcast a stage (status mirrors the kind, as Current_Behavior). */
  setStage(projectId: string, stage: ProjectStage): void {
    this.stages.set(projectId, stage);
    this.deps.events.status({ projectId, status: stageToFriendlyStatus(stage.kind) });
  }

  private async scriptLinesOf(projectId: string): Promise<ScriptLine[]> {
    const manifest = await this.deps.loadManifest(projectId);
    return manifest.scenes.map((s, i) => ({ sceneId: s.id, order: i, headline: s.headline ?? "", narration: s.narration ?? "" }));
  }

  private async storyboardScenesOf(projectId: string): Promise<SceneCard[]> {
    const manifest = await this.deps.loadManifest(projectId);
    // Reuse the tested buildStoryboard view-model builder (R5.6), mapping each
    // still through the mediaUrl-wrapping seam.
    return buildStoryboard(
      projectId,
      "",
      manifest.scenes.map((s) => s.id),
      "",
      (_root, sceneId) => this.deps.reviewStill(projectId, sceneId),
    ).scenes;
  }

  /** Stage 1: AI writes the script; then wait for approval unless the gate is off (R2.1–R2.3, R2.7). */
  beginScript(projectId: string, input: AuthorInput): void {
    this.inputs.set(projectId, input);
    this.setStage(projectId, { kind: "writing" });
    void this.runScript(projectId, input);
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
      const message = this.deps.redact(e instanceof Error ? e.message : "Có lỗi khi viết kịch bản.");
      this.setStage(projectId, { kind: "error", message, fixable: false });
      this.deps.events.friendlyError({ projectId, message, retry: "create", fixable: false });
    }
  }

  /** Stage 2: render voice + draft via generate-validate-repair (R2.4–R2.7, R2.9). */
  approve(projectId: string): void {
    void this.runRender(projectId);
  }

  /** "Sửa bằng AI": re-run the repair loop on a Content_Error project (Req 5.2). */
  fixWithAi(projectId: string): void {
    if (this.stages.get(projectId)?.kind !== "error") return; // only from an error screen; no double-run
    void this.runRender(projectId);
  }

  /** "Duyệt & xuất bản": render the final full-quality MP4 (only from the ready review stage). */
  publish(projectId: string): void {
    if (this.stages.get(projectId)?.kind !== "ready") return;
    void this.runPublish(projectId);
  }

  private async runPublish(projectId: string): Promise<void> {
    this.setStage(projectId, { kind: "rendering", percent: 0 });
    try {
      const res = await this.deps.worker.publish(projectId);
      if (res.ok) {
        this.setStage(projectId, { kind: "published", outputPath: this.deps.toMedia(res.outputPath) });
      } else {
        const fixable = res.error ? classifyError(res.error) === "content" : false;
        const message = this.deps.redact(res.error?.cause ?? "Xuất bản thất bại. Hãy thử lại.");
        this.setStage(projectId, { kind: "error", message, fixable });
        this.deps.events.friendlyError({ projectId, message, retry: "full", fixable });
      }
    } catch (e) {
      const fixable = classifyError(serializeError(e, "render")) === "content";
      const message = this.deps.redact(e instanceof Error ? e.message : "Có lỗi khi xuất bản.");
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
    const named = edits.filter((e) => e.text.trim().length > 0);
    const notes = globalNotes.trim();
    if (named.length === 0 && notes === "") return; // nothing to do
    const sceneIds = named.map((e) => e.sceneId);
    const perSceneIntent = Object.fromEntries(named.map((e) => [e.sceneId, e.text.trim()]));
    void this.runSceneEdits(projectId, sceneIds, perSceneIntent, notes);
  }

  private async runSceneEdits(
    projectId: string,
    sceneIds: string[],
    perSceneIntent: Record<string, string>,
    globalNotes: string,
  ): Promise<void> {
    this.setStage(projectId, { kind: "rendering", percent: 0 });
    const hooks = this.renderHooks(projectId);
    try {
      // Apply the user's instruction by re-authoring the scene code…
      await this.deps.worker.reauthorScenes(
        { projectId, sceneIds, preprompt: { contractRef: "SKILL.md+AGENTS.md", affectedSceneIds: sceneIds, perSceneIntent, globalNotes } },
        hooks,
      );
      // …then re-render the draft (and auto-repair any new oracle errors).
      const outcome = await this.deps.worker.generateValidateRepair(projectId, { maxAttempts: this.deps.settings.maxRepairAttempts }, hooks);
      if (outcome.kind === "passed") {
        this.setStage(projectId, { kind: "ready", scenes: await this.storyboardScenesOf(projectId) });
      } else if (outcome.kind === "infra") {
        const message = "Gặp trục trặc hạ tầng khi dựng lại (kết nối hoặc cấu hình). Hãy kiểm tra và thử lại.";
        this.setStage(projectId, { kind: "error", message, fixable: false });
        this.deps.events.friendlyError({ projectId, message, retry: "draft", fixable: false });
      } else {
        const message = "Chưa áp dụng được chỉnh sửa sau nhiều lần thử. Bạn có thể thử lại hoặc để AI sửa.";
        this.setStage(projectId, { kind: "error", message, fixable: true });
        this.deps.events.friendlyError({ projectId, message, retry: "draft", fixable: true });
      }
    } catch (e) {
      const fixable = classifyError(serializeError(e, "render")) === "content";
      const message = this.deps.redact(e instanceof Error ? e.message : "Có lỗi khi áp dụng chỉnh sửa.");
      this.setStage(projectId, { kind: "error", message, fixable });
      this.deps.events.friendlyError({ projectId, message, retry: "draft", fixable });
    }
  }

  private renderHooks(projectId: string): AgentHooks {
    return {
      onProgress: (ratio) => {
        this.setStage(projectId, { kind: "rendering", percent: Math.round(ratio * 100) });
        this.deps.events.progress({ projectId, ratio, phase: "draft" });
      },
      onSceneProduced: (sceneId, stillPath) => this.deps.events.scene({ projectId, sceneId, stillPath: this.deps.toMedia(stillPath) }),
      onRepair: () => {},
    };
  }

  private async runRender(projectId: string): Promise<void> {
    this.setStage(projectId, { kind: "rendering", percent: 0 });
    const hooks = this.renderHooks(projectId);
    try {
      const outcome = await this.deps.worker.generateValidateRepair(projectId, { maxAttempts: this.deps.settings.maxRepairAttempts }, hooks);
      if (outcome.kind === "passed") {
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
      const message = this.deps.redact(e instanceof Error ? e.message : "Có lỗi khi dựng video.");
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
    try {
      const manifest = await this.deps.loadManifest(projectId);
      if (manifest.scenes.length === 0) return { kind: "writing" };
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
    await this.deps.deleteProject(projectId);
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
