import { describe, expect, it } from "vitest";
import { defaultSettings } from "./settings-model.js";

/**
 * Feature: web-dashboard, Task 10.2 — settings defaults (Req 11.7, 11.8). Every
 * L3 setting is pre-populated so the flow runs without opening Settings.
 *
 * NOTE (reconcile-main-controllers S2): the `normalizeSettings` tests were
 * removed with the function (it was off the production path; merge/persist is
 * now covered by SettingsStore property tests P2–P6).
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
