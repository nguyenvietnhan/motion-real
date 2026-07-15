import { describe, expect, it } from "vitest";
import type { ProjectStage } from "../../shared/types.js";
import {
  shouldLogStageTransition,
  stageFingerprint,
} from "./workspace-stage.js";

describe("workspace-stage fingerprints", () => {
  it("is total over ProjectStage kinds and ignores percent noise", () => {
    const cases: Array<{ stage: ProjectStage; fingerprint: string }> = [
      { stage: { kind: "writing" }, fingerprint: "writing" },
      { stage: { kind: "writing", phase: "crawl" }, fingerprint: "writing:crawl" },
      { stage: { kind: "writing", phase: "image-filter" }, fingerprint: "writing:image-filter" },
      { stage: { kind: "writing", phase: "author" }, fingerprint: "writing:author" },
      { stage: { kind: "image-review", images: [] }, fingerprint: "image-review" },
      { stage: { kind: "script", lines: [] }, fingerprint: "script" },
      { stage: { kind: "rendering", percent: 0, phase: "draft" }, fingerprint: "rendering:draft" },
      { stage: { kind: "rendering", percent: 99, phase: "draft" }, fingerprint: "rendering:draft" },
      { stage: { kind: "rendering", percent: 0, phase: "prepare" }, fingerprint: "rendering:prepare" },
      { stage: { kind: "rendering", percent: 0, phase: "full" }, fingerprint: "rendering:full" },
      { stage: { kind: "rendering", percent: 0, phase: "edit" }, fingerprint: "rendering:edit" },
      {
        stage: { kind: "rendering", percent: 0, phase: "qa", qaPass: 2, qaTotal: 5 },
        fingerprint: "rendering:qa:2/5",
      },
      { stage: { kind: "ready", scenes: [] }, fingerprint: "ready" },
      { stage: { kind: "published", outputPath: "x.mp4" }, fingerprint: "published" },
      { stage: { kind: "error", message: "x", fixable: true, retry: "draft" }, fingerprint: "error:draft" },
      { stage: { kind: "error", message: "x", fixable: false }, fingerprint: "error" },
    ];
    for (const row of cases) {
      expect(stageFingerprint(row.stage)).toBe(row.fingerprint);
    }
    expect(stageFingerprint(undefined)).toBe("none");
  });

  it("skips transition logs when only percent changes", () => {
    const a: ProjectStage = { kind: "rendering", percent: 10, phase: "draft" };
    const b: ProjectStage = { kind: "rendering", percent: 80, phase: "draft" };
    expect(shouldLogStageTransition(a, b)).toBe(false);
    expect(shouldLogStageTransition(a, { kind: "rendering", percent: 0, phase: "full" })).toBe(true);
    expect(shouldLogStageTransition(undefined, a)).toBe(true);
  });
});
