import type { ProjectState, VoiceProviderFailure } from "@motionreal/pipeline";
import type { SceneImageRole } from "@motionreal/schema";

/**
 * UI-side view-model types shared between the main (engine host) and renderer
 * (React) processes. These are the ONLY shapes that cross IPC — already-
 * translated view-models, never engine internals (no SafetyIssue check ids,
 * manifest JSON, `.tsx`, or stack traces).
 */

// --- AI gateway + account ------------------------------------------

/** Open provider id discovered from the gateway (NOT a fixed union). */
export type AiProviderId = string;

export type GatewayState =
  | { kind: "starting"; attempt: number }
  | { kind: "ready"; baseUrl: string }
  | { kind: "unavailable" };

/** A provider discovered from the gateway's management API. */
export type ProviderInfo = {
  id: AiProviderId;
  name: string;
  loginType: "browser" | "device" | "api-key" | "custom";
  connectedCount: number;
};

/** A model the gateway reports as available, e.g. "kr/claude-sonnet-4.5". */
export type ModelInfo = { id: string; label: string };

/**
 * One completed AI-account connection. `active` mirrors 9router's own
 * `isActive` flag (the connection it is currently routing through) — used to
 * surface only the account in use rather than every connected one.
 */
export type ConnectedAccount = { provider: AiProviderId; label: string; active?: boolean };

/** Many connections may be active at once; a model may be unselected. */
export type AiAccountState =
  | { kind: "disconnected" }
  | { kind: "connecting"; provider: AiProviderId }
  | { kind: "connected"; accounts: ConnectedAccount[]; selectedModel?: ModelInfo };

// --- DeepSeek Harness video drafts ---------------------------------

export type AgentProductionState =
  | "discovery"
  | "collecting_assets"
  | "asset_review"
  | "preparing_brief"
  | "brief_review"
  | "queued_create"
  | "authoring"
  | "visual_refine"
  | "scene_review"
  | "paused"
  | "error";

export type AgentSearchProvider = "deepseek" | "exa";

/** Scrubbed native Harness work item; never includes prompt, paths, URLs or tool output. */
export type AgentActivityVM = {
  id: string;
  label: string;
  status: "running" | "completed" | "failed";
};

/** A video-scoped Harness workspace. Paths and credentials never cross IPC. */
export type AgentDraftVM = {
  id: string;
  title: string;
  createdAt: string;
  /** Filesystem modification time of authoritative Agent metadata. */
  updatedAt: string;
  projectId?: string;
  workflowVersion: 2;
  workflowRevision: number;
  productionState: AgentProductionState;
  /** Old sessions can still carry Harness's workspace-write + ask policy. */
  sessionAccess: "full" | "legacy-approval";
  activeJobId?: string;
  /** Stage that will be resumed after a user-stopped workflow is continued. */
  pausedFrom?: Exclude<AgentProductionState, "paused" | "discovery" | "asset_review" | "brief_review" | "scene_review" | "error">;
  lastError?: string;
  /** Recent, allow-listed Harness activity for the MotionReal workflow surface. */
  activities?: AgentActivityVM[];
  /** A native Harness question or approval is awaiting the user; no raw prompt crosses IPC. */
  needsAttention?: boolean;
  /** Local native Harness conversation URL used by the embedded renderer iframe. */
  harnessUrl?: string;
  /** Whether DeepSeek Harness has the separate credential required by web_search. */
  webSearchConfigured?: boolean;
  /** Provider loaded by the running Harness, not a search-health assertion. */
  searchProvider?: AgentSearchProvider;
  /** The agent has written an explicit request awaiting the user's approval. */
  createReady: boolean;
  /** Validated local images awaiting the user's approval. */
  assetReview?: AgentAssetVM[];
  /** Selected ids survive collection/review retries and app restarts. */
  selectedAssetIds?: string[];
  /** Safe handoff validation error; raw paths and file contents never cross IPC. */
  assetCollectionError?: string;
  /** Validated Agent brief awaiting user edits/approval. */
  briefReview?: AgentBriefVM;
  /** Safe brief validation/prompt error; raw workspace data never crosses IPC. */
  briefReviewError?: string;
};

export type AgentSettingsVM = {
  searchProvider: AgentSearchProvider;
  webSearchConfigured: boolean;
  currentModelId?: string;
  modelOptions: Array<{ id: string; label: string }>;
  currentAccessId?: string;
  accessOptions: Array<{
    id: string;
    label: string;
    description?: string;
    requiresConfirmation: boolean;
  }>;
};

/** One validated image in an Agent workspace. */
export type AgentAssetVM = {
  id: string;
  previewUrl: string;
  sourceUrl: string;
  label: string;
  role: SceneImageRole;
  width: number;
  height: number;
  bytes: number;
};

