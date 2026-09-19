import { describe, expect, it } from "vitest";
import { agentProjectProgress, shouldPollAgentActivities, shouldPollProjectStage } from "./agent-project-progress.js";
import type { ProjectStage } from "./types.js";

describe("agentProjectProgress", () => {
  it.each<[ProjectStage, string]>([
    [{ kind: "writing", phase: "author" }, "authoring"],
    [{ kind: "script", lines: [] }, "scene_review"],
    [{ kind: "image-review", images: [] }, "scene_review"],
    [{ kind: "rendering", percent: 20, phase: "prepare" }, "rendering"],
    [{ kind: "rendering", percent: 30, phase: "draft" }, "rendering"],
    [{ kind: "ready", scenes: [], draftPath: "media://draft.mp4" }, "scene_review"],
    [{ kind: "ready", scenes: [] }, "scene_review"],
    [{ kind: "rendering", percent: 70, phase: "full" }, "rendering"],
    [{ kind: "published", outputPath: "media://video.mp4" }, "published"],
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

  it("polls Harness activity only for hidden automated progress", () => {
    for (const state of ["collecting_assets", "preparing_brief", "authoring", "visual_refine"] as const) {
      expect(shouldPollAgentActivities(state, false)).toBe(true);
      expect(shouldPollAgentActivities(state, true)).toBe(false);
    }
    for (const state of ["discovery", "asset_review", "brief_review", "paused", "scene_review", "error"] as const) {
      expect(shouldPollAgentActivities(state, false)).toBe(false);
    }
  });

  it("falls back to project stage polling only while the linked project is cancelable", () => {
    expect(shouldPollProjectStage(agentProjectProgress({ kind: "writing", phase: "author" }))).toBe(true);
    expect(shouldPollProjectStage(agentProjectProgress({ kind: "rendering", percent: 20, phase: "prepare" }))).toBe(true);
    expect(shouldPollProjectStage(agentProjectProgress({ kind: "ready", scenes: [] }))).toBe(false);
    expect(shouldPollProjectStage(agentProjectProgress({ kind: "published", outputPath: "media://video.mp4" }))).toBe(false);
  });

  it("projects real workspace subphases during active authoring without claiming draft rendering", () => {
    const prepareStill = agentProjectProgress({ kind: "rendering", percent: 45, phase: "prepare" }, "authoring");
    expect(prepareStill).toMatchObject({
      state: "authoring",
      label: "Đang chuẩn bị ảnh xem trước…",
      percent: 45,
      canCancel: true,
      reviewReady: false,
    });

    const refineStill = agentProjectProgress({ kind: "rendering", percent: 60, phase: "prepare" }, "visual_refine");
    expect(refineStill).toMatchObject({
      state: "authoring",
      label: "Đang chuẩn bị ảnh soát lỗi…",
      percent: 60,
      canCancel: true,
      reviewReady: false,
    });
  });

  it("suppresses stale ready and published stages while new authoring is active", () => {
    const staleReady = agentProjectProgress({ kind: "ready", scenes: [], draftPath: "media://old.mp4" }, "authoring");
    expect(staleReady).toMatchObject({
      state: "authoring",
      label: "Đang viết scene (Harness)",
      canCancel: true,
      reviewReady: false,
    });

    const stalePublished = agentProjectProgress({ kind: "published", outputPath: "media://old.mp4" }, "visual_refine");
    expect(stalePublished).toMatchObject({
      state: "authoring",
      label: "Đang soát lỗi hình ảnh (Harness)",
      canCancel: true,
      reviewReady: false,
    });
  });

  it("ensures Agent paused and error states win over stale Workspace ready, published, or rendering", () => {
    const pausedOverPublished = agentProjectProgress({ kind: "published", outputPath: "media://old.mp4" }, "paused");
    expect(pausedOverPublished).toEqual({
      state: "paused",
      label: "Đã tạm dừng",
      canCancel: false,
      reviewReady: false,
    });

    const pausedOverReady = agentProjectProgress({ kind: "ready", scenes: [] }, "paused");
    expect(pausedOverReady).toEqual({
      state: "paused",
      label: "Đã tạm dừng",
      canCancel: false,
      reviewReady: false,
    });

    const pausedOverRendering = agentProjectProgress({ kind: "rendering", percent: 80, phase: "draft" }, "paused");
    expect(pausedOverRendering).toEqual({
      state: "paused",
      label: "Đã tạm dừng",
      canCancel: false,
      reviewReady: false,
    });

    const errorOverReady = agentProjectProgress({ kind: "ready", scenes: [] }, "error");
    expect(errorOverReady).toEqual({
      state: "error",
      label: "Cần xử lý lỗi",
      canCancel: false,
      reviewReady: false,
    });

    const errorOverStageError = agentProjectProgress({ kind: "error", message: "Render thất bại.", fixable: false, retry: "draft" }, "error");
    expect(errorOverStageError).toEqual({
      state: "error",
      label: "Render thất bại.",
      canCancel: false,
      reviewReady: false,
    });
  });
});
