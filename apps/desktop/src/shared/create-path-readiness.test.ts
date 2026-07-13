import { describe, expect, it } from "vitest";
import type { AiAccountState, GatewayState } from "./types.js";
import {
  createPathReadiness,
  voicePresenceFromSettings,
  type CreatePathVoicePresence,
} from "./create-path-readiness.js";

const gwReady: GatewayState = { kind: "ready", baseUrl: "http://127.0.0.1:20128" };
const gwStarting: GatewayState = { kind: "starting", attempt: 1 };
const gwDown: GatewayState = { kind: "unavailable" };

const accConnected: AiAccountState = {
  kind: "connected",
  accounts: [{ provider: "kiro", label: "me" }],
  selectedModel: { id: "gpt", label: "GPT" },
};
const accNoModel: AiAccountState = {
  kind: "connected",
  accounts: [{ provider: "kiro", label: "me" }],
};
const accDisconnected: AiAccountState = { kind: "disconnected" };

const voiceOk: CreatePathVoicePresence = { hasApiKey: true, hasVoiceId: true };
const voiceNoKey: CreatePathVoicePresence = { hasApiKey: false, hasVoiceId: false };
const voiceNoId: CreatePathVoicePresence = { hasApiKey: true, hasVoiceId: false };

describe("createPathReadiness", () => {
  it("is ok only when AI ready and voice ready", () => {
    const r = createPathReadiness({ gateway: gwReady, account: accConnected, voice: voiceOk });
    expect(r.ok).toBe(true);
    expect(r.steps.every((s) => s.ok)).toBe(true);
  });

  it("blocks AI step when gateway is starting / unavailable / no account", () => {
    expect(createPathReadiness({ gateway: gwStarting, account: accDisconnected, voice: voiceOk }).steps[0]?.ok).toBe(
      false,
    );
    expect(createPathReadiness({ gateway: gwDown, account: accDisconnected, voice: voiceOk }).steps[0]?.ok).toBe(false);
    expect(createPathReadiness({ gateway: gwReady, account: accDisconnected, voice: voiceOk }).steps[0]?.ok).toBe(
      false,
    );
  });

  it("blocks model step when connected but no model", () => {
    const r = createPathReadiness({ gateway: gwReady, account: accNoModel, voice: voiceOk });
    expect(r.ok).toBe(false);
    expect(r.steps.find((s) => s.id === "ai")?.ok).toBe(true);
    expect(r.steps.find((s) => s.id === "model")?.ok).toBe(false);
    expect(r.steps.find((s) => s.id === "model")?.hint).toMatch(/model/i);
  });

  it("blocks voice step when key or voice id missing", () => {
    const noKey = createPathReadiness({ gateway: gwReady, account: accConnected, voice: voiceNoKey });
    expect(noKey.ok).toBe(false);
    expect(noKey.steps.find((s) => s.id === "voice")?.ok).toBe(false);
    expect(noKey.steps.find((s) => s.id === "voice")?.hint).toMatch(/API key/i);

    const noId = createPathReadiness({ gateway: gwReady, account: accConnected, voice: voiceNoId });
    expect(noId.steps.find((s) => s.id === "voice")?.hint).toMatch(/voice id/i);
  });

  it("returns exactly three ordered steps", () => {
    const r = createPathReadiness({ gateway: gwReady, account: accConnected, voice: voiceOk });
    expect(r.steps.map((s) => s.id)).toEqual(["ai", "model", "voice"]);
  });
});

describe("voicePresenceFromSettings", () => {
  it("treats saved credentials + ui voice id as ready", () => {
    expect(
      voicePresenceFromSettings({
        voiceProvider: "vivibe",
        voiceCredentials: { vivibe: "saved", elevenlabs: "missing" },
        vivibeVoiceId: "v1",
      }),
    ).toEqual({ hasApiKey: true, hasVoiceId: true });
  });

  it("missing credential blocks key", () => {
    expect(
      voicePresenceFromSettings({
        voiceProvider: "vivibe",
        voiceCredentials: { vivibe: "missing", elevenlabs: "missing" },
      }).hasApiKey,
    ).toBe(false);
  });

  it("environment credential counts as voice id when UI field empty", () => {
    expect(
      voicePresenceFromSettings({
        voiceProvider: "elevenlabs",
        voiceCredentials: { vivibe: "missing", elevenlabs: "environment" },
      }),
    ).toEqual({ hasApiKey: true, hasVoiceId: true });
  });
});