export type AgentBriefVM = {
  revision: number;
  title: string;
  prompt: string;
  format: "tiktok";
  videoLanguage: VideoLanguageChoice;
  selectedAssetIds: string[];
};

/**
 * Choices made by the user when accepting an Agent-generated brief.  The model
 * proposes content and language only; duration and voice are application policy.
 */
export type AgentBriefInput = {
  title: string;
  prompt: string;
  durationTier: DurationTierChoice;
  videoLanguage: VideoLanguageChoice;
  voiceProvider: VoiceProviderChoice;
};

// --- create --------------------------------------------------------

/**
 * A local image the user picked at the create screen and that has been imported
 * (content-addressed) into the staging dir (create-time image staging). `ref` is the
 * project-relative path it will live at once the project exists
 * (`assets/<sha>.<ext>`); `previewUrl` is a `media://` URL to the staged copy.
 */
export type StagedImage = { ref: string; previewUrl: string; width: number; height: number; bytes: number; name: string };

/**
 * A pasted (Ctrl+V) or drag-dropped image: the bytes the renderer read from a
 * `File`/clipboard item, BASE64-encoded, with the source filename for the
 * rejection notice. Unlike the native picker (which has a filesystem path),
 * these have no path, so they cross IPC directly. We carry base64 (not a raw
 * `Uint8Array`) because a string serializes cleanly across the contextBridge +
 * IPC boundary, whereas a typed array can arrive mangled.
 */
export type DroppedImage = { name: string; dataBase64: string };

/** The minimal image descriptor carried into `CreateInput` (no preview/bytes). */
export type StagedImageRef = { ref: string; width: number; height: number };

/** Result of the native image picker: imported images + per-file rejections. */
export type PickImagesResult = {
  staged: StagedImage[];
  rejected: { name: string; reason: string }[];
};

/** Delivery format — short-form 9:16 only. */
export type VideoFormatChoice = "tiktok";
/** Duration tier for short-form pacing: 1≈45s, 2≈90s, 3≈150s, 4≈210s. */
export type DurationTierChoice = 1 | 2 | 3 | 4;
/** Authored video language the user picks: content, narration, captions, title, hashtags. */
export type VideoLanguageChoice = "vi" | "en";

export type CreateInput = {
  raw: string;
  /** TTS provider captured into the project brief at create time. */
  voiceProvider?: VoiceProviderChoice;
  /** Always tiktok for new creates (optional for older call sites). */
  format?: VideoFormatChoice;
  /** User-picked short-form duration tier (default 1). */
  durationTier?: DurationTierChoice;
  /** Authored video language (default vi). */
  videoLanguage?: VideoLanguageChoice;
  /**
   * BGM library track name chosen at create (Home knobs). Required for
   * skip_edit auto-full; also seeds full/stills_edit storyboard selection.
   * `null` = explicit no music; omit = leave manifest unset (no BGM).
   */
  bgm?: string | null;
  images?: StagedImageRef[];
  /**
   * Home composer only. When the queue runner is busy, create spills into the
   * ephemeral `home` queue instead of starting a parallel project.
   */
  source?: "home";
};

/** Result of projects:create — started immediately or queued behind busy runner. */
export type CreateProjectResult =
  | { kind: "started"; projectId: string }
  | { kind: "queued"; queueId: string; jobId: string; imagesDropped?: boolean };

// --- projects / gallery -------------------------------------------

export type FriendlyStatus = "building" | "draft-ready" | "done" | "error";

export type ProjectCardVM = {
  projectId: string;
  title: string;
  thumbnailPath: string | null;
  /** Drives aspect-correct gallery media without adding a visible format badge. */
  format: VideoFormatChoice;
  status: FriendlyStatus;
  createdAtLabel: string;
  /** Missing means legacy Classic ownership. */
  creationMode?: "classic" | "harness";
  /** Present only for a Harness-owned project. */
  agentDraftId?: string;
};

export type VoiceProviderChoice = "vivibe" | "elevenlabs" | "vieneu";
export type CredentialState = "saved" | "environment" | "missing";
// --- background music library --------------------------------

/** One track in the per-machine BGM library (shared across projects). */
export type BgmTrackVM = {
  /** Library filename — what a project stores as its chosen BGM ref. */
  name: string;
  /** Human label shown in the picker; may differ for a bundled track. */
  label: string;
  /** Compact size hint for the UI (e.g. "3.2 MB"). */
  sizeLabel: string;
  /** Streamable local URL used only for in-picker audio preview. */
  previewUrl: string;
  /** Bundled tracks remain available and cannot be removed from the picker. */
  builtIn: boolean;
};

// --- script gate ---------------------------------------------------

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

// --- storyboard review + edits -------------------------------------

