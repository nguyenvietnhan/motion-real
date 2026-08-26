import type { DashboardApi, Unsubscribe } from "../shared/ipc-contract.js";
import type { EventChannel } from "../shared/channels.js";

/**
 * The minimal IPC surface the preload client needs — an injectable seam so the
 * client builder is unit-testable with a fake instead
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
      pickImages: () => inv("projects:pickImages"),
      importImageBytes: (files) => inv("projects:importImageBytes", files),
      removeStagedImage: (ref) => inv("projects:removeStagedImage", ref),
      create: (input) => inv("projects:create", input),
      list: () => inv("projects:list"),
      open: (projectId) => inv("projects:open", projectId),
      stage: (projectId) => inv("projects:stage", projectId),
      rename: (projectId, newTitle) => inv("projects:rename", projectId, newTitle),
      delete: (projectId) => inv("projects:delete", projectId),
      reveal: (projectId) => inv("projects:reveal", projectId),
      save: (projectId) => inv("projects:save", projectId),
      cancel: (projectId) => inv("projects:cancel", projectId),
      retry: (projectId) => inv("projects:retry", projectId),
      fixWithAi: (projectId) => inv("projects:fixWithAi", projectId),
      submitImageReview: (projectId, selectedRefs) => inv("projects:submitImageReview", projectId, selectedRefs),
      diagnostics: (projectId) => inv("projects:diagnostics", projectId),
    },
    bgm: {
      list: () => inv("bgm:list"),
      add: () => inv("bgm:add"),
      remove: (name) => inv("bgm:remove", name),
      getForProject: (projectId) => inv("bgm:getForProject", projectId),
      setForProject: (projectId, name) => inv("bgm:setForProject", projectId, name),
    },
    thumbnail: {
      generate: (projectId) => inv("thumbnail:generate", projectId),
      save: (projectId) => inv("thumbnail:save", projectId),
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
      readiness: () => inv("settings:readiness"),
      renderSmoke: (input) => inv("settings:renderSmoke", input),
    },
    queue: {
      list: () => inv("queue:list"),
      get: (queueId) => inv("queue:get", queueId),
      create: (title) => inv("queue:create", title),
      delete: (queueId) => inv("queue:delete", queueId),
      rename: (queueId, title) => inv("queue:rename", queueId, title),
      addJob: (queueId, input) => inv("queue:addJob", queueId, input),
      updateJob: (queueId, jobId, patch) => inv("queue:updateJob", queueId, jobId, patch),
      deleteJob: (queueId, jobId) => inv("queue:deleteJob", queueId, jobId),
      cancelJob: (queueId, jobId) => inv("queue:cancelJob", queueId, jobId),
      start: (queueId) => inv("queue:start", queueId),
      pause: () => inv("queue:pause"),
      resume: () => inv("queue:resume"),
      status: () => inv("queue:status"),
    },
    tts: {
      setApiKey: (provider, apiKey) => inv("tts:setApiKey", provider, apiKey),
      clearApiKey: (provider) => inv("tts:clearApiKey", provider),
      testVoice: (provider) => inv("tts:testVoice", provider),
    },
    agent: {
      preflight: () => inv("agent:preflight"),
      listSessions: () => inv("agent:listSessions"),
      openSession: (projectId) => inv("agent:openSession", projectId),
      history: (sessionId) => inv("agent:history", sessionId),
      prompt: (sessionId, text) => inv("agent:prompt", sessionId, text),
      abort: (sessionId) => inv("agent:abort", sessionId),
      proposal: (sessionId) => inv("agent:proposal", sessionId),
      applyEditProposal: (sessionId) => inv("agent:applyEditProposal", sessionId),
      forgetSession: (sessionId) => inv("agent:forgetSession", sessionId),
    },
    events: {
      onProgress: (cb) => subscribe(ipc, "events:progress", cb),
      onScene: (cb) => subscribe(ipc, "events:scene", cb),
      onStatus: (cb) => subscribe(ipc, "events:status", cb),
      onFriendlyError: (cb) => subscribe(ipc, "events:friendlyError", cb),
      onAgent: (cb) => subscribe(ipc, "events:agent", cb),
    },
  };
}
