import { describe, expect, it, vi, type Mock } from "vitest";
import type { AgentHooks, SceneSnapshot, VisualQaResult } from "../agent/agent-worker.js";
import type { ProjectStage } from "../../shared/types.js";
import {
  refineBeforeDraft,
  refineEditedScenes,
  restoreToPriorDraft,
  runVisionPasses,
  type RefineFlowDeps,
} from "./workspace-refine-flow.js";

const hooks: AgentHooks = {
  onProgress: () => {},
  onSceneProduced: () => {},
  onRepair: () => {},
};

const cleanQa = (sceneIds: string[] = []): VisualQaResult => ({
  kind: "checked",
  defects: [],
  checkedSceneIds: sceneIds,
});

const defectQa = (sceneId: string, issue: string): VisualQaResult => ({
  kind: "checked",
  defects: [{ sceneId, issue }],
  checkedSceneIds: [sceneId],
});

const skippedQa = (reason: "provider-error" | "invalid-response" | "no-stills" = "provider-error"): VisualQaResult => ({
  kind: "skipped",
  reason,
  requestedSceneIds: [],
});

type MockWorker = {
  renderStills: Mock;
  visualQa: Mock;
  reauthorScenes: Mock;
  snapshotScenes: Mock;
  restoreScenes: Mock;
  generateValidateRepair: Mock;
};

function makeDeps(over: {
  settings?: RefineFlowDeps["settings"];
  worker?: Partial<MockWorker>;
  loadManifest?: RefineFlowDeps["loadManifest"];
} = {}): { deps: RefineFlowDeps; stages: ProjectStage[]; worker: MockWorker } {
  const stages: ProjectStage[] = [];
  const worker: MockWorker = {
    renderStills: vi.fn(async () => ({ stills: ["s1.png"] })),
    visualQa: vi.fn(async () => cleanQa()),
    reauthorScenes: vi.fn(async () => ({ kind: "authored" as const, sceneIds: ["scene-01"] })),
    snapshotScenes: vi.fn(async (_id: string, sceneIds: string[]) =>
      sceneIds.map((sceneId) => ({ sceneId, code: `// ${sceneId}` })),
    ),
    restoreScenes: vi.fn(async () => {}),
    generateValidateRepair: vi.fn(async () => ({ kind: "passed" as const, attempts: 1 })),
    ...over.worker,
  };
  const deps: RefineFlowDeps = {
    projectId: "p1",
    settings: over.settings ?? { refinePasses: 3, refineEarlyStop: true, maxRepairAttempts: 3 },
    worker: worker as unknown as RefineFlowDeps["worker"],
    loadManifest:
      over.loadManifest ?? vi.fn(async () => ({ scenes: [{ id: "scene-01" }, { id: "scene-02" }] })),
    setStage: (stage) => {
      stages.push(stage);
    },
    editHooks: () => hooks,
    warn: vi.fn(),
  };
  return { deps, stages, worker };
}

