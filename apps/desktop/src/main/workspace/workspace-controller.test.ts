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
    settings: { scriptGateEnabled: true, maxRepairAttempts: 3, visualQaEnabled: false, imageCrawlAiFilter: false, imageCrawlHumanReview: false },
    listProjects: async () => [],
    loadManifest: async () => ({ scenes: [] }),
    writeManifest: async () => {},
    reviewStill: (_id, sceneId) => `media://still/${sceneId}`,
    toMedia: (p) => p,
    hasStill: () => false,
    hasOutput: () => false,
    outputMedia: () => "media://out.mp4",
    hasDraft: () => false,
    draftMedia: () => "media://out.draft.mp4",
    assetMedia: (_id, ref) => `media://asset/${ref}`,
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
  it("AI visual-QA round: a flagged scene is reauthored + re-rendered before ready (when enabled)", async () => {
    const reauthorScenes = vi.fn(async () => ({ kind: "authored", sceneIds: ["scene-02"] }) as AuthorOutcome);
    const visualQa = vi.fn(async () => [{ sceneId: "scene-02", issue: "chữ đè lên nhau" }]);
    let renders = 0;
    const worker: AgentWorker = {
      author: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
      reauthorScenes,
      publish: async () => ({ ok: true, outputPath: "out.mp4" }),
      generateValidateRepair: async (): Promise<RepairOutcome> => { renders++; return { kind: "passed", attempts: 1 }; },
      visualQa,
    };
    const ctrl = new WorkspaceController(baseDeps({ worker, settings: { scriptGateEnabled: false, maxRepairAttempts: 3, visualQaEnabled: true, imageCrawlAiFilter: false, imageCrawlHumanReview: false } }));
    ctrl.approve("p1");
    await flush();
    expect(visualQa).toHaveBeenCalledTimes(1);
    expect(visualQa.mock.calls[0]).toEqual(["p1", undefined, expect.any(AbortSignal)]); // initial draft → checks ALL scenes
    expect(reauthorScenes).toHaveBeenCalledTimes(1); // flagged scene reauthored
    expect(renders).toBe(2); // initial draft + one QA re-render
    expect((await ctrl.stage("p1")).kind).toBe("ready");
  });

  it("post-edit QA is scoped to the edited scenes; disabled ⇒ never called", async () => {
    const visualQa = vi.fn(async () => [] as { sceneId: string; issue: string }[]);
    const worker: AgentWorker = {
      author: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
      reauthorScenes: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: ["scene-01"] }),
      publish: async () => ({ ok: true, outputPath: "out.mp4" }),
      generateValidateRepair: async (): Promise<RepairOutcome> => ({ kind: "passed", attempts: 1 }),
      visualQa,
    };
    const off = new WorkspaceController(baseDeps({ worker, settings: { scriptGateEnabled: false, maxRepairAttempts: 3, visualQaEnabled: false, imageCrawlAiFilter: false, imageCrawlHumanReview: false } }));
    off.approve("p1");
    await flush();
    expect(visualQa).not.toHaveBeenCalled();

    const on = new WorkspaceController(baseDeps({ worker, settings: { scriptGateEnabled: false, maxRepairAttempts: 3, visualQaEnabled: true, imageCrawlAiFilter: false, imageCrawlHumanReview: false } }));
    on.setStage("p2", { kind: "ready", scenes: [] });
    on.submitEdits("p2", [{ sceneId: "scene-01", text: "to chữ" }], "");
    await flush();
    expect(visualQa).toHaveBeenCalledWith("p2", ["scene-01"], expect.any(AbortSignal));
  });

  it("non-regressive: if the QA rewrite can't produce a clean draft, restore the pre-QA scenes (stays ready, not error)", async () => {
    const visualQa = vi.fn(async () => [{ sceneId: "scene-02", issue: "đè chữ" }]);
    const snapshotScenes = vi.fn(async () => [{ sceneId: "scene-02", code: "// OLD good code" }]);
    const restoreScenes = vi.fn(async () => {});
    let gen = 0;
    const worker: AgentWorker = {
      author: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
      reauthorScenes: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: ["scene-02"] }),
      publish: async () => ({ ok: true, outputPath: "out.mp4" }),
      generateValidateRepair: async (): Promise<RepairOutcome> => {
        gen++;
        // 1: initial draft passes; 2: post-QA rewrite fails; 3: post-restore passes.
        return gen === 2 ? { kind: "exhausted", attempts: 3, remainingHardErrors: 1 } : { kind: "passed", attempts: 1 };
      },
      visualQa,
      snapshotScenes,
      restoreScenes,
    };
    const ctrl = new WorkspaceController(baseDeps({ worker, settings: { scriptGateEnabled: false, maxRepairAttempts: 3, visualQaEnabled: true, imageCrawlAiFilter: false, imageCrawlHumanReview: false } }));
    ctrl.approve("p1");
    await flush();
    expect(snapshotScenes).toHaveBeenCalledWith("p1", ["scene-02"]);
    expect(restoreScenes).toHaveBeenCalledWith("p1", [{ sceneId: "scene-02", code: "// OLD good code" }]);
    expect(gen).toBe(3); // initial + QA re-render + restore re-render
    expect((await ctrl.stage("p1")).kind).toBe("ready"); // QA never downgraded the passing draft
  });

  it("in-flight guard: a second action while a render is running is ignored (no double-run)", async () => {
    let resolveGen: (() => void) | undefined;
    const gen = vi.fn(() => new Promise<RepairOutcome>((r) => { resolveGen = () => r({ kind: "passed", attempts: 1 }); }));
    const ctrl = new WorkspaceController(baseDeps({ worker: workerWith(gen) }));
    ctrl.approve("p1");
    ctrl.approve("p1"); // second call while the first render is still in flight
    await flush();
    expect(gen).toHaveBeenCalledTimes(1);
    resolveGen?.();
    await flush();
  });

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

