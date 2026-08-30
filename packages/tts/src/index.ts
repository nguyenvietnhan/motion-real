import { createHash } from "node:crypto";
import type { VoiceProvider } from "./types.js";

export {
  concatAudio,
  concatAudioWithGaps,
  measureAudioDuration,
  mixBgm,
  synthesizeMockAudio,
} from "./audio-ops.js";
export { alignmentToSrt, type ElevenLabsAlignment } from "./caption-timing.js";
export { createTtsClient } from "./client-factory.js";
export {
  VoiceProviderError,
  asVoiceProviderError,
  isVoiceProviderError,
  retryAfterMs,
  voiceProviderErrorFrom,
  type VoiceProviderFailure,
  type VoiceProviderFailureCode,
} from "./provider-error.js";
export {
  ELEVENLABS_DEFAULT_MODEL_ID,
  ELEVENLABS_OUTPUT_FORMAT,
  ElevenLabsClient,
  defaultElevenLabsVoiceId,
  elevenLabsApiKey,
  elevenLabsBaseUrl,
  type ElevenLabsClientOptions,
} from "./elevenlabs-client.js";
export {
  VivibeClient,
  defaultVivibeVoiceId,
  vivibeApiKey,
  vivibeBaseUrl,
  vivibeRetryAttempts,
  vivibeRetryBaseDelayMs,
  type VivibeClientOptions,
} from "./vivibe-client.js";
export {
  VieneuClient,
  type VieneuClientOptions,
} from "./vieneu-client.js";
export {
  VIENEU_DEFAULT_VOICE_ID,
  VIENEU_DEFAULT_WORDS_PER_SECOND,
  VIENEU_RUNTIME_ID,
  VIENEU_VOICES,
} from "./vieneu-presets.js";
export type { CloudTtsProvider, VoiceProvider, TTSRequest, TTSResult, TTSVoice, TtsCallOptions, TtsClient } from "./types.js";

export const TTS_NORMALIZER_VERSION = "vi-v1";

export type TtsCacheIdentity = {
  provider: VoiceProvider | "mock";
  text: string;
  voiceId: string;
  speed: number;
  modelId?: string;
  languageCode?: string;
  outputFormat?: string;
  normalizerVersion?: string;
};

export function ttsCacheKey(identity: TtsCacheIdentity): string {
  return createHash("sha256")
    .update(JSON.stringify(identity))
    .digest("hex")
    .slice(0, 20);
}
