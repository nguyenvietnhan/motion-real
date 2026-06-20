import { describe, expect, it } from "vitest";
import type { LockedVideoSpec } from "@news/schema";
import { transitionSampleFileName, transitionSampleFrame } from "./transition-samples.js";

const spec: LockedVideoSpec = {
  version: 1,
  title: "Transition samples",
  styleId: "clean-luxury-tech",
  format: "tiktok",
  ratio: "9:16",
  language: "vi",
  fps: 30,
  durationInFrames: 185,
  audio: {},
  captions: [],
  scenes: [
    {
      id: "scene-01",
      component: "a",
      durationInSeconds: 3.33,
      headline: "A",
      narration: "A",
      props: {},
      startFrame: 0,
      durationInFrames: 100,
    },
    {
      id: "scene-02",
      component: "b",
      durationInSeconds: 3.33,
      headline: "B",
      narration: "B",
      props: {},
      startFrame: 85,
      durationInFrames: 100,
    },
  ],
};

describe("transition review samples", () => {
  it("samples inside the 15-frame overlap at 30fps", () => {
    expect(transitionSampleFrame(spec, 0, 0.25)).toBe(89);
    expect(transitionSampleFrame(spec, 0, 0.5)).toBe(93);
    expect(transitionSampleFrame(spec, 0, 0.75)).toBe(96);
    expect(transitionSampleFrame(spec, 1, 0.5)).toBeNull();
  });

  it("uses stable review artifact names", () => {
    expect(transitionSampleFileName("scene-01", "scene-02", 0.5)).toBe("scene-01-to-scene-02.t50.png");
  });
});
