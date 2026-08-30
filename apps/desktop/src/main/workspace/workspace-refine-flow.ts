import type { AgentHooks, AgentWorker, SceneSnapshot, VisualQaResult } from "../agent/agent-worker.js";
import type { ProjectStage } from "../../shared/types.js";
import { visionRepairPreprompt } from "./workspace-render-flow.js";

type RefineSettings = {
  readonly refinePasses: number;
  readonly refineEarlyStop: boolean;
  readonly maxRepairAttempts: number;
};

type RefineWorker = Pick<
  AgentWorker,
  "renderStills" | "visualQa" | "reauthorScenes" | "snapshotScenes" | "restoreScenes" | "generateValidateRepair"
>;

export type RefineFlowDeps = {
  projectId: string;
  signal?: AbortSignal;
  settings: RefineSettings;
  worker: RefineWorker;
  loadManifest: (projectId: string) => Promise<{ scenes: { id: string }[] }>;
  setStage: (stage: ProjectStage) => void;
  /** Indeterminate reauthor hooks (no progress bar). */
  editHooks: () => AgentHooks;
  warn: (details: Record<string, unknown>, message: string) => void;
};

export type RestorePriorDraftDeps = {
  projectId: string;
  snapshot: SceneSnapshot;
  settings: Pick<RefineSettings, "maxRepairAttempts">;
  worker: Pick<AgentWorker, "restoreScenes" | "generateValidateRepair" | "renderStills">;
  setStage: (stage: ProjectStage) => void;
  hooks: AgentHooks;
  /** Called after a successful restore + re-render so still URLs invalidate. */
  bumpRenderVersion: () => void;
  /**
   * How to re-preview after restore: draft MP4 repair loop (default) or cheap stills.
   * Use stills when desktop reviewMode does not render a draft.
   */
  preview?: "draft" | "stills";
  /** When preview is stills, optional scene scope (omit ⇒ all scenes). */
  sceneIds?: string[];
  signal?: AbortSignal;
};

async function snapshotFresh(
  deps: RefineFlowDeps,
  sceneIds: string[],
  preRefine: SceneSnapshot,
  snapshotted: Set<string>,
): Promise<void> {
  const fresh = sceneIds.filter((id) => !snapshotted.has(id));
  if (fresh.length === 0 || !deps.worker.snapshotScenes) return;
  const snap = await deps.worker.snapshotScenes(deps.projectId, fresh).catch((error) => {
    deps.warn(
      { err: error, projectId: deps.projectId, sceneIds: fresh },
      "refine snapshot failed; continuing without those rollback entries",
    );
    return [] as SceneSnapshot;
  });
  for (const entry of snap) {
    preRefine.push(entry);
    snapshotted.add(entry.sceneId);
  }
}

/**
 * Defect-fixing vision loop: up to refinePasses rounds of visualQa → reauthor →
 * stills. Early-stop needs two consecutive *checked* clean passes when enabled.
 * A skipped pass consumes the budget but never increments the clean streak.
 */
export async function runVisionPasses(
  deps: RefineFlowDeps,
  scope: string[] | undefined,
  preRefine: SceneSnapshot,
  snapshotted: Set<string>,
): Promise<boolean> {
  const passes = deps.settings.refinePasses;
  if (passes <= 0 || !deps.worker.visualQa) return false;
  const earlyStop = deps.settings.refineEarlyStop;
  let changedAny = false;
  let cleanStreak = 0;

  for (let pass = 1; pass <= passes; pass += 1) {
    if (deps.signal?.aborted) break;
    deps.setStage({ kind: "rendering", percent: 0, phase: "qa", qaPass: pass, qaTotal: passes });
    const result: VisualQaResult = await deps.worker.visualQa(deps.projectId, scope, deps.signal).catch((error) => {
      deps.warn(
        { err: error, projectId: deps.projectId, sceneIds: scope },
        "visual QA failed; treating pass as skipped",
      );
      return {
        kind: "skipped" as const,
        reason: "provider-error" as const,
        requestedSceneIds: scope ? [...scope] : [],
      };
    });
    if (deps.signal?.aborted) break;

    if (result.kind === "skipped") {
      // Consume this configured pass; do not invent retries or count as clean.
      cleanStreak = 0;
      continue;
    }

    if (result.defects.length === 0) {
      cleanStreak += 1;
      if (earlyStop && cleanStreak >= 2) break;
      continue;
    }
    cleanStreak = 0;

    const flagged = result.defects;
    const sceneIds = flagged.map((defect) => defect.sceneId);
    await snapshotFresh(deps, sceneIds, preRefine, snapshotted);
    deps.setStage({ kind: "rendering", percent: 0, phase: "qa", qaPass: pass, qaTotal: passes });
    await deps.worker.reauthorScenes(
      { projectId: deps.projectId, sceneIds, preprompt: visionRepairPreprompt(flagged) },
      deps.editHooks(),
      deps.signal,
    );
    changedAny = true;

    const rendered = (await deps.worker.renderStills?.(deps.projectId, sceneIds, deps.signal)) ?? { stills: [] };
    if (rendered.stills.length === 0) {
      if (preRefine.length > 0 && deps.worker.restoreScenes) {
        await deps.worker.restoreScenes(deps.projectId, preRefine);
        changedAny = false;
      }
      break;
    }
  }
  return changedAny;
}

