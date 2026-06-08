import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { WorkspaceController, type WorkspaceDeps, type WsManifest } from "./workspace-controller.js";
import { stripL0Tokens } from "../redact/friendly.js";
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
    redact: (m) => m,
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

// Redaction at the workspace error boundary (R8.5)
describe("error-stage messages are redacted", () => {
  it("strips L0 engine tokens (N-codes, .tsx) from the error message", async () => {
    const worker: AgentWorker = {
      author: async (): Promise<AuthorOutcome> => ({ kind: "no-source", message: "Lỗi N14 ở /p/scene-01.tsx" }),
      reauthorScenes: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
      publish: async () => ({ ok: true, outputPath: "out.mp4" }),
      generateValidateRepair: async (): Promise<RepairOutcome> => ({ kind: "passed", attempts: 1 }),
    };
    const ctrl = new WorkspaceController(baseDeps({ worker, redact: stripL0Tokens }));
    ctrl.beginScript("p1", { text: "x", urls: [] });
    await flush();
    const st = await ctrl.stage("p1");
    expect(st.kind).toBe("error");
    if (st.kind === "error") {
      expect(st.message).not.toMatch(/N14|\.tsx/);
      expect(st.message.length).toBeGreaterThan(0);
    }
  });
});
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
            publish: async () => ({ ok: true, outputPath: "out.mp4" }),
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

// fixWithAi + fixable flag (desktop-author-mode, Req 5/7)
function workerWith(outcome: RepairOutcome | (() => Promise<RepairOutcome>)): AgentWorker {
  return {
    author: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
    reauthorScenes: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
    publish: async () => ({ ok: true, outputPath: "out.mp4" }),
    generateValidateRepair: typeof outcome === "function" ? (outcome as AgentWorker["generateValidateRepair"]) : async () => outcome,
  };
}

describe("fixWithAi + fixable flag", () => {
  it("from an error stage: passed ⇒ ready", async () => {
    const ctrl = new WorkspaceController(baseDeps({ worker: workerWith({ kind: "passed", attempts: 2 }) }));
    ctrl.setStage("p1", { kind: "error", message: "x", fixable: true });
    ctrl.fixWithAi("p1");
    await flush();
    expect((await ctrl.stage("p1")).kind).toBe("ready");
  });

  it("exhausted ⇒ error with fixable:true; infra ⇒ error with fixable:false", async () => {
    const exhausted = new WorkspaceController(baseDeps({ worker: workerWith({ kind: "exhausted", attempts: 3, remainingHardErrors: 2 }) }));
    exhausted.setStage("p1", { kind: "error", message: "x", fixable: true });
    exhausted.fixWithAi("p1");
    await flush();
    const e = await exhausted.stage("p1");
    expect(e.kind === "error" && e.fixable).toBe(true);

    const infra = new WorkspaceController(baseDeps({ worker: workerWith({ kind: "infra", attempts: 1 }) }));
    infra.setStage("p2", { kind: "error", message: "x", fixable: true });
    infra.fixWithAi("p2");
    await flush();
    const i = await infra.stage("p2");
    expect(i.kind === "error" && i.fixable).toBe(false);
  });

  it("is a no-op when the stage is not error (no double-run)", async () => {
    const gen = vi.fn(async () => ({ kind: "passed", attempts: 1 }) as RepairOutcome);
    const worker = workerWith(gen);
    const ctrl = new WorkspaceController(baseDeps({ worker }));
    ctrl.setStage("p1", { kind: "ready", scenes: [] });
    ctrl.fixWithAi("p1");
    await flush();
    expect(gen).not.toHaveBeenCalled();
  });
});

