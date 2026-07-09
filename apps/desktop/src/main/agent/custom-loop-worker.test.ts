import { describe, expect, it, vi } from "vitest";
import { CustomLoopAgentWorker, type AuthoringBackend, type AuthoredScene } from "./custom-loop-worker.js";
import type { AgentHooks } from "./agent-worker.js";

/**
 * path-X custom-loop adapter orchestration.
 * Verifies ordering + scene hooks, ingest/no-source failure mapping, and that
 * the repair delegation drives the backend's render/report.
 */

function backend(over: Partial<AuthoringBackend> = {}): AuthoringBackend {
  return {
    authorScenes: async () => ({ scenes: [] }),
    reauthor: async () => ({ scenes: [] }),
    renderDraft: async () => ({ ok: true }),
    renderFull: async () => ({ ok: true, outputPath: "out.mp4" }),
    getSafetyReport: async () => ({ ok: true, hardErrors: [], warnings: [] }),
    ...over,
  };
}

function recordingHooks(): { hooks: AgentHooks; scenes: string[] } {
  const scenes: string[] = [];
  return {
    scenes,
    hooks: { onProgress() {}, onSceneProduced: (id) => scenes.push(id), onRepair() {} },
  };
}

const twoScenes: AuthoredScene[] = [
  { sceneId: "scene-01", stillPath: "review/scene-01.png" },
  { sceneId: "scene-02", stillPath: "review/scene-02.png" },
];

describe("CustomLoopAgentWorker.author", () => {
  it("authors and emits each produced scene", async () => {
    const worker = new CustomLoopAgentWorker(backend({ authorScenes: async () => ({ scenes: twoScenes }) }));
    const { hooks, scenes } = recordingHooks();

    const outcome = await worker.author(
      { projectId: "p1", input: { text: "Làm video từ https://e.com/a", urls: ["https://e.com/a"] }, scriptGate: true },
      hooks,
    );

    expect(outcome).toEqual({ kind: "authored", sceneIds: ["scene-01", "scene-02"] });
    expect(scenes).toEqual(["scene-01", "scene-02"]);
  });

  it("maps an empty authoring result to no-source", async () => {
    const worker = new CustomLoopAgentWorker(backend({ authorScenes: async () => ({ scenes: [], message: "no source" }) }));
    const { hooks } = recordingHooks();
    const outcome = await worker.author(
      { projectId: "p1", input: { text: "abc", urls: [] }, scriptGate: false },
      hooks,
    );
    expect(outcome).toEqual({ kind: "no-source", message: "no source" });
  });
});

describe("CustomLoopAgentWorker.visualQa", () => {
  it("absent backend QA returns unsupported, not a fake clean pass", async () => {
    const worker = new CustomLoopAgentWorker(backend());
    await expect(worker.visualQa("p1", ["scene-01"])).resolves.toEqual({
      kind: "skipped",
      reason: "unsupported",
      requestedSceneIds: ["scene-01"],
    });
  });

  it("passes through a checked backend result", async () => {
    const worker = new CustomLoopAgentWorker(
      backend({
        visualQa: async () => ({
          kind: "checked",
          defects: [{ sceneId: "scene-01", issue: "clip" }],
          checkedSceneIds: ["scene-01"],
        }),
      }),
    );
    await expect(worker.visualQa("p1")).resolves.toMatchObject({ kind: "checked" });
  });
});

describe("CustomLoopAgentWorker.generateValidateRepair", () => {
  it("delegates to the repair loop, re-authoring flagged scenes until clean", async () => {
    let renders = 0;
    const reauthor = vi.fn(async () => ({ scenes: twoScenes }));
    const worker = new CustomLoopAgentWorker(
      backend({
        renderDraft: async () => {
          renders++;
          return { ok: true };
        },
        getSafetyReport: async () =>
          renders === 1
            ? { ok: false, hardErrors: [{ check: "N31", severity: "error", sceneId: "scene-02", message: "runtime fallback" }], warnings: [] }
            : { ok: true, hardErrors: [], warnings: [] },
        reauthor,
      }),
    );
    const { hooks } = recordingHooks();
    const outcome = await worker.generateValidateRepair("p1", { maxAttempts: 3 }, hooks);
    expect(outcome).toEqual({ kind: "passed", attempts: 2 });
    expect(reauthor).toHaveBeenCalledWith(
      "p1",
      [{ sceneId: "scene-02", issues: [{ check: "N31", severity: "error", sceneId: "scene-02", message: "runtime fallback" }] }],
      undefined, // no cancel signal threaded in this direct-worker test
    );
  });
});
