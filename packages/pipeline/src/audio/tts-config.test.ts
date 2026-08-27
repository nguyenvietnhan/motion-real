import { describe, expect, it } from "vitest";
import type { VideoSpec } from "@motionreal/schema";
import { serializeError } from "../errors.js";
import {
  prepareTtsText,
  resolveElevenLabsCredentials,
  resolveVivibeCredentials,
  synthesizeNarration,
} from "./tts.js";

describe("Vivibe credential resolution", () => {
  it("uses explicit in-memory credentials after process.env has been scrubbed", () => {
    expect(
      resolveVivibeCredentials(
        { apiKey: "  explicit-key  ", voiceId: "  explicit-voice  " },
        { apiKey: "", voiceId: undefined },
      ),
    ).toEqual({ apiKey: "explicit-key", voiceId: "explicit-voice" });
  });

  it("keeps the environment fallback for non-desktop processes that still use it", () => {
    expect(
      resolveVivibeCredentials({}, { apiKey: "env-key", voiceId: "env-voice" }),
    ).toEqual({ apiKey: "env-key", voiceId: "env-voice" });
  });
});

describe("ElevenLabs credential resolution", () => {
  it("keeps explicit provider config ahead of environment fallback", () => {
    expect(resolveElevenLabsCredentials(
      { apiKey: " key ", voiceId: " voice ", modelId: " model " },
      { apiKey: "env-key", voiceId: "env-voice", modelId: "env-model" },
    )).toEqual({ apiKey: "key", voiceId: "voice", modelId: "model" });
  });
});

describe("language-aware TTS preparation", () => {
  it("normalizes Vietnamese digits for spoken audio", () => {
    expect(prepareTtsText("Năm 2026", "elevenlabs", "vi"))
      .toBe("Năm hai nghìn không trăm hai mươi sáu.");
  });

  it("does not apply the Vietnamese number normalizer to English narration", () => {
    expect(prepareTtsText("The year is 2026", "elevenlabs", "en"))
      .toBe("The year is 2026.");
  });

  it("rejects Vivibe for an English project before synthesis", async () => {
    const spec = {
      version: 1,
      title: "English",
      format: "tiktok",
      language: "en",
      scenes: [],
    } satisfies VideoSpec;
    await expect(synthesizeNarration(spec, {
      projectId: "english-vivibe-block",
      provider: "vivibe",
      apiKey: "key",
      voiceId: "voice",
    })).rejects.toThrow(/Vivibe.*Vietnamese|ElevenLabs/i);
  });

  it("rejects VieNeu for an English project before starting the local runtime", async () => {
    const spec = {
      version: 1,
      title: "English",
      format: "tiktok",
      language: "en",
      scenes: [],
    } satisfies VideoSpec;
    await expect(synthesizeNarration(spec, {
      projectId: "english-vieneu-block",
      provider: "vieneu",
      voiceId: "Trúc Ly",
    })).rejects.toThrow(/VieNeu.*Vietnamese|ElevenLabs/i);
  });

  it("keeps missing provider configuration as a structured tts failure", async () => {
    const spec = {
      version: 1,
      title: "Vietnamese",
      format: "tiktok",
      language: "vi",
      scenes: [],
    } satisfies VideoSpec;
    const error = await synthesizeNarration(spec, {
      projectId: "missing-voice-config",
      provider: "vivibe",
      apiKey: "",
      voiceId: "voice",
    }).catch((value: unknown) => value);
    expect(serializeError(error, "render")).toMatchObject({
      stage: "tts",
      voiceFailure: { provider: "vivibe", code: "not_configured" },
    });
  });
});
