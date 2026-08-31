/**
 * @motionreal/pipeline — orchestration for pure AUTHOR mode. Wires
 * authoring/admission, TTS, locking, safety grid, renderer, review, and project
 * store. This barrel re-exports the stable public surface.
 */

export * from "./types.js";
export * from "./errors.js";
export * from "./log/logger.js";
export * from "./store/store.js";
export * from "./store/project-diagnostics.js";
export * from "./store/project-evidence.js";
export * from "./assets/import-image.js";
export * from "./assets/bundled-media.js";
export * from "./ingest/url-ingest.js";
export * from "./ingest/safe-fetch.js";
export * from "./ingest/crawl-images.js";
// Re-export the Vivibe config probes so leaf adapters can read TTS readiness
// without depending on @motionreal/tts directly.
export {
  ELEVENLABS_DEFAULT_MODEL_ID,
  VIENEU_DEFAULT_VOICE_ID,
  VIENEU_DEFAULT_WORDS_PER_SECOND,
  VIENEU_RUNTIME_ID,
  VIENEU_VOICES,
  VieneuClient,
  VivibeClient,
  ElevenLabsClient,
  createTtsClient,
  asVoiceProviderError,
  isVoiceProviderError,
  VoiceProviderError,
  vivibeApiKey,
  defaultVivibeVoiceId,
  elevenLabsApiKey,
  defaultElevenLabsVoiceId,
  type VoiceProviderFailure,
  type VoiceProviderFailureCode,
  type TtsClient,
} from "@motionreal/tts";
export * from "./safety/index.js";
export * from "./audio/captions.js";
export * from "./audio/lock.js";
export * from "./audio/tts.js";
export * from "./audio/bgm-library.js";
export * from "./render/renderer.js";
export * from "./render/review-evidence.js";
export * from "./render/runtime-probe.js";
export {
  renderProjectStills,
  type RenderProjectStillsOptions,
  type RenderProjectStillsResult,
} from "./render/render-stills.js";
export * from "./render/render-thumbnail.js";
export * from "./authoring/authored-entry.js";
export * from "./render/cache.js";
export * from "./render/determinism.js";
export * from "./authoring/index.js";
export * from "./cli/cli.js";
export * from "./orchestrator.js";
export * from "./tools/create-tools.js";
export * from "./tools/tool-result.js";
