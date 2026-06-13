import type {
  AiAccountState,
  AiProviderId,
  ApplyResult,
  ApproveResult,
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
  StylePackVM,
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
    /** The registered design style packs (id + name + chrome preview hints) so the create screen can render a style picker. Single source of truth = the `@news/design` registry. */
    listStylePacks(): Promise<StylePackVM[]>;
    create(input: CreateInput): Promise<{ projectId: string }>;
    list(): Promise<ProjectCardVM[]>;
    open(projectId: string): Promise<StoryboardModel>;
    stage(projectId: string): Promise<ProjectStage>;
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
