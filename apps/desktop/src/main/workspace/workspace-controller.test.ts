import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { WorkspaceController, type WorkspaceDeps, type WsManifest } from "./workspace-controller.js";
import { stripL0Tokens } from "../redact/friendly.js";
import type { AgentHooks, AgentWorker, AuthorImageRef, AuthorOutcome, RepairOutcome } from "../agent/agent-worker.js";
import type { ProjectCardVM, ProjectStage, ScriptEdit } from "../../shared/types.js";

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
    settings: { scriptGateEnabled: true, maxRepairAttempts: 3, refinePasses: 0, refineEarlyStop: true, imageCrawlAiFilter: false, imageCrawlHumanReview: false },
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
    hasThumbnail: () => false,
    thumbnailMedia: () => "media://thumbnail.png",
    assetMedia: (_id, ref) => `media://asset/${ref}`,
    deleteProject: async () => {},
    revealProject: async () => {},
    redact: (m) => m,
    ...over,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function card(over: Partial<ProjectCardVM> = {}): ProjectCardVM {
  return {
    projectId: "p1",
    title: "T",
    thumbnailPath: null,
    format: "tiktok",
    status: "error",
    createdAtLabel: "20/06/2026",
    ...over,
  };
}

describe("projects:list status recovery", () => {
  it("uses the full MP4 on disk as done when the brief/card status is stale", async () => {
    const ctrl = new WorkspaceController(baseDeps({
      listProjects: async () => [card({ status: "error" })],
      hasOutput: () => true,
    }));
    expect((await ctrl.list())[0]?.status).toBe("done");
  });

  it("uses an existing draft on disk as draft-ready when no full MP4 exists", async () => {
    const ctrl = new WorkspaceController(baseDeps({
      listProjects: async () => [card({ status: "building" })],
      hasDraft: () => true,
    }));
    expect((await ctrl.list())[0]?.status).toBe("draft-ready");
  });

  it("lets a live in-memory stage win over disk artifacts", async () => {
    const ctrl = new WorkspaceController(baseDeps({
      listProjects: async () => [card({ status: "done" })],
      hasOutput: () => true,
    }));
    ctrl.setStage("p1", { kind: "error", message: "x", fixable: false });
    expect((await ctrl.list())[0]?.status).toBe("error");
  });
});

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
  it("no scenes→error(retry:create); has still→ready; else→script; read throws→error", async () => {
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

          // A stranded scaffold (0 scenes) or an unreadable manifest is NOT a live
          // job here (a running job holds an in-memory "writing" stage that stage()
          // returns first), so it must land on a recoverable error — never a
          // permanent "writing" spinner with no affordance.
          let expected: ProjectStage["kind"];
          if (threw) expected = "error";
          else if (sceneCount === 0) expected = "error";
          else if (hasStill) expected = "ready";
          else expected = "script";
          expect(stage.kind).toBe(expected);
          if (expected === "error" && stage.kind === "error") expect(stage.retry).toBe("create");
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
  it("silent refine BEFORE the draft: vision flags a scene, reauthors + re-renders stills, then the draft renders ONCE; stops early", async () => {
    // freeform-engine L1: refine now runs on the cheap stills path BEFORE the first
    // MP4 draft (not after a 100%-complete draft). The manifest here has the flagged
    // scene, so the creative bootstrap reauthors it too; we assert the vision loop's
    // behavior + that the draft MP4 renders exactly ONCE (after refine).
    const reauthorScenes = vi.fn(async () => ({ kind: "authored", sceneIds: ["scene-02"] }) as AuthorOutcome);
    // refinePasses=2: pass 1 flags a defect, pass 2 finds none → early stop (R4.5).
    const visualQa = vi
      .fn<(p: string, s?: string[], sig?: AbortSignal) => Promise<{ sceneId: string; issue: string }[]>>()
      .mockResolvedValueOnce([{ sceneId: "scene-02", issue: "chữ đè lên nhau" }])
      .mockResolvedValueOnce([]);
    const renderStills = vi.fn(async () => ({ stills: ["media://still/scene-02.png"] }));
    let renders = 0;
    const worker: AgentWorker = {
      author: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
      reauthorScenes,
      publish: async () => ({ ok: true, outputPath: "out.mp4" }),
      generateValidateRepair: async (): Promise<RepairOutcome> => { renders++; return { kind: "passed", attempts: 1 }; },
      visualQa,
      renderStills,
      snapshotScenes: async (_id, ids) => ids.map((id) => ({ sceneId: id, code: "// good" })),
      restoreScenes: async () => {},
    };
    const ctrl = new WorkspaceController(baseDeps({ worker, loadManifest: async () => ({ scenes: [{ id: "scene-02" }] }), settings: { scriptGateEnabled: false, maxRepairAttempts: 3, refinePasses: 2, refineEarlyStop: true, imageCrawlAiFilter: false, imageCrawlHumanReview: false } }));
    ctrl.approve("p1");
    await flush();
    expect(visualQa).toHaveBeenCalledTimes(2); // pass 1 (flags) + pass 2 (clean → early stop)
    expect(visualQa.mock.calls[0]).toEqual(["p1", undefined, expect.any(AbortSignal)]); // first-author refine → ALL scenes
    expect(renderStills).toHaveBeenCalledWith("p1", ["scene-02"], expect.any(AbortSignal)); // cheap per-scene re-render in the vision pass
    const reauthorCalls = reauthorScenes.mock.calls as unknown as [[{ preprompt: { perSceneIntent: Record<string, string> } }], [{ preprompt: { perSceneIntent: Record<string, string> } }]];
    const visionIntent = reauthorCalls[1]![0].preprompt.perSceneIntent["scene-02"];
    expect(visionIntent).toMatch(/Sửa tối thiểu/);
    expect(visionIntent).toMatch(/KHÔNG được biến cảnh thành title-card/);
    expect(renders).toBe(1); // the draft MP4 renders exactly ONCE, AFTER refine (no draft-before-refine)
    expect((await ctrl.stage("p1")).kind).toBe("ready");
  });

  it("first-author creative bootstrap reauthors EVERY scene once before the draft, even with no vision defects", async () => {
    // freeform-engine L1: the "render lại cho sáng tạo hơn" pass — one bold rewrite
    // over ALL scenes BEFORE any defect is flagged, so the first draft is already
    // ambitious. With visualQa returning no defects, the bootstrap is the ONLY
    // reauthor, and it covers every manifest scene.
    const reauthorScenes = vi.fn(async (job: { sceneIds: string[] }) => ({ kind: "authored", sceneIds: job.sceneIds }) as AuthorOutcome);
    const visualQa = vi.fn(async () => [] as { sceneId: string; issue: string }[]);
    const renderStills = vi.fn(async () => ({ stills: ["media://still/scene-01.png", "media://still/scene-02.png"] }));
    let renders = 0;
    const worker: AgentWorker = {
      author: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
      reauthorScenes,
      publish: async () => ({ ok: true, outputPath: "out.mp4" }),
      generateValidateRepair: async (): Promise<RepairOutcome> => { renders++; return { kind: "passed", attempts: 1 }; },
      visualQa,
      renderStills,
      snapshotScenes: async (_id, ids) => ids.map((id) => ({ sceneId: id, code: "// blind" })),
      restoreScenes: async () => {},
    };
    const ctrl = new WorkspaceController(baseDeps({ worker, loadManifest: async () => ({ scenes: [{ id: "scene-01" }, { id: "scene-02" }] }), settings: { scriptGateEnabled: false, maxRepairAttempts: 3, refinePasses: 2, refineEarlyStop: true, imageCrawlAiFilter: false, imageCrawlHumanReview: false } }));
    ctrl.approve("p1");
    await flush();
    expect(reauthorScenes).toHaveBeenCalledTimes(1); // ONE bold bootstrap (no vision defects to fix)
    const job = (reauthorScenes.mock.calls[0] as unknown[])[0] as {
      sceneIds: string[];
      preprompt: { perSceneIntent: Record<string, string> };
    };
    expect(job.sceneIds).toEqual(["scene-01", "scene-02"]); // EVERY scene
    const bootstrapIntent = job.preprompt.perSceneIntent["scene-01"] ?? "";
    expect(bootstrapIntent).toMatch(/ĐANG DIỄN TIẾN qua phần lớn thời lượng/);
    expect(bootstrapIntent).toMatch(/khuyến khích sáng tạo, KHÔNG bắt buộc/);
    expect(bootstrapIntent).toMatch(/cảnh tĩnh có chủ đích vẫn hợp lệ/);
    expect(bootstrapIntent).toMatch(/interpolate có clamp hoặc spring/);
    expect(bootstrapIntent).toMatch(/KHÔNG dùng Math\.sin\(frame\)/);
    expect(bootstrapIntent).not.toMatch(/ANIMATION PHẢI|NHIỀU PHA|chuyển động LIÊN TỤC|mạch đập|nhịp thở chậm/);
    expect(renderStills).toHaveBeenCalledWith("p1", ["scene-01", "scene-02"], expect.any(AbortSignal)); // re-render all after the bold rewrite
    expect(renders).toBe(1); // draft MP4 once, after refine
    expect((await ctrl.stage("p1")).kind).toBe("ready");
  });

  it("loading status (freeform-engine L3): the two hidden pre-draft renders use the neutral 'prepare' phase; vision passes carry qaPass/qaTotal", async () => {
    // The bland bản-1 render + the creative bootstrap must NOT surface a detailed
    // render stage (the user never sees the raw/intermediate takes) — they show as
    // the neutral "prepare" phase. The DEFECT-fixing vision loop, by contrast,
    // annotates each "qa" stage with which round is running (lần N/M) so the
    // spinner isn't opaque. refinePasses=2: pass 1 flags, pass 2 clean → stops.
    const reauthorScenes = vi.fn(async (job: { sceneIds: string[] }) => ({ kind: "authored", sceneIds: job.sceneIds }) as AuthorOutcome);
    const visualQa = vi
      .fn<(p: string, s?: string[], sig?: AbortSignal) => Promise<{ sceneId: string; issue: string }[]>>()
      .mockResolvedValueOnce([{ sceneId: "scene-01", issue: "đè chữ" }])
      .mockResolvedValueOnce([]);
    const worker: AgentWorker = {
      author: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
      reauthorScenes,
      publish: async () => ({ ok: true, outputPath: "out.mp4" }),
      generateValidateRepair: async (): Promise<RepairOutcome> => ({ kind: "passed", attempts: 1 }),
      visualQa,
      renderStills: async () => ({ stills: ["media://still/scene-01.png"] }),
      snapshotScenes: async (_id, ids) => ids.map((id) => ({ sceneId: id, code: "// good" })),
      restoreScenes: async () => {},
    };
    const ctrl = new WorkspaceController(baseDeps({ worker, loadManifest: async () => ({ scenes: [{ id: "scene-01" }] }), settings: { scriptGateEnabled: false, maxRepairAttempts: 3, refinePasses: 2, refineEarlyStop: true, imageCrawlAiFilter: false, imageCrawlHumanReview: false } }));
    // Capture every rendering stage the controller emits during the flow.
    const seen: Extract<ProjectStage, { kind: "rendering" }>[] = [];
    const realSetStage = ctrl.setStage.bind(ctrl);
    vi.spyOn(ctrl, "setStage").mockImplementation((id, stage) => {
      if (stage.kind === "rendering") seen.push(stage);
      realSetStage(id, stage);
    });
    ctrl.approve("p1");
    await flush();
    // The two hidden pre-draft renders (bản-1 + bootstrap) are "prepare", never a
    // raw "draft"/"qa" percent — so the user doesn't see the bland/bootstrap takes.
    const prepares = seen.filter((s) => s.phase === "prepare");
    expect(prepares.length).toBeGreaterThanOrEqual(2);
    // The vision pass that actually fixed a defect carries the round counter.
    const qaWithPass = seen.find((s) => s.phase === "qa" && s.qaPass !== undefined);
    expect(qaWithPass).toMatchObject({ phase: "qa", qaPass: 1, qaTotal: 2 });
  });

  it("early-stop (freeform-engine L4): ON needs TWO consecutive clean passes; OFF burns the full count", async () => {
    // L4 strengthened the stop rule: a SINGLE clean vision pass no longer ends the
    // loop (the vision model is non-deterministic — it can miss a defect on one
    // glance then catch it next). With early-stop ON, two clean passes IN A ROW are
    // required; a flagged pass resets the streak. With it OFF, the loop always runs
    // the full `refinePasses`. Driven through the first-author flow (`approve`); the
    // creative bootstrap never calls visualQa, so the visualQa count == vision passes.
    const makeWorker = (
      visualQa: (p: string, s?: string[], sig?: AbortSignal) => Promise<{ sceneId: string; issue: string }[]>,
    ): AgentWorker => ({
      author: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
      reauthorScenes: async (job: { sceneIds: string[] }) => ({ kind: "authored", sceneIds: job.sceneIds }) as AuthorOutcome,
      publish: async () => ({ ok: true, outputPath: "out.mp4" }),
      generateValidateRepair: async (): Promise<RepairOutcome> => ({ kind: "passed", attempts: 1 }),
      visualQa: vi.fn(visualQa),
      renderStills: async () => ({ stills: ["media://still/scene-01.png"] }),
      snapshotScenes: async (_id, ids) => ids.map((id) => ({ sceneId: id, code: "// good" })),
      restoreScenes: async () => {},
    });
    const run = async (over: { refinePasses: number; refineEarlyStop: boolean }, worker: AgentWorker) => {
      const ctrl = new WorkspaceController(baseDeps({
        worker,
        loadManifest: async () => ({ scenes: [{ id: "scene-01" }] }),
        settings: { scriptGateEnabled: false, maxRepairAttempts: 3, ...over, imageCrawlAiFilter: false, imageCrawlHumanReview: false },
      }));
      ctrl.approve("p1");
      await flush();
      return worker.visualQa as ReturnType<typeof vi.fn>;
    };

    // ON + [clean, clean]: two clean in a row → stop after pass 2 (not the full 5).
    const wA = makeWorker(async () => []);
    expect((await run({ refinePasses: 5, refineEarlyStop: true }, wA))).toHaveBeenCalledTimes(2);

    // ON + [defect, clean, clean]: the defect resets the streak, so it takes a clean
    // PAIR after it → passes run 1(defect),2(clean),3(clean) then stop. 4th never runs.
    let n = 0;
    const wB = makeWorker(async () => (++n === 1 ? [{ sceneId: "scene-01", issue: "đè chữ" }] : []));
    expect((await run({ refinePasses: 5, refineEarlyStop: true }, wB))).toHaveBeenCalledTimes(3);

    // OFF + always clean: the streak never triggers a break → burns the full count.
    const wC = makeWorker(async () => []);
    expect((await run({ refinePasses: 3, refineEarlyStop: false }, wC))).toHaveBeenCalledTimes(3);
  });

  it("post-edit refine is scoped to the edited scenes; refinePasses=0 ⇒ never called", async () => {
    const visualQa = vi.fn(async () => [] as { sceneId: string; issue: string }[]);
    const worker: AgentWorker = {
      author: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
      reauthorScenes: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: ["scene-01"] }),
      publish: async () => ({ ok: true, outputPath: "out.mp4" }),
      generateValidateRepair: async (): Promise<RepairOutcome> => ({ kind: "passed", attempts: 1 }),
      visualQa,
      renderStills: async () => ({ stills: ["media://still/scene-01.png"] }),
    };
    const off = new WorkspaceController(baseDeps({ worker, settings: { scriptGateEnabled: false, maxRepairAttempts: 3, refinePasses: 0, refineEarlyStop: true, imageCrawlAiFilter: false, imageCrawlHumanReview: false } }));
    off.approve("p1");
    await flush();
    expect(visualQa).not.toHaveBeenCalled();

    const on = new WorkspaceController(baseDeps({ worker, settings: { scriptGateEnabled: false, maxRepairAttempts: 3, refinePasses: 1, refineEarlyStop: true, imageCrawlAiFilter: false, imageCrawlHumanReview: false } }));
    on.setStage("p2", { kind: "ready", scenes: [] });
    on.submitEdits("p2", [{ sceneId: "scene-01", text: "to chữ" }], "");
    await flush();
    expect(visualQa).toHaveBeenCalledWith("p2", ["scene-01"], expect.any(AbortSignal));
  });

  it("edit path renders stills + vision BEFORE the single draft MP4 (draft once, at the end)", async () => {
    // The core "stills-first" guarantee for a user edit: reauthor → renderStills(scope)
    // → visualQa(scope) → ONE generateValidateRepair (the draft MP4). No draft MP4 is
    // rendered before vision runs (the old waste was a full draft just to feed vision).
    const calls: string[] = [];
    const reauthorScenes = vi.fn(async (): Promise<AuthorOutcome> => { calls.push("reauthor"); return { kind: "authored", sceneIds: ["scene-01"] }; });
    const renderStills = vi.fn(async () => { calls.push("renderStills"); return { stills: ["media://still/scene-01.png"] }; });
    const visualQa = vi.fn(async () => { calls.push("visualQa"); return [] as { sceneId: string; issue: string }[]; });
    const generateValidateRepair = vi.fn(async (): Promise<RepairOutcome> => { calls.push("draft"); return { kind: "passed", attempts: 1 }; });
    const worker: AgentWorker = {
      author: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
      reauthorScenes,
      publish: async () => ({ ok: true, outputPath: "out.mp4" }),
      generateValidateRepair,
      visualQa,
      renderStills,
      snapshotScenes: async (_id, ids) => ids.map((id) => ({ sceneId: id, code: "// good" })),
      restoreScenes: async () => {},
    };
    const ctrl = new WorkspaceController(baseDeps({ worker, loadManifest: async () => ({ scenes: [{ id: "scene-01" }] }), settings: { scriptGateEnabled: false, maxRepairAttempts: 3, refinePasses: 1, refineEarlyStop: true, imageCrawlAiFilter: false, imageCrawlHumanReview: false } }));
    ctrl.setStage("p1", { kind: "ready", scenes: [] });
    ctrl.submitEdits("p1", [{ sceneId: "scene-01", text: "to chữ" }], "");
    await flush();
    expect(generateValidateRepair).toHaveBeenCalledTimes(1); // draft MP4 exactly ONCE
    // renderStills + visualQa both ran before the only draft render.
    expect(calls.indexOf("renderStills")).toBeLessThan(calls.indexOf("draft"));
    expect(calls.indexOf("visualQa")).toBeLessThan(calls.indexOf("draft"));
    expect((await ctrl.stage("p1")).kind).toBe("ready");
  });

  it("edit path: stills break (empty) ⇒ restore pre-edit source, keep prior draft, no broken-edit draft", async () => {
    // A user edit that breaks admission/render yields empty stills on the cheap path.
    // We must restore the pre-edit source and re-render the draft the user already had
    // — never render the broken edit's draft, never strand the user on an error.
    const snapshotScenes = vi.fn(async () => [{ sceneId: "scene-01", code: "// PRE-EDIT good" }]);
    const restoreScenes = vi.fn(async () => {});
    let gen = 0;
    const generateValidateRepair = vi.fn(async (): Promise<RepairOutcome> => { gen++; return { kind: "passed", attempts: 1 }; });
    const worker: AgentWorker = {
      author: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
      reauthorScenes: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: ["scene-01"] }),
      publish: async () => ({ ok: true, outputPath: "out.mp4" }),
      generateValidateRepair,
      visualQa: async () => [],
      renderStills: async () => ({ stills: [] }), // edit broke the render
      snapshotScenes,
      restoreScenes,
    };
    const ctrl = new WorkspaceController(baseDeps({ worker, loadManifest: async () => ({ scenes: [{ id: "scene-01" }] }), settings: { scriptGateEnabled: false, maxRepairAttempts: 3, refinePasses: 1, refineEarlyStop: true, imageCrawlAiFilter: false, imageCrawlHumanReview: false } }));
    ctrl.setStage("p1", { kind: "ready", scenes: [] });
    ctrl.submitEdits("p1", [{ sceneId: "scene-01", text: "làm hỏng" }], "");
    await flush();
    expect(restoreScenes).toHaveBeenCalledWith("p1", [{ sceneId: "scene-01", code: "// PRE-EDIT good" }]);
    expect(gen).toBe(1); // only the restored-draft re-render; the broken edit never rendered a draft
    expect((await ctrl.stage("p1")).kind).toBe("ready"); // kept the prior draft, not an error
  });

  it("non-regressive: if the post-refine draft can't be repaired, restore the blind pre-refine scenes (stays ready, not error)", async () => {
    // freeform-engine L1: refine (bootstrap + vision) runs on stills BEFORE the
    // draft MP4. If the refined draft then exhausts repairs, restore the blind
    // pre-refine source and re-render it — refine must never ship a draft worse
    // than the un-refined one. The draft MP4 renders at most twice (refined, then
    // restored), never a draft-before-refine.
    const visualQa = vi.fn(async () => [{ sceneId: "scene-02", issue: "đè chữ" }]);
    const snapshotScenes = vi.fn(async () => [{ sceneId: "scene-02", code: "// BLIND good code" }]);
    const restoreScenes = vi.fn(async () => {});
    let gen = 0;
    const worker: AgentWorker = {
      author: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
      reauthorScenes: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: ["scene-02"] }),
      publish: async () => ({ ok: true, outputPath: "out.mp4" }),
      generateValidateRepair: async (): Promise<RepairOutcome> => {
        gen++;
        // 1: post-refine draft exhausts; 2: post-restore (blind) draft passes.
        return gen === 1 ? { kind: "exhausted", attempts: 3, remainingHardErrors: 1 } : { kind: "passed", attempts: 1 };
      },
      visualQa,
      renderStills: async () => ({ stills: ["media://still/scene-02.png"] }),
      snapshotScenes,
      restoreScenes,
    };
    const ctrl = new WorkspaceController(baseDeps({ worker, loadManifest: async () => ({ scenes: [{ id: "scene-02" }] }), settings: { scriptGateEnabled: false, maxRepairAttempts: 3, refinePasses: 1, refineEarlyStop: true, imageCrawlAiFilter: false, imageCrawlHumanReview: false } }));
    ctrl.approve("p1");
    await flush();
    expect(snapshotScenes).toHaveBeenCalledWith("p1", ["scene-02"]);
    expect(restoreScenes).toHaveBeenCalledWith("p1", [{ sceneId: "scene-02", code: "// BLIND good code" }]);
    expect(gen).toBe(2); // refined draft (exhausted) + restored blind draft
    expect((await ctrl.stage("p1")).kind).toBe("ready"); // refine never downgraded to an error
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

