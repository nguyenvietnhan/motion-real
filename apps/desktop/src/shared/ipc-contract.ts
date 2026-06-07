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
  ProgressEvent,
  ProjectCardVM,
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
    accountState(): Promise<AiAccountState>;
    connect(provider?: AiProviderId): Promise<AiAccountState>;
  };
  projects: {
    create(input: CreateInput): Promise<{ projectId: string }>;
    list(): Promise<ProjectCardVM[]>;
    open(projectId: string): Promise<StoryboardModel>;
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