/** Locked-timeline projection for draft player seek/highlight (seconds). */
export type SceneTimeline = { startSeconds: number; endSeconds: number };

export type SceneCard = {
  sceneId: string;
  order: number;
  stillPath: string;
  editText: string;
  headline?: string;
  narration?: string;
  eyebrow?: string;
  /** Present only when a readable locked timeline exists for this scene. */
  timeline?: SceneTimeline;
};

export type StoryboardModel = { projectId: string; scenes: SceneCard[]; globalNotes: string };

/** A reviewable script line (narration + headline) before rendering. */
export type ScriptLine = { sceneId: string; order: number; headline: string; narration: string; imagePath?: string };

/** Script-gate evidence panel (optional; absent for text-only/old projects). */
export type ScriptEvidenceModel = {
  sources: Array<{ id: string; sourceUrl: string; title: string; site?: string; publishedDate?: string }>;
  claims: Array<{ id: string; text: string; sourceId?: string; excerpt?: string; sceneIds: string[] }>;
};

/**
 * One crawled article image offered on the review screen (crawled-image review).
 * `previewUrl` is a `media://` URL to the already-imported local asset;
 * `suggested` = the AI-filter pre-tick (true ⇒ checkbox starts checked).
 */
export type CrawledImageVM = { ref: string; previewUrl: string; width: number; height: number; sourceUrl: string; suggested: boolean; label?: string };

/** The live stage of a project's workspace, driving the staged UI. */
export type ProjectStage =
  | { kind: "writing"; phase?: "author" | "crawl" | "image-filter" } // AI is reading sources / drafting the script
  | { kind: "image-review"; images: CrawledImageVM[] } // blocking: confirm which crawled article images to use before authoring (crawled-image review)
  | { kind: "script"; lines: ScriptLine[]; linkWarning?: string; evidence?: ScriptEvidenceModel } // awaiting user review/approval (linkWarning = brief links that couldn't be read)
  | { kind: "rendering"; percent: number; phase?: "edit" | "draft" | "full" | "qa" | "prepare"; qaPass?: number; qaTotal?: number } // building (edit reauthor | draft | full | ai visual-qa | hidden prep). "prepare" is the NEUTRAL phase for the two hidden pre-draft renders (blind stills + creative bootstrap): the user sees a generic "Đang dựng bản nháp…" and never the raw bland take. qaPass/qaTotal annotate a "qa" phase with which vision round is running (e.g. 2/5) so the UI can say "Đang soát lỗi hình ảnh (lần 2/5)…"
  | { kind: "ready"; scenes: SceneCard[]; notice?: string; draftPath?: string } // draft ready, review scenes (notice = a transient message; draftPath = mediaUrl of the low-res draft MP4 for in-app preview, when it exists)
  /** Draft MP4 healthy but manifest missing/unreadable — view/reveal only. */
  | { kind: "draft-recovery"; draftPath: string; notice: string }
  | { kind: "published"; outputPath: string; title?: string; hashtags?: string[]; thumbnailPath?: string; format?: VideoFormatChoice } // full MP4 rendered (title+hashtags for Copy; thumbnailPath = caption-free first-scene cover; format drives preview/cover aspect)
  | { kind: "error"; message: string; fixable: boolean; retry?: "create" | "draft" | "full"; voiceFailure?: VoiceProviderFailure }; // retry = which loop "Thử lại" re-runs (re-author | re-render draft | re-publish), so it doesn't re-author on a render failure

export type EditBatch = {
  perScene: { sceneId: string; text: string }[];
  globalNotes: string;
};

export type EvidenceWarning = { sceneId: string; unsupportedFigure: string };

export type SubmitResult =
  | { ok: true; revision: number; warnings?: EvidenceWarning[] }
  | { ok: false; reason: "no-changes" | "last-scene" | "scene-render-failed"; sceneId?: string };

// --- approve / full render -----------------------------------------

export type ApproveResult = { ok: true; outputPath: string } | { ok: false; reason: "draft-first" };

// --- project diagnostics (renderer-safe view model) ---------------

export type ProjectDiagnosticEntryVM = {
  at: string;
  kind: "lifecycle" | "authoring" | "repair" | "warning" | "error";
  state: "info" | "warning" | "error" | "resolved" | "reverted";
  message: string;
  sceneId?: string;
};

export type ProjectDiagnosticsVM = {
  projectId: string;
  entries: ProjectDiagnosticEntryVM[];
  truncated: boolean;
};

// --- settings readiness (renderer-safe view model) ----------------

export type DesktopReadinessCheck = {
  id: "gateway" | "account" | "model" | "voice" | "ffmpeg" | "browser" | "n10" | "theme" | "fonts";
  state: "ready" | "warning" | "blocked";
  label: string;
  detail: string;
  remediation?: string;
};

