import type { SceneDetailMode, SceneTemporalMode } from "./content-plan-schema.js";

type ReviewIntentScene = {
  sceneId: string;
  temporalMode?: SceneTemporalMode;
  detailMode?: SceneDetailMode;
  motionProgression: string;
  motionBeats?: readonly unknown[];
};

export type SceneReviewProfile = {
  sceneId: string;
  temporalMode: SceneTemporalMode;
  detailMode: SceneDetailMode;
  overview: true;
  motionArtifact: "none" | "cue-filmstrip" | "dense-filmstrip";
  detailArtifact: boolean;
  reasons: readonly string[];
};

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
      overview: true,
      motionArtifact: temporalMode === "static"
        ? "none"
        : temporalMode === "stepped" ? "cue-filmstrip" : "dense-filmstrip",
      detailArtifact: detailMode === "fine",
      reasons: [temporalMode, ...(detailMode === "fine" ? ["fine-detail"] : [])],
    };
  });
}
