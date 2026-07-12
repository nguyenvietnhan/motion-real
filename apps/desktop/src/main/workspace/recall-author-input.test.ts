import { describe, expect, it } from "vitest";
import type { ProjectBrief } from "@motionreal/pipeline";
import { authorInputFromBrief } from "./recall-author-input.js";

function brief(overrides: Partial<ProjectBrief> = {}): ProjectBrief {
  return {
    projectId: "p1",
    prompt: "Giải thích Random Forest https://a.example/source",
    duration: 60,
    ratio: "9:16",
    language: "vi",
    aiProvider: "mock",
    tts: { provider: "none", speed: 1 },
    state: "scaffolded",
    currentStep: "scaffolded",
    error: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("authorInputFromBrief", () => {
  it("rehydrates persisted delivery choices for retry after restart", () => {
    expect(authorInputFromBrief(brief({ format: "tiktok", durationTier: 3, language: "vi" }))).toEqual({
      text: "Giải thích Random Forest https://a.example/source",
      urls: ["https://a.example/source"],
      format: "tiktok",
      durationTier: 3,
      videoLanguage: "vi",
    });
  });

  it("rehydrates durationTier 4 (3:30 knobs)", () => {
    expect(authorInputFromBrief(brief({ durationTier: 4 }))).toMatchObject({
      durationTier: 4,
      format: "tiktok",
    });
  });

  it("always rehydrates short-form tiktok format", () => {
    expect(authorInputFromBrief(brief({ language: "en" }))).toMatchObject({
      format: "tiktok",
      durationTier: 1,
      videoLanguage: "en",
    });
  });

  it("returns null for an empty prompt", () => {
    expect(authorInputFromBrief(brief({ prompt: "   " }))).toBeNull();
  });
});
