import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { WorkspaceController, type WorkspaceDeps, type WsManifest } from "./workspace-controller.js";
import type { AgentHooks, AgentWorker, AuthorOutcome, RepairOutcome } from "../agent/agent-worker.js";
import type { ProjectStage, ScriptEdit } from "../../shared/types.js";

/**
 * Feature: reconcile-main-controllers — WorkspaceController property tests (S4).
 * Reproduces the inline staged-workspace Current_Behavior of index.ts
 * (R1.4, R2.5, R2.8, R2.9).
 */

const noopEvents = () => ({ progress: vi.fn(), scene: vi.fn(), status: vi.fn(), friendlyError: vi.fn() });

function baseDeps(over: Partial<WorkspaceDeps> = {}): WorkspaceDeps {
  return {
    worker: {} as AgentWorker,
    events: noopEvents(),
    settings: { scriptGateEnabled: true, maxRepairAttempts: 3 },
    listProjects: async () => [],
    loadManifest: async () => ({ scenes: [] }),
    writeManifest: async () => {},
    reviewStill: (_id, sceneId) => `media://still/${sceneId}`,
    toMedia: (p) => p,
    hasStill: () => false,
    deleteProject: async () => {},
    revealProject: async () => {},
    ...over,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// Property 7: Empty-narration guard for applyEdits
describe("Property 7: empty-narration guard (manifest order, no write on reject)", () => {
  it("rejects with the FIRST manifest-order offending scene and never writes", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 6 }),
        fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 1, maxLength: 6 }),
        async (sceneCount, emptyIdxsRaw) => {
          const scenes = Array.from({ length: sceneCount }, (_, i) => ({
            id: `scene-${String(i + 1).padStart(2, "0")}`,
            narration: `narration ${i}`,
          }));
          const manifest: WsManifest = { scenes: scenes.map((s) => ({ ...s })) };
          // Edits that empty the narration of some scenes (by index).
          const emptyIdxs = emptyIdxsRaw.filter((i) => i < sceneCount);
          const edits: ScriptEdit[] = emptyIdxs.map((i) => ({ sceneId: scenes[i]!.id, narration: "   " }));

          const writeManifest = vi.fn(async () => {});
          const ctrl = new WorkspaceController(baseDeps({ loadManifest: async () => manifest, writeManifest }));

          const res = await ctrl.applyEdits("p1", edits);
          if (emptyIdxs.length === 0) {
            expect(res).toEqual({ ok: true });
            expect(writeManifest).toHaveBeenCalledTimes(1);
          } else {
            const firstOffending = scenes[Math.min(...emptyIdxs)]!.id;
            expect(res).toEqual({ ok: false, reason: "empty-narration", sceneId: firstOffending });
            expect(writeManifest).not.toHaveBeenCalled();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("applies valid edits exactly once", async () => {
    const manifest: WsManifest = { scenes: [{ id: "scene-01", narration: "a" }, { id: "scene-02", narration: "b" }] };
    const writeManifest = vi.fn(async () => {});
    const ctrl = new WorkspaceController(baseDeps({ loadManifest: async () => manifest, writeManifest }));
    const res = await ctrl.applyEdits("p1", [{ sceneId: "scene-01", narration: "x", headline: "H" }]);
    expect(res).toEqual({ ok: true });
    expect(writeManifest).toHaveBeenCalledTimes(1);
    expect(manifest.scenes[0]).toEqual({ id: "scene-01", narration: "x", headline: "H" });
  });
});

// Property 8: Project stage recovery rules
describe("Property 8: project stage recovery rules", () => {
  it("no scenes→writing; has still→ready; else→script; read throws→writing", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 5 }),
        fc.boolean(),
        fc.boolean(),
        async (sceneCount, hasStill, threw) => {
          const scenes = Array.from({ length: sceneCount }, (_, i) => ({ id: `scene-${i + 1}`, narration: "n" }));
          const deps = baseDeps({
            loadManifest: async () => {
              if (threw) throw new Error("read fail");
              return { scenes };
            },
            hasStill: () => hasStill,
          });
          const ctrl = new WorkspaceController(deps);
          const stage = await ctrl.stage("p1");

          let expected: ProjectStage["kind"];
          if (threw) expected = "writing";
          else if (sceneCount === 0) expected = "writing";
          else if (hasStill) expected = "ready";
          else expected = "script";
          expect(stage.kind).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns the in-memory stage when known (no disk read)", async () => {
    const loadManifest = vi.fn(async () => ({ scenes: [] }));
    const ctrl = new WorkspaceController(baseDeps({ loadManifest }));
    ctrl.setStage("p1", { kind: "rendering", percent: 42 });
    expect(await ctrl.stage("p1")).toEqual({ kind: "rendering", percent: 42 });
    expect(loadManifest).not.toHaveBeenCalled();
  });
});

// Property 9: Render progress mapping attaches the correct projectId
describe("Property 9: render progress mapping", () => {
  it("percent = round(ratio*100); events.progress carries {projectId, ratio, phase:'draft'}", () => {
    fc.assert(
      fc.asyncProperty(
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 6 }),
        async (ratios) => {
          const progress: { projectId: string; ratio: number; phase: string }[] = [];
          const percents: number[] = [];
          const events = { ...noopEvents(), progress: (e: { projectId: string; ratio: number; phase: "draft" | "full" }) => progress.push(e) };

          let ctrl!: WorkspaceController;
          const worker: AgentWorker = {
            author: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
            reauthorScenes: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
            generateValidateRepair: async (_id, _opts, hooks: AgentHooks): Promise<RepairOutcome> => {
              for (const r of ratios) {
                hooks.onProgress(r);
                const st = await ctrl.stage("pX");
                if (st.kind === "rendering") percents.push(st.percent);
              }
              return { kind: "passed", attempts: 1 };
            },
          };
          ctrl = new WorkspaceController(baseDeps({ worker, events }));
          ctrl.approve("pX");
          await flush();

          expect(progress).toEqual(ratios.map((r) => ({ projectId: "pX", ratio: r, phase: "draft" })));
          expect(percents).toEqual(ratios.map((r) => Math.round(r * 100)));
        },
      ),
      { numRuns: 50 },
    );
  });
});