// Retry-routing: an error stage carries a `retry` hint of WHICH loop failed so
// "Thử lại" re-runs that loop (re-render a render error) instead of always
// re-authoring a fresh script (which wasted tokens — the script was fine, the
// render wasn't). The hint is set at each error site; the publish guard reads it.
describe("error stage carries the right retry hint", () => {
  it('an author failure (no source / runScript) tags retry:"create"', async () => {
    const worker: AgentWorker = {
      author: async (): Promise<AuthorOutcome> => ({ kind: "no-source", message: "không tìm được nguồn" }),
      reauthorScenes: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
      publish: async () => ({ ok: true, outputPath: "out.mp4" }),
      generateValidateRepair: async (): Promise<RepairOutcome> => ({ kind: "passed", attempts: 1 }),
    };
    const ctrl = new WorkspaceController(baseDeps({ worker }));
    ctrl.beginScript("p1", { text: "x", urls: [] });
    await flush();
    const st = await ctrl.stage("p1");
    expect(st.kind === "error" && st.retry).toBe("create");
    expect(st.kind === "error" && st.fixable).toBe(false);
  });

  it('a render content-exhaust failure tags retry:"draft" + fixable:true', async () => {
    const ctrl = new WorkspaceController(
      baseDeps({ worker: workerWith({ kind: "exhausted", attempts: 3, remainingHardErrors: 2 }) }),
    );
    ctrl.approve("p1"); // runRender via approve (no script gate path needed)
    await flush();
    const st = await ctrl.stage("p1");
    expect(st.kind === "error" && st.retry).toBe("draft");
    expect(st.kind === "error" && st.fixable).toBe(true);
  });

  it('a render infra failure tags retry:"draft" + fixable:false', async () => {
    const ctrl = new WorkspaceController(baseDeps({ worker: workerWith({ kind: "infra", attempts: 1 }) }));
    ctrl.approve("p1");
    await flush();
    const st = await ctrl.stage("p1");
    expect(st.kind === "error" && st.retry).toBe("draft");
    expect(st.kind === "error" && st.fixable).toBe(false);
  });

  it('a publish (full-render) failure tags retry:"full"', async () => {
    const publish = vi.fn(async () => ({ ok: false as const, error: { message: "", stage: "render" as const, cause: "boom", severity: "error" as const } }));
    const worker = { ...workerWith({ kind: "passed", attempts: 1 }), publish };
    const ctrl = new WorkspaceController(baseDeps({ worker }));
    ctrl.setStage("p1", { kind: "ready", scenes: [] });
    ctrl.publish("p1");
    await flush();
    const st = await ctrl.stage("p1");
    expect(st.kind === "error" && st.retry).toBe("full");
  });
});

