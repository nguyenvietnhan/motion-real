import type {
  AgentHooks,
  AgentWorker,
  AuthorJob,
  AuthorOutcome,
  ReauthorJob,
  RepairLoopOptions,
  RepairOutcome,
} from "./agent-worker.js";
import type { SafetyIssue } from "@news/pipeline";
import { generateValidateRepair, type SafetyReportView, type RenderResult } from "./repair-loop.js";

/**
 * Path-X custom-loop Agent_Worker adapter. It drives the Model_Gateway + MCP
 * tools and orchestrates author / re-author / repair via the `AuthoringBackend`
 * seam, and is testable without a live model.
 */

/** One authored/re-authored scene with its review keyframe. */
export type AuthoredScene = { sceneId: string; stillPath: string };

/**
 * One scene to re-author. The auto-repair loop supplies the flagging `issues`
 * (drives vision + the repair prompt); the manual visual-edit path supplies an
 * `intent` string instead. (desktop-author-mode, Req 3.)
 */
export type ReauthorTarget = { sceneId: string; issues?: SafetyIssue[]; intent?: string };

/** The model+MCP-facing operations the custom loop drives. */
export interface AuthoringBackend {
  /** Fetch + ground research for a URL job; `ok:false` ⇒ ingest failed (Req 3.9). */
  ingest(input: { kind: "url"; url: string }): Promise<{ ok: boolean; message?: string }>;
  /** Author the scene .tsx + manifest + narration for a fresh project. */
  authorScenes(job: AuthorJob): Promise<{ scenes: AuthoredScene[]; message?: string }>;
  /** Re-author ONLY the named scenes (code-level self-repair / visual edit). */
  reauthor(projectId: string, targets: ReauthorTarget[]): Promise<{ scenes: AuthoredScene[] }>;
  /** Render one draft (drives the MCP `render_draft` tool); failure carries the engine error. */
  renderDraft(projectId: string): Promise<RenderResult>;
  /** Read the safety report for the just-rendered draft (MCP `get_safety_report`). */
  getSafetyReport(projectId: string): Promise<SafetyReportView>;
}

function emitScenes(scenes: AuthoredScene[], hooks: AgentHooks): void {
  scenes.forEach((scene, i) => {
    hooks.onProgress(scenes.length === 0 ? 1 : (i + 1) / scenes.length);
    hooks.onSceneProduced(scene.sceneId, scene.stillPath);
  });
}

export class CustomLoopAgentWorker implements AgentWorker {
  constructor(private readonly backend: AuthoringBackend) {}

  async author(job: AuthorJob, hooks: AgentHooks): Promise<AuthorOutcome> {
    if (job.input.kind === "url") {
      const ingested = await this.backend.ingest(job.input);
      if (!ingested.ok) {
        return { kind: "ingest-failed", message: ingested.message ?? "Không lấy được nội dung từ nguồn này." };
      }
    }
    const authored = await this.backend.authorScenes(job);
    if (authored.scenes.length === 0) {
      return { kind: "no-source", message: authored.message ?? "Chưa tìm được nguồn nội dung phù hợp." };
    }
    emitScenes(authored.scenes, hooks);
    return { kind: "authored", sceneIds: authored.scenes.map((s) => s.sceneId) };
  }

  async reauthorScenes(job: ReauthorJob, hooks: AgentHooks): Promise<AuthorOutcome> {
    const targets = job.sceneIds.map((sceneId) => ({
      sceneId,
      intent: job.preprompt.perSceneIntent[sceneId] ?? job.preprompt.globalNotes,
    }));
    const result = await this.backend.reauthor(job.projectId, targets);
    emitScenes(result.scenes, hooks);
    return { kind: "authored", sceneIds: result.scenes.map((s) => s.sceneId) };
  }

  async generateValidateRepair(
    projectId: string,
    opts: RepairLoopOptions,
    hooks: AgentHooks,
  ): Promise<RepairOutcome> {
    return generateValidateRepair(
      {
        renderDraft: () => this.backend.renderDraft(projectId),
        getSafetyReport: () => this.backend.getSafetyReport(projectId),
        reauthor: async (targets) => {
          await this.backend.reauthor(projectId, targets);
        },
        hooks,
      },
      opts,
    );
  }
}
