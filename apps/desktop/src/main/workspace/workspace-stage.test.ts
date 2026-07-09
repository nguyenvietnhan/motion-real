import { describe, expect, it } from "vitest";
import type { ProjectStage } from "../../shared/types.js";
import {
  ALLOWED_OTHER_STAGE_KIND_EDGES,
  DOCUMENTED_STAGE_KIND_EDGES,
  classifyStageKindTransition,
  shouldLogStageTransition,
  stageFingerprint,
  stageKindOf,
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

describe("workspace-stage kind policy", () => {
  it("maps stage kinds and treats phase-only hops as documented", () => {
    expect(stageKindOf(undefined)).toBe("none");
    expect(stageKindOf({ kind: "writing", phase: "crawl" })).toBe("writing");
    expect(classifyStageKindTransition("writing", "writing")).toBe("documented");
    expect(classifyStageKindTransition("rendering", "rendering")).toBe("documented");
  });

  it("classifies documented happy-path kind edges", () => {
    for (const [from, to] of DOCUMENTED_STAGE_KIND_EDGES) {
      expect(classifyStageKindTransition(from, to)).toBe("documented");
    }
    // Real smoke path kinds
    expect(classifyStageKindTransition("none", "writing")).toBe("documented");
    expect(classifyStageKindTransition("writing", "image-review")).toBe("documented");
    expect(classifyStageKindTransition("image-review", "writing")).toBe("documented");
    expect(classifyStageKindTransition("writing", "script")).toBe("documented");
    expect(classifyStageKindTransition("script", "rendering")).toBe("documented");
    expect(classifyStageKindTransition("rendering", "ready")).toBe("documented");
    expect(classifyStageKindTransition("ready", "rendering")).toBe("documented");
    expect(classifyStageKindTransition("rendering", "published")).toBe("documented");
  });

  it("classifies allowed recovery/error edges without calling them unknown", () => {
    for (const [from, to] of ALLOWED_OTHER_STAGE_KIND_EDGES) {
      expect(classifyStageKindTransition(from, to)).toBe("allowed-other");
    }
    expect(classifyStageKindTransition("rendering", "error")).toBe("allowed-other");
    expect(classifyStageKindTransition("error", "rendering")).toBe("allowed-other");
    expect(classifyStageKindTransition("none", "ready")).toBe("allowed-other");
  });

  it("marks hops outside both tables as unknown (non-fatal policy)", () => {
    expect(classifyStageKindTransition("published", "image-review")).toBe("unknown");
  });
});