describe('publish re-runs from a retry:"full" error stage, not other errors', () => {
  it('a "Thử lại" on a publish error re-runs publish (not a re-author)', async () => {
    const publish = vi.fn(async () => ({ ok: true as const, outputPath: "/out/p1.mp4" }));
    const worker = { ...workerWith({ kind: "passed", attempts: 1 }), publish };
    const ctrl = new WorkspaceController(baseDeps({ worker, toMedia: (p) => `media://${p}` }));
    ctrl.setStage("p1", { kind: "error", message: "x", fixable: false, retry: "full" });
    ctrl.publish("p1"); // App.tsx routes a retry:"full" "Thử lại" to review.approveDraft → publish
    await flush();
    expect(publish).toHaveBeenCalledWith("p1", expect.any(AbortSignal));
    expect((await ctrl.stage("p1")).kind).toBe("published");
  });

  it('publish stays a no-op on a render (retry:"draft") error — that recovers via fixWithAi instead', async () => {
    const publish = vi.fn(async () => ({ ok: true as const, outputPath: "x" }));
    const worker = { ...workerWith({ kind: "passed", attempts: 1 }), publish };
    const ctrl = new WorkspaceController(baseDeps({ worker }));
    ctrl.setStage("p1", { kind: "error", message: "x", fixable: true, retry: "draft" });
    ctrl.publish("p1");
    await flush();
    expect(publish).not.toHaveBeenCalled();
  });
});

