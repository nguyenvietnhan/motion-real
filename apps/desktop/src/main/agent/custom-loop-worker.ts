import type {
  AgentHooks,
  AgentWorker,
  AuthorJob,
  AuthorOutcome,
  PrepromptPayload,
  ReauthorJob,
  RepairLoopOptions,
  RepairOutcome,
} from "./agent-worker.js";
import { generateValidateRepair, type SafetyReportView } from "./repair-loop.js";

/**
 * Path-X custom-loop Agent_Worker adapter (web-dashboard Task 5.1; the POC_Spike
 * artifact recorded decision `X`). It assembles the Preprompt, drives the
 * Model_Gateway + MCP tools, and orchestrates author / re-author / repair.
 *
 * The model+MCP side is injected as an `AuthoringBackend` seam: the CONCRETE
 * backend (OpenAI-compatible client at the local gateway + the `@news/mcp`
 * tools) is wired in once the gateway lifecycle (task 6.3) and create wiring
 * (task 7.1) land. This adapter owns the ORCHESTRATION — ordering, scene/progress
 * hooks, ingest/no-source failure mapping, and the repair-loop delegation — and
 * is testable today without a live model.
 */

/** One authored/re-authored scene with its review keyframe. */
export type AuthoredScene = { sceneId: string; stillPath: string };

/** The model+MCP-facing operations the custom loop drives. */
export interface AuthoringBackend {
  /** Fetch + ground research for a URL job; `ok:false` ⇒ ingest failed (Req 3.9). */
  ingest(input: { kind: "url"; url: string }): Promise<{ ok: boolean; message?: string }>;
  /** Author the scene .tsx + manifest + narration for a fresh project. */
  authorScenes(job: AuthorJob): Promise<{ scenes: AuthoredScene[]; message?: string }>;
  /** Re-author ONLY the named scenes from a visual-edit Preprompt (Req 8.7). */
  reauthor(projectId: string, sceneIds: string[], preprompt: PrepromptPayload): Promise<{ scenes: AuthoredScene[] }>;
  /** Render one draft (drives the MCP `render_draft` tool). */
  renderDraft(projectId: string): Promise<{ ok: boolean }>;
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
    const result = await this.backend.reauthor(job.projectId, job.sceneIds, job.preprompt);
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
        reauthor: async (sceneIds) => {
          await this.backend.reauthor(projectId, sceneIds, {
            contractRef: "SKILL.md+AGENTS.md",
            affectedSceneIds: sceneIds,
            perSceneIntent: {},
            globalNotes: "",
          });
        },
        hooks,
      },
      opts,
    );
  }
}
