import { describe, expect, it } from "vitest";
import type { SceneCard } from "../../shared/types.js";
import { publishedStageOf, readyStageOf } from "./workspace-view-model.js";

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

  it("builds a default published stage", () => {
    expect(publishedStageOf("media://out.mp4")).toEqual({
      kind: "published",
      outputPath: "media://out.mp4",
      format: "tiktok",
    });
  });

  it("keeps published copy metadata", () => {
    expect(publishedStageOf("media://out.mp4", { title: "Launch", hashtags: ["#ai", "#video"] })).toEqual({
      kind: "published",
      outputPath: "media://out.mp4",
      format: "tiktok",
      title: "Launch",
      hashtags: ["#ai", "#video"],
    });
  });

  it("keeps published thumbnail and format while omitting empty optional fields", () => {
    expect(
      publishedStageOf("media://out.mp4", {
        title: "",
        hashtags: [],
        thumbnailPath: "media://thumbnail.png",
        format: "youtube",
      }),
    ).toEqual({
      kind: "published",
      outputPath: "media://out.mp4",
      format: "youtube",
      thumbnailPath: "media://thumbnail.png",
    });
  });
});
