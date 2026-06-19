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

/**
 * A local image the user picked at the create screen and that has been imported
 * (content-addressed) into the staging dir (Phase 2 Block A). `ref` is the
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

/** Delivery format the user picks at the create screen (drives canvas + zones + caption presence). */
export type VideoFormatChoice = "tiktok" | "youtube";
/** Duration tier (1/2/3) the user picks; maps to per-format second targets (R7.3). */
export type DurationTierChoice = 1 | 2 | 3;
/** Publish-title language the user picks (R9.2); never changes the script language. */
export type TitleLanguageChoice = "vi" | "en" | "mix";

export type CreateInput = {
  raw: string;
  /** Delivery format (default tiktok). */
  format?: VideoFormatChoice;
  /** Duration tier the word-budget aims at (default 1). */
  durationTier?: DurationTierChoice;
  /** Publish-title language (default vi). */
  titleLanguage?: TitleLanguageChoice;
  images?: StagedImageRef[];
};

/**
 * A selectable design style pack, surfaced to the create-screen picker. Read
 * from the `@news/design` registry (the single source of truth) so a newly
 * registered pack appears as a chip without touching the renderer. `preview`
 * carries the few CHROME hints the renderer needs to draw a CSS thumbnail of the
 * look (no rendered image — a coarse, always-correct sketch driven by the same
 * tokens the real render reads).
 */
export type StylePackVM = {
  id: string;
  name: string;
  description: string;
  /** True for the pack `makeTheme` falls back to — the picker pre-selects it. */
  isDefault: boolean;
  preview: {
    /** Block border weight in px. */
    borderWidth: number;
    /** Border treatment: "none" ⇒ frameless (sketch draws no block outline). */
    borderStyle: "solid" | "hairline" | "none";
    /** Faint full-frame grid behind content. */
    grid: boolean;
    /** Corner registration ticks (editorial print detail). */
    registrationTicks: boolean;
    /** Whitespace/density bias — drives how "busy" the sketch reads. */
    density: "compact" | "editorial" | "airy";
    /** Dark base (vs the default light cream) — the sketch paints a dark canvas. */
    dark: boolean;
    /** Rounded corners (vs the squared editorial grammar) — sketch rounds blocks. */
    rounded: boolean;
    /** Decorative starfield backdrop (galaxy look) — sketch sprinkles faint stars. */
    starfield: boolean;
  };
};

// --- projects / gallery (Req 10) -------------------------------------------

export type FriendlyStatus = "building" | "draft-ready" | "done" | "error";

export type ProjectCardVM = {
  projectId: string;
  title: string;
  thumbnailPath: string | null;
  status: FriendlyStatus;
  createdAtLabel: string;
};

// --- background music library (Req 11 / I2) --------------------------------

/** One track in the per-machine BGM library (shared across projects). */
export type BgmTrackVM = {
  /** Library filename — what a project stores as its chosen BGM ref. */
  name: string;
  /** Compact size hint for the UI (e.g. "3.2 MB"). */
  sizeLabel: string;
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
export type ScriptLine = { sceneId: string; order: number; headline: string; narration: string; imagePath?: string };

/**
 * One crawled article image offered on the review screen (Phase 2 Block B).
 * `previewUrl` is a `media://` URL to the already-imported local asset;
 * `suggested` = the AI-filter pre-tick (true ⇒ checkbox starts checked).
 */
export type CrawledImageVM = { ref: string; previewUrl: string; width: number; height: number; sourceUrl: string; suggested: boolean };

/** The live stage of a project's workspace, driving the staged UI. */
export type ProjectStage =
  | { kind: "writing"; phase?: "author" | "crawl" | "image-filter" } // AI is reading sources / drafting the script
  | { kind: "image-review"; images: CrawledImageVM[] } // blocking: confirm which crawled article images to use before authoring (Phase 2 Block B)
  | { kind: "script"; lines: ScriptLine[]; linkWarning?: string } // awaiting user review/approval (linkWarning = brief links that couldn't be read)
  | { kind: "rendering"; percent: number; phase?: "edit" | "draft" | "full" | "qa" | "prepare"; qaPass?: number; qaTotal?: number } // building (edit reauthor | draft | full | ai visual-qa | hidden prep). "prepare" is the NEUTRAL phase for the two hidden pre-draft renders (blind stills + creative bootstrap, freeform-engine L1/L3): the user sees a generic "Đang dựng bản nháp…" and never the raw bland take. qaPass/qaTotal annotate a "qa" phase with which vision round is running (e.g. 2/5) so the UI can say "Đang soát lỗi hình ảnh (lần 2/5)…"
  | { kind: "ready"; scenes: SceneCard[]; notice?: string; draftPath?: string } // draft ready, review scenes (notice = a transient message; draftPath = mediaUrl of the low-res draft MP4 for in-app preview, when it exists)
  | { kind: "published"; outputPath: string; title?: string; hashtags?: string[]; thumbnailPath?: string; format?: VideoFormatChoice } // full MP4 rendered (title+hashtags for Copy; thumbnailPath = caption-free first-scene cover; format drives preview/cover aspect, I3/R12)
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
  /**
   * How many SILENT refine passes run over the rendered stills before the user
   * sees the first draft (freeform-engine D6/R4.4): an AI vision pass flags
   * layout defects, the flagged scenes are re-authored, and the stills re-render
   * — repeated up to this many times (stopping early when a pass finds nothing).
   * 0 disables refine entirely. Clamped to [0,5]; default 2. (Replaces the old
   * boolean `visualQaEnabled`: that ON ⇒ a positive pass count, OFF ⇒ 0.)
   */
  refinePasses: number;
  /**
   * Stop the silent refine loop early when TWO CONSECUTIVE vision passes find no
   * defect (freeform-engine L4), instead of after a single clean pass. ON (default)
   * trades a little quota for fewer missed defects — a lone clean pass can be a
   * vision miss, so we confirm with a second. OFF runs the full `refinePasses`
   * budget regardless (most thorough, most quota). When ON and a pass DOES flag a
   * defect, the consecutive-clean counter resets.
   */
  refineEarlyStop: boolean;
  /** When a brief carries a link, let the AI pre-select which crawled article images fit (Phase 2 Block B). */
  imageCrawlAiFilter: boolean;
  /** Show a blocking review screen so the user confirms crawled images before authoring (Phase 2 Block B). */
  imageCrawlHumanReview: boolean;
  /**
   * MEASURED Vietnamese narration rate (words/second) for the configured voice
   * (freeform-engine K1/R5.4/D13). The author prompt turns a duration target into
   * a total word budget at this rate; a wrong rate makes a "90s" request render as
   * ~60s. Populated by `scripts/calibrate-voice.ts` (sends fixed-length passages
   * through Vivibe, measures real seconds → avg w/s). Absent ⇒ the prompt falls
   * back to the baked default (~4.7). Clamped to a sane band before use.
   */
  voiceWordsPerSecond?: number;
  /**
   * The voiceId the `voiceWordsPerSecond` rate was measured for. The rate is
   * voice-specific (a faster/slower voice reads at a different w/s), so when the
   * configured `voiceId` differs from this, the measured rate is STALE and the
   * prompt ignores it (falls back to the default) until re-calibrated. Absent ⇒
   * never calibrated.
   */
  voiceWpsCalibratedFor?: string;
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
