import { describe, expect, it } from "vitest";
import { classifyQueueWaitStage, QUEUE_HUMAN_WAIT_MESSAGE } from "./queue-stage.js";
import type { ProjectStage } from "../../shared/types.js";

describe("classifyQueueWaitStage", () => {
  it("treats published as success", () => {
    const stage: ProjectStage = {
      kind: "published",
      outputPath: "/out.mp4",
      title: "t",
    };
    expect(classifyQueueWaitStage(stage)).toEqual({ action: "published" });
  });

  it("treats error as failed with message", () => {
    const stage: ProjectStage = {
      kind: "error",
      message: "TTS missing",
      fixable: true,
      retry: "full",
    };
    expect(classifyQueueWaitStage(stage)).toEqual({
      action: "failed",
      message: "TTS missing",
    });
  });

  it("fails human-wait stages with settings guidance", () => {
    const kinds = ["script", "image-review", "ready", "draft-recovery"] as const;
    for (const kind of kinds) {
      let stage: ProjectStage;
      if (kind === "script") {
        stage = { kind: "script", lines: [] };
      } else if (kind === "image-review") {
        stage = { kind: "image-review", images: [] };
      } else if (kind === "ready") {
        stage = { kind: "ready", scenes: [] };
      } else {
        stage = { kind: "draft-recovery", draftPath: "/d.mp4", notice: "x" };
      }
      expect(classifyQueueWaitStage(stage)).toEqual({
        action: "failed",
        message: QUEUE_HUMAN_WAIT_MESSAGE,
      });
    }
  });

  it("continues writing and rendering", () => {
    expect(classifyQueueWaitStage({ kind: "writing" })).toEqual({ action: "continue" });
    expect(
      classifyQueueWaitStage({ kind: "rendering", percent: 40, phase: "full" }),
    ).toEqual({ action: "continue" });
  });
});
