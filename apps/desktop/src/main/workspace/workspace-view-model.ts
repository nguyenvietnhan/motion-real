import type { ProjectStage, SceneCard, SceneTimeline, ScriptLine, VideoFormatChoice } from "../../shared/types.js";
import { withMediaCacheBust } from "../../shared/media-cache-bust.js";
import { buildStoryboard } from "../review/storyboard.js";

/** Pure projection from locked frames to seekable seconds (no I/O). */
export function projectSceneTimelines(input: {
  fps: number;
  scenes: ReadonlyArray<{ id: string; startFrame: number; durationInFrames: number }>;
}): Record<string, SceneTimeline> {
  if (!Number.isFinite(input.fps) || input.fps <= 0) return {};
  const out: Record<string, SceneTimeline> = {};
  for (const scene of input.scenes) {
    if (!scene.id || !Number.isFinite(scene.startFrame) || !Number.isFinite(scene.durationInFrames)) continue;
    if (scene.startFrame < 0 || scene.durationInFrames <= 0) continue;
    const startSeconds = Math.max(0, scene.startFrame / input.fps);
    const endSeconds = Math.max(0, (scene.startFrame + scene.durationInFrames) / input.fps);
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) continue;
    out[scene.id] = { startSeconds, endSeconds };
  }
  return out;
}

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
  timelines?: Record<string, SceneTimeline>,
): SceneCard[] {
  return buildStoryboard(
    projectId,
    "",
    scenes.map((scene) => scene.id),
    "",
    (_root, sceneId) => reviewStillOf(sceneId),
  ).scenes.map((scene) => {
    const manifestScene = scenes.find((candidate) => candidate.id === scene.sceneId);
    const timeline = timelines?.[scene.sceneId];
    return {
      ...scene,
      stillPath: scene.stillPath ? withMediaCacheBust(scene.stillPath, renderVersion) : scene.stillPath,
      headline: manifestScene?.headline,
      narration: manifestScene?.narration,
      eyebrow: manifestScene?.eyebrow,
      ...(timeline ? { timeline } : {}),
    };
  });
}
