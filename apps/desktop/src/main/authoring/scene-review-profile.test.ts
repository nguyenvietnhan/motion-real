import { describe, expect, it } from "vitest";
import { sceneReviewProfiles } from "./content-plan.js";

describe("sceneReviewProfiles", () => {
  it("derives deterministic artifacts without a scalar risk score", () => {
    expect(sceneReviewProfiles([
      { sceneId: "scene-01", temporalMode: "static", detailMode: "normal", motionProgression: "hold" },
      { sceneId: "scene-02", temporalMode: "stepped", detailMode: "normal", motionProgression: "steps", motionBeats: [{ id: "a", anchor: "one two", action: "one" }, { id: "b", anchor: "three four", action: "two" }] },
      { sceneId: "scene-03", temporalMode: "continuous", detailMode: "fine", motionProgression: "terminal", motionBeats: [{ id: "a", anchor: "one two", action: "one" }, { id: "b", anchor: "three four", action: "two" }] },
    ])).toEqual([
      { sceneId: "scene-01", temporalMode: "static", detailMode: "normal", overview: true, motionArtifact: "none", detailArtifact: false, reasons: ["static"] },
      { sceneId: "scene-02", temporalMode: "stepped", detailMode: "normal", overview: true, motionArtifact: "cue-filmstrip", detailArtifact: false, reasons: ["stepped"] },
      { sceneId: "scene-03", temporalMode: "continuous", detailMode: "fine", overview: true, motionArtifact: "dense-filmstrip", detailArtifact: true, reasons: ["continuous", "fine-detail"] },
    ]);
  });

  it("uses legacy motion-beat and semantic fallbacks", () => {
    expect(sceneReviewProfiles([
      { sceneId: "scene-01", motionProgression: "hold" },
      { sceneId: "scene-02", motionProgression: "steps", motionBeats: [{ id: "a", anchor: "one two", action: "one" }, { id: "b", anchor: "three four", action: "two" }] },
      { sceneId: "scene-03", motionProgression: "semantic: old plan" },
    ])).toMatchObject([
      { temporalMode: "static", detailMode: "normal", motionArtifact: "none" },
      { temporalMode: "stepped", detailMode: "normal", motionArtifact: "cue-filmstrip" },
      { temporalMode: "stepped", detailMode: "normal", motionArtifact: "cue-filmstrip" },
    ]);
  });
});
