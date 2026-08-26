import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { aiReady, ModelGatewayManager, type GatewayDeps } from "./model-gateway-manager.js";
import type { AiAccountState, AiProviderId, GatewayState, ModelInfo } from "../../shared/types.js";

/**
 * Property 3: AI generation is gated by gateway-ready,
 * account-connected, AND a selected model. aiReady(gw, acc) is true iff the
 * gateway is ready, at least one account is connected, and a model is selected.
 *
 */

const providerArb = fc.constantFrom<AiProviderId>("kiro", "codex", "gemini", "antigravity", "openrouter");
const modelArb: fc.Arbitrary<ModelInfo> = fc
  .tuple(providerArb, fc.string({ minLength: 1, maxLength: 12 }))
  .map(([p, m]) => ({ id: `${p}/${m}`, label: m }));

const gatewayArb: fc.Arbitrary<GatewayState> = fc.oneof(
  fc.integer({ min: 1, max: 3 }).map<GatewayState>((attempt) => ({ kind: "starting", attempt })),
  fc.constant<GatewayState>({ kind: "ready", baseUrl: "http://localhost:20128/v1" }),
  fc.constant<GatewayState>({ kind: "unavailable" }),
);

const accountArb: fc.Arbitrary<AiAccountState> = fc.oneof(
  fc.constant<AiAccountState>({ kind: "disconnected" }),
  providerArb.map<AiAccountState>((provider) => ({ kind: "connecting", provider })),
  fc
    .tuple(
      fc.array(providerArb.map((p) => ({ provider: p, label: p })), { minLength: 0, maxLength: 3 }),
      fc.option(modelArb, { nil: undefined }),
    )
    .map<AiAccountState>(([accounts, selectedModel]) => ({ kind: "connected", accounts, selectedModel })),
);

describe("Property 3: AI generation gate", () => {
  it("aiReady ⇔ gateway ready AND ≥1 connected account AND a selected model", () => {
    fc.assert(
      fc.property(gatewayArb, accountArb, (gw, acc) => {
        const expected =
          gw.kind === "ready" &&
          acc.kind === "connected" &&
          acc.accounts.length > 0 &&
          acc.selectedModel !== undefined;
        expect(aiReady(gw, acc)).toBe(expected);
      }),
      { numRuns: 300 },
    );
  });
});

describe("gateway self-heal (ensureReady)", () => {
  const baseGwDeps = (launch: () => Promise<boolean>): GatewayDeps => ({
    launch,
    listProviders: async () => [],
    beginConnect: async () => ({ loginSurface: "external-browser" }),
    pollConnections: async () => [],
    listModels: async () => [],
    maxStartAttempts: 1,
  });
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("recovers to ready on a later poll after an initial failed start (no app restart)", async () => {
    let up = false;
    const launch = vi.fn(async () => up);
    const mgr = new ModelGatewayManager(baseGwDeps(launch));

    expect(await mgr.start()).toEqual({ kind: "unavailable" }); // 9router down at launch
    expect(mgr.ensureReady().kind).toBe("starting"); // kicks a background restart (transitions synchronously)
    await tick();
    expect(mgr.state().kind).toBe("unavailable"); // still down → stays recoverable

    up = true; // 9router comes up later
    expect(mgr.ensureReady().kind).toBe("starting"); // next poll kicks another start
    await tick();
    expect(mgr.state()).toEqual({ kind: "ready", baseUrl: "http://localhost:20128/v1" });
  });

  it("does not start concurrently while one start is already in flight", async () => {
    let resolveLaunch: ((v: boolean) => void) | undefined;
    const launch = vi.fn(() => new Promise<boolean>((r) => { resolveLaunch = r; }));
    const mgr = new ModelGatewayManager(baseGwDeps(launch));
    void mgr.start();
    mgr.ensureReady();
    mgr.ensureReady();
    await tick();
    expect(launch).toHaveBeenCalledTimes(1); // deduped
    resolveLaunch?.(true);
  });

  it("downgrades a previously-ready gateway when the health check fails", async () => {
    let up = true;
    const mgr = new ModelGatewayManager(baseGwDeps(async () => up));
    expect((await mgr.start()).kind).toBe("ready");
    up = false;
    expect(await mgr.refreshHealth()).toEqual({ kind: "unavailable" });
    expect(mgr.account()).toEqual({ kind: "disconnected" });
  });
});
