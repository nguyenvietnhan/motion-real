import { describe, expect, it } from "vitest";
import { createControllerArgsFromIpc, normalizeStagedImages, parseVoiceProvider } from "./create-ipc.js";

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
  it("preserves raw text, duration tier, language, voice provider, bgm, and images", () => {
    expect(
      createControllerArgsFromIpc({
        raw: "chủ đề",
        durationTier: 2,
        videoLanguage: "en",
        voiceProvider: "elevenlabs",
        bgm: "theme.mp3",
        images: [{ ref: "staging/aa.png", width: 800, height: 600 }],
      }),
    ).toEqual({
      raw: "chủ đề",
      images: [{ ref: "staging/aa.png", width: 800, height: 600 }],
      choices: {
        durationTier: 2,
        videoLanguage: "en",
        voiceProvider: "elevenlabs",
        bgm: "theme.mp3",
      },
    });
  });

  it("accepts explicit no-music bgm (null)", () => {
    expect(createControllerArgsFromIpc({ raw: "x", bgm: null }).choices.bgm).toBeNull();
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

  it("rejects null and non-object payloads with a Vietnamese boundary error", () => {
    expect(() => createControllerArgsFromIpc(null)).toThrow("Dữ liệu tạo video không hợp lệ.");
    expect(() => createControllerArgsFromIpc("prompt")).toThrow("Dữ liệu tạo video không hợp lệ.");
    expect(() => createControllerArgsFromIpc({ raw: 42 })).toThrow("Nội dung tạo video không hợp lệ.");
  });

  it("drops traversal, nested paths, and invalid image dimensions", () => {
    expect(
      normalizeStagedImages([
        { ref: "staging/good.png", width: 640, height: 480 },
        { ref: "staging/../secret.png", width: 1, height: 1 },
        { ref: "staging/nested/file.png", width: 1, height: 1 },
        { ref: "outside.png", width: 1, height: 1 },
        { ref: "staging/zero.png", width: 0, height: 20 },
        { ref: "staging/nan.png", width: Number.NaN, height: 20 },
      ]),
    ).toEqual([{ ref: "staging/good.png", width: 640, height: 480 }]);
  });
});
