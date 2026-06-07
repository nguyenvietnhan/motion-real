import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { aiReady } from "./model-gateway-manager.js";
import type { AiAccountState, AiProviderId, GatewayState, ModelInfo } from "../../shared/types.js";

/**
 * Feature: web-dashboard, Property 3: AI generation is gated by gateway-ready,
 * account-connected, AND a selected model. aiReady(gw, acc) is true iff the
 * gateway is ready, at least one account is connected, and a model is selected.
 * (Req 2.12, 2.13)
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
