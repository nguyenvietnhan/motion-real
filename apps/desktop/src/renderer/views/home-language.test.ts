import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyVideoLanguageSelection,
  applyVoiceProviderSelection,
  fileToBase64,
  filesToDroppedImages,
  languageOptionsForProvider,
} from "./home.js";

afterEach(() => vi.unstubAllGlobals());

describe("create-screen language/provider coupling", () => {
  it("Vivibe and VieNeu only offer Vietnamese; ElevenLabs offers both", () => {
    expect(languageOptionsForProvider("vivibe").map((o) => o.value)).toEqual(["vi"]);
    expect(languageOptionsForProvider("vieneu").map((o) => o.value)).toEqual(["vi"]);
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

  it("selecting VieNeu switches an English video back to Vietnamese", () => {
    expect(applyVoiceProviderSelection("vieneu", "en")).toEqual({
      videoLanguage: "vi",
      voiceProvider: "vieneu",
    });
  });

  it("never exposes a mixed-language selection label", () => {
    const labels = languageOptionsForProvider("elevenlabs").map((option) => option.label);
    expect(languageOptionsForProvider("elevenlabs").map((option) => option.value)).toEqual(["vi", "en"]);
    expect(labels).not.toContain("Trộn");
  });
});

describe("paste/drop image encoding", () => {
  it("uses FileReader sequentially and preserves file order", async () => {
    class FakeFileReader {
      static active = 0;
      static maxActive = 0;
      result: string | ArrayBuffer | null = null;
      error: Error | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;

      readAsDataURL(file: File): void {
        FakeFileReader.active += 1;
        FakeFileReader.maxActive = Math.max(FakeFileReader.maxActive, FakeFileReader.active);
        queueMicrotask(() => {
          this.result = `data:image/png;base64,${file.name}-payload`;
          FakeFileReader.active -= 1;
          this.onload?.();
        });
      }
    }
    vi.stubGlobal("FileReader", FakeFileReader);

    const result = await filesToDroppedImages([
      { name: "first.png" } as File,
      { name: "second.png" } as File,
    ]);
    expect(result).toEqual([
      { name: "first.png", dataBase64: "first.png-payload" },
      { name: "second.png", dataBase64: "second.png-payload" },
    ]);
    expect(FakeFileReader.maxActive).toBe(1);
  });

  it("rejects FileReader failures and malformed results", async () => {
    class FailedFileReader {
      result: string | ArrayBuffer | null = null;
      error = new Error("read failed");
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      readAsDataURL(): void { this.onerror?.(); }
    }
    vi.stubGlobal("FileReader", FailedFileReader);
    await expect(fileToBase64({ name: "bad.png" } as File)).rejects.toThrow("read failed");

    class MalformedFileReader extends FailedFileReader {
      override readAsDataURL(): void {
        this.result = "not-a-data-url";
        this.onload?.();
      }
    }
    vi.stubGlobal("FileReader", MalformedFileReader);
    await expect(fileToBase64({ name: "bad.png" } as File)).rejects.toThrow("Dữ liệu ảnh không hợp lệ");
  });
});
