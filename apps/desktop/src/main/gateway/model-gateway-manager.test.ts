import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { aiReady } from "./model-gateway-manager.js";
import type { AiAccountState, AiProviderId, GatewayState } from "../../shared/types.js";

/**
 * Feature: web-dashboard, Property 3: AI generation is gated by gateway-ready
 * and account-connected. aiReady(gw, acc) is true iff the gateway is ready AND
 * an account is connected. (Req 2.4, 2.9)
 */

const providerArb = fc.constantFrom<AiProviderId>("kiro", "codex", "gemini");

const gatewayArb: fc.Arbitrary<GatewayState> = fc.oneof(
  fc.integer({ min: 1, max: 3 }).map<GatewayState>((attempt) => ({ kind: "starting", attempt })),
  fc.constant<GatewayState>({ kind: "ready", baseUrl: "http://localhost:20128/v1" }),
  fc.constant<GatewayState>({ kind: "unavailable" }),
);

const accountArb: fc.Arbitrary<AiAccountState> = fc.oneof(
  fc.constant<AiAccountState>({ kind: "disconnected" }),
  providerArb.map<AiAccountState>((provider) => ({ kind: "connecting", provider })),
  fc
    .tuple(providerArb, fc.string())
    .map<AiAccountState>(([provider, label]) => ({ kind: "connected", provider, label })),
);

describe("Property 3: AI generation gate", () => {
  it("aiReady ⇔ gateway ready AND account connected", () => {
    fc.assert(
      fc.property(gatewayArb, accountArb, (gw, acc) => {
        expect(aiReady(gw, acc)).toBe(gw.kind === "ready" && acc.kind === "connected");
      }),
      { numRuns: 300 },
    );
  });
});
