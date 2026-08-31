import type { DurationTierChoice, VideoLanguageChoice } from "../../shared/types.js";
import type { SceneMotionBeat } from "@motionreal/schema";
import { computePacingBudget, countWords } from "../authoring/pacing-policy.js";

/** A tier-derived contract written by MotionReal, never chosen by the authoring model. */
export type HarnessAuthoringPacing = {
  duration_tier: DurationTierChoice;
  target_seconds: number;
  words_per_second: number;
  target_narration_words: number;
  min_narration_words: number;
  min_scenes: number;
  target_scenes: number;
  max_scenes: number;
  max_scene_narration_words: number;
};

const HARNESS_MIN_WORD_RATIO = 0.85;

export function buildHarnessAuthoringPacing(
  durationTier: DurationTierChoice,
  videoLanguage: VideoLanguageChoice,
  wordsPerSecond?: number,
): HarnessAuthoringPacing {
  const budget = computePacingBudget(
    { format: "tiktok", durationTier, videoLanguage },
    wordsPerSecond,
  );
  return {
    duration_tier: durationTier,
    target_seconds: budget.targetSeconds,
    words_per_second: budget.wordsPerSecond,
    target_narration_words: budget.targetWords,
    min_narration_words: Math.max(
      budget.minTotalNarrationWords,
      Math.round(budget.targetWords * HARNESS_MIN_WORD_RATIO),
    ),
    min_scenes: budget.minScenes,
    target_scenes: budget.targetScenes,
    max_scenes: budget.maxScenes,
    max_scene_narration_words: budget.maxSceneNarrationWords,
  };
}

export type HarnessManifestPacingResult =
  | { ok: true; manifest: Record<string, unknown>; sceneIds: string[]; narrationWords: number }
  | { ok: false; errors: string[] };

type HarnessNarrationPlan = {
  scenes: ReadonlyArray<{ sceneId: string; narration: string; motionBeats?: readonly SceneMotionBeat[] }>;
};

const TRANSITIONS = new Set(["slide", "fade", "wipe", "clockWipe", "zoom"]);

function normalizeTransition(value: unknown): string | undefined {
  const candidate = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>).type
    : value;
  return typeof candidate === "string" && TRANSITIONS.has(candidate) ? candidate : undefined;
}

/** Validate only pacing/identity here; render admission remains owned by the pipeline. */
export function validateHarnessManifestPacing(
  value: unknown,
  submittedSceneIds: readonly string[],
  pacing: HarnessAuthoringPacing,
  videoLanguage: VideoLanguageChoice,
  contentPlan?: HarnessNarrationPlan,
): HarnessManifestPacingResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["project/manifest.json phải là JSON object."] };
  }
  const manifest = value as Record<string, unknown>;
  if (!Array.isArray(manifest.scenes)) {
    return { ok: false, errors: ["project/manifest.json thiếu scenes."] };
  }

  const errors: string[] = [];
  const sceneIds: string[] = [];
  const sceneWords: Array<{ id: string; words: number }> = [];
  const plannedNarration = new Map(contentPlan?.scenes.map((scene) => [scene.sceneId, scene.narration]) ?? []);
  const plannedMotionBeats = new Map(contentPlan?.scenes
    .filter((scene) => scene.motionBeats)
    .map((scene) => [scene.sceneId, scene.motionBeats!] as const) ?? []);
  const normalizedScenes: Record<string, unknown>[] = [];
  for (const [index, value] of manifest.scenes.entries()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`Scene ${index + 1} không hợp lệ.`);
      continue;
    }
    const scene = value as Record<string, unknown>;
    if (typeof scene.id !== "string" || !scene.id.trim()) {
      errors.push(`Scene ${index + 1} thiếu id.`);
      continue;
    }
    const id = scene.id.trim();
    sceneIds.push(id);
    if (!/^scene-[0-9]{2}$/.test(id)) {
      errors.push(`${id} có scene id không hợp lệ; phải là scene-01, scene-02, … không thêm hậu tố.`);
    }
    const narration = typeof scene.narration === "string" && scene.narration.trim()
      ? scene.narration
      : plannedNarration.get(id);
    const transition = normalizeTransition(scene.transitionToNext);
    const { transitionToNext: _transition, motionBeats: _modelMotionBeats, ...sceneWithoutTransition } = scene;
    const canonicalMotionBeats = plannedMotionBeats.get(id);
    normalizedScenes.push({
      ...sceneWithoutTransition,
      ...(narration ? { narration } : {}),
      ...(canonicalMotionBeats ? { motionBeats: [...canonicalMotionBeats] } : {}),
      ...(transition ? { transitionToNext: transition } : {}),
    });
    if (!narration?.trim()) {
      errors.push(`${id} thiếu narration.`);
    } else {
      const words = countWords(narration);
      sceneWords.push({ id, words });
      if (words > pacing.max_scene_narration_words) {
        errors.push(`${id} có ${words} từ; tối đa ${pacing.max_scene_narration_words} từ để tránh một cảnh quá dài.`);
      }
    }
    if (index < manifest.scenes.length - 1) {
      if (!transition) {
        errors.push(`${id} phải khai báo transitionToNext có chủ đích.`);
      }
    }
  }

  if (new Set(sceneIds).size !== sceneIds.length) errors.push("Manifest có scene id trùng.");
  if (contentPlan) {
    const plannedSceneIds = contentPlan.scenes.map((scene) => scene.sceneId);
    if (plannedSceneIds.length !== sceneIds.length || plannedSceneIds.some((id, index) => id !== sceneIds[index])) {
      errors.push("Scene trong manifest phải khớp đúng thứ tự scene của content plan.");
    }
  }
  if (sceneIds.length !== submittedSceneIds.length || sceneIds.some((id, index) => id !== submittedSceneIds[index])) {
    errors.push("scene_ids đã submit phải khớp đúng thứ tự mọi scene trong manifest.");
  }
  if (sceneIds.length < pacing.min_scenes || sceneIds.length > pacing.max_scenes) {
    errors.push(
      `Tier ${pacing.duration_tier} (${pacing.target_seconds}s) cần ${pacing.min_scenes}-${pacing.max_scenes} cảnh; hiện có ${sceneIds.length}.`,
    );
  }
  const narrationWords = sceneWords.reduce((sum, scene) => sum + scene.words, 0);
  if (narrationWords < pacing.min_narration_words) {
    errors.push(
      `Narration có ${narrationWords} từ; cần tối thiểu ${pacing.min_narration_words} từ cho target ${pacing.target_seconds}s.`,
    );
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    sceneIds,
    narrationWords,
    manifest: {
      ...manifest,
      scenes: normalizedScenes,
      format: "tiktok",
      durationTier: pacing.duration_tier,
      videoLanguage,
    },
  };
}
