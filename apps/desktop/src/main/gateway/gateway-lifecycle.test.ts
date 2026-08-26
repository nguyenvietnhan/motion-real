import { describe, expect, it, vi } from "vitest";
import { ModelGatewayManager, GATEWAY_BASE_URL, type GatewayDeps } from "./model-gateway-manager.js";
import type { ConnectedAccount, ModelInfo, ProviderInfo } from "../../shared/types.js";

/**
 * gateway start retry + dynamic provider /
 * connect / model lifecycle, with stubbed
 * 9router effects.
 */

const PROVIDERS: ProviderInfo[] = [
  { id: "kiro", name: "Kiro AI", loginType: "device", connectedCount: 1 },
  { id: "codex", name: "OpenAI Codex", loginType: "browser", connectedCount: 0 },
  { id: "openrouter", name: "OpenRouter", loginType: "api-key", connectedCount: 0 },
];
const MODELS: ModelInfo[] = [
  { id: "kr/claude-sonnet-4.5", label: "claude-sonnet-4.5" },
  { id: "cx/gpt-5.2-codex", label: "gpt-5.2-codex" },
];

function deps(over: Partial<GatewayDeps> = {}): GatewayDeps {
  return {
    launch: async () => true,
    listProviders: async () => PROVIDERS,
    beginConnect: async () => ({ loginSurface: "external-browser" }),
    pollConnections: async () => [],
    listModels: async () => MODELS,
    ...over,
  };
}

describe("ModelGatewayManager.start", () => {
  it("becomes ready on first launch and wires the local key internally", async () => {
    const wireKey = vi.fn();
    const mgr = new ModelGatewayManager(deps({ wireKey, generateKey: () => "secret-key" }));
    const state = await mgr.start();
    expect(state).toEqual({ kind: "ready", baseUrl: GATEWAY_BASE_URL });
    expect(wireKey).toHaveBeenCalledWith("secret-key");
    expect(JSON.stringify(mgr.state())).not.toContain("secret-key");
  });

  it("retains only the gateway-issued key for trusted local runtimes", async () => {
    const mgr = new ModelGatewayManager(deps({ generateKey: () => "request-name", wireKey: async () => "issued-key" }));
    await mgr.start();
    expect(mgr.localGatewayApiKey()).toBe("issued-key");
    expect(JSON.stringify(mgr.state())).not.toContain("issued-key");
  });

  it("retries up to 3 attempts then surfaces unavailable", async () => {
    const launch = vi.fn(async () => false);
    const mgr = new ModelGatewayManager(deps({ launch }));
    expect(await mgr.start()).toEqual({ kind: "unavailable" });
    expect(launch).toHaveBeenCalledTimes(3);
  });
});

describe("ModelGatewayManager — dynamic providers + connect + model", () => {
  it("discovers providers and lists models from the gateway", async () => {
    const mgr = new ModelGatewayManager(deps());
    expect(await mgr.listProviders()).toEqual(PROVIDERS);
    expect(await mgr.listModels()).toEqual(MODELS);
  });

  it("delegates connect to the gateway UI and reports the login surface", async () => {
    const beginConnect = vi.fn(async (id: string) =>
      id === "codex" ? { loginSurface: "external-browser" as const } : { loginSurface: "in-app" as const },
    );
    const mgr = new ModelGatewayManager(deps({ beginConnect }));
    expect(await mgr.beginConnect("codex")).toEqual({ loginSurface: "external-browser" });
    expect(await mgr.beginConnect("openrouter")).toEqual({ loginSurface: "in-app" });
  });

  it("is not AI-ready until a connection is polled AND a model is selected", async () => {
    let connections: ConnectedAccount[] = [];
    const mgr = new ModelGatewayManager(deps({ pollConnections: async () => connections }));
    await mgr.start();
    expect(mgr.aiReady()).toBe(false); // no connection, no model

    connections = [{ provider: "kiro", label: "me@kiro" }];
    const acc = await mgr.refreshConnections();
    expect(acc.kind).toBe("connected");
    expect(mgr.aiReady()).toBe(false); // connected but no model yet

    mgr.selectModel(MODELS[0]!);
    expect(mgr.selectedModel()).toEqual(MODELS[0]);
    expect(mgr.aiReady()).toBe(true);
  });

  it("supports multiple simultaneous connections", async () => {
    const mgr = new ModelGatewayManager(
      deps({ pollConnections: async () => [
        { provider: "kiro", label: "a" },
        { provider: "codex", label: "b" },
      ] }),
    );
    await mgr.start();
    const acc = await mgr.refreshConnections();
    expect(acc.kind === "connected" && acc.accounts.length).toBe(2);
  });
});
