import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  VoiceProviderError,
  asVoiceProviderError,
  createTtsClient,
  type TtsClient,
  type VoiceProvider,
} from "@motionreal/pipeline";
import type { VoiceTestResult } from "../../shared/types.js";
import type { ResolvedVoiceConfig } from "./settings-store.js";
import { toFriendlyError } from "../redact/friendly.js";

const MAX_SAMPLE_BYTES = 1024 * 1024;

type VoiceTesterDeps = {
  rootDir: string;
  createClient?: (provider: VoiceProvider, apiKey: string) => TtsClient;
  id?: () => string;
};

export function createVoiceTester(deps: VoiceTesterDeps): (config: ResolvedVoiceConfig) => Promise<VoiceTestResult> {
  let running = false;
  return async (config) => {
    if (running) {
      return voiceTestFailure(config.provider, new Error("voice test already running"), "Đang kiểm tra giọng đọc. Hãy chờ một chút.");
    }
    running = true;
    const dir = join(deps.rootDir, `voice-test-${(deps.id ?? randomUUID)()}`);
    let client: TtsClient | undefined;
    try {
      if (config.provider !== "vieneu" && !config.apiKey) {
        throw new VoiceProviderError({ provider: config.provider, code: "not_configured", retryable: false });
      }
      if (!config.voiceId) {
        throw new VoiceProviderError({ provider: config.provider, code: "voice_not_found", retryable: false });
      }
      await mkdir(dir, { recursive: true });
      client = (deps.createClient ?? createTtsClient)(config.provider, config.apiKey);
      const sample = await client.synthesize({
        text: "Xin chào, đây là giọng đọc thử.",
        voiceId: config.voiceId,
        speed: config.speed,
        outputPath: join(dir, "sample"),
        ...(config.modelId ? { modelId: config.modelId } : {}),
        ...(config.provider === "elevenlabs" ? { languageCode: "vi" } : {}),
      });
      const info = await stat(sample.audioPath);
      if (!info.isFile() || info.size <= 0 || info.size > MAX_SAMPLE_BYTES) {
        throw new Error("voice test sample is empty or too large");
      }
      const mime = audioMime(sample.audioPath);
      if (!mime) throw new Error("voice test returned an unsupported audio format");
      return { ok: true, audioDataUrl: `data:${mime};base64,${(await readFile(sample.audioPath)).toString("base64")}` };
    } catch (error) {
      return voiceTestFailure(config.provider, error);
    } finally {
      await client?.dispose?.().catch((_error) => undefined);
      running = false;
      await rm(dir, { recursive: true, force: true }).catch((_error) => undefined);
    }
  };
}

function voiceTestFailure(provider: VoiceProvider, error: unknown, message?: string): VoiceTestResult {
  const failure = asVoiceProviderError(provider, error).failure;
  const friendly = toFriendlyError({
    message: "[tts] voice test failed",
    stage: "tts",
    cause: "voice test failed",
    severity: "error",
    voiceFailure: failure,
  });
  return { ok: false, error: message ?? friendly.message, voiceFailure: failure };
}

function audioMime(path: string): string | null {
  const ext = extname(path).toLowerCase();
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".m4a") return "audio/mp4";
  return null;
}
