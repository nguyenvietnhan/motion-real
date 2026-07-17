import type {
  AiAccountState,
  AiProviderId,
  ApplyResult,
  ApproveResult,
  BgmTrackVM,
  CreateInput,
  CreateProjectResult,
  DroppedImage,
  EditBatch,
  FriendlyError,
  GatewayState,
  ModelInfo,
  PickImagesResult,
  ProgressEvent,
  ProjectCardVM,
  ProviderInfo,
  ProjectStage,
  SceneEvent,
  ScriptEdit,
  ScriptGateModel,
  SettingsModel,
  StatusEvent,
  StoryboardModel,
  SubmitResult,
  VoiceProviderChoice,
} from "./types.js";
import type {
  QueueJobInput,
  QueueJobUpdateInput,
  QueueProjectVM,
  QueueRunnerStatus,
  QueueStartResult,
} from "./queue-types.js";

/** Unsubscribe handle returned by every event subscription. */
export type Unsubscribe = () => void;

/**
 * The one typed IPC contract shared by the preload bridge and the main router.
 * The renderer reaches the engine ONLY through `window.dashboard`, which
 * implements this interface.
 */
export interface DashboardApi {
  ai: {
    gatewayState(): Promise<GatewayState>;
    listProviders(): Promise<ProviderInfo[]>;
    connectedAccounts(): Promise<AiAccountState>;
    beginConnect(providerId: AiProviderId): Promise<{ loginSurface: "external-browser" | "in-app" }>;
    listModels(): Promise<ModelInfo[]>;
    selectModel(modelId: string): Promise<AiAccountState>;
    selectedModel(): Promise<ModelInfo | undefined>;
  };
  projects: {
    /** Open a native file picker, import the picked images (content-addressed) into staging, and return previews + per-file rejections (create-time image staging). */
    pickImages(): Promise<PickImagesResult>;
    /** Import raw image bytes the renderer captured from a paste (Ctrl+V) or drag-drop — no file path — into staging (create-time image staging). */
    importImageBytes(files: DroppedImage[]): Promise<PickImagesResult>;
    /** Delete one staged create-time image by its `staging/<sha>.<ext>` ref when the user removes it from the attach strip, so unused bytes don't linger until the 24h sweep. Best-effort: an unknown/already-gone ref resolves cleanly. */
    removeStagedImage(ref: string): Promise<void>;
    create(input: CreateInput): Promise<CreateProjectResult>;
    list(): Promise<ProjectCardVM[]>;
    open(projectId: string): Promise<StoryboardModel>;
    stage(projectId: string): Promise<ProjectStage>;
    /** Rename a project's display title (persisted to its manifest); the gallery card + published panel reflect it. Resolves the saved (clamped/trimmed) title, or null when the project has no manifest to rename. */
    rename(projectId: string, newTitle: string): Promise<string | null>;
    delete(projectId: string): Promise<void>;
    reveal(projectId: string): Promise<void>;
    /** Copy the full-quality MP4 to a user-chosen location via a native Save dialog. Resolves `{saved:false}` when the user cancels, and `{saved:false, error}` (redacted reason) when the copy fails. */
    save(projectId: string): Promise<{ saved: boolean; error?: string }>;
    /** Stop the in-flight render/author/edit job ("Dừng render"); the project returns to its prior reviewable stage. */
    cancel(projectId: string): Promise<void>;
    /** Re-run authoring for an existing project (the "Thử lại" action). */
    retry(projectId: string): Promise<void>;
    /** Ask the agent to fix Content_Errors and re-render ("Sửa bằng AI"). */
    fixWithAi(projectId: string): Promise<void>;
    /** Confirm the crawled-image selection (crawled-image review); authoring begins with these refs. Empty ⇒ author text-only. */
    submitImageReview(projectId: string, selectedRefs: string[]): Promise<void>;
    /** Bounded, redacted project diagnostic trace (lifecycle/repair/authoring only). */
    diagnostics(projectId: string): Promise<import("./types.js").ProjectDiagnosticsVM>;
  };
  bgm: {
    /** List the per-machine BGM library tracks (shared across projects). */
    list(): Promise<BgmTrackVM[]>;
    /** Open a native picker and copy the chosen audio file(s) into the library; resolves the updated list. */
    add(): Promise<BgmTrackVM[]>;
    /** Delete one library track by name; resolves the updated list. */
    remove(name: string): Promise<BgmTrackVM[]>;
    /** Read a project's currently-selected BGM track name (null = none). */
    getForProject(projectId: string): Promise<string | null>;
    /** Set (or clear, with null) a project's BGM track; persisted to its manifest. */
    setForProject(projectId: string, name: string | null): Promise<void>;
  };
  thumbnail: {
    /**
     * Render the first authored scene without captions and expose its stable
     * cover artifact. Resolves null when generation failed or work is in flight.
     */
    generate(projectId: string): Promise<{ thumbnailUrl: string } | null>;
    /** Copy the generated cover PNG to a user-chosen location. */
    save(projectId: string): Promise<{ saved: boolean; error?: string }>;
  };
  script: {
    get(projectId: string): Promise<ScriptGateModel>;
    applyEdits(projectId: string, edits: ScriptEdit[]): Promise<ApplyResult>;
    approve(projectId: string): Promise<void>;
    setEnabled(enabled: boolean): Promise<void>;
  };
  review: {
    submitEdits(projectId: string, batch: EditBatch): Promise<SubmitResult>;
    approveDraft(projectId: string): Promise<ApproveResult>;
  };
  settings: {
    get(): Promise<SettingsModel>;
    update(patch: Partial<SettingsModel>): Promise<SettingsModel>;
    /** Local/gateway readiness report (no LLM/TTS call). */
    readiness(): Promise<import("./types.js").DesktopReadinessReport>;
    /**
     * Dev/test: create a real project titled "test", ~10s target, TTS none,
     * then hand off to the normal workspace author/render path.
     * When the queue runner is busy, returns `kind: "queued"` (ephemeral home) instead.
     */
    renderSmoke(input?: {
      raw?: string;
      videoLanguage?: import("./types.js").VideoLanguageChoice;
    }): Promise<
      | { ok: true; kind: "started"; projectId: string }
      | { ok: true; kind: "queued"; queueId: string; jobId: string }
      | { ok: false; error: string }
    >;
  };
  queue: {
    list(): Promise<QueueProjectVM[]>;
    get(queueId: string): Promise<QueueProjectVM | null>;
    create(title?: string): Promise<QueueProjectVM>;
    delete(queueId: string): Promise<boolean>;
    rename(queueId: string, title: string): Promise<QueueProjectVM | null>;
    addJob(queueId: string, input: QueueJobInput): Promise<QueueProjectVM | null>;
    /** Patch a still-queued job (prompt + knobs). */
    updateJob(queueId: string, jobId: string, patch: QueueJobUpdateInput): Promise<QueueProjectVM | null>;
    deleteJob(queueId: string, jobId: string): Promise<QueueProjectVM | null>;
    /** Stop the currently running job in this queue. */
    cancelJob(queueId: string, jobId: string): Promise<{ ok: true } | { ok: false; error: string }>;
    /** Explicit start only — addJob never starts render. Schedules if another container is active. */
    start(queueId: string): Promise<QueueStartResult>;
    status(): Promise<QueueRunnerStatus>;
  };
  tts: {
    setApiKey(provider: VoiceProviderChoice, apiKey: string): Promise<SettingsModel>;
    clearApiKey(provider: VoiceProviderChoice): Promise<SettingsModel>;
  };
  events: {
    onProgress(cb: (e: ProgressEvent) => void): Unsubscribe;
    onScene(cb: (e: SceneEvent) => void): Unsubscribe;
    onStatus(cb: (e: StatusEvent) => void): Unsubscribe;
    onFriendlyError(cb: (e: FriendlyError) => void): Unsubscribe;
  };
}

declare global {
  interface Window {
    dashboard: DashboardApi;
  }
}
