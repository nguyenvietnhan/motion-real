import type { DashboardApi, Unsubscribe } from "../shared/ipc-contract.js";
import type { EventChannel } from "../shared/channels.js";

/**
 * The minimal IPC surface the preload client needs — an injectable seam so the
 * client builder is unit-testable with a fake (web-dashboard Task 1.3) instead
 * of the real Electron `ipcRenderer`.
 */
export interface IpcLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (...args: unknown[]) => void): void;
  off(channel: string, listener: (...args: unknown[]) => void): void;
}

function subscribe<T>(ipc: IpcLike, channel: EventChannel, cb: (e: T) => void): Unsubscribe {
  const listener = (_event: unknown, payload: T): void => cb(payload);
  ipc.on(channel, listener as (...args: unknown[]) => void);
  return () => ipc.off(channel, listener as (...args: unknown[]) => void);
}

/**
 * Build the typed `DashboardApi` client over an `IpcLike`. Every method maps to
 * exactly one allow-listed channel; nothing else is reachable. Values crossing
 * the boundary are typed by the contract (cast at the seam only).
 */
export function createDashboardClient(ipc: IpcLike): DashboardApi {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inv = (channel: string, ...args: unknown[]): Promise<any> => ipc.invoke(channel, ...args) as Promise<any>;
  return {
    license: {
      get: () => inv("license:get"),
      activate: (key) => inv("license:activate", key),
    },
    ai: {
      gatewayState: () => inv("ai:gatewayState"),
      listProviders: () => inv("ai:listProviders"),
      connectedAccounts: () => inv("ai:connectedAccounts"),
      beginConnect: (providerId) => inv("ai:beginConnect", providerId),
      listModels: () => inv("ai:listModels"),
      selectModel: (modelId) => inv("ai:selectModel", modelId),
      selectedModel: () => inv("ai:selectedModel"),
    },
    projects: {
      create: (input) => inv("projects:create", input),
      list: () => inv("projects:list"),
      open: (projectId) => inv("projects:open", projectId),
      stage: (projectId) => inv("projects:stage", projectId),
      delete: (projectId) => inv("projects:delete", projectId),
      reveal: (projectId) => inv("projects:reveal", projectId),
    },
    script: {
      get: (projectId) => inv("script:get", projectId),
      applyEdits: (projectId, edits) => inv("script:applyEdits", projectId, edits),
      approve: (projectId) => inv("script:approve", projectId),
      setEnabled: (enabled) => inv("script:setEnabled", enabled),
    },
    review: {
      submitEdits: (projectId, batch) => inv("review:submitEdits", projectId, batch),
      approveDraft: (projectId) => inv("review:approveDraft", projectId),
    },
    settings: {
      get: () => inv("settings:get"),
      update: (patch) => inv("settings:update", patch),
    },
    events: {
      onProgress: (cb) => subscribe(ipc, "events:progress", cb),
      onScene: (cb) => subscribe(ipc, "events:scene", cb),
      onStatus: (cb) => subscribe(ipc, "events:status", cb),
      onFriendlyError: (cb) => subscribe(ipc, "events:friendlyError", cb),
    },
  };
}
