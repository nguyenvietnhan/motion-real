import { describe, expect, it, vi } from "vitest";
import { parseEnvText, readEnvFile, resolveBootVoiceEnv } from "./runtime-env.js";

describe("runtime env parsing", () => {
  it("parses env text with comments, quotes, whitespace, and duplicate keys", () => {
    expect(
      parseEnvText(`
        # full-line comments are ignored
        VIVIBE_API_KEY = " file-key "
        ELEVENLABS_API_KEY='eleven-file'
        VIDEO_TOOL_HOME = V:/MotionReal
        EMPTY =
        BAD-NAME=ignored
        NO_EQUALS
        VIVIBE_API_KEY=last-wins
      `),
    ).toEqual({
      VIVIBE_API_KEY: "last-wins",
      ELEVENLABS_API_KEY: "eleven-file",
      VIDEO_TOOL_HOME: "V:/MotionReal",
      EMPTY: "",
    });
  });

  it("reads an env file through injectable filesystem deps", () => {
    expect(
      readEnvFile("V:/MotionReal/.env", {
        exists: () => true,
        readText: () => "VIVIBE_API_KEY=from-file\n",
        warn: () => undefined,
      }),
    ).toEqual({ VIVIBE_API_KEY: "from-file" });

    expect(
      readEnvFile("V:/MotionReal/.missing-env", {
        exists: () => false,
        readText: () => {
          throw new Error("should not read");
        },
        warn: () => undefined,
      }),
    ).toEqual({});
  });

  it("warns and returns empty values when the env file cannot be read", () => {
    const warn = vi.fn();
    const error = new Error("denied");
    expect(
      readEnvFile("V:/MotionReal/.env", {
        exists: () => true,
        readText: () => {
          throw error;
        },
        warn,
      }),
    ).toEqual({});
    expect(warn).toHaveBeenCalledWith(error);
  });
});

describe("boot voice env", () => {
  it("prefers process env over file env and trims values", () => {
    expect(
      resolveBootVoiceEnv(
        {
          VIVIBE_API_KEY: " process-vivibe ",
          VIVIBE_VOICE_ID: " process-voice ",
          ELEVENLABS_API_KEY: " process-eleven ",
          ELEVENLABS_VOICE_ID: " process-eleven-voice ",
        },
        {
          VIVIBE_API_KEY: "file-vivibe",
          VIVIBE_VOICE_ID: "file-voice",
          ELEVENLABS_API_KEY: "file-eleven",
          ELEVENLABS_VOICE_ID: "file-eleven-voice",
        },
      ),
    ).toEqual({
      vivibeApiKey: "process-vivibe",
      vivibeVoiceId: "process-voice",
      elevenLabsApiKey: "process-eleven",
      elevenLabsVoiceId: "process-eleven-voice",
    });
  });

  it("keeps legacy Vivibe aliases in the current precedence order", () => {
    expect(
      resolveBootVoiceEnv(
        {
          VIETNAMESE_API_KEY: "legacy-process-key",
          VIETNAMESE_VOICEID: "legacy-process-voice",
        },
        {
          VIVIBE_API_KEY: "file-canonical-key",
          VIVIBE_VOICE_ID: "file-canonical-voice",
        },
      ),
    ).toMatchObject({
      vivibeApiKey: "legacy-process-key",
      vivibeVoiceId: "legacy-process-voice",
    });

    expect(
      resolveBootVoiceEnv(
        {},
        {
          VIETNAMESE_API_KEY: "legacy-file-key",
          VIETNAMESE_VOICEID: "legacy-file-voice",
        },
      ),
    ).toMatchObject({
      vivibeApiKey: "legacy-file-key",
      vivibeVoiceId: "legacy-file-voice",
    });
  });
});
