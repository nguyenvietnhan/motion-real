import { describe, expect, it } from "vitest";
import {
  CANVAS,
  CAPTION_BAND,
  CONTENT_ZONE,
  FPS,
  SceneSpecSchema,
  T_TRANSITION,
  UI_RESERVE,
  parseAiJsonOutput,
  rectContains,
  rectHeight,
  rectWidth,
  secondsToFrames,
  transitionFrames,
  uiReserveTop,
} from "./index.js";

/**
 * @news/schema self-tests: the single source of truth for layout zones + timing.
 * Pure, deterministic.
 */

describe("layout zones", () => {
  it("content zone sits above the caption band with a clearance gap", () => {
    expect(CONTENT_ZONE.bottom).toBeLessThan(CAPTION_BAND.top);
    expect(CAPTION_BAND.top - CONTENT_ZONE.bottom).toBeGreaterThan(0);
  });

  it("caption band stays above the bottom platform-UI reserve", () => {
    expect(CAPTION_BAND.bottom).toBeLessThanOrEqual(uiReserveTop());
    expect(uiReserveTop()).toBe(CANVAS.height - UI_RESERVE.bottom);
  });

  it("rect helpers compute width/height and containment", () => {
    expect(rectWidth(CONTENT_ZONE)).toBe(CONTENT_ZONE.right - CONTENT_ZONE.left);
    expect(rectHeight(CONTENT_ZONE)).toBe(CONTENT_ZONE.bottom - CONTENT_ZONE.top);
    expect(rectContains(CONTENT_ZONE, { top: 200, bottom: 400, left: 200, right: 400 })).toBe(true);
    expect(rectContains(CONTENT_ZONE, { top: 0, bottom: 400, left: 200, right: 400 })).toBe(false);
  });
});

describe("timing", () => {
  it("transitionFrames is fps-aware and at least 1 frame", () => {
    expect(transitionFrames(30)).toBe(15);
    expect(transitionFrames(20)).toBe(10);
    expect(transitionFrames(60)).toBe(30);
    expect(T_TRANSITION).toBe(transitionFrames(FPS));
  });

  it("secondsToFrames rounds and never returns 0", () => {
    expect(secondsToFrames(2, 30)).toBe(60);
    expect(secondsToFrames(0, 30)).toBe(1);
  });
});

describe("parseAiJsonOutput", () => {
  it("parses plain JSON and strips ```json fences", () => {
    expect(parseAiJsonOutput('{"a":1}')).toEqual({ a: 1 });
    expect(parseAiJsonOutput("```json\n{\"a\":2}\n```")).toEqual({ a: 2 });
    expect(parseAiJsonOutput("```\n{\"a\":3}\n```")).toEqual({ a: 3 });
  });
});

describe("SceneSpecSchema id", () => {
  const base = { component: "x", durationInSeconds: 10, headline: "H", narration: "n", props: {} };
  it("accepts sequential scene-NN ids", () => {
    expect(SceneSpecSchema.safeParse({ id: "scene-01", ...base }).success).toBe(true);
  });
  it("rejects malformed ids", () => {
    expect(SceneSpecSchema.safeParse({ id: "scene-1", ...base }).success).toBe(false);
    expect(SceneSpecSchema.safeParse({ id: "intro", ...base }).success).toBe(false);
  });
});
