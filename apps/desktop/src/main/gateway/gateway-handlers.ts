import type { InvokeHandlers } from "../ipc-router.js";
import type { ModelInfo } from "../../shared/types.js";

export type GatewayHandlers = Required<
  Pick<
    InvokeHandlers,
    | "ai:gatewayState"
    | "ai:listProviders"
    | "ai:connectedAccounts"
    | "ai:beginConnect"
    | "ai:listModels"
    | "ai:selectModel"
    | "ai:selectedModel"
  >
>;

export type GatewayHandlerDeps = {
  ensureReady: () => unknown;
  listProviders: () => unknown;
  refreshConnections: () => unknown;
  beginConnect: (providerId: string) => unknown;
  listModels: () => unknown;
  selectModel: (model: ModelInfo) => unknown;
  /** Gateway manager's selected model (returned by `ai:selectedModel`). */
  getSelectedFromGateway: () => ModelInfo | undefined;
};

export type CreateGatewayHandlersResult = {
  handlers: GatewayHandlers;
  /** Desktop-side selected model id for authoring (`model: () => getSelectedModelId()`). */
  getSelectedModelId: () => string | undefined;
};

/**
 * AI gateway IPC group. Owns the desktop `selectedModel` mirror used by
 * authoring; forwards connect/list/select to the gateway manager deps.
 */
export function createGatewayHandlers(deps: GatewayHandlerDeps): CreateGatewayHandlersResult {
  let selectedModel: ModelInfo | undefined;

  const handlers: GatewayHandlers = {
    "ai:gatewayState": () => deps.ensureReady(),
    "ai:listProviders": () => deps.listProviders(),
    "ai:connectedAccounts": () => deps.refreshConnections(),
    "ai:beginConnect": (providerId) => deps.beginConnect(String(providerId)),
    "ai:listModels": () => deps.listModels(),
    "ai:selectModel": (modelId) => {
      selectedModel = { id: String(modelId), label: String(modelId) };
      return deps.selectModel(selectedModel);
    },
    "ai:selectedModel": () => deps.getSelectedFromGateway(),
  };

  return {
    handlers,
    getSelectedModelId: () => selectedModel?.id,
  };
}
