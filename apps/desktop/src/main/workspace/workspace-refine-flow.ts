import type { AgentHooks, AgentWorker, SceneSnapshot, VisualDefect } from "../agent/agent-worker.js";
import type { ProjectStage } from "../../shared/types.js";
import { creativeBootstrapPreprompt, visionRepairPreprompt } from "./workspace-render-flow.js";

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
  worker: Pick<AgentWorker, "restoreScenes" | "generateValidateRepair">;
  setStage: (stage: ProjectStage) => void;
  hooks: AgentHooks;
  /** Called after a successful restore + re-render so still URLs invalidate. */
  bumpRenderVersion: () => void;
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
 * One-shot creative bootstrap (first author only): reauthor every scene with a
 * "be bolder" intent, then re-render stills. Accept-gate restores preRefine if
 * the rewrite stops rendering.
 */
export async function creativeBootstrapPass(
  deps: RefineFlowDeps,
  preRefine: SceneSnapshot,
  snapshotted: Set<string>,
): Promise<void> {
  if (deps.signal?.aborted) return;
  const manifest = await deps.loadManifest(deps.projectId).catch((error) => {
    deps.warn({ err: error, projectId: deps.projectId }, "creative-bootstrap manifest read failed; bootstrap skipped");
    return { scenes: [] as { id: string }[] };
  });
  const sceneIds = manifest.scenes.map((scene) => scene.id);
  if (sceneIds.length === 0) return;

  await snapshotFresh(deps, sceneIds, preRefine, snapshotted);
  deps.setStage({ kind: "rendering", percent: 0, phase: "prepare" });
  await deps.worker.reauthorScenes(
    { projectId: deps.projectId, sceneIds, preprompt: creativeBootstrapPreprompt(sceneIds) },
    deps.editHooks(),
    deps.signal,
  );
  const rendered = (await deps.worker.renderStills?.(deps.projectId, sceneIds, deps.signal)) ?? { stills: [] };
  if (rendered.stills.length === 0 && preRefine.length > 0 && deps.worker.restoreScenes) {
    await deps.worker.restoreScenes(deps.projectId, preRefine);
  }
}

/**
 * Defect-fixing vision loop: up to refinePasses rounds of visualQa → reauthor →
 * stills. Early-stop needs two consecutive clean passes when enabled.
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
    const flagged = await deps.worker.visualQa(deps.projectId, scope, deps.signal).catch((error) => {
      deps.warn(
        { err: error, projectId: deps.projectId, sceneIds: scope },
        "visual QA failed; treating pass as unflagged",
      );
      return [] as VisualDefect[];
    });
    if (deps.signal?.aborted) break;
    if (flagged.length === 0) {
      cleanStreak += 1;
      if (earlyStop && cleanStreak >= 2) break;
      continue;
    }
    cleanStreak = 0;

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
 * Silent refine before the first real draft MP4: stills → creative bootstrap →
 * vision loop. Returns cumulative pre-refine snapshot for caller rollback.
 */
export async function refineBeforeDraft(deps: RefineFlowDeps): Promise<SceneSnapshot> {
  const preRefine: SceneSnapshot = [];
  const passes = deps.settings.refinePasses;
  if (passes <= 0 || !deps.worker.renderStills || !deps.worker.visualQa) return preRefine;

  deps.setStage({ kind: "rendering", percent: 0, phase: "prepare" });
  const first = await deps.worker.renderStills(deps.projectId, undefined, deps.signal);
  if (deps.signal?.aborted || first.stills.length === 0) return preRefine;

  const snapshotted = new Set<string>();
  await creativeBootstrapPass(deps, preRefine, snapshotted);
  if (deps.signal?.aborted) return preRefine;
  await runVisionPasses(deps, undefined, preRefine, snapshotted);
  return preRefine;
}

/**
 * Edit-path refine: stills for edited scenes → vision only (no creative bootstrap).
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
 * Restore pre-edit source and re-render the known-good draft.
 * Returns true when the rollback path ran.
 */
export async function restoreToPriorDraft(deps: RestorePriorDraftDeps): Promise<boolean> {
  if (deps.snapshot.length === 0 || !deps.worker.restoreScenes) return false;
  deps.setStage({ kind: "rendering", percent: 0, phase: "edit" });
  await deps.worker.restoreScenes(deps.projectId, deps.snapshot);
  deps.setStage({ kind: "rendering", percent: 0, phase: "draft" });
  await deps.worker.generateValidateRepair(
    deps.projectId,
    { maxAttempts: deps.settings.maxRepairAttempts },
    deps.hooks,
  );
  deps.bumpRenderVersion();
  return true;
}
