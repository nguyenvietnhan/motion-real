import type { ProjectStage, SceneCard } from "../../shared/types.js";

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