/**
 * Silent refine before the first real draft MP4: stills → vision loop. Initial
 * authoring already targets final quality; visual QA fixes only identified defects.
 */
export async function refineBeforeDraft(deps: RefineFlowDeps): Promise<SceneSnapshot> {
  const preRefine: SceneSnapshot = [];
  const passes = deps.settings.refinePasses;
  if (passes <= 0 || !deps.worker.renderStills || !deps.worker.visualQa) return preRefine;

  deps.setStage({ kind: "rendering", percent: 0, phase: "prepare" });
  const first = await deps.worker.renderStills(deps.projectId, undefined, deps.signal);
  if (deps.signal?.aborted || first.stills.length === 0) return preRefine;

  const snapshotted = new Set<string>();
  await runVisionPasses(deps, undefined, preRefine, snapshotted);
  return preRefine;
}

/**
 * Edit-path refine: stills for edited scenes → scoped vision review only.
 * Returns false when first stills are empty or aborted.
 */
export async function refineEditedScenes(deps: RefineFlowDeps, sceneIds: string[]): Promise<boolean> {
  const passes = deps.settings.refinePasses;
  if (passes <= 0 || !deps.worker.renderStills || !deps.worker.visualQa) return true;
  if (sceneIds.length === 0) return true;

  deps.setStage({ kind: "rendering", percent: 0, phase: "prepare" });
  const first = await deps.worker.renderStills(deps.projectId, sceneIds, deps.signal).catch((error) => {
    deps.warn(
      { err: error, projectId: deps.projectId, sceneIds },
      "edited-scene still render failed; edit acceptance will fail",
    );
    return { stills: [] as string[] };
  });
  if (deps.signal?.aborted) return false;
  if (first.stills.length === 0) return false;

  const preRefine: SceneSnapshot = [];
  const snapshotted = new Set<string>();
  await runVisionPasses(deps, sceneIds, preRefine, snapshotted);
  return true;
}

/**
 * Restore pre-edit source and re-preview the known-good state (draft or stills).
 * Returns true when the rollback path ran.
 */
export async function restoreToPriorDraft(deps: RestorePriorDraftDeps): Promise<boolean> {
  if (deps.snapshot.length === 0 || !deps.worker.restoreScenes) return false;
  deps.setStage({ kind: "rendering", percent: 0, phase: "edit" });
  await deps.worker.restoreScenes(deps.projectId, deps.snapshot);
  if (deps.preview === "stills") {
    deps.setStage({ kind: "rendering", percent: 0, phase: "prepare" });
    await deps.worker.renderStills?.(
      deps.projectId,
      deps.sceneIds && deps.sceneIds.length > 0 ? deps.sceneIds : undefined,
      deps.signal,
    );
  } else {
    deps.setStage({ kind: "rendering", percent: 0, phase: "draft" });
    await deps.worker.generateValidateRepair(
      deps.projectId,
      { maxAttempts: deps.settings.maxRepairAttempts },
      deps.hooks,
      deps.signal,
    );
  }
  deps.bumpRenderVersion();
  return true;
}
