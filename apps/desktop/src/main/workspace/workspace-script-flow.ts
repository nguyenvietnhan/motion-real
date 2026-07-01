import type { ScriptGateModel, ScriptLine } from "../../shared/types.js";

export function scriptGateModelFromLines(
  projectId: string,
  enabled: boolean,
  lines: ScriptLine[],
): ScriptGateModel {
  return {
    projectId,
    enabled,
    scenes: lines.map((line) => ({
      sceneId: line.sceneId,
      order: line.order,
      narration: line.narration,
      headline: line.headline,
    })),
  };
}
