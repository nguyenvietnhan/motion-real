import { describe, expect, it, vi } from "vitest";
import type { ModelInfo } from "../../shared/types.js";
import { createGatewayHandlers } from "./gateway-handlers.js";

describe("gateway IPC handlers", () => {
  it("forwards list/connect/state channels and string-coerces beginConnect", async () => {
    const ensureReady = vi.fn(() => ({ kind: "ready" }));
    const listProviders = vi.fn(async () => [{ id: "p1" }]);
    const refreshConnections = vi.fn(async () => [{ id: "a1" }]);
    const beginConnect = vi.fn(async (id: string) => ({ loginSurface: "external-browser", id }));
    const listModels = vi.fn(async () => [{ id: "m1", label: "M1" }]);
    const selectModel = vi.fn((model: ModelInfo) => ({ kind: "connected", selectedModel: model }));
    const getSelectedFromGateway = vi.fn((): ModelInfo | undefined => undefined);

    const { handlers, getSelectedModelId } = createGatewayHandlers({
      ensureReady,
      listProviders,
      refreshConnections,
      beginConnect,
      listModels,
      selectModel,
      getSelectedFromGateway,
    });

    expect(getSelectedModelId()).toBeUndefined();
    expect(handlers["ai:gatewayState"]()).toEqual({ kind: "ready" });
    await expect(handlers["ai:listProviders"]()).resolves.toEqual([{ id: "p1" }]);
    await expect(handlers["ai:connectedAccounts"]()).resolves.toEqual([{ id: "a1" }]);
    await expect(handlers["ai:listModels"]()).resolves.toEqual([{ id: "m1", label: "M1" }]);

    await handlers["ai:beginConnect"](42);
    expect(beginConnect).toHaveBeenCalledWith("42");
  });

  it("selectModel stores desktop selected id and calls deps with { id, label }", () => {
    const selectModel = vi.fn((model: ModelInfo) => model);
    const gatewaySelected: ModelInfo = { id: "gw", label: "Gateway copy" };
    const { handlers, getSelectedModelId } = createGatewayHandlers({
      ensureReady: vi.fn(),
      listProviders: vi.fn(),
      refreshConnections: vi.fn(),
      beginConnect: vi.fn(),
      listModels: vi.fn(),
      selectModel,
      getSelectedFromGateway: () => gatewaySelected,
    });

    expect(handlers["ai:selectModel"]("kr/claude")).toEqual({
      id: "kr/claude",
      label: "kr/claude",
    });
    expect(selectModel).toHaveBeenCalledWith({ id: "kr/claude", label: "kr/claude" });
    expect(getSelectedModelId()).toBe("kr/claude");
    expect(handlers["ai:selectedModel"]()).toEqual(gatewaySelected);
  });

  it("coerces non-string modelId on selectModel", () => {
    const selectModel = vi.fn((model: ModelInfo) => model);
    const { handlers, getSelectedModelId } = createGatewayHandlers({
      ensureReady: vi.fn(),
      listProviders: vi.fn(),
      refreshConnections: vi.fn(),
      beginConnect: vi.fn(),
      listModels: vi.fn(),
      selectModel,
      getSelectedFromGateway: () => undefined,
    });

    handlers["ai:selectModel"](99);
    expect(selectModel).toHaveBeenCalledWith({ id: "99", label: "99" });
    expect(getSelectedModelId()).toBe("99");
  });
});
