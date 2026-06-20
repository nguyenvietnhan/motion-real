import type { SettingsModel, VoiceProviderChoice } from "./types.js";

export const ELEVENLABS_DEFAULT_MODEL_ID = "eleven_multilingual_v2";

export function voiceCalibrationKey(input: {
  provider: VoiceProviderChoice;
  voiceId: string;
  modelId?: string;
  speed?: number;
}): string {
  return [input.provider, input.modelId ?? "default", input.voiceId, String(input.speed ?? 1)].join(":");
}

/** Default repair budget (mirrors the engine clamp lower bound in repair-loop). */
const DEFAULT_MAX_REPAIR_ATTEMPTS = 3;

/** Default silent refine passes over the stills before the first draft (D6/R4.4). */
export const DEFAULT_REFINE_PASSES = 2;
/** Refine passes are clamped to this inclusive range; 0 disables refine. */
export const MIN_REFINE_PASSES = 0;
export const MAX_REFINE_PASSES = 5;

/**
 * Clamp a refine-pass count into [0,5]; a non-finite value falls back to the
 * default. The UI exposes a plain number field, and a persisted settings file
 * (or a legacy `visualQaEnabled` migration) can carry anything — so the count is
 * always clamped before it drives the refine loop.
 */
export function clampRefinePasses(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_REFINE_PASSES;
  return Math.min(MAX_REFINE_PASSES, Math.max(MIN_REFINE_PASSES, Math.floor(n)));
}

/**
 * Default Vietnamese narration rate (words/second) used to turn a duration tier
 * into a total word budget in the author prompt (freeform-engine K1/R5.4/D13).
 * 4.7 was MEASURED from real Vivibe audio (the earlier 2.7 guess rendered a "90s"
 * request as ~60s). The calibration script (`scripts/calibrate-voice.ts`) can
 * re-measure the configured voice and persist `voiceWordsPerSecond`; this is the
 * fallback when no calibration has run.
 */
export const DEFAULT_WORDS_PER_SECOND = 4.7;
/** Conservative default for English ElevenLabs narration until language-aware calibration is added. */
export const DEFAULT_ENGLISH_WORDS_PER_SECOND = 2.5;
/**
 * A measured rate is clamped to this sane band before it's trusted: a TTS/network
 * hiccup (e.g. a near-zero or absurdly large measured duration) must never poison
 * the word budget. Vietnamese short-form narration sits comfortably inside this.
 */
export const MIN_WORDS_PER_SECOND = 2.0;
export const MAX_WORDS_PER_SECOND = 8.0;

/**
 * Clamp a measured words/second into the sane band; a non-finite or out-of-band
 * value falls back to the measured default. Used both when persisting a freshly
 * calibrated rate and when reading a (possibly hand-edited) settings file before
 * it drives the prompt's word budget.
 */
export function clampWordsPerSecond(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_WORDS_PER_SECOND;
  return Math.min(MAX_WORDS_PER_SECOND, Math.max(MIN_WORDS_PER_SECOND, n));
}

/** Count words the SAME way the pacing oracle does (whitespace split, no empties). */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** One calibration sample: a passage and the real seconds Vivibe took to read it. */
export type CalibrationSample = { text: string; seconds: number };

/**
 * Compute the calibrated words/second from measured samples (freeform-engine
 * K1/R5.4/D13). Uses a TOTAL-weighted average (Σ words / Σ seconds), not a mean
 * of per-sample ratios, so a longer passage counts proportionally more and a
 * short passage's measurement jitter doesn't dominate. Samples with a
 * non-positive/non-finite duration or zero words are skipped (a failed/empty
 * synth never poisons the rate). Returns undefined when no sample is usable, so
 * the caller keeps the existing/default rate rather than writing garbage. The
 * result is clamped to the sane band.
 */
export function computeWordsPerSecond(samples: CalibrationSample[]): number | undefined {
  let totalWords = 0;
  let totalSeconds = 0;
  for (const s of samples) {
    if (!Number.isFinite(s.seconds) || s.seconds <= 0) continue;
    const words = countWords(s.text);
    if (words <= 0) continue;
    totalWords += words;
    totalSeconds += s.seconds;
  }
  if (totalSeconds <= 0 || totalWords <= 0) return undefined;
  return clampWordsPerSecond(totalWords / totalSeconds);
}

/**
 * Settings defaults (web-dashboard Task 10.1, design §Settings,
 * Req 11.3/11.4/11.7/11.8). Every L3 setting is PRE-POPULATED so a user can run
 * the whole flow with Vivibe as the default provider, a default output
 * dir, repair budget 3, and the script gate ON. `outputDir` is supplied by the
 * main process (the `.video-tool` home) to keep this module pure.
 *
 * NOTE (reconcile-main-controllers S2): `normalizeSettings` was removed. It was
 * never on the production path — `index.ts` merged settings inline WITHOUT
 * clamping `maxRepairAttempts`, so the clamp was a divergence (R4.4). The real
 * persistence/merge now lives in the tested `SettingsStore` (main/settings).
 */

export function defaultSettings(outputDir: string): SettingsModel {
  return {
    aiAccount: { kind: "disconnected" },
    voiceProvider: "vivibe",
    elevenLabsModelId: ELEVENLABS_DEFAULT_MODEL_ID,
    voiceCredentials: { vivibe: "missing", elevenlabs: "missing" },
    voiceCalibrations: {},
    outputDir,
    maxRepairAttempts: DEFAULT_MAX_REPAIR_ATTEMPTS,
    scriptGateEnabled: true,
    refinePasses: DEFAULT_REFINE_PASSES,
    refineEarlyStop: true,
    imageCrawlAiFilter: true,
    imageCrawlHumanReview: true,
  };
}
