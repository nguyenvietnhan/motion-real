import { describe, expect, it, vi } from "vitest";
import { BatchSubmitController, buildStoryboard, type StoryboardBackend } from "./storyboard.js";
import type { EditBatch, EvidenceWarning } from "../../shared/types.js";

/**
 * Feature: web-dashboard, Task 9.1 (storyboard + batch submit) and Task 5.4
 * (evidence-gate on edit, Req 8.9). Submissions route only changed scenes to
 * re-author/re-render; an unsupported-figure request returns an EvidenceWarning
 * leaving the scene's figure unchanged.
 */

function okBackend(over: Partial<StoryboardBackend> = {}): StoryboardBackend {
  return { reauthorAndRender: vi.fn(async () => ({ ok: true })), ...over };
}

describe("buildStoryboard", () => {
  it("maps scene ids to review keyframes in order", () => {
    const model = buildStoryboard("p1", "/p/p1", ["scene-01", "scene-02"]);
    expect(model.scenes).toEqual([
      { sceneId: "scene-01", order: 0, stillPath: "/p/p1/review/scene-01.png", editText: "" },
      { sceneId: "scene-02", order: 1, stillPath: "/p/p1/review/scene-02.png", editText: "" },
    ]);
  });
});

describe("BatchSubmitController.submit", () => {
  const emptyBatch: EditBatch = { perScene: [], globalNotes: "" };

  it("rejects an empty batch without touching the backend", async () => {
    const backend = okBackend();
    const ctrl = new BatchSubmitController("p1", backend);
    expect(await ctrl.submit(emptyBatch, 3)).toEqual({ ok: false, reason: "no-changes" });
    expect(backend.reauthorAndRender).not.toHaveBeenCalled();
  });

  it("rejects removing the only remaining scene", async () => {
    const ctrl = new BatchSubmitController("p1", okBackend());
    expect(await ctrl.submit(emptyBatch, 1, ["scene-01"])).toEqual({ ok: false, reason: "last-scene" });
  });

  it("re-authors only the edited scenes and increments the revision", async () => {
    const reauthorAndRender = vi.fn(async () => ({ ok: true as const }));
    const ctrl = new BatchSubmitController("p1", { reauthorAndRender });
    const batch: EditBatch = {
      perScene: [
        { sceneId: "scene-02", text: "đổi biểu đồ" },
        { sceneId: "scene-04", text: "" }, // empty → not a change
      ],
      globalNotes: "tông màu ấm hơn",
    };
    const result = await ctrl.submit(batch, 5);
    expect(result).toEqual({ ok: true, revision: 1 });
    expect(reauthorAndRender).toHaveBeenCalledWith(
      "p1",
      ["scene-02"],
      { "scene-02": "đổi biểu đồ" },
      "tông màu ấm hơn",
    );
  });

  it("preserves the draft and names the scene on a re-render failure (Req 8.12)", async () => {
    const ctrl = new BatchSubmitController("p1", {
      reauthorAndRender: async () => ({ ok: false, reason: "scene-render-failed", sceneId: "scene-03" }),
    });
    const batch: EditBatch = { perScene: [{ sceneId: "scene-03", text: "vẽ lại" }], globalNotes: "" };
    expect(await ctrl.submit(batch, 4)).toEqual({ ok: false, reason: "scene-render-failed", sceneId: "scene-03" });
  });

  it("surfaces an evidence-gate warning naming the unsupported figure (Req 8.9)", async () => {
    const warnings: EvidenceWarning[] = [{ sceneId: "scene-02", unsupportedFigure: "92%" }];
    const ctrl = new BatchSubmitController("p1", {
      reauthorAndRender: async () => ({ ok: true, warnings }),
    });
    const batch: EditBatch = { perScene: [{ sceneId: "scene-02", text: "thêm số liệu 92%" }], globalNotes: "" };
    const result = await ctrl.submit(batch, 5);
    expect(result).toEqual({ ok: true, revision: 1, warnings });
  });
});
