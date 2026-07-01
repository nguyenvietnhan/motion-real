import type { ProjectStage, SceneCard, VideoFormatChoice } from "../../shared/types.js";

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
