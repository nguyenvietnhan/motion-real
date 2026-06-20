import { describe, expect, it } from "vitest";
import { applyVideoLanguageSelection, applyVoiceProviderSelection, VIDEO_LANGUAGE_OPTIONS } from "./home.js";

describe("create-screen language/provider coupling", () => {
  it("selecting English switches the provider to ElevenLabs", () => {
    expect(applyVideoLanguageSelection("en", "vivibe")).toEqual({
      videoLanguage: "en",
      voiceProvider: "elevenlabs",
    });
  });

  it("selecting Vivibe switches an English video back to Vietnamese", () => {
    expect(applyVoiceProviderSelection("vivibe", "en")).toEqual({
      videoLanguage: "vi",
      voiceProvider: "vivibe",
    });
  });

  it("never exposes a mixed-language selection", () => {
    expect(VIDEO_LANGUAGE_OPTIONS.map((option) => option.value)).toEqual(["vi", "en"]);
    expect(VIDEO_LANGUAGE_OPTIONS.map((option) => option.label)).not.toContain("Trộn");
  });
});