// Unreadable-link warning: when a brief link can't be fetched, the content
// leans on the model's own knowledge → surface a non-blocking warning so the
// user verifies before approving (it must never block the flow).
describe("runScript link warning (unreadable brief links)", () => {
  function authorReturning(unreadableUrls?: string[]): AgentWorker {
    return {
      author: async (): Promise<AuthorOutcome> => ({
        kind: "authored",
        sceneIds: ["scene-01"],
        ...(unreadableUrls ? { unreadableUrls } : {}),
      }),
      reauthorScenes: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
      publish: async () => ({ ok: true, outputPath: "out.mp4" }),
      generateValidateRepair: async (): Promise<RepairOutcome> => ({ kind: "passed", attempts: 1 }),
    };
  }

  it("gate ON + an unreadable link ⇒ the script stage carries a linkWarning naming the count", async () => {
    const ctrl = new WorkspaceController(
      baseDeps({ worker: authorReturning(["https://a.example/x"]), settings: { scriptGateEnabled: true, maxRepairAttempts: 3, visualQaEnabled: false, imageCrawlAiFilter: false, imageCrawlHumanReview: false } }),
    );
    ctrl.beginScript("p1", { text: "tóm tắt https://a.example/x", urls: ["https://a.example/x"] });
    await flush();
    const st = await ctrl.stage("p1");
    expect(st.kind).toBe("script");
    if (st.kind === "script") {
      expect(st.linkWarning).toBeDefined();
      expect(st.linkWarning).toContain("1/1");
    }
  });

  it("gate ON + every link read ⇒ NO linkWarning", async () => {
    const ctrl = new WorkspaceController(
      baseDeps({ worker: authorReturning(), settings: { scriptGateEnabled: true, maxRepairAttempts: 3, visualQaEnabled: false, imageCrawlAiFilter: false, imageCrawlHumanReview: false } }),
    );
    ctrl.beginScript("p1", { text: "tóm tắt https://a.example/x", urls: ["https://a.example/x"] });
    await flush();
    const st = await ctrl.stage("p1");
    expect(st.kind).toBe("script");
    if (st.kind === "script") expect(st.linkWarning).toBeUndefined();
  });

  it("script lines carry the AI-placed image as a previewable imagePath (Phase 2 Block B)", async () => {
    // After authoring, the manifest holds the AI's per-scene image placement; the
    // script-review stage must surface it (mapped through the assetMedia seam) so
    // the user sees which image landed on which scene before approving.
    const ctrl = new WorkspaceController(
      baseDeps({
        worker: authorReturning(),
        loadManifest: async () => ({
          scenes: [
            { id: "scene-01", headline: "H1", narration: "n1", image: { ref: "assets/aa.png" } },
            { id: "scene-02", headline: "H2", narration: "n2" },
          ],
        }),
        settings: { scriptGateEnabled: true, maxRepairAttempts: 3, visualQaEnabled: false, imageCrawlAiFilter: false, imageCrawlHumanReview: false },
      }),
    );
    ctrl.beginScript("p1", { text: "x", urls: [] });
    await flush();
    const st = await ctrl.stage("p1");
    expect(st.kind).toBe("script");
    if (st.kind === "script") {
      expect(st.lines[0]!.imagePath).toBe("media://asset/assets/aa.png");
      expect(st.lines[1]!.imagePath).toBeUndefined();
    }
  });

  it("gate OFF + an unreadable link ⇒ the warning rides through to the ready stage notice", async () => {
    const ctrl = new WorkspaceController(
      baseDeps({ worker: authorReturning(["https://a.example/x", "https://b.example/y"]), settings: { scriptGateEnabled: false, maxRepairAttempts: 3, visualQaEnabled: false, imageCrawlAiFilter: false, imageCrawlHumanReview: false } }),
    );
    ctrl.beginScript("p1", { text: "x", urls: ["https://a.example/x", "https://b.example/y"] });
    await flush();
    const st = await ctrl.stage("p1");
    expect(st.kind).toBe("ready");
    if (st.kind === "ready") {
      expect(st.notice).toBeDefined();
      expect(st.notice).toContain("2/2");
    }
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

  it("a global-note-only edit re-authors EVERY scene, carrying the note as each scene's intent", async () => {
    const reauthorScenes = vi.fn(async (job: { sceneIds: string[]; preprompt: { perSceneIntent: Record<string, string> } }) => ({ kind: "authored", sceneIds: job.sceneIds }) as AuthorOutcome);
    const worker = { ...workerWith({ kind: "passed", attempts: 1 }), reauthorScenes };
    const ctrl = new WorkspaceController(baseDeps({ worker, loadManifest: async () => ({ scenes: [{ id: "scene-01" }, { id: "scene-02" }] }) }));
    ctrl.setStage("p1", { kind: "ready", scenes: [] });
    ctrl.submitEdits("p1", [], "giọng ấm hơn");
    await flush();
    expect(reauthorScenes).toHaveBeenCalledTimes(1);
    const job = (reauthorScenes.mock.calls[0] as unknown[])[0] as { sceneIds: string[]; preprompt: { perSceneIntent: Record<string, string> } };
    expect(job.sceneIds).toEqual(["scene-01", "scene-02"]);
    expect(job.preprompt.perSceneIntent["scene-01"]).toContain("giọng ấm hơn");
    expect(job.preprompt.perSceneIntent["scene-02"]).toContain("giọng ấm hơn");
  });

  it("folds a global note INTO each per-scene intent", async () => {
    const reauthorScenes = vi.fn(async (job: { sceneIds: string[]; preprompt: { perSceneIntent: Record<string, string> } }) => ({ kind: "authored", sceneIds: job.sceneIds }) as AuthorOutcome);
    const worker = { ...workerWith({ kind: "passed", attempts: 1 }), reauthorScenes };
    const ctrl = new WorkspaceController(baseDeps({ worker }));
    ctrl.setStage("p1", { kind: "ready", scenes: [] });
    ctrl.submitEdits("p1", [{ sceneId: "scene-01", text: "to chữ tiêu đề" }], "tông màu ấm");
    await flush();
    const job = (reauthorScenes.mock.calls[0] as unknown[])[0] as { preprompt: { perSceneIntent: Record<string, string> } };
    expect(job.preprompt.perSceneIntent["scene-01"]).toContain("to chữ tiêu đề");
    expect(job.preprompt.perSceneIntent["scene-01"]).toContain("tông màu ấm");
  });

  it("when EVERY rewrite fails admission (none applied), returns to ready with a notice and does NOT re-render", async () => {
    const reauthorScenes = vi.fn(async () => ({ kind: "authored", sceneIds: [] }) as AuthorOutcome); // zero applied
    const generateValidateRepair = vi.fn(async () => ({ kind: "passed", attempts: 1 }) as RepairOutcome);
    const worker: AgentWorker = {
      author: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
      reauthorScenes,
      publish: async () => ({ ok: true, outputPath: "out.mp4" }),
      generateValidateRepair,
    };
    const ctrl = new WorkspaceController(baseDeps({ worker, loadManifest: async () => ({ scenes: [{ id: "scene-01" }] }) }));
    ctrl.setStage("p1", { kind: "ready", scenes: [] });
    ctrl.submitEdits("p1", [{ sceneId: "scene-01", text: "đổi nền xanh" }], "");
    await flush();
    expect(reauthorScenes).toHaveBeenCalledTimes(1);
    expect(generateValidateRepair).not.toHaveBeenCalled(); // no pointless re-render of unchanged code
    const st = await ctrl.stage("p1");
    expect(st.kind).toBe("ready");
    if (st.kind === "ready") expect(st.notice && st.notice.length > 0).toBe(true);
  });

  it("non-regressive: an edit that can't render cleanly restores the prior draft and stays ready (not error)", async () => {
    // The edit applies (admission ok) but the re-render exhausts repairs → the
    // edit broke the layout. The controller must restore the pre-edit source and
    // re-render the draft the user already had, landing on ready (with a notice),
    // never stranding them on an error screen with a broken scene.
    const reauthorScenes = vi.fn(async () => ({ kind: "authored", sceneIds: ["scene-01"] }) as AuthorOutcome);
    const snapshotScenes = vi.fn(async () => [{ sceneId: "scene-01", code: "// PRE-EDIT good code" }]);
    const restoreScenes = vi.fn(async () => {});
    // First repair (after the edit) exhausts; the post-restore re-render passes.
    const generateValidateRepair = vi
      .fn<() => Promise<RepairOutcome>>()
      .mockResolvedValueOnce({ kind: "exhausted", attempts: 3, remainingHardErrors: 2 })
      .mockResolvedValue({ kind: "passed", attempts: 1 });
    const worker: AgentWorker = {
      author: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
      reauthorScenes,
      publish: async () => ({ ok: true, outputPath: "out.mp4" }),
      generateValidateRepair,
      snapshotScenes,
      restoreScenes,
    };
    const ctrl = new WorkspaceController(baseDeps({ worker }));
    ctrl.setStage("p1", { kind: "ready", scenes: [] });
    ctrl.submitEdits("p1", [{ sceneId: "scene-01", text: "to chữ thật lớn" }], "");
    await flush();

    expect(snapshotScenes).toHaveBeenCalledWith("p1", ["scene-01"]);
    expect(restoreScenes).toHaveBeenCalledWith("p1", [{ sceneId: "scene-01", code: "// PRE-EDIT good code" }]);
    const st = await ctrl.stage("p1");
    expect(st.kind).toBe("ready");
    if (st.kind === "ready") expect(st.notice && st.notice.length > 0).toBe(true);
  });

  it("with no restore seam, a regressive edit still surfaces a fixable error (unchanged fallback)", async () => {
    // No snapshot/restore available → the non-regression guard can't run, so the
    // prior behaviour stands: an exhausted edit lands on a fixable error screen.
    const reauthorScenes = vi.fn(async () => ({ kind: "authored", sceneIds: ["scene-01"] }) as AuthorOutcome);
    const generateValidateRepair = vi.fn(async () => ({ kind: "exhausted", attempts: 3, remainingHardErrors: 1 }) as RepairOutcome);
    const friendlyError = vi.fn();
    const events = { ...noopEvents(), friendlyError };
    const worker: AgentWorker = {
      author: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
      reauthorScenes,
      publish: async () => ({ ok: true, outputPath: "out.mp4" }),
      generateValidateRepair,
      // no snapshotScenes / restoreScenes
    };
    const ctrl = new WorkspaceController(baseDeps({ worker, events }));
    ctrl.setStage("p1", { kind: "ready", scenes: [] });
    ctrl.submitEdits("p1", [{ sceneId: "scene-01", text: "đổi nền xanh" }], "");
    await flush();

    const st = await ctrl.stage("p1");
    expect(st.kind).toBe("error");
    if (st.kind === "error") expect(st.fixable).toBe(true);
    expect(friendlyError).toHaveBeenCalled();
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
    expect(publish).toHaveBeenCalledWith("p1", expect.any(AbortSignal));
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

  it("recovers a published stage from disk when the full MP4 exists", async () => {
    const ctrl = new WorkspaceController(
      baseDeps({ loadManifest: async () => ({ scenes: [{ id: "scene-01" }] }), hasOutput: () => true, outputMedia: () => "media://done.mp4" }),
    );
    const st = await ctrl.stage("p-done");
    expect(st.kind).toBe("published");
    if (st.kind === "published") expect(st.outputPath).toBe("media://done.mp4");
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

// "Dừng render" — cancelling an in-flight render is NOT a failure: the worker's
// loop sees the aborted signal and reports `cancelled`, and the controller
// recovers the prior reviewable stage from disk (never an error screen).
describe("cancel (Dừng render) → recover prior stage", () => {
  it("cancel during a render reports back to ready (a draft existed), not error", async () => {
    let seenSignal: AbortSignal | undefined;
    let release: (() => void) | undefined;
    const worker: AgentWorker = {
      author: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
      reauthorScenes: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
      publish: async () => ({ ok: true, outputPath: "out.mp4" }),
      // Hold the render open until cancel() fires, then report `cancelled` exactly
      // as the real loop does once it observes the aborted signal.
      generateValidateRepair: async (_id, _opts, _hooks, signal): Promise<RepairOutcome> => {
        seenSignal = signal;
        await new Promise<void>((r) => { release = r; });
        return { kind: "cancelled", attempts: 1 };
      },
    };
    // The project has stills + a draft on disk, so the recovered stage is `ready`.
    const ctrl = new WorkspaceController(
      baseDeps({
        worker,
        settings: { scriptGateEnabled: false, maxRepairAttempts: 3, visualQaEnabled: false, imageCrawlAiFilter: false, imageCrawlHumanReview: false },
        loadManifest: async () => ({ scenes: [{ id: "scene-01" }] }),
        hasStill: () => true,
        hasDraft: () => true,
        draftMedia: () => "media://p1.draft.mp4",
      }),
    );
    ctrl.approve("p1");
    await flush();
    expect((await ctrl.stage("p1")).kind).toBe("rendering");
    expect(seenSignal).toBeDefined();

    ctrl.cancel("p1");
    expect(seenSignal!.aborted).toBe(true);
    release?.();
    await flush();

    const st = await ctrl.stage("p1");
    expect(st.kind).toBe("ready");
    if (st.kind === "ready") expect(st.draftPath).toBe("media://p1.draft.mp4");
  });

  it("cancel() is a no-op when nothing is running for the project", () => {
    const ctrl = new WorkspaceController(baseDeps());
    expect(() => ctrl.cancel("nope")).not.toThrow();
  });
});