export type DesktopReadinessReport = {
  ok: boolean;
  checks: DesktopReadinessCheck[];
};

export type VoiceTestResult =
  | { ok: true; audioDataUrl: string }
  | { ok: false; error: string; voiceFailure: VoiceProviderFailure };

// --- settings -----------------------------------------------------

/**
 * Desktop post-author review policy (global Settings).
 * - full: draft MP4 + scene edit (default); user approves before full export
 * - stills_edit: stills only + scene edit (no draft MP4); user approves full
 * - skip_edit: stills (+ silent refine), no review/edit stop; auto full export
 *   (forceFull when no draft). For true unattended runs also turn OFF
 *   scriptGateEnabled and imageCrawlHumanReview.
 */
export type ReviewMode = "full" | "stills_edit" | "skip_edit";

export type SettingsModel = {
  aiAccount: AiAccountState;
  /**
   * User's explicit generation-model preference; runtime account state remains
   * transient. Absent on first use; older settings files may omit it.
   */
  preferredAiModelId?: string;
  /** Default for the create screen; each project persists its actual selection. */
  voiceProvider: VoiceProviderChoice;
  /** Most recently accepted duration tier across Home, Queue, and Video Agent. */
  lastDurationTier: DurationTierChoice;
  vivibeVoiceId?: string;
  elevenLabsVoiceId?: string;
  vieneuVoiceId?: string;
  elevenLabsModelId: string;
  voiceCredentials: Record<"vivibe" | "elevenlabs", CredentialState>;
  /** Measured WPS keyed by provider/model/voice/speed identity. */
  voiceCalibrations: Record<string, number>;
  outputDir: string;
  maxRepairAttempts: number;
  scriptGateEnabled: boolean;
  /**
   * How far to stop for human review before full export.
   * Independent of silent refine and script gate.
   */
  reviewMode: ReviewMode;
  /**
   * How many SILENT refine passes run over the rendered stills before the user
   * sees the first draft : an AI vision pass flags
   * layout defects, the flagged scenes are re-authored, and the stills re-render
   * — repeated up to this many times (stopping early when a pass finds nothing).
   * 0 disables refine entirely. Clamped to [0,5]; default 2. (Replaces the old
   * boolean `visualQaEnabled`: that ON ⇒ a positive pass count, OFF ⇒ 0.)
   */
  refinePasses: number;
  /**
   * Stop the silent refine loop early when TWO CONSECUTIVE vision passes find no
   * defect, instead of after a single clean pass. ON (default)
   * trades a little quota for fewer missed defects — a lone clean pass can be a
   * vision miss, so we confirm with a second. OFF runs the full `refinePasses`
   * budget regardless (most thorough, most quota). When ON and a pass DOES flag a
   * defect, the consecutive-clean counter resets.
   */
  refineEarlyStop: boolean;
  /** When a brief carries a link, let the AI pre-select which crawled article images fit (AI image preselection). */
  imageCrawlAiFilter: boolean;
  /** Show a blocking review screen so the user confirms crawled images before authoring (crawled-image review). */
  imageCrawlHumanReview: boolean;
  /**
   * Dev/test: when ON, Home shows a round "Render smoke" button next to send
   * (silent ~10s sample MP4, no TTS). Default OFF.
   */
  smokeRenderEnabled: boolean;
};

/** Fields the untrusted renderer may persist through `settings:update`. */
export type SettingsUpdateInput = Partial<Pick<SettingsModel,
  | "preferredAiModelId"
  | "voiceProvider"
  | "lastDurationTier"
  | "vivibeVoiceId"
  | "elevenLabsVoiceId"
  | "vieneuVoiceId"
  | "maxRepairAttempts"
  | "scriptGateEnabled"
  | "reviewMode"
  | "refinePasses"
  | "refineEarlyStop"
  | "imageCrawlAiFilter"
  | "imageCrawlHumanReview"
  | "smokeRenderEnabled"
>>;

// --- streaming events ---------------------------------------

export type ProgressEvent = { projectId: string; ratio: number; phase: "draft" | "full" };
export type SceneEvent = { projectId: string; sceneId: string; stillPath: string };
export type StatusEvent = { projectId: string; status: FriendlyStatus };
export type FriendlyError = {
  projectId?: string;
  message: string;
  retry?: "draft" | "full" | "create" | "activate" | "connect";
  /** When true, a Content_Error the agent can attempt to fix ("Sửa bằng AI"). */
  fixable?: boolean;
  voiceFailure?: VoiceProviderFailure;
};

/** A plain-language auto-fix description that may cross IPC (never an N-code). */
export type FriendlyFix = { sceneId?: string; message: string };

/** Total mapping target reused by the gallery. */
export type { ProjectState };
