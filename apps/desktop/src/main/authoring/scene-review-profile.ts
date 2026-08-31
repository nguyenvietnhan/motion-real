import type { SceneDetailMode, SceneTemporalMode } from "./content-plan-schema.js";
import type { SceneReviewProfile } from "@motionreal/pipeline";

type ReviewIntentScene = {
  sceneId: string;
  temporalMode?: SceneTemporalMode;
  detailMode?: SceneDetailMode;
  motionProgression: string;
  motionBeats?: readonly unknown[];
};

export type { SceneReviewProfile } from "@motionreal/pipeline";

export function sceneReviewProfiles(scenes: readonly ReviewIntentScene[]): SceneReviewProfile[] {
  return scenes.map((scene) => {
    const temporalMode = scene.temporalMode ?? (
      (scene.motionBeats?.length ?? 0) >= 2 || /\bsemantic\s*:/iu.test(scene.motionProgression)
        ? "stepped"
        : "static"
    );
    const detailMode = scene.detailMode ?? "normal";
    return {
      sceneId: scene.sceneId,
      temporalMode,
      detailMode,
    };
  });
}
