import type {
  AiAccountState,
  AiProviderId,
  ApplyResult,
  ApproveResult,
  CreateInput,
  EditBatch,
  FriendlyError,
  GatewayState,
  LicenseState,
  ModelInfo,
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
    create(input: CreateInput): Promise<{ projectId: string }>;
    list(): Promise<ProjectCardVM[]>;
    open(projectId: string): Promise<StoryboardModel>;
    stage(projectId: string): Promise<ProjectStage>;
    delete(projectId: string): Promise<void>;
    reveal(projectId: string): Promise<void>;
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
