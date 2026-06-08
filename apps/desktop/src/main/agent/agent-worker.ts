/**
 * The `AgentWorker` abstraction (web-dashboard Task 2.6, design §Agent_Worker).
 *
 * ONE interface, TWO swappable implementations decided by the POC_Spike (Req 7):
 *   (Y) headless agent-runtime adapter (auto-loads SKILL.md/AGENTS.md, MCP tools)
 *   (X) custom-loop adapter (assembles a Preprompt, drives the OpenAI-compatible
 *       gateway + MCP tools ourselves)
 * Both drive the SAME `@news/mcp` tools / single-process orchestrator, so the
 * rest of the design depends only on this interface — never on the chosen path
 * (Req 7.5). No engine internals appear here; this is the authoring contract the
 * control plane sees.
 */

import type { SerializedPipelineError } from "@news/pipeline";

/**
 * Input for a fresh authoring job: a free-form user brief (chat-style) plus any
 * links found in it to fetch for grounding (best-effort, never a hard gate).
 */
export type AuthorInput = { text: string; urls: string[] };

/** Author scenes for a brand-new project: ingest → author → (script gate) → draft. */
export type AuthorJob = {
  projectId: string;
  input: AuthorInput;
  /** When true, hold the first draft until the user approves/disables the gate (Req 4). */
  scriptGate: boolean;
};

/** Re-author ONLY the named scenes from a batch of visual edits (Req 8.7). */
export type ReauthorJob = {
  projectId: string;
  sceneIds: string[];
  preprompt: PrepromptPayload;
};

/**
 * The fixed, contract-bearing payload merged into a re-author request. For path
 * X this is assembled into the Preprompt; for path Y it is handed to the runtime
 * as the user intent alongside the auto-loaded contract files.
 */
export type PrepromptPayload = {
  /** The contract bearer is always the repo's SKILL.md + AGENTS.md (never inlined here). */
  contractRef: "SKILL.md+AGENTS.md";
  affectedSceneIds: string[];
  perSceneIntent: Record<string, string>;
  globalNotes: string;
};

/** Budget for the generate-validate-repair loop; default 3, clamped to [1,10] (Req 6.4). */
export type RepairLoopOptions = { maxAttempts: number };

/** Outcome of a fresh-author or re-author job. */
export type AuthorOutcome =
  | { kind: "authored"; sceneIds: string[] }
  | { kind: "no-source"; message: string };

/** Outcome of the generate-validate-repair loop (Req 6.3/6.7; + infra, Req 4). */
export type RepairOutcome =
  | { kind: "passed"; attempts: number }
  | { kind: "exhausted"; attempts: number; remainingHardErrors: number }
  | { kind: "infra"; attempts: number };

/** Result of a full-quality publish render. */
export type PublishResult = { ok: true; outputPath: string } | { ok: false; error?: SerializedPipelineError };

/** A layout defect the AI visual-QA flagged on a rendered scene still. */
export type VisualDefect = { sceneId: string; issue: string };

/** A snapshot of authored scene source, used to roll back a regressive QA round. */
export type SceneSnapshot = { sceneId: string; code: string }[];

/** A plain-language auto-fix description (NEVER an N-code / engine internal; Req 6.8). */
export type { FriendlyFix } from "../../shared/types.js";
import type { FriendlyFix } from "../../shared/types.js";

/**
 * Streaming callbacks the worker uses to surface progress to the UI. The worker
 * emits only translated, user-facing values — ratios, scene stills, and friendly
 * fixes — never raw grid issues or stack traces.
 */
export interface AgentHooks {
  /** Render/author progress in [0,1] → UI percentage (Req 5.2). */
  onProgress(ratio: number): void;
  /** A new scene still is ready; the Storyboard grows (Req 5.3). */
  onSceneProduced(sceneId: string, stillPath: string): void;
  /** An auto-applied repair, described in plain language (Req 6.8). */
  onRepair(fix: FriendlyFix): void;
}

export interface AgentWorker {
  /** Author scenes for a fresh project. */
  author(job: AuthorJob, hooks: AgentHooks): Promise<AuthorOutcome>;
  /** Re-author ONLY the named scenes from batched visual edits (Req 8.7). */
  reauthorScenes(job: ReauthorJob, hooks: AgentHooks): Promise<AuthorOutcome>;
  /** Render the final full-quality MP4 (draft-first gate already satisfied). */
  publish(projectId: string): Promise<PublishResult>;
  /** Run the generate-validate-repair loop to zero hard errors or budget (Req 6). */
  generateValidateRepair(
    projectId: string,
    opts: RepairLoopOptions,
    hooks: AgentHooks,
  ): Promise<RepairOutcome>;
  /**
   * Optional AI visual-QA: judge the rendered scene stills (vision model) for
   * clear LAYOUT defects (overlap, clipping, off-canvas, imbalance) the
   * deterministic grid can't catch. `sceneIds` scopes the check (e.g. only the
   * scenes a user just edited); omit to check every scene. Returns the flagged
   * scenes + a short description. Model-dependent (needs vision) and best-effort.
   */
  visualQa?(projectId: string, sceneIds?: string[]): Promise<VisualDefect[]>;
  /** Snapshot authored scene source so a regressive visual-QA round can be rolled back. */
  snapshotScenes?(projectId: string, sceneIds: string[]): Promise<SceneSnapshot>;
  /** Restore authored scene source from a snapshot (re-admits the components). */
  restoreScenes?(projectId: string, snapshot: SceneSnapshot): Promise<void>;
}
