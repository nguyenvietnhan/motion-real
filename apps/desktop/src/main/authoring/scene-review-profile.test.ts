import { describe, expect, it } from "vitest";
import { sceneReviewProfiles } from "./content-plan.js";

describe("sceneReviewProfiles", () => {
  it("keeps only the two independent review decisions", () => {
    expect(sceneReviewProfiles([
      { sceneId: "scene-01", temporalMode: "static", detailMode: "normal", motionProgression: "hold" },
      { sceneId: "scene-02", temporalMode: "stepped", detailMode: "normal", motionProgression: "steps", motionBeats: [{ id: "a", anchor: "one two", action: "one" }, { id: "b", anchor: "three four", action: "two" }] },
      { sceneId: "scene-03", temporalMode: "continuous", detailMode: "fine", motionProgression: "terminal", motionBeats: [{ id: "a", anchor: "one two", action: "one" }, { id: "b", anchor: "three four", action: "two" }] },
    ])).toEqual([
      { sceneId: "scene-01", temporalMode: "static", detailMode: "normal" },
      { sceneId: "scene-02", temporalMode: "stepped", detailMode: "normal" },
      { sceneId: "scene-03", temporalMode: "continuous", detailMode: "fine" },
    ]);
  });

  it("uses legacy motion-beat and semantic fallbacks", () => {
    expect(sceneReviewProfiles([
      { sceneId: "scene-01", motionProgression: "hold" },
      { sceneId: "scene-02", motionProgression: "steps", motionBeats: [{ id: "a", anchor: "one two", action: "one" }, { id: "b", anchor: "three four", action: "two" }] },
      { sceneId: "scene-03", motionProgression: "semantic: old plan" },
    ])).toMatchObject([
      { temporalMode: "static", detailMode: "normal" },
      { temporalMode: "stepped", detailMode: "normal" },
      { temporalMode: "stepped", detailMode: "normal" },
    ]);
  });
});