describe("workspace-refine-flow", () => {
  it("skips refineBeforeDraft when refine is disabled or unsupported", async () => {
    const { deps, worker } = makeDeps({
      settings: { refinePasses: 0, refineEarlyStop: true, maxRepairAttempts: 3 },
    });
    expect(await refineBeforeDraft(deps)).toEqual([]);
    expect(worker.renderStills).not.toHaveBeenCalled();

    const noVision = makeDeps({
      worker: {
        visualQa: undefined as unknown as Mock,
        renderStills: vi.fn(async () => ({ stills: ["x"] })),
      },
    });
    // Drop visualQa on the deps object the same way production does (optional).
    const depsNoVision: RefineFlowDeps = {
      ...noVision.deps,
      worker: { ...noVision.deps.worker, visualQa: undefined },
    };
    expect(await refineBeforeDraft(depsNoVision)).toEqual([]);
  });

  it("returns early when first stills are empty (no bootstrap)", async () => {
    const { deps, worker } = makeDeps({
      worker: { renderStills: vi.fn(async () => ({ stills: [] })) },
    });
    expect(await refineBeforeDraft(deps)).toEqual([]);
    expect(worker.reauthorScenes).not.toHaveBeenCalled();
  });

  it("runs creative bootstrap then vision on first-author path", async () => {
    const { deps, worker, stages } = makeDeps({
      worker: {
        visualQa: vi
          .fn()
          .mockResolvedValueOnce(defectQa("scene-01", "overlap"))
          .mockResolvedValueOnce(cleanQa(["scene-01"]))
          .mockResolvedValueOnce(cleanQa(["scene-01"])),
      },
    });
    const snap = await refineBeforeDraft(deps);
    expect(worker.renderStills).toHaveBeenCalled();
    expect(worker.reauthorScenes).toHaveBeenCalled();
    const bootstrapCall = worker.reauthorScenes.mock.calls[0]!;
    expect(bootstrapCall[0].sceneIds).toEqual(["scene-01", "scene-02"]);
    expect(Object.keys(bootstrapCall[0].preprompt.perSceneIntent).length).toBe(2);
    expect(stages.some((s) => s.kind === "rendering" && s.phase === "prepare")).toBe(true);
    expect(stages.some((s) => s.kind === "rendering" && s.phase === "qa")).toBe(true);
    expect(snap.length).toBeGreaterThan(0);
  });

  it("restores snapshot when stills empty after vision reauthor (accept-gate)", async () => {
    const { deps, worker } = makeDeps({
      worker: {
        visualQa: vi.fn(async () => defectQa("scene-01", "clip")),
        renderStills: vi
          .fn()
          .mockResolvedValueOnce({ stills: ["ok.png"] })
          .mockResolvedValueOnce({ stills: ["ok.png"] })
          .mockResolvedValueOnce({ stills: [] }),
      },
    });
    await refineBeforeDraft(deps);
    expect(worker.restoreScenes).toHaveBeenCalled();
  });

  it("early-stops vision after two consecutive checked-clean passes", async () => {
    const visualQa = vi.fn(async () => cleanQa());
    const { deps } = makeDeps({
      settings: { refinePasses: 5, refineEarlyStop: true, maxRepairAttempts: 3 },
      worker: { visualQa },
    });
    await runVisionPasses(deps, undefined, [], new Set());
    expect(visualQa).toHaveBeenCalledTimes(2);
  });

  it("skipped then two checked-clean requires three passes before early stop", async () => {
    const visualQa = vi
      .fn()
      .mockResolvedValueOnce(skippedQa("provider-error"))
      .mockResolvedValueOnce(cleanQa())
      .mockResolvedValueOnce(cleanQa());
    const { deps, worker } = makeDeps({
      settings: { refinePasses: 5, refineEarlyStop: true, maxRepairAttempts: 3 },
      worker: { visualQa },
    });
    await runVisionPasses(deps, undefined, [], new Set());
    expect(visualQa).toHaveBeenCalledTimes(3);
    expect(worker.reauthorScenes).not.toHaveBeenCalled();
  });

  it("skipped never increments the clean streak even if repeated", async () => {
    const visualQa = vi.fn(async () => skippedQa("invalid-response"));
    const { deps } = makeDeps({
      settings: { refinePasses: 3, refineEarlyStop: true, maxRepairAttempts: 3 },
      worker: { visualQa },
    });
    await runVisionPasses(deps, undefined, [], new Set());
    expect(visualQa).toHaveBeenCalledTimes(3);
  });

  it("checked defect reauthors only flagged scenes", async () => {
    const visualQa = vi
      .fn()
      .mockResolvedValueOnce(defectQa("scene-02", "clip"))
      .mockResolvedValueOnce(cleanQa(["scene-02"]))
      .mockResolvedValueOnce(cleanQa(["scene-02"]));
    const { deps, worker } = makeDeps({
      settings: { refinePasses: 5, refineEarlyStop: true, maxRepairAttempts: 3 },
      worker: { visualQa },
    });
    await runVisionPasses(deps, undefined, [], new Set());
    expect(worker.reauthorScenes).toHaveBeenCalledTimes(1);
    expect(worker.reauthorScenes.mock.calls[0]![0].sceneIds).toEqual(["scene-02"]);
  });

  it("edit path never runs creative bootstrap reauthor when vision is clean", async () => {
    const { deps, worker } = makeDeps({
      worker: { visualQa: vi.fn(async () => cleanQa(["scene-01"])) },
    });
    expect(await refineEditedScenes(deps, ["scene-01"])).toBe(true);
    expect(worker.reauthorScenes).not.toHaveBeenCalled();
    expect(worker.renderStills.mock.calls[0]![1]).toEqual(["scene-01"]);
  });

  it("edit path returns false when first stills are empty", async () => {
    const { deps, worker } = makeDeps({
      worker: { renderStills: vi.fn(async () => ({ stills: [] })) },
    });
    expect(await refineEditedScenes(deps, ["scene-01"])).toBe(false);
    expect(worker.visualQa).not.toHaveBeenCalled();
  });

  it("restoreToPriorDraft restores and re-renders when snapshot exists", async () => {
    const restoreScenes = vi.fn(async () => {});
    const generateValidateRepair = vi.fn(async () => ({ kind: "passed" as const, attempts: 1 }));
    const bumpRenderVersion = vi.fn();
    const stages: ProjectStage[] = [];
    const ok = await restoreToPriorDraft({
      projectId: "p1",
      snapshot: [{ sceneId: "scene-01", code: "x" }],
      settings: { maxRepairAttempts: 2 },
      worker: { restoreScenes, generateValidateRepair },
      setStage: (s) => stages.push(s),
      hooks,
      bumpRenderVersion,
    });
    expect(ok).toBe(true);
    expect(restoreScenes).toHaveBeenCalled();
    expect(generateValidateRepair).toHaveBeenCalled();
    expect(bumpRenderVersion).toHaveBeenCalled();
    expect(stages.map((s) => (s.kind === "rendering" ? s.phase : s.kind))).toEqual(["edit", "draft"]);
  });

  it("restoreToPriorDraft returns false for empty snapshot", async () => {
    expect(
      await restoreToPriorDraft({
        projectId: "p1",
        snapshot: [],
        settings: { maxRepairAttempts: 2 },
        worker: {
          restoreScenes: vi.fn(async () => {}),
          generateValidateRepair: vi.fn(async () => ({ kind: "passed" as const, attempts: 1 })),
        },
        setStage: () => {},
        hooks,
        bumpRenderVersion: () => {},
      }),
    ).toBe(false);
  });
});
