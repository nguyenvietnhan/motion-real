import { describe, expect, it } from "vitest";
import {
  normalizePreferredAiModelId,
  preferredModelDecision,
  PREFERRED_AI_MODEL_ID_MAX_LEN,
} from "./model-selection.js";

describe("normalizePreferredAiModelId", () => {
  it("accepts a trimmed non-empty string within the cap", () => {
    expect(normalizePreferredAiModelId("  gpt-5.6  ")).toBe("gpt-5.6");
  });

  it("returns undefined for missing/blank/non-string values", () => {
    expect(normalizePreferredAiModelId(undefined)).toBeUndefined();
    expect(normalizePreferredAiModelId(null)).toBeUndefined();
    expect(normalizePreferredAiModelId(42)).toBeUndefined();
    expect(normalizePreferredAiModelId("")).toBeUndefined();
    expect(normalizePreferredAiModelId("   ")).toBeUndefined();
  });

  it("rejects overlong values instead of persisting arbitrary IPC input", () => {
    expect(normalizePreferredAiModelId("x".repeat(PREFERRED_AI_MODEL_ID_MAX_LEN + 1))).toBeUndefined();
    expect(normalizePreferredAiModelId("x".repeat(PREFERRED_AI_MODEL_ID_MAX_LEN))).toBe(
      "x".repeat(PREFERRED_AI_MODEL_ID_MAX_LEN),
    );
  });
});

describe("preferredModelDecision", () => {
  it("waits when no models are available", () => {
    expect(
      preferredModelDecision({
        preferredModelId: "gpt-5.6",
        availableModelIds: [],
      }),
    ).toEqual({ kind: "wait" });
  });

  it("first use chooses and persists the first available model", () => {
    expect(
      preferredModelDecision({
        availableModelIds: ["a", "b"],
      }),
    ).toEqual({ kind: "select-and-persist", modelId: "a" });
  });

  it("persists an existing runtime selection when no preference is saved", () => {
    expect(
      preferredModelDecision({
        runtimeModelId: "b",
        availableModelIds: ["a", "b"],
      }),
    ).toEqual({ kind: "select-and-persist", modelId: "b" });
  });

  it("a saved model wins even when the list is reordered", () => {
    expect(
      preferredModelDecision({
        preferredModelId: "gpt-5.6",
        runtimeModelId: "other",
        availableModelIds: ["other", "gpt-5.6", "first"],
      }),
    ).toEqual({ kind: "select-runtime", modelId: "gpt-5.6" });
  });

  it("a saved missing model returns unavailable and never selects index zero", () => {
    expect(
      preferredModelDecision({
        preferredModelId: "gpt-5.6",
        availableModelIds: ["other", "first"],
      }),
    ).toEqual({ kind: "unavailable", modelId: "gpt-5.6" });
  });

  it("an already matching runtime selection causes no duplicate selection", () => {
    expect(
      preferredModelDecision({
        preferredModelId: "gpt-5.6",
        runtimeModelId: "gpt-5.6",
        availableModelIds: ["gpt-5.6", "other"],
      }),
    ).toEqual({ kind: "wait" });
  });

  it("manual replacement is just another select-and-persist path when preference is cleared", () => {
    // When the user already has a preference that matches, wait; replacement is
    // driven by explicit settings.update after selectModel in the UI.
    expect(
      preferredModelDecision({
        preferredModelId: "replacement",
        runtimeModelId: "replacement",
        availableModelIds: ["replacement", "old"],
      }),
    ).toEqual({ kind: "wait" });
  });
});
