import { describe, expect, it } from "vitest";
import {
  defaultSettings,
  clampMaxRepairAttempts,
  clampWordsPerSecond,
  computeWordsPerSecond,
  DEFAULT_MAX_REPAIR_ATTEMPTS,
  DEFAULT_REVIEW_MODE,
  MIN_REPAIR_ATTEMPTS,
  MAX_REPAIR_ATTEMPTS,
  DEFAULT_WORDS_PER_SECOND,
  MIN_WORDS_PER_SECOND,
  MAX_WORDS_PER_SECOND,
  normalizeReviewMode,
  reviewModeAllowsSceneEdit,
  reviewModeNeedsDraftMp4,
  reviewModeRequiresForceFull,
} from "./settings-model.js";

/**
 * settings defaults. Every
 * L3 setting is pre-populated so the flow runs without opening Settings.
 *
 * the `normalizeSettings` tests were
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
    expect(s.reviewMode).toBe(DEFAULT_REVIEW_MODE);
    expect(s.aiAccount).toEqual({ kind: "disconnected" });
    // First-use: no preferred model until the gateway list + decision helper pick one.
    expect(s.preferredAiModelId).toBeUndefined();
  });
});

describe("reviewMode helpers", () => {
  it("normalizes unknown/missing values to full", () => {
    expect(normalizeReviewMode(undefined)).toBe("full");
    expect(normalizeReviewMode("nope")).toBe("full");
    expect(normalizeReviewMode("stills_edit")).toBe("stills_edit");
    expect(normalizeReviewMode("skip_edit")).toBe("skip_edit");
  });

  it("maps edit and draft needs for each mode", () => {
    expect(reviewModeAllowsSceneEdit("full")).toBe(true);
    expect(reviewModeAllowsSceneEdit("stills_edit")).toBe(true);
    expect(reviewModeAllowsSceneEdit("skip_edit")).toBe(false);
    expect(reviewModeNeedsDraftMp4("full")).toBe(true);
    expect(reviewModeNeedsDraftMp4("stills_edit")).toBe(false);
    expect(reviewModeNeedsDraftMp4("skip_edit")).toBe(false);
    expect(reviewModeRequiresForceFull("full")).toBe(false);
    expect(reviewModeRequiresForceFull("stills_edit")).toBe(true);
    expect(reviewModeRequiresForceFull("skip_edit")).toBe(true);
  });
});

describe("clampMaxRepairAttempts", () => {
  it("keeps the settings-visible repair budget in the engine's effective range", () => {
    expect(clampMaxRepairAttempts(0)).toBe(MIN_REPAIR_ATTEMPTS);
    expect(clampMaxRepairAttempts(99)).toBe(MAX_REPAIR_ATTEMPTS);
    expect(clampMaxRepairAttempts(4.9)).toBe(4);
  });

  it("falls back to the default for a non-finite budget", () => {
    expect(clampMaxRepairAttempts(NaN)).toBe(DEFAULT_MAX_REPAIR_ATTEMPTS);
    expect(clampMaxRepairAttempts(Infinity)).toBe(DEFAULT_MAX_REPAIR_ATTEMPTS);
  });
});

/**
 * Vivibe read-rate calibration math. The author
 * prompt turns a duration target into a word budget at this rate; a bad rate
 * makes a "90s" request render short. These cover the PURE helpers the
 * calibration script + the settings store rely on (the live Vivibe measurement
 * is a manual script, not a unit test).
 */
describe("clampWordsPerSecond", () => {
  it("keeps an in-band rate unchanged", () => {
    expect(clampWordsPerSecond(4.7)).toBe(4.7);
    expect(clampWordsPerSecond(3.2)).toBe(3.2);
  });

  it("clamps an out-of-band rate to the sane [min,max] (a bad measurement can't poison the budget)", () => {
    expect(clampWordsPerSecond(0.1)).toBe(MIN_WORDS_PER_SECOND);
    expect(clampWordsPerSecond(99)).toBe(MAX_WORDS_PER_SECOND);
  });

  it("falls back to the measured default for a non-finite value", () => {
    expect(clampWordsPerSecond(NaN)).toBe(DEFAULT_WORDS_PER_SECOND);
    expect(clampWordsPerSecond(Infinity)).toBe(DEFAULT_WORDS_PER_SECOND);
  });
});

describe("computeWordsPerSecond", () => {
  it("uses a TOTAL-weighted average (Σ words / Σ seconds), not a mean of ratios", () => {
    // 10 words / 5s = 2 w/s and 90 words / 15s = 6 w/s. A mean-of-ratios would be
    // 4.0; the total-weighted average is 100/20 = 5.0 (the long sample counts more).
    const ten = Array.from({ length: 10 }, (_, i) => `t${i}`).join(" ");
    const ninety = Array.from({ length: 90 }, (_, i) => `w${i}`).join(" ");
    expect(computeWordsPerSecond([{ text: ten, seconds: 5 }, { text: ninety, seconds: 15 }])).toBe(5);
  });

  it("skips samples with a non-positive/non-finite duration or zero words", () => {
    const five = Array.from({ length: 5 }, (_, i) => `w${i}`).join(" ");
    // Only the valid sample (5 words / 2s = 2.5) counts; the rest are skipped.
    const rate = computeWordsPerSecond([
      { text: five, seconds: 2 },
      { text: "bỏ qua", seconds: 0 },
      { text: "bỏ qua", seconds: -3 },
      { text: "bỏ qua", seconds: NaN },
      { text: "   ", seconds: 4 },
    ]);
    expect(rate).toBe(2.5);
  });

  it("returns undefined when no sample is usable (caller keeps the existing/default rate)", () => {
    expect(computeWordsPerSecond([])).toBeUndefined();
    expect(computeWordsPerSecond([{ text: "x", seconds: 0 }])).toBeUndefined();
  });

  it("clamps the computed rate into the sane band", () => {
    // 100 words in 1s ⇒ 100 w/s raw, clamped down to the max.
    const hundred = Array.from({ length: 100 }, (_, i) => `w${i}`).join(" ");
    expect(computeWordsPerSecond([{ text: hundred, seconds: 1 }])).toBe(MAX_WORDS_PER_SECOND);
  });
});
