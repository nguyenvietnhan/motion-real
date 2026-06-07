import { describe, expect, it } from "vitest";
import { defaultSettings, normalizeSettings } from "./settings-model.js";

/**
 * Feature: web-dashboard, Task 10.2 — settings defaults and normalization
 * (Req 11.7, 11.8). Every L3 setting is pre-populated; normalization keeps the
 * Vivibe voice and clamps the repair budget.
 */

describe("defaultSettings", () => {
  it("pre-populates every L3 setting so the flow runs without opening Settings", () => {
    const s = defaultSettings("/home/.video-tool/out");
    expect(s.voiceProvider).toBe("vivibe");
    expect(s.outputDir).toBe("/home/.video-tool/out");
    expect(s.maxRepairAttempts).toBe(3);
    expect(s.scriptGateEnabled).toBe(true);
    expect(s.aiAccount).toEqual({ kind: "disconnected" });
  });
});

describe("normalizeSettings", () => {
  it("clamps the repair budget into [1,10] and forces Vivibe", () => {
    const base = defaultSettings("/o");
    expect(normalizeSettings(base, { maxRepairAttempts: 99 }).maxRepairAttempts).toBe(10);
    expect(normalizeSettings(base, { maxRepairAttempts: 0 }).maxRepairAttempts).toBe(1);
    // @ts-expect-error — voiceProvider is a literal; a bad patch is still forced back.
    expect(normalizeSettings(base, { voiceProvider: "mock" }).voiceProvider).toBe("vivibe");
  });

  it("prefers the live AI-account state when provided", () => {
    const base = defaultSettings("/o");
    const out = normalizeSettings(base, {}, { kind: "connected", accounts: [{ provider: "kiro", label: "me" }] });
    expect(out.aiAccount).toEqual({ kind: "connected", accounts: [{ provider: "kiro", label: "me" }] });
  });

  it("preserves unrelated fields on a partial update", () => {
    const base = { ...defaultSettings("/o"), scriptGateEnabled: false, voiceId: "v1" };
    const out = normalizeSettings(base, { maxRepairAttempts: 5 });
    expect(out.scriptGateEnabled).toBe(false);
    expect(out.voiceId).toBe("v1");
    expect(out.outputDir).toBe("/o");
  });
});