// A project stranded across an app restart (cancel mid-crawl / quit while
// authoring) recovers to an error stage whose "Thử lại" calls retry(). After a
// restart the in-memory input map is empty, so retry() must rehydrate the
// AuthorInput from the persisted brief via recallInput — otherwise the button is
// a silent no-op and the poll re-derives the same error (error↔writing flicker).
describe("retry() rehydrates the author input from disk when not in memory", () => {
  it("with no in-memory input, retry pulls the input from recallInput and re-authors", async () => {
    const author = vi.fn<AgentWorker["author"]>(async () => ({ kind: "authored", sceneIds: [] }));
    const worker: AgentWorker = {
      author,
      reauthorScenes: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
      publish: async () => ({ ok: true, outputPath: "out.mp4" }),
      generateValidateRepair: async (): Promise<RepairOutcome> => ({ kind: "passed", attempts: 1 }),
    };
    const recallInput = vi.fn(async () => ({ text: "chủ đề đã lưu", urls: ["https://a.example/x"] }));
    // Fresh controller (nothing in the in-memory inputs map) ⇒ simulates a restart.
    const ctrl = new WorkspaceController(baseDeps({ worker, recallInput, settings: { scriptGateEnabled: false, maxRepairAttempts: 3, refinePasses: 0, refineEarlyStop: true, imageCrawlAiFilter: false, imageCrawlHumanReview: false } }));
    await ctrl.retry("p-restart");
    await flush();
    expect(recallInput).toHaveBeenCalledWith("p-restart");
    expect(author).toHaveBeenCalledTimes(1);
    expect(author.mock.calls[0]![0]).toMatchObject({ projectId: "p-restart", input: { text: "chủ đề đã lưu", urls: ["https://a.example/x"] } });
  });

  it("is a no-op (no throw) when the input can't be recalled either", async () => {
    const author = vi.fn(async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }));
    const worker = { ...workerWith({ kind: "passed", attempts: 1 }), author };
    const recallInput = vi.fn(async () => null);
    const ctrl = new WorkspaceController(baseDeps({ worker, recallInput }));
    await ctrl.retry("p-gone");
    await flush();
    expect(author).not.toHaveBeenCalled();
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
      baseDeps({ worker: authorReturning(["https://a.example/x"]), settings: { scriptGateEnabled: true, maxRepairAttempts: 3, refinePasses: 0, refineEarlyStop: true, imageCrawlAiFilter: false, imageCrawlHumanReview: false } }),
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
      baseDeps({ worker: authorReturning(), settings: { scriptGateEnabled: true, maxRepairAttempts: 3, refinePasses: 0, refineEarlyStop: true, imageCrawlAiFilter: false, imageCrawlHumanReview: false } }),
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
        settings: { scriptGateEnabled: true, maxRepairAttempts: 3, refinePasses: 0, refineEarlyStop: true, imageCrawlAiFilter: false, imageCrawlHumanReview: false },
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
      baseDeps({ worker: authorReturning(["https://a.example/x", "https://b.example/y"]), settings: { scriptGateEnabled: false, maxRepairAttempts: 3, refinePasses: 0, refineEarlyStop: true, imageCrawlAiFilter: false, imageCrawlHumanReview: false } }),
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
    expect(job.preprompt.perSceneIntent).toEqual({ "scene-01": "Yêu cầu riêng cho cảnh này (ưu tiên): to chữ tiêu đề lên" });
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
        settings: { scriptGateEnabled: false, maxRepairAttempts: 3, refinePasses: 0, refineEarlyStop: true, imageCrawlAiFilter: false, imageCrawlHumanReview: false },
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

// Phase 2 Block B — beginCreate crawls article images, optionally AI-pre-selects,
// optionally parks a blocking image-review, then authors with the approved set
// folded into AuthorInput.images. These exercise the toggle matrix + the review
// resolve path that the rest of the suite (all toggles off) never reaches.
describe("Block B: crawl → (AI-filter) → (review) → author", () => {
  type Captured = { images?: AuthorImageRef[] };
  /**
   * A worker that records the `images` of the LAST author() call (so a test can
   * assert which crawled refs reached authoring) plus configurable crawl/filter
   * doubles. scriptGate is forced ON by the controller's default settings, so a
   * successful author parks at `script` — a stable point to inspect `captured`.
   */
  function crawlWorker(
    captured: Captured,
    over: {
      crawl?: AgentWorker["crawlImages"];
      filter?: AgentWorker["filterCrawledImages"];
    } = {},
  ): AgentWorker {
    return {
      author: async ({ input }): Promise<AuthorOutcome> => {
        captured.images = input.images;
        return { kind: "authored", sceneIds: ["scene-01"] };
      },
      reauthorScenes: async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] }),
      publish: async () => ({ ok: true, outputPath: "out.mp4" }),
      generateValidateRepair: async (): Promise<RepairOutcome> => ({ kind: "passed", attempts: 1 }),
      ...(over.crawl ? { crawlImages: over.crawl } : {}),
      ...(over.filter ? { filterCrawledImages: over.filter } : {}),
    };
  }

  const img = (ref: string): { ref: string; width: number; height: number; sourceUrl: string } => ({
    ref,
    width: 800,
    height: 600,
    sourceUrl: `https://src.example/${ref}`,
  });
  const settings = (over: Partial<WorkspaceDeps["settings"]>): WorkspaceDeps["settings"] => ({
    scriptGateEnabled: true,
    maxRepairAttempts: 3,
    refinePasses: 0,
    refineEarlyStop: true,
    imageCrawlAiFilter: false,
    imageCrawlHumanReview: false,
    ...over,
  });

  it("no link → authors immediately, never crawls", async () => {
    const captured: Captured = {};
    const crawlImages = vi.fn(async () => [img("a.png")]);
    const ctrl = new WorkspaceController(baseDeps({ worker: crawlWorker(captured, { crawl: crawlImages }) }));
    ctrl.beginCreate("p1", { text: "tin", urls: [] });
    await flush();
    expect(crawlImages).not.toHaveBeenCalled();
    expect((await ctrl.stage("p1")).kind).toBe("script");
    expect(captured.images).toBeUndefined();
  });

  it("link create surfaces a crawl phase before authoring", async () => {
    const captured: Captured = {};
    const ctrl = new WorkspaceController(
      baseDeps({
        worker: crawlWorker(captured, { crawl: async () => [] }),
        settings: settings({ imageCrawlHumanReview: true }),
      }),
    );
    ctrl.beginCreate("p1", { text: "tin", urls: ["https://a.example/post"] });

    expect(await ctrl.stage("p1")).toEqual({ kind: "writing", phase: "crawl" });
  });

  it("AI image filtering surfaces its own writing phase", async () => {
    const captured: Captured = {};
    let resolveFilter!: (refs: string[]) => void;
    const filter = vi.fn(() => new Promise<string[]>((resolve) => {
      resolveFilter = resolve;
    }));
    const ctrl = new WorkspaceController(
      baseDeps({
        worker: crawlWorker(captured, { crawl: async () => [img("a.png")], filter }),
        settings: settings({ imageCrawlAiFilter: true, imageCrawlHumanReview: false }),
      }),
    );
    ctrl.beginCreate("p1", { text: "tin", urls: ["https://a.example/post"] });
    await flush();

    expect(await ctrl.stage("p1")).toEqual({ kind: "writing", phase: "image-filter" });
    resolveFilter(["a.png"]);
    await flush();
  });

  it("link but zero crawled images → authors text-only (no review screen)", async () => {
    const captured: Captured = {};
    const ctrl = new WorkspaceController(
      baseDeps({
        worker: crawlWorker(captured, { crawl: async () => [] }),
        settings: settings({ imageCrawlHumanReview: true, imageCrawlAiFilter: true }),
      }),
    );
    ctrl.beginCreate("p1", { text: "tin", urls: ["https://a.example/post"] });
    await flush();
    expect((await ctrl.stage("p1")).kind).toBe("script"); // never parked review
    expect(captured.images).toBeUndefined();
  });

  it("a crawl that throws never blocks authoring (best-effort) → text-only", async () => {
    const captured: Captured = {};
    const ctrl = new WorkspaceController(
      baseDeps({
        worker: crawlWorker(captured, { crawl: async () => { throw new Error("network"); } }),
        settings: settings({ imageCrawlHumanReview: true }),
      }),
    );
    ctrl.beginCreate("p1", { text: "tin", urls: ["https://a.example/post"] });
    await flush();
    expect((await ctrl.stage("p1")).kind).toBe("script");
    expect(captured.images).toBeUndefined();
  });

  it("AI-filter ON + review OFF → authors with exactly the AI-suggested subset", async () => {
    const captured: Captured = {};
    const filter = vi.fn(async () => ["a.png"]); // keep a, drop b
    const ctrl = new WorkspaceController(
      baseDeps({
        worker: crawlWorker(captured, { crawl: async () => [img("a.png"), img("b.png")], filter }),
        settings: settings({ imageCrawlAiFilter: true, imageCrawlHumanReview: false }),
      }),
    );
    ctrl.beginCreate("p1", { text: "bài báo", urls: ["https://a.example/post"] });
    await flush();
    expect(filter).toHaveBeenCalledTimes(1);
    expect((await ctrl.stage("p1")).kind).toBe("script");
    expect(captured.images).toEqual([{ ref: "a.png", width: 800, height: 600 }]);
  });

  it("both OFF → authors with the WHOLE crawled pool (authoring AI is the final filter)", async () => {
    const captured: Captured = {};
    const filter = vi.fn(async () => ["a.png"]);
    const ctrl = new WorkspaceController(
      baseDeps({
        worker: crawlWorker(captured, { crawl: async () => [img("a.png"), img("b.png")], filter }),
        settings: settings({ imageCrawlAiFilter: false, imageCrawlHumanReview: false }),
      }),
    );
    ctrl.beginCreate("p1", { text: "tin", urls: ["https://a.example/post"] });
    await flush();
    expect(filter).not.toHaveBeenCalled(); // AI-filter off ⇒ no filter call
    expect(captured.images).toEqual([
      { ref: "a.png", width: 800, height: 600 },
      { ref: "b.png", width: 800, height: 600 },
    ]);
  });

  it("review ON → parks image-review with AI-suggested pre-ticked; submit authors the user's selection", async () => {
    const captured: Captured = {};
    const filter = vi.fn(async () => ["a.png"]); // AI suggests a
    const ctrl = new WorkspaceController(
      baseDeps({
        worker: crawlWorker(captured, { crawl: async () => [img("a.png"), img("b.png")], filter }),
        settings: settings({ imageCrawlAiFilter: true, imageCrawlHumanReview: true }),
        assetMedia: (_id, ref) => `media://asset/${ref}`,
      }),
    );
    ctrl.beginCreate("p1", { text: "bài báo", urls: ["https://a.example/post"] });
    await flush();

    const stage = await ctrl.stage("p1");
    expect(stage.kind).toBe("image-review");
    if (stage.kind === "image-review") {
      expect(stage.images.map((i) => i.ref)).toEqual(["a.png", "b.png"]);
      expect(stage.images.find((i) => i.ref === "a.png")?.suggested).toBe(true);
      expect(stage.images.find((i) => i.ref === "b.png")?.suggested).toBe(false);
      expect(stage.images[0]!.previewUrl).toBe("media://asset/a.png");
    }
    expect(captured.images).toBeUndefined(); // not authored yet (blocking)

    // User overrides the suggestion: keeps b, drops a.
    ctrl.submitImageReview("p1", ["b.png"]);
    await flush();
    expect((await ctrl.stage("p1")).kind).toBe("script");
    expect(captured.images).toEqual([{ ref: "b.png", width: 800, height: 600 }]);
  });

  it("review ON, submit NONE → authors text-only", async () => {
    const captured: Captured = {};
    const ctrl = new WorkspaceController(
      baseDeps({
        worker: crawlWorker(captured, { crawl: async () => [img("a.png")] }),
        settings: settings({ imageCrawlHumanReview: true }),
      }),
    );
    ctrl.beginCreate("p1", { text: "tin", urls: ["https://a.example/post"] });
    await flush();
    expect((await ctrl.stage("p1")).kind).toBe("image-review");
    ctrl.submitImageReview("p1", []);
    await flush();
    expect((await ctrl.stage("p1")).kind).toBe("script");
    expect(captured.images).toBeUndefined();
  });

  it("submitImageReview is a no-op when no review is parked (stale/double submit)", async () => {
    const captured: Captured = {};
    const ctrl = new WorkspaceController(baseDeps({ worker: crawlWorker(captured) }));
    expect(() => ctrl.submitImageReview("nope", ["a.png"])).not.toThrow();
    await flush();
    expect(captured.images).toBeUndefined();
  });
});

