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

export type AiProviderId = "kiro" | "codex" | "gemini";

export type GatewayState =
  | { kind: "starting"; attempt: number }
  | { kind: "ready"; baseUrl: string }
  | { kind: "unavailable" };

export type AiAccountState =
  | { kind: "disconnected" }
  | { kind: "connecting"; provider: AiProviderId }
  | { kind: "connected"; provider: AiProviderId; label: string };

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
  outputDir: string;
  maxRepairAttempts: number;
  scriptGateEnabled: boolean;
};

// --- streaming events (Req 5, 9, 10) ---------------------------------------

export type ProgressEvent = { projectId: string; ratio: number; phase: "draft" | "full" };
export type SceneEvent = { projectId: string; sceneId: string; stillPath: string };
export type StatusEvent = { projectId: string; status: FriendlyStatus };
export type FriendlyError = {
  projectId?: string;
  message: string;
  retry?: "draft" | "full" | "create" | "activate" | "connect";
};

/** A plain-language auto-fix description that may cross IPC (never an N-code). */
export type FriendlyFix = { sceneId?: string; message: string };

/** Total mapping target reused by the gallery (Req 10.2/10.3). */
export type { ProjectState };
