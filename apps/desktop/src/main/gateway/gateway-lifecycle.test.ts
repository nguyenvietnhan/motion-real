import { describe, expect, it, vi } from "vitest";
import { ModelGatewayManager, GATEWAY_BASE_URL, type GatewayDeps } from "./model-gateway-manager.js";

/**
 * Feature: web-dashboard, Task 6.5 — gateway start retry + OAuth connect
 * lifecycle (Req 2.2, 2.8), with stubbed child-process + OAuth.
 */

function deps(over: Partial<GatewayDeps> = {}): GatewayDeps {
  return {
    launch: async () => true,
    oauth: async () => ({ ok: true, label: "me@kiro" }),
    ...over,
  };
}

describe("ModelGatewayManager.start", () => {
  it("becomes ready on first successful launch and wires the local key internally", async () => {
    const wireKey = vi.fn();
    const mgr = new ModelGatewayManager(deps({ wireKey, generateKey: () => "secret-key" }));
    const state = await mgr.start();
    expect(state).toEqual({ kind: "ready", baseUrl: GATEWAY_BASE_URL });
    expect(wireKey).toHaveBeenCalledWith("secret-key");
    // The key is never exposed on the manager surface.
    expect(JSON.stringify(mgr.state())).not.toContain("secret-key");
  });

  it("retries up to 3 attempts then surfaces unavailable", async () => {
    const launch = vi.fn(async () => false);
    const mgr = new ModelGatewayManager(deps({ launch }));
    const state = await mgr.start();
    expect(state).toEqual({ kind: "unavailable" });
    expect(launch).toHaveBeenCalledTimes(3);
  });

  it("recovers if a later attempt succeeds", async () => {
    let n = 0;
    const mgr = new ModelGatewayManager(
      deps({
        launch: async () => {
          n++;
          return n === 3;
        },
      }),
    );
    expect((await mgr.start()).kind).toBe("ready");
    expect(n).toBe(3);
  });
});

describe("ModelGatewayManager.connectAccount", () => {
  it("records a connected account on success and enables AI", async () => {
    const mgr = new ModelGatewayManager(deps());
    await mgr.start();
    const acc = await mgr.connectAccount("kiro");
    expect(acc).toEqual({ kind: "connected", provider: "kiro", label: "me@kiro" });
    expect(mgr.aiReady()).toBe(true);
  });

  it("retains a previously connected account when a later connect is cancelled", async () => {
    let attempt = 0;
    const mgr = new ModelGatewayManager(
      deps({
        oauth: async () => {
          attempt++;
          return attempt === 1 ? { ok: true, label: "first" } : { ok: false };
        },
      }),
    );
    await mgr.connectAccount("kiro");
    const after = await mgr.connectAccount("codex"); // fails → retain prior
    expect(after).toEqual({ kind: "connected", provider: "kiro", label: "first" });
  });

  it("treats an OAuth timeout as not-connected and stays disconnected with no prior account", async () => {
    const mgr = new ModelGatewayManager(
      deps({
        oauth: (_p, signal) =>
          new Promise((_res, rej) => signal.addEventListener("abort", () => rej(new Error("timeout")))),
        connectTimeoutMs: 10,
      }),
    );
    const acc = await mgr.connectAccount("gemini");
    expect(acc).toEqual({ kind: "disconnected" });
  });
});
