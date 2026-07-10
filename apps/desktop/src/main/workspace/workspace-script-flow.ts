import { linkWarningOf } from "./workspace-helpers.js";
import { computeScriptEdits } from "../script/script-gate-apply.js";
import type { AgentHooks, AgentWorker, AuthorInput } from "../agent/agent-worker.js";
import type { ApplyResult, FriendlyError, ProjectStage, ScriptEdit, ScriptEvidenceModel, ScriptGateModel, ScriptLine } from "../../shared/types.js";

type EditableManifest = {
  scenes: Array<{ id: string; narration?: string; headline?: string }>;
};

type RunScriptAuthoringOptions = {
  projectId: string;
  input: AuthorInput;
  worker: Pick<AgentWorker, "author">;
  scriptGateEnabled: boolean;
  redact: (message: string) => string;
  loadScriptLines: () => Promise<ScriptLine[]>;
  loadEvidence?: () => Promise<ScriptEvidenceModel | undefined>;
  setStage: (stage: ProjectStage) => void;
  runRender: (readyNotice?: string) => Promise<void>;
  friendlyError: (error: FriendlyError) => void;
  logError?: (message?: unknown, ...optionalParams: unknown[]) => void;
  signal?: AbortSignal;
  /** Restore prior reviewable stage after cancel — not an error. */
  recoverAfterCancel?: () => Promise<void>;
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

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { name?: string }).name === "AbortError");
}

export async function runScriptAuthoring({
  projectId,
  input,
  worker,
  scriptGateEnabled,
  redact,
  loadScriptLines,
  loadEvidence,
  setStage,
  runRender,
  friendlyError,
  logError,
  signal,
  recoverAfterCancel,
}: RunScriptAuthoringOptions): Promise<void> {
  const hooks: AgentHooks = { onProgress: () => {}, onSceneProduced: () => {}, onRepair: () => {} };

  try {
    if (signal?.aborted) {
      await recoverAfterCancel?.();
      return;
    }
    const authored = await worker.author({ projectId, input, scriptGate: scriptGateEnabled }, hooks, signal);
    if (authored.kind === "cancelled" || signal?.aborted) {
      await recoverAfterCancel?.();
      return;
    }
    if (authored.kind !== "authored") {
      const message = redact(authored.message ?? "Chưa tìm được nguồn nội dung phù hợp.");
      setStage({ kind: "error", message, fixable: false, retry: "create" });
      friendlyError({ projectId, message, retry: "create", fixable: false });
      return;
    }

    const linkWarning =
      authored.sourceWarning ?? linkWarningOf(input.urls.length, authored.unreadableUrls ?? []);
    if (scriptGateEnabled) {
      const evidence = await loadEvidence?.().catch((_error: unknown) => undefined);
      setStage({
        kind: "script",
        lines: await loadScriptLines(),
        ...(linkWarning ? { linkWarning } : {}),
        ...(evidence ? { evidence } : {}),
      });
    } else {
      await runRender(linkWarning);
    }
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) {
      await recoverAfterCancel?.();
      return;
    }
    logError?.(`[workspace] authoring failed for ${projectId}:`, error);
    const message = "Có lỗi khi viết kịch bản. Hãy thử lại.";
    setStage({ kind: "error", message, fixable: false, retry: "create" });
    friendlyError({ projectId, message, retry: "create", fixable: false });
  }
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
