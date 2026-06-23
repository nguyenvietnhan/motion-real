import type {
  AgentHooks,
  AgentWorker,
  AuthorJob,
  AuthorOutcome,
  ReauthorJob,
  RepairLoopOptions,
  RepairOutcome,
  PublishResult,
  TransitionAuthorOutcome,
  VisualDefect,
  SceneSnapshot,
} from "./agent-worker.js";
import type { SafetyIssue, CrawledImage } from "@news/pipeline";
import type { AuthorImageRef } from "./agent-worker.js";
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
 * (drives vision + the repair prompt); the manual visual-edit / visual-QA path
 * supplies an `intent` string and sets `visual` so the rewrite is ALSO shown the
 * current rendered still (a layout fix must see what it's fixing). (Req 3.)
 */
export type ReauthorTarget = { sceneId: string; issues?: SafetyIssue[]; intent?: string; visual?: boolean };

/** The model+MCP-facing operations the custom loop drives. Render/chat ops take
 * an optional `signal` so a user "Dừng render" aborts the in-flight Remotion
 * encode (via Remotion's cancelSignal) and the AI calls (via fetch abort). */
export interface AuthoringBackend {
  /** Author the scene .tsx + manifest + narration for a fresh project (ingests any brief links best-effort). */
  authorScenes(job: AuthorJob): Promise<{ scenes: AuthoredScene[]; message?: string; unreadableUrls?: string[] }>;
  /** Re-author ONLY the named scenes (code-level self-repair / visual edit). */
  reauthor(projectId: string, targets: ReauthorTarget[], signal?: AbortSignal): Promise<{ scenes: AuthoredScene[] }>;
  /** Optional boundary-level transition authoring after scene refine. */
  prepareTransitions?(projectId: string, sceneIds?: string[], signal?: AbortSignal): Promise<TransitionAuthorOutcome>;
  /** Render one draft (drives the MCP `render_draft` tool); failure carries the engine error. */
  renderDraft(projectId: string, signal?: AbortSignal): Promise<RenderResult>;
  /** Optional fast per-scene STILLS render (no TTS/MP4) — the cheap loop the silent refine pass iterates on. */
  renderStills?(projectId: string, sceneIds?: string[], signal?: AbortSignal): Promise<{ stills: string[] }>;
  /** Render the final full-quality MP4 (drives MCP `render_full`); draft-first gate already satisfied. */
  renderFull(projectId: string, signal?: AbortSignal): Promise<PublishResult>;
  /** Read the safety report for the just-rendered draft (MCP `get_safety_report`). */
  getSafetyReport(projectId: string): Promise<SafetyReportView>;
  /** Optional AI visual-QA over rendered stills (vision model); flags layout defects. */
  visualQa?(projectId: string, sceneIds?: string[], signal?: AbortSignal): Promise<VisualDefect[]>;
  /** Optional: snapshot authored scene source (for a non-regressive visual-QA round). */
  snapshotScenes?(projectId: string, sceneIds: string[]): Promise<SceneSnapshot>;
  /** Optional: restore authored scene source from a snapshot (re-admits the components). */
  restoreScenes?(projectId: string, snapshot: SceneSnapshot): Promise<void>;
  /** Optional (Phase 2 Block B): crawl an article URL's images into the project assetsDir. */
  crawlImages?(projectId: string, url: string, signal?: AbortSignal): Promise<CrawledImage[]>;
  /** Optional (Phase 2 Block B): AI pre-select which crawled refs fit the article. */
  filterCrawledImages?(projectId: string, articleText: string, refs: AuthorImageRef[], signal?: AbortSignal): Promise<string[]>;
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
    const authored = await this.backend.authorScenes(job);
    if (authored.scenes.length === 0) {
      return { kind: "no-source", message: authored.message ?? "Chưa tạo được cảnh nào từ yêu cầu này." };
    }
    emitScenes(authored.scenes, hooks);
    return {
      kind: "authored",
      sceneIds: authored.scenes.map((s) => s.sceneId),
      ...(authored.unreadableUrls && authored.unreadableUrls.length > 0 ? { unreadableUrls: authored.unreadableUrls } : {}),
    };
  }

  async reauthorScenes(job: ReauthorJob, hooks: AgentHooks, signal?: AbortSignal): Promise<AuthorOutcome> {
    const targets = job.sceneIds.map((sceneId) => ({
      sceneId,
      intent: job.preprompt.perSceneIntent[sceneId] ?? job.preprompt.globalNotes,
      // Visual intent (user Canva edit or AI visual-QA): the rewrite must SEE the
      // current rendered still, not fix a layout it can't observe.
      visual: true,
    }));
    const result = await this.backend.reauthor(job.projectId, targets, signal);
    emitScenes(result.scenes, hooks);
    return { kind: "authored", sceneIds: result.scenes.map((s) => s.sceneId) };
  }

  prepareTransitions(projectId: string, sceneIds?: string[], signal?: AbortSignal): Promise<TransitionAuthorOutcome> {
    return this.backend.prepareTransitions?.(projectId, sceneIds, signal) ?? Promise.resolve({ authoredBoundaryIds: [], failedBoundaryIds: [] });
  }

  publish(projectId: string, signal?: AbortSignal): Promise<PublishResult> {
    return this.backend.renderFull(projectId, signal);
  }

  renderStills(projectId: string, sceneIds?: string[], signal?: AbortSignal): Promise<{ stills: string[] }> {
    return this.backend.renderStills?.(projectId, sceneIds, signal) ?? Promise.resolve({ stills: [] });
  }

  visualQa(projectId: string, sceneIds?: string[], signal?: AbortSignal): Promise<VisualDefect[]> {
    return this.backend.visualQa?.(projectId, sceneIds, signal) ?? Promise.resolve([]);
  }

  snapshotScenes(projectId: string, sceneIds: string[]): Promise<SceneSnapshot> {
    return this.backend.snapshotScenes?.(projectId, sceneIds) ?? Promise.resolve([]);
  }

  restoreScenes(projectId: string, snapshot: SceneSnapshot): Promise<void> {
    return this.backend.restoreScenes?.(projectId, snapshot) ?? Promise.resolve();
  }

  crawlImages(projectId: string, url: string, signal?: AbortSignal): Promise<CrawledImage[]> {
    return this.backend.crawlImages?.(projectId, url, signal) ?? Promise.resolve([]);
  }

  filterCrawledImages(projectId: string, articleText: string, refs: AuthorImageRef[], signal?: AbortSignal): Promise<string[]> {
    return this.backend.filterCrawledImages?.(projectId, articleText, refs, signal) ?? Promise.resolve([]);
  }

  async generateValidateRepair(
    projectId: string,
    opts: RepairLoopOptions,
    hooks: AgentHooks,
    signal?: AbortSignal,
  ): Promise<RepairOutcome> {
    return generateValidateRepair(
      {
        renderDraft: () => this.backend.renderDraft(projectId, signal),
        getSafetyReport: () => this.backend.getSafetyReport(projectId),
        reauthor: async (targets) => {
          await this.backend.reauthor(projectId, targets, signal);
        },
        hooks,
      },
      { ...opts, ...(signal ? { signal } : {}) },
    );
  }
}
