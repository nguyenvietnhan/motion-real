import type {
  AiAccountState,
  AiProviderId,
  ApplyResult,
  ApproveResult,
  BgmTrackVM,
  CreateInput,
  DroppedImage,
  EditBatch,
  FriendlyError,
  GatewayState,
  LicenseState,
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
} from "./types.js";

/** Unsubscribe handle returned by every event subscription. */
export type Unsubscribe = () => void;

/**
 * The one typed IPC contract shared by the preload bridge and the main router
 * (web-dashboard design §IPC API surface). The renderer reaches the engine ONLY
 * through `window.dashboard`, which implements this interface.
 */
export interface DashboardApi {
  license: {
    get(): Promise<LicenseState>;
    activate(key: string): Promise<LicenseState>;
  };
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
    /** Open a native file picker, import the picked images (content-addressed) into staging, and return previews + per-file rejections (Phase 2 Block A). */
    pickImages(): Promise<PickImagesResult>;
    /** Import raw image bytes the renderer captured from a paste (Ctrl+V) or drag-drop — no file path — into staging (Phase 2 Block A). */
    importImageBytes(files: DroppedImage[]): Promise<PickImagesResult>;
    /** Delete one staged create-time image by its `staging/<sha>.<ext>` ref when the user removes it from the attach strip, so unused bytes don't linger until the 24h sweep. Best-effort: an unknown/already-gone ref resolves cleanly. */
    removeStagedImage(ref: string): Promise<void>;
    create(input: CreateInput): Promise<{ projectId: string }>;
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
    /** Confirm the crawled-image selection (Phase 2 Block B); authoring begins with these refs. Empty ⇒ author text-only. */
    submitImageReview(projectId: string, selectedRefs: string[]): Promise<void>;
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
     * Generate the project's thumbnail/cover PNG (R12, I3): a clean BRAND CARD
     * (theme wash + publish title centered) for both formats — no scene frame
     * behind it. Resolves the `media://` URL of the written PNG, or null when
     * generation failed or a render is in flight.
     */
    generate(projectId: string): Promise<{ thumbnailUrl: string } | null>;
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
