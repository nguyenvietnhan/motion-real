import { describe, expect, it } from "vitest";
import {
  applyVideoLanguageSelection,
  applyVoiceProviderSelection,
  languageOptionsForProvider,
  VIDEO_LANGUAGE_OPTIONS,
} from "./home.js";

describe("create-screen language/provider coupling", () => {
  it("Vivibe only offers Vietnamese; ElevenLabs offers both", () => {
    expect(languageOptionsForProvider("vivibe").map((o) => o.value)).toEqual(["vi"]);
    expect(languageOptionsForProvider("elevenlabs").map((o) => o.value)).toEqual(["vi", "en"]);
  });

  it("picking English under ElevenLabs keeps ElevenLabs", () => {
    expect(applyVideoLanguageSelection("en", "elevenlabs")).toEqual({
      videoLanguage: "en",
      voiceProvider: "elevenlabs",
    });
  });

  it("picking English under Vivibe is forced back to Vietnamese (defensive)", () => {
    expect(applyVideoLanguageSelection("en", "vivibe")).toEqual({
      videoLanguage: "vi",
      voiceProvider: "vivibe",
    });
  });

  it("selecting Vivibe switches an English video back to Vietnamese", () => {
    expect(applyVoiceProviderSelection("vivibe", "en")).toEqual({
      videoLanguage: "vi",
      voiceProvider: "vivibe",
    });
  });

  it("never exposes a mixed-language selection label", () => {
    expect(VIDEO_LANGUAGE_OPTIONS.map((option) => option.value)).toEqual(["vi", "en"]);
    expect(VIDEO_LANGUAGE_OPTIONS.map((option) => option.label)).not.toContain("Trộn");
  });
});
