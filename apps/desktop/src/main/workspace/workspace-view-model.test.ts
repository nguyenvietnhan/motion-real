import { describe, expect, it } from "vitest";
import type { SceneCard } from "../../shared/types.js";
import { readyStageOf } from "./workspace-view-model.js";

const scenes: SceneCard[] = [
  {
    sceneId: "scene-01",
    order: 0,
    stillPath: "media://scene-01.png",
    editText: "",
    headline: "Headline",
    narration: "Narration",
  },
];

describe("workspace view model helpers", () => {
  it("builds a ready stage without optional draft or notice fields", () => {
    expect(readyStageOf(scenes)).toEqual({ kind: "ready", scenes });
  });

  it("keeps the draft player path when one exists", () => {
    expect(readyStageOf(scenes, { draftPath: "media://draft.mp4" })).toEqual({
      kind: "ready",
      scenes,
      draftPath: "media://draft.mp4",
    });
  });

  it("keeps a transient ready-stage notice", () => {
    expect(readyStageOf(scenes, { notice: "Some scenes were kept." })).toEqual({
      kind: "ready",
      scenes,
      notice: "Some scenes were kept.",
    });
  });
});
