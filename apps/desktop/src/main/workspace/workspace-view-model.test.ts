import { describe, expect, it } from "vitest";
import type { SceneCard } from "../../shared/types.js";
import {
  fullRenderStageStart,
  publishErrorStageOf,
  publishedStageOf,
  readyStageOf,
  scriptLinesFromScenes,
  storyboardScenesFromScenes,
} from "./workspace-view-model.js";

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

  it("builds full-render start and publish-error stages", () => {
    expect(fullRenderStageStart()).toEqual({ kind: "rendering", percent: 0, phase: "full" });
    expect(publishErrorStageOf({ message: "Xuất bản thất bại.", fixable: false })).toEqual({
      kind: "error",
      message: "Xuất bản thất bại.",
      fixable: false,
      retry: "full",
    });
  });

  it("maps script scenes to ordered script lines with text defaults", () => {
    expect(
      scriptLinesFromScenes(
        [
          { id: "scene-01" },
          { id: "scene-02", headline: "Headline", narration: "Narration" },
        ],
        (ref) => `media://${ref}`,
      ),
    ).toEqual([
      { sceneId: "scene-01", order: 0, headline: "", narration: "" },
      { sceneId: "scene-02", order: 1, headline: "Headline", narration: "Narration" },
    ]);
  });

  it("maps scene image refs to previewable script-line image paths", () => {
    expect(
      scriptLinesFromScenes(
        [
          { id: "scene-01", image: { ref: "image-a.png" } },
          { id: "scene-02" },
        ],
        (ref) => `media://asset/${ref}`,
      ),
    ).toEqual([
      {
        sceneId: "scene-01",
        order: 0,
        headline: "",
        narration: "",
        imagePath: "media://asset/image-a.png",
      },
      { sceneId: "scene-02", order: 1, headline: "", narration: "" },
    ]);
  });

  it("maps storyboard scenes to review stills in manifest order", () => {
    expect(
      storyboardScenesFromScenes(
        "p1",
        [{ id: "scene-02" }, { id: "scene-01" }],
        3,
        (sceneId) => `media://review/${sceneId}.png`,
      ),
    ).toEqual([
      {
        sceneId: "scene-02",
        order: 0,
        stillPath: "media://review/scene-02.png#r3",
        editText: "",
        headline: undefined,
        narration: undefined,
        eyebrow: undefined,
      },
      {
        sceneId: "scene-01",
        order: 1,
        stillPath: "media://review/scene-01.png#r3",
        editText: "",
        headline: undefined,
        narration: undefined,
        eyebrow: undefined,
      },
    ]);
  });

  it("copies storyboard display copy from the manifest scene", () => {
    expect(
      storyboardScenesFromScenes(
        "p1",
        [
          {
            id: "scene-01",
            headline: "Headline",
            narration: "Narration",
            eyebrow: "Context",
          },
        ],
        0,
        (sceneId) => `media://review/${sceneId}.png`,
      ),
    ).toEqual([
      {
        sceneId: "scene-01",
        order: 0,
        stillPath: "media://review/scene-01.png#r0",
        editText: "",
        headline: "Headline",
        narration: "Narration",
        eyebrow: "Context",
      },
    ]);
  });
});
