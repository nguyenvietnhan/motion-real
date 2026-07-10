import { tierSeconds, type DurationTier, type VideoFormat, type VideoLanguage } from "@motionreal/schema";
import { DEFAULT_ENGLISH_WORDS_PER_SECOND, DEFAULT_WORDS_PER_SECOND, countWords as countSpeechWords } from "../../shared/settings-model.js";

export type PacingPolicyInput = {
  format?: VideoFormat;
  durationTier?: DurationTier;
  videoLanguage?: VideoLanguage;
};

export type PacingBudget = {
  format: VideoFormat;
  durationTier: DurationTier;
  videoLanguage: VideoLanguage;
  wordsPerSecond: number;
  targetSeconds: number;
  targetWords: number;
  minScenes: number;
  targetScenes: number;
  maxScenes: number;
  maxAvgWordsPerScene: number;
  maxSceneNarrationWords: number;
  enforceScenePacing: boolean;
};

export const SHORTFORM_90S_SCENE_RANGE = { min: 10, target: 11, max: 12 } as const;

const BASE_SECONDS = 90;
const SCENE_GROWTH_EXPONENT = 0.35;
const SHORTFORM_MAX_AVG_WORDS_PER_SCENE = 75;

function defaultWordsPerSecond(language: VideoLanguage): number {
  return language === "en" ? DEFAULT_ENGLISH_WORDS_PER_SECOND : DEFAULT_WORDS_PER_SECOND;
}

export function resolvedWordsPerSecond(language: VideoLanguage, wordsPerSecond?: number): number {
  return wordsPerSecond ?? defaultWordsPerSecond(language);
}

export function computePacingBudget(input: PacingPolicyInput, wordsPerSecond?: number): PacingBudget {
  const format: VideoFormat = "tiktok";
  const durationTier = input.durationTier ?? 1;
  const videoLanguage = input.videoLanguage ?? "vi";
  const wps = resolvedWordsPerSecond(videoLanguage, wordsPerSecond);
  const targetSeconds = tierSeconds(format, durationTier);
  const targetWords = Math.round(targetSeconds * wps);
  const ratio = Math.max(1, targetSeconds) / BASE_SECONDS;
  const growth = ratio < 1 ? ratio : Math.pow(ratio, SCENE_GROWTH_EXPONENT);
  const targetScenes = Math.max(3, Math.round(SHORTFORM_90S_SCENE_RANGE.target * growth));
  const maxAvg = SHORTFORM_MAX_AVG_WORDS_PER_SCENE;
  const minByDuration = targetSeconds >= BASE_SECONDS ? SHORTFORM_90S_SCENE_RANGE.min : 3;
  const minScenes = Math.max(minByDuration, Math.ceil(targetWords / maxAvg));
  const maxScenes = Math.max(minScenes, targetScenes + 1);

  return {
    format,
    durationTier,
    videoLanguage,
    wordsPerSecond: wps,
    targetSeconds,
    targetWords,
    minScenes,
    targetScenes,
    maxScenes,
    maxAvgWordsPerScene: maxAvg,
    maxSceneNarrationWords: Math.round(maxAvg * 1.35),
    enforceScenePacing: true,
  };
}

export const countWords = countSpeechWords;
