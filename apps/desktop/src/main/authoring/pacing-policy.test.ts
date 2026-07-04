import { describe, expect, it } from "vitest";
import { computePacingBudget } from "./pacing-policy.js";

describe("computePacingBudget", () => {
  it("keeps the 90s TikTok anchor at 10-12 scenes", () => {
    const budget = computePacingBudget({ format: "tiktok", durationTier: 2, videoLanguage: "vi" });

    expect(budget.targetSeconds).toBe(90);
    expect(budget.targetWords).toBe(423);
    expect(budget.minScenes).toBe(10);
    expect(budget.targetScenes).toBe(11);
    expect(budget.maxScenes).toBe(12);
  });

  it("scales longer TikTok videos without allowing a six-scene 2m30s plan", () => {
    const budget = computePacingBudget({ format: "tiktok", durationTier: 3, videoLanguage: "vi" });

    expect(budget.targetSeconds).toBe(150);
    expect(budget.targetWords).toBe(705);
    expect(budget.minScenes).toBe(10);
    expect(budget.targetScenes).toBe(13);
    expect(budget.maxScenes).toBe(14);
    expect(budget.maxAvgWordsPerScene).toBe(75);
  });
});
