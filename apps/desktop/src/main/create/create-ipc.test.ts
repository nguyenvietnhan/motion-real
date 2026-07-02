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
  it("preserves raw text, format, tier, language, voice provider, and images", () => {
    expect(
      createControllerArgsFromIpc({
        raw: "chủ đề",
        format: "youtube",
        durationTier: 2,
        videoLanguage: "en",
        voiceProvider: "elevenlabs",
        images: [{ ref: "staging/aa.png", width: 800, height: 600 }],
      }),
    ).toEqual({
      raw: "chủ đề",
      images: [{ ref: "staging/aa.png", width: 800, height: 600 }],
      choices: {
        format: "youtube",
        durationTier: 2,
        videoLanguage: "en",
        voiceProvider: "elevenlabs",
      },
    });
  });

  it("defaults missing images to an empty array", () => {
    expect(createControllerArgsFromIpc({ raw: "chủ đề" })).toEqual({
      raw: "chủ đề",
      images: [],
      choices: {},
    });
  });

  it("passes legacy titleLanguage only when videoLanguage is absent", () => {
    expect(createControllerArgsFromIpc({ raw: "legacy", titleLanguage: "mix" }).choices).toEqual({
      titleLanguage: "mix",
    });

    expect(createControllerArgsFromIpc({ raw: "modern", videoLanguage: "en", titleLanguage: "mix" }).choices).toEqual({
      videoLanguage: "en",
    });
  });

  it("throws through invalid non-empty voice providers during payload conversion", () => {
    expect(() => createControllerArgsFromIpc({ raw: "chủ đề", voiceProvider: "bad-provider" })).toThrow(
      "Nhà cung cấp giọng đọc không hợp lệ.",
    );
  });
});
