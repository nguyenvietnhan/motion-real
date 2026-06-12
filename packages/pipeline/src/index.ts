/**
 * @news/pipeline — the orchestration brain (the analogue of math_video_tool's
 * mvlib.build). Wires authoring/admission + TTS + locking + safety grid +
 * renderer + review + project store together for pure AUTHOR mode. This barrel
 * re-exports the stable public surface.
 */

export * from "./types.js";
export * from "./errors.js";
export * from "./store/store.js";
export * from "./assets/import-image.js";
export * from "./ingest/url-ingest.js";
export * from "./ingest/safe-fetch.js";
export * from "./ingest/crawl-images.js";
export * from "./tracker/tracker.js";
export * from "./bulk/bulk.js";
// Re-export the Vivibe config probes so leaf packages (e.g. @news/mcp) can read
// TTS readiness without depending on @news/tts directly.
export { vivibeApiKey, defaultVivibeVoiceId } from "@news/tts";
export * from "./safety/index.js";
export * from "./audio/captions.js";
export * from "./audio/lock.js";
export * from "./audio/sfx.js";
export * from "./audio/tts.js";
export * from "./render/renderer.js";
export * from "./authoring/authored-entry.js";
export * from "./render/cache.js";
export * from "./render/determinism.js";
export * from "./review.js";
export * from "./authoring/index.js";
export * from "./cli/cli.js";
export * from "./orchestrator.js";
