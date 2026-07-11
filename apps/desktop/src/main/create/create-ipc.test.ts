import { describe, expect, it } from "vitest";
import { createControllerArgsFromIpc, parseVoiceProvider } from "./create-ipc.js";

describe("parseVoiceProvider", () => {
  it("passes through supported voice providers", () => {
    expect(parseVoiceProvider("vivibe")).toBe("vivibe");
    expect(parseVoiceProvider("elevenlabs")).toBe("elevenlabs");
  });

  it("throws a Vietnamese message for unsupported providers", () => {
    expect(() => parseVoiceProvider("openai")).toThrow("Nhà cung cấp giọng đọc không hợp lệ.");
  });
});

describe("createControllerArgsFromIpc", () => {
  it("preserves raw text, duration tier, language, voice provider, and images", () => {
    expect(
      createControllerArgsFromIpc({
        raw: "chủ đề",
        durationTier: 2,
        videoLanguage: "en",
        voiceProvider: "elevenlabs",
        images: [{ ref: "staging/aa.png", width: 800, height: 600 }],
      }),
    ).toEqual({
      raw: "chủ đề",
      images: [{ ref: "staging/aa.png", width: 800, height: 600 }],
      choices: {
        durationTier: 2,
        videoLanguage: "en",
        voiceProvider: "elevenlabs",
      },
    });
  });

  it("accepts duration tier 1 (truthy edge)", () => {
    expect(createControllerArgsFromIpc({ raw: "x", durationTier: 1 }).choices.durationTier).toBe(1);
  });

  it("accepts duration tier 4 (3:30)", () => {
    expect(createControllerArgsFromIpc({ raw: "x", durationTier: 4 }).choices.durationTier).toBe(4);
    expect(createControllerArgsFromIpc({ raw: "x", durationTier: "4" }).choices.durationTier).toBe(4);
  });

  it("ignores invalid duration tiers", () => {
    expect(createControllerArgsFromIpc({ raw: "x", durationTier: 9 }).choices.durationTier).toBeUndefined();
  });

  it("defaults missing images to an empty array", () => {
    expect(createControllerArgsFromIpc({ raw: "chủ đề" })).toEqual({
      raw: "chủ đề",
      images: [],
      choices: {},
    });
  });

  it("throws through invalid non-empty voice providers during payload conversion", () => {
    expect(() => createControllerArgsFromIpc({ raw: "chủ đề", voiceProvider: "bad-provider" })).toThrow(
      "Nhà cung cấp giọng đọc không hợp lệ.",
    );
  });
});
