/**
 * The `AgentWorker` abstraction (web-dashboard Task 2.6, design §Agent_Worker).
 *
 * ONE interface, TWO swappable implementations decided by the POC_Spike (Req 7):
 *   (Y) headless agent-runtime adapter (auto-loads the shared contract/docs and MCP tools)
 *   (X) custom-loop adapter (assembles a Preprompt, drives the OpenAI-compatible
 *       gateway + MCP tools ourselves)
 * Both drive the SAME pipeline tools / single-process orchestrator, so the
 * rest of the design depends only on this interface — never on the chosen path
 * (Req 7.5). No engine internals appear here; this is the authoring contract the
 * control plane sees.
 */

import type { SerializedPipelineError, CrawledImage } from "@motionreal/pipeline";
import type { VideoFormat, DurationTier, VideoLanguage } from "@motionreal/schema";

/**
 * A local image the user attached at create time (create-time image staging). Carries only
 * the content-addressed `ref` (`assets/<sha>.<ext>`, already imported into the
 * project) + its pixel size — NOT the bytes. The backend reads the bytes from
 * disk to build the vision part, so this stays small + serializable across IPC.
 */
export type AuthorImageRef = { ref: string; width: number; height: number };

export const AUTHORING_CONTRACT_REF = "AI_CONTRACT.md+docs/current" as const;

/**
 * Input for a fresh authoring job: a free-form user brief (chat-style) plus any
 * links found in it to fetch for grounding (best-effort, never a hard gate), and
 * any local images the user attached for the AI to place (create-time image staging).
 *
 * The freeform-engine create screen (R7/R9/D10) picks three delivery knobs the
 * backend threads into the prompt + spec (it never lets the model choose them):
 * `format` (TikTok 9:16 / YouTube 16:9 → canvas + caption presence), `durationTier`
 * (the word-budget bucket, see `tierSeconds`), and `videoLanguage` (vi/en for the
 * whole authored video: title, on-screen text, narration, captions). All optional: absent ⇒ the
 * backend's defaults (tiktok / tier 1 / vi). Style selection is not part of the
 * authoring input; the multi-style design system was removed (D1).
 */
export type AuthorInput = {
  text: string;
  urls: string[];
  images?: AuthorImageRef[];
  format?: VideoFormat;
  durationTier?: DurationTier;
  videoLanguage?: VideoLanguage;
};

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
  /** Contract bearer reference only; the contract text is never inlined here. */
  contractRef: typeof AUTHORING_CONTRACT_REF;
  affectedSceneIds: string[];
  perSceneIntent: Record<string, string>;
  globalNotes: string;
};

/** Budget for the generate-validate-repair loop; default 3, clamped to [1,10] (Req 6.4). */
export type RepairLoopOptions = { maxAttempts: number; signal?: AbortSignal };

/** Outcome of a fresh-author or re-author job. */
export type AuthorOutcome =
  | { kind: "authored"; sceneIds: string[]; unreadableUrls?: string[] }
  | { kind: "no-source"; message: string };

/** Outcome of the generate-validate-repair loop (Req 6.3/6.7; + infra, Req 4; + user cancel). */
export type RepairOutcome =
  | { kind: "passed"; attempts: number }
  | { kind: "exhausted"; attempts: number; remainingHardErrors: number }
  | { kind: "infra"; attempts: number }
  /** The user pressed "Dừng render" — the loop stopped on purpose, not a failure. */
  | { kind: "cancelled"; attempts: number };

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
  reauthorScenes(job: ReauthorJob, hooks: AgentHooks, signal?: AbortSignal): Promise<AuthorOutcome>;
  /**
   * Optional fast per-scene STILLS render (no TTS/MP4/heavy-oracle) — the cheap
   * inner loop the SILENT refine pass iterates on (freeform-engine R4.2/R4.3).
   * `sceneIds` scopes the render to the scenes a pass just rewrote; omit ⇒ all.
   * Returns the rendered still paths (empty on a render failure — refine is
   * best-effort and must never crash the author flow).
   */
  renderStills?(projectId: string, sceneIds?: string[], signal?: AbortSignal): Promise<{ stills: string[] }>;
  /** Render the final full-quality MP4 (draft-first gate already satisfied). */
  publish(projectId: string, signal?: AbortSignal): Promise<PublishResult>;
  /** Run the generate-validate-repair loop to zero hard errors or budget (Req 6). */
  generateValidateRepair(
    projectId: string,
    opts: RepairLoopOptions,
    hooks: AgentHooks,
    signal?: AbortSignal,
  ): Promise<RepairOutcome>;
  /**
   * Optional AI visual-QA: judge the rendered scene stills (vision model) for
   * clear LAYOUT defects (overlap, clipping, off-canvas, imbalance) the
   * deterministic grid can't catch. `sceneIds` scopes the check (e.g. only the
   * scenes a user just edited); omit to check every scene. Returns the flagged
   * scenes + a short description. Model-dependent (needs vision) and best-effort.
   */
  visualQa?(projectId: string, sceneIds?: string[], signal?: AbortSignal): Promise<VisualDefect[]>;
  /** Snapshot authored scene source so a regressive visual-QA round can be rolled back. */
  snapshotScenes?(projectId: string, sceneIds: string[]): Promise<SceneSnapshot>;
  /** Restore authored scene source from a snapshot (re-admits the components). */
  restoreScenes?(projectId: string, snapshot: SceneSnapshot): Promise<void>;
  /** Crawl an article URL's images into the project assetsDir (crawled-image review); [] when unsupported/failed. */
  crawlImages?(projectId: string, url: string, signal?: AbortSignal): Promise<CrawledImage[]>;
  /** AI pre-select which crawled refs fit the article (crawled-image review); [] when unsupported/failed. */
  filterCrawledImages?(projectId: string, articleText: string, refs: AuthorImageRef[], signal?: AbortSignal): Promise<string[]>;
}