// Rename a project's display title (H2/R9.4)
describe("rename (project display title)", () => {
  it("patches manifest.title (spreading to keep other fields) and returns the trimmed title", async () => {
    const manifest = { title: "Cũ", hashtags: ["#a"], theme: { dominant: "#111" }, scenes: [{ id: "scene-01" }] } as unknown as WsManifest;
    const writeManifest = vi.fn(async () => {});
    const ctrl = new WorkspaceController(baseDeps({ loadManifest: async () => manifest, writeManifest }));

    const saved = await ctrl.rename("p1", "  Tiêu đề mới  ");
    expect(saved).toBe("Tiêu đề mới"); // trimmed
    expect(writeManifest).toHaveBeenCalledTimes(1);
    const written = (writeManifest.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    // The title is patched; theme/hashtags/scenes are preserved (spread, not replaced).
    expect(written.title).toBe("Tiêu đề mới");
    expect(written.hashtags).toEqual(["#a"]);
    expect(written.theme).toEqual({ dominant: "#111" });
    expect((written.scenes as unknown[]).length).toBe(1);
  });

  it("rejects a blank title without writing (a blank card name is never useful)", async () => {
    const writeManifest = vi.fn(async () => {});
    const ctrl = new WorkspaceController(baseDeps({ loadManifest: async () => ({ title: "Cũ", scenes: [] }) as WsManifest, writeManifest }));
    expect(await ctrl.rename("p1", "   ")).toBeNull();
    expect(writeManifest).not.toHaveBeenCalled();
  });

  it("re-emits the live published stage with the new title so an open Copy panel updates", async () => {
    const manifest = { title: "Cũ", scenes: [{ id: "scene-01" }] } as unknown as WsManifest;
    const ctrl = new WorkspaceController(baseDeps({ loadManifest: async () => manifest, writeManifest: async () => {} }));
    ctrl.setStage("p1", { kind: "published", outputPath: "media://out.mp4", title: "Cũ" });
    await ctrl.rename("p1", "Mới");
    const st = await ctrl.stage("p1");
    expect(st.kind).toBe("published");
    if (st.kind === "published") expect(st.title).toBe("Mới");
  });

  it("returns null when the manifest can't be loaded (no write, no throw)", async () => {
    const writeManifest = vi.fn(async () => {});
    const ctrl = new WorkspaceController(
      baseDeps({ loadManifest: async () => { throw new Error("ENOENT"); }, writeManifest }),
    );
    expect(await ctrl.rename("p1", "Mới")).toBeNull();
    expect(writeManifest).not.toHaveBeenCalled();
  });
});
