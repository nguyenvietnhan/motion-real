import type { ProjectStage, SceneCard, ScriptLine, VideoFormatChoice } from "../../shared/types.js";
import { buildStoryboard } from "../review/storyboard.js";

type ScriptLineSourceScene = {
  id: string;
  headline?: string;
  narration?: string;
  image?: { ref: string };
};

type StoryboardSourceScene = {
  id: string;
  headline?: string;
  narration?: string;
  eyebrow?: string;
};

export function readyStageOf(
  scenes: SceneCard[],
  options: { draftPath?: string; notice?: string } = {},
): ProjectStage {
  return {
    kind: "ready",
    scenes,
    ...(options.draftPath ? { draftPath: options.draftPath } : {}),
    ...(options.notice ? { notice: options.notice } : {}),
  };
}

export function publishedStageOf(
  outputPath: string,
  options: {
    title?: string;
    hashtags?: string[];
    thumbnailPath?: string;
    format?: VideoFormatChoice;
  } = {},
): ProjectStage {
  return {
    kind: "published",
    outputPath,
    format: options.format ?? "tiktok",
    ...(options.title ? { title: options.title } : {}),
    ...(options.hashtags && options.hashtags.length > 0 ? { hashtags: options.hashtags } : {}),
    ...(options.thumbnailPath ? { thumbnailPath: options.thumbnailPath } : {}),
  };
}

/** Full-render progress stage at the start of publish. */
export function fullRenderStageStart(): ProjectStage {
  return { kind: "rendering", percent: 0, phase: "full" };
}

/** Error stage after a failed full publish (retry re-runs publish, not re-author). */
export function publishErrorStageOf(input: { message: string; fixable: boolean }): ProjectStage {
  return {
    kind: "error",
    message: input.message,
    fixable: input.fixable,
    retry: "full",
  };
}

export function scriptLinesFromScenes(
  scenes: ScriptLineSourceScene[],
  assetMediaOf: (ref: string) => string,
): ScriptLine[] {
  return scenes.map((scene, index) => ({
    sceneId: scene.id,
    order: index,
    headline: scene.headline ?? "",
    narration: scene.narration ?? "",
    ...(scene.image?.ref ? { imagePath: assetMediaOf(scene.image.ref) } : {}),
  }));
}

export function storyboardScenesFromScenes(
  projectId: string,
  scenes: StoryboardSourceScene[],
  renderVersion: number,
  reviewStillOf: (sceneId: string) => string,
): SceneCard[] {
  return buildStoryboard(
    projectId,
    "",
    scenes.map((scene) => scene.id),
    "",
    (_root, sceneId) => reviewStillOf(sceneId),
  ).scenes.map((scene) => {
    const manifestScene = scenes.find((candidate) => candidate.id === scene.sceneId);
    return {
      ...scene,
      stillPath: scene.stillPath ? `${scene.stillPath}#r${renderVersion}` : scene.stillPath,
      headline: manifestScene?.headline,
      narration: manifestScene?.narration,
      eyebrow: manifestScene?.eyebrow,
    };
  });
}
