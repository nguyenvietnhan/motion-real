import { describe, expect, it } from "vitest";
import { buildStoryboard } from "./storyboard.js";

/**
 * Feature: web-dashboard, Task 9.1 (storyboard view-model). Maps ordered scene
 * ids to the engine's review keyframes.
 *
 * NOTE (reconcile-main-controllers S1): the BatchSubmitController tests were
 * removed alongside the deferred Review_Edit_Loop; only buildStoryboard remains.
 */

describe("buildStoryboard", () => {
  it("maps scene ids to review keyframes in order", () => {
    const model = buildStoryboard("p1", "/p/p1", ["scene-01", "scene-02"]);
    expect(model.scenes).toEqual([
      { sceneId: "scene-01", order: 0, stillPath: "/p/p1/review/scene-01.png", editText: "" },
      { sceneId: "scene-02", order: 1, stillPath: "/p/p1/review/scene-02.png", editText: "" },
    ]);
  });

  it("uses the injected still mapper when provided", () => {
    const model = buildStoryboard("p1", "/p/p1", ["scene-01"], "", (_r, id) => `media://file/${id}`);
    expect(model.scenes[0]!.stillPath).toBe("media://file/scene-01");
  });
});