// Per-scene free-form edit → reauthor + re-render (desktop-author-mode, Part B)
describe("submitEdits (per-scene free-form edit)", () => {
  it("from ready: re-authors the edited scene with its instruction, re-renders, returns to ready", async () => {
    const reauthorScenes = vi.fn(async () => ({ kind: "authored", sceneIds: ["scene-01"] }) as AuthorOutcome);
    const worker: AgentWorker = {
      author: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
      reauthorScenes,
      publish: async () => ({ ok: true, outputPath: "out.mp4" }),
      generateValidateRepair: async (): Promise<RepairOutcome> => ({ kind: "passed", attempts: 1 }),
    };
    const ctrl = new WorkspaceController(baseDeps({ worker }));
    ctrl.setStage("p1", { kind: "ready", scenes: [] });
    ctrl.submitEdits("p1", [{ sceneId: "scene-01", text: "to chữ tiêu đề lên" }], "");
    await flush();

    expect(reauthorScenes).toHaveBeenCalledTimes(1);
    const job = (reauthorScenes.mock.calls[0] as unknown[])[0] as { projectId: string; sceneIds: string[]; preprompt: { perSceneIntent: Record<string, string> } };
    expect(job.projectId).toBe("p1");
    expect(job.sceneIds).toEqual(["scene-01"]);
    expect(job.preprompt.perSceneIntent).toEqual({ "scene-01": "to chữ tiêu đề lên" });
    expect((await ctrl.stage("p1")).kind).toBe("ready");
  });

  it("is a no-op when not in the ready stage", async () => {
    const reauthorScenes = vi.fn(async () => ({ kind: "authored", sceneIds: [] }) as AuthorOutcome);
    const worker = { ...workerWith({ kind: "passed", attempts: 1 }), reauthorScenes };
    const ctrl = new WorkspaceController(baseDeps({ worker }));
    ctrl.setStage("p1", { kind: "writing" });
    ctrl.submitEdits("p1", [{ sceneId: "scene-01", text: "x" }], "");
    await flush();
    expect(reauthorScenes).not.toHaveBeenCalled();
  });

  it("is a no-op when every edit is blank and there are no notes", async () => {
    const reauthorScenes = vi.fn(async () => ({ kind: "authored", sceneIds: [] }) as AuthorOutcome);
    const worker = { ...workerWith({ kind: "passed", attempts: 1 }), reauthorScenes };
    const ctrl = new WorkspaceController(baseDeps({ worker }));
    ctrl.setStage("p1", { kind: "ready", scenes: [] });
    ctrl.submitEdits("p1", [{ sceneId: "scene-01", text: "   " }], "  ");
    await flush();
    expect(reauthorScenes).not.toHaveBeenCalled();
  });
});
describe("publish (full render)", () => {
  it("from ready: renders full and moves to published with the output path", async () => {
    const publish = vi.fn(async () => ({ ok: true as const, outputPath: "/out/p1.mp4" }));
    const worker = { ...workerWith({ kind: "passed", attempts: 1 }), publish };
    const ctrl = new WorkspaceController(baseDeps({ worker, toMedia: (p) => `media://${p}` }));
    ctrl.setStage("p1", { kind: "ready", scenes: [] });
    ctrl.publish("p1");
    await flush();
    expect(publish).toHaveBeenCalledWith("p1");
    const st = await ctrl.stage("p1");
    expect(st.kind).toBe("published");
    if (st.kind === "published") expect(st.outputPath).toBe("media:///out/p1.mp4");
  });

  it("is a no-op outside the ready stage", async () => {
    const publish = vi.fn(async () => ({ ok: true as const, outputPath: "x" }));
    const worker = { ...workerWith({ kind: "passed", attempts: 1 }), publish };
    const ctrl = new WorkspaceController(baseDeps({ worker }));
    ctrl.setStage("p1", { kind: "writing" });
    ctrl.publish("p1");
    await flush();
    expect(publish).not.toHaveBeenCalled();
  });

  it("a full-render failure surfaces a redacted error", async () => {
    const publish = vi.fn(async () => ({ ok: false as const, error: { message: "", stage: "render" as const, cause: "boom N14 .tsx", severity: "error" as const } }));
    const worker = { ...workerWith({ kind: "passed", attempts: 1 }), publish };
    const ctrl = new WorkspaceController(baseDeps({ worker, redact: stripL0Tokens }));
    ctrl.setStage("p1", { kind: "ready", scenes: [] });
    ctrl.publish("p1");
    await flush();
    const st = await ctrl.stage("p1");
    expect(st.kind).toBe("error");
    if (st.kind === "error") expect(st.message).not.toMatch(/N14|\.tsx/);
  });
});

describe("Property 6: redaction holds for the new repair paths", () => {
  // Feature: desktop-author-mode, Property 6: redaction holds for new paths
  it("a render throw carrying N-codes/.tsx surfaces a clean friendly message", async () => {
    const friendlyErrors: { message: string; fixable?: boolean }[] = [];
    const events = { ...noopEvents(), friendlyError: (e: { message: string; fixable?: boolean }) => friendlyErrors.push(e) };
    const worker = workerWith(async () => {
      throw new Error("render-oracle N14 failed in /p/authored/scene-01.tsx { }");
    });
    const ctrl = new WorkspaceController(baseDeps({ worker, events, redact: stripL0Tokens }));
    ctrl.setStage("p1", { kind: "error", message: "x", fixable: true });
    ctrl.fixWithAi("p1");
    await flush();
    expect(friendlyErrors.length).toBeGreaterThan(0);
    for (const fe of friendlyErrors) expect(fe.message).not.toMatch(/N14|\.tsx|[{}]/);
    const st = await ctrl.stage("p1");
    expect(st.kind).toBe("error");
    if (st.kind === "error") expect(st.message).not.toMatch(/N14|\.tsx|[{}]/);
  });
});
