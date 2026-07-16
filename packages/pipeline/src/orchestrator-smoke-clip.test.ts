import { describe, expect, it } from "vitest";
import type { LockedVideoSpec } from "@motionreal/schema";
import { clipLockedSpecToSeconds, SMOKE_RENDER_SECONDS } from "./orchestrator.js";

function makeSpec(overrides?: Partial<LockedVideoSpec>): LockedVideoSpec {
  return {
    version: 1,
    title: "clip-test",
    format: "tiktok",
    duration: 60,
    ratio: "9:16",
    language: "vi",
    theme: { dominant: "#5B8CFF" },
    fps: 30,
    durationInFrames: 900,
    scenes: [
      {
        id: "scene-01",
        component: "demo-hero",
        durationInSeconds: 10,
        headline: "A",
        narration: "a",
        props: {},
        startFrame: 0,
        durationInFrames: 300,
        audio: { src: "audio/a.wav", duration: 10 },
      },
      {
        id: "scene-02",
        component: "demo-idea",
        durationInSeconds: 20,
        headline: "B",
        narration: "b",
        props: {},
        startFrame: 300,
        durationInFrames: 600,
      },
    ],
    audio: { narrationSrc: "audio/mix.wav" },
    captions: [{ startFrame: 0, endFrame: 30, text: "hi", sceneId: "scene-01" }],
    ...overrides,
  };
}

describe("clipLockedSpecToSeconds", () => {
  it("clips to ~10s, drops audio and captions", () => {
    const clipped = clipLockedSpecToSeconds(makeSpec(), SMOKE_RENDER_SECONDS);
    expect(clipped.durationInFrames).toBe(300);
    expect(clipped.scenes).toHaveLength(1);
    expect(clipped.scenes[0]!.durationInFrames).toBe(300);
    expect(clipped.scenes[0]!.audio).toBeUndefined();
    expect(clipped.audio).toEqual({});
    expect(clipped.captions).toEqual([]);
    expect(clipped.title).toContain("smoke");
  });

  it("keeps short specs silent without growing duration", () => {
    const short = makeSpec({
      durationInFrames: 90,
      duration: 3,
      scenes: [
        {
          id: "scene-01",
          component: "demo-hero",
          durationInSeconds: 3,
          headline: "A",
          narration: "a",
          props: {},
          startFrame: 0,
          durationInFrames: 90,
        },
      ],
      audio: {},
      captions: [],
    });
    const clipped = clipLockedSpecToSeconds(short, SMOKE_RENDER_SECONDS);
    expect(clipped.durationInFrames).toBe(90);
    expect(clipped.scenes).toHaveLength(1);
  });
});
