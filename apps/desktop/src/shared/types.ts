import type { ProjectState } from "@news/pipeline";

/**
 * UI-side view-model types shared between the main (engine host) and renderer
 * (React) processes (web-dashboard design §Data Models). These are the ONLY
 * shapes that cross IPC — already-translated view-models, never engine internals
 * (no SafetyIssue check ids, manifest JSON, `.tsx`, or stack traces).
 */

// --- license (Req 1) -------------------------------------------------------

export type LicenseState =
  | { kind: "unactivated" }
  | { kind: "activating" }
  | { kind: "active"; machineLocked: true; lastVerifiedAt: string }
  | { kind: "lapsed"; reason: "revoked" | "expired" }
  | { kind: "error"; reason: "timeout" | "offline" | "invalid" | "limit" | "revoked" };

// --- AI gateway + account (Req 2) ------------------------------------------

/** Open provider id discovered from the gateway (NOT a fixed union). */
export type AiProviderId = string;

export type GatewayState =
  | { kind: "starting"; attempt: number }
  | { kind: "ready"; baseUrl: string }
  | { kind: "unavailable" };

/** A provider discovered from the gateway's management API (Req 2.4). */
export type ProviderInfo = {
  id: AiProviderId;
  name: string;
  loginType: "browser" | "device" | "api-key" | "custom";
  connectedCount: number;
};

/** A model the gateway reports as available (Req 2.11), e.g. "kr/claude-sonnet-4.5". */
export type ModelInfo = { id: string; label: string };

/**
 * One completed AI-account connection. `active` mirrors 9router's own
 * `isActive` flag (the connection it is currently routing through) — used to
 * surface only the account in use rather than every connected one.
 */
export type ConnectedAccount = { provider: AiProviderId; label: string; active?: boolean };

/** Many connections may be active at once (Req 2.10); a model may be unselected (Req 2.13). */
export type AiAccountState =
  | { kind: "disconnected" }
  | { kind: "connecting"; provider: AiProviderId }
  | { kind: "connected"; accounts: ConnectedAccount[]; selectedModel?: ModelInfo };

// --- create (Req 3) --------------------------------------------------------

export type CreateInput = { raw: string; stylePackId?: string; accentColor?: string };

// --- projects / gallery (Req 10) -------------------------------------------

export type FriendlyStatus = "building" | "draft-ready" | "done" | "error";

export type ProjectCardVM = {
  projectId: string;
  title: string;
  thumbnailPath: string | null;
  status: FriendlyStatus;
  createdAtLabel: string;
};

// --- script gate (Req 4) ---------------------------------------------------

export type ScriptEdit = { sceneId: string; narration?: string; headline?: string };

export type ScriptGateModel = {
  projectId: string;
  enabled: boolean;
  scenes: { sceneId: string; order: number; narration: string; headline?: string }[];
};

export type ApplyResult =
  | { ok: true }
  | { ok: false; reason: "empty-narration"; sceneId: string }
  | { ok: false; reason: "write-failed" };

// --- storyboard review + edits (Req 8) -------------------------------------

export type SceneCard = { sceneId: string; order: number; stillPath: string; editText: string };

export type StoryboardModel = { projectId: string; scenes: SceneCard[]; globalNotes: string };

/** A reviewable script line (narration + headline) before rendering (Req 4). */
export type ScriptLine = { sceneId: string; order: number; headline: string; narration: string };

/** The live stage of a project's workspace, driving the staged UI. */
export type ProjectStage =
  | { kind: "writing" } // AI is drafting the script
  | { kind: "script"; lines: ScriptLine[]; linkWarning?: string } // awaiting user review/approval (linkWarning = brief links that couldn't be read)
  | { kind: "rendering"; percent: number; phase?: "edit" | "draft" | "full" | "qa" } // building (edit reauthor | draft | full | ai visual-qa)
  | { kind: "ready"; scenes: SceneCard[]; notice?: string } // draft ready, review scenes (notice = a transient message, e.g. an edit that couldn't be applied)
  | { kind: "published"; outputPath: string } // full MP4 rendered
  | { kind: "error"; message: string; fixable: boolean; retry?: "create" | "draft" | "full" }; // retry = which loop "Thử lại" re-runs (re-author | re-render draft | re-publish), so it doesn't re-author on a render failure

export type EditBatch = {
  perScene: { sceneId: string; text: string }[];
  globalNotes: string;
};

export type EvidenceWarning = { sceneId: string; unsupportedFigure: string };

export type SubmitResult =
  | { ok: true; revision: number; warnings?: EvidenceWarning[] }
  | { ok: false; reason: "no-changes" | "last-scene" | "scene-render-failed"; sceneId?: string };

// --- approve / full render (Req 9) -----------------------------------------

export type ApproveResult = { ok: true; outputPath: string } | { ok: false; reason: "draft-first" };

// --- settings (Req 11) -----------------------------------------------------

export type SettingsModel = {
  aiAccount: AiAccountState;
  voiceProvider: "vivibe";
  voiceId?: string;
  voiceApiKey?: string;
  outputDir: string;
  maxRepairAttempts: number;
  scriptGateEnabled: boolean;
  /** Run an AI vision pass over rendered stills to auto-fix layout defects before review. */
  visualQaEnabled: boolean;
};

// --- streaming events (Req 5, 9, 10) ---------------------------------------

export type ProgressEvent = { projectId: string; ratio: number; phase: "draft" | "full" };
export type SceneEvent = { projectId: string; sceneId: string; stillPath: string };
export type StatusEvent = { projectId: string; status: FriendlyStatus };
export type FriendlyError = {
  projectId?: string;
  message: string;
  retry?: "draft" | "full" | "create" | "activate" | "connect";
  /** When true, a Content_Error the agent can attempt to fix ("Sửa bằng AI"). */
  fixable?: boolean;
};

/** A plain-language auto-fix description that may cross IPC (never an N-code). */
export type FriendlyFix = { sceneId?: string; message: string };

/** Total mapping target reused by the gallery (Req 10.2/10.3). */
export type { ProjectState };
