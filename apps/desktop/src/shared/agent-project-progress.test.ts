import { describe, expect, it } from "vitest";
import { agentProjectProgress } from "./agent-project-progress.js";
import type { ProjectStage } from "./types.js";

describe("agentProjectProgress", () => {
  it.each<[ProjectStage, string]>([
    [{ kind: "writing", phase: "author" }, "authoring"],
    [{ kind: "script", lines: [] }, "still_review"],
    [{ kind: "image-review", images: [] }, "still_review"],
    [{ kind: "rendering", percent: 20, phase: "prepare" }, "still_review"],
    [{ kind: "rendering", percent: 30, phase: "draft" }, "draft_render"],
    [{ kind: "ready", scenes: [], draftPath: "media://draft.mp4" }, "draft_review"],
    [{ kind: "ready", scenes: [] }, "still_review"],
    [{ kind: "rendering", percent: 70, phase: "full" }, "final_render"],
    [{ kind: "published", outputPath: "media://video.mp4" }, "completed"],
    [{ kind: "error", message: "Lỗi", fixable: false }, "error"],
  ])("maps %s from the authoritative workspace stage", (stage, state) => {
    expect(agentProjectProgress(stage).state).toBe(state);
  });

  it("clamps render progress and exposes only safe existing actions", () => {
    expect(agentProjectProgress({ kind: "rendering", percent: 140, phase: "draft" })).toMatchObject({
      percent: 100,
      canCancel: true,
      reviewReady: false,
    });
    expect(agentProjectProgress({ kind: "ready", scenes: [] })).toMatchObject({
      canCancel: false,
      reviewReady: true,
    });
  });
});
