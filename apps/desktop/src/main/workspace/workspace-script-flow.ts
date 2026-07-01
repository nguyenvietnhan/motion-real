import { computeScriptEdits } from "../script/script-gate-apply.js";
import type { ApplyResult, ScriptEdit, ScriptGateModel, ScriptLine } from "../../shared/types.js";

type EditableManifest = {
  scenes: Array<{ id: string; narration?: string; headline?: string }>;
};

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

export function applyScriptEditsToManifest(manifest: EditableManifest, edits: ScriptEdit[]): ApplyResult {
  const guard = computeScriptEdits(
    manifest.scenes.map((scene) => ({
      sceneId: scene.id,
      narration: scene.narration ?? "",
      headline: scene.headline,
    })),
    edits,
  );
  if (!guard.ok) return guard;

  const byId = new Map(edits.map((edit) => [edit.sceneId, edit]));
  for (const scene of manifest.scenes) {
    const edit = byId.get(scene.id);
    if (!edit) continue;
    if (edit.narration !== undefined) scene.narration = edit.narration;
    if (edit.headline !== undefined) scene.headline = edit.headline;
  }
  return { ok: true };
}
