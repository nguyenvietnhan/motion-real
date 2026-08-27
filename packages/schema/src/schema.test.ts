import { describe, expect, it } from "vitest";
import {
  CANVAS,
  CAPTION_BAND,
  CONTENT_ZONE,
  FPS,
  SceneImageSchema,
  SceneSpecSchema,
  T_TRANSITION,
  UI_RESERVE,
  geometry,
  parseAiJsonOutput,
  rectHeight,
  rectWidth,
  secondsToFrames,
  transitionFrames,
} from "./index.js";

/**
 * @motionreal/schema self-tests: the single source of truth for layout zones + timing.
 * Pure, deterministic.
 */

describe("layout zones", () => {
  it("content zone sits above the caption band with a clearance gap", () => {
    expect(CONTENT_ZONE.bottom).toBeLessThan(CAPTION_BAND.top);
    expect(CAPTION_BAND.top - CONTENT_ZONE.bottom).toBeGreaterThan(0);
  });

  it("rect helpers compute width/height", () => {
    expect(rectWidth(CONTENT_ZONE)).toBe(CONTENT_ZONE.right - CONTENT_ZONE.left);
    expect(rectHeight(CONTENT_ZONE)).toBe(CONTENT_ZONE.bottom - CONTENT_ZONE.top);
  });

  it("caption band stays within the bottom platform-UI reserve", () => {
    expect(CAPTION_BAND.bottom).toBeLessThanOrEqual(CANVAS.height - UI_RESERVE.bottom);
  });
});

describe("geometry", () => {
  it("returns the short-form 9:16 globals", () => {
    const g = geometry();
    expect(g.format).toBe("tiktok");
    expect(g.canvas).toEqual({ width: CANVAS.width, height: CANVAS.height });
    expect(g.contentZone).toEqual(CONTENT_ZONE);
    expect(g.captionBand).toEqual(CAPTION_BAND);
    expect(g.uiReserve).toEqual({ bottom: UI_RESERVE.bottom, right: UI_RESERVE.right });
    expect(g.safeMargin).toBeGreaterThan(0);
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
  it("accepts an optional local image and rejects a remote one", () => {
    expect(SceneSpecSchema.safeParse({ id: "scene-01", ...base, image: { ref: "assets/a.png" } }).success).toBe(true);
    expect(SceneSpecSchema.safeParse({ id: "scene-01", ...base, image: { ref: "https://x/y.png" } }).success).toBe(false);
  });
});

describe("SceneImageSchema ref refinement (local-only, raster-only)", () => {
  const ok = (ref: string) => SceneImageSchema.safeParse({ ref }).success;
  it("accepts project-relative raster paths", () => {
    expect(ok("assets/photo.png")).toBe(true);
    expect(ok("assets/x.jpg")).toBe(true);
    expect(ok("assets/x.jpeg")).toBe(true);
    expect(ok("assets/x.webp")).toBe(true);
    expect(ok("assets/x.gif")).toBe(true);
  });
  it("rejects URL / data / blob schemes (remote media banned at render time)", () => {
    expect(ok("http://x/y.png")).toBe(false);
    expect(ok("https://x/y.png")).toBe(false);
    expect(ok("data:image/png;base64,AAAA")).toBe(false);
    expect(ok("blob:abcd")).toBe(false);
  });
  it("rejects absolute paths and '..' traversal", () => {
    expect(ok("/etc/passwd.png")).toBe(false);
    expect(ok("C:\\secret.png")).toBe(false);
    expect(ok("../../outside.png")).toBe(false);
    expect(ok("assets/../../escape.png")).toBe(false);
  });
  it("rejects non-raster / scriptable formats (SVG)", () => {
    expect(ok("assets/x.svg")).toBe(false);
    expect(ok("assets/x.mp4")).toBe(false);
    expect(ok("assets/noext")).toBe(false);
  });
  it("accepts an optional alt and caps its length", () => {
    expect(SceneImageSchema.safeParse({ ref: "assets/x.png", alt: "a chart" }).success).toBe(true);
    expect(SceneImageSchema.safeParse({ ref: "assets/x.png", alt: "x".repeat(161) }).success).toBe(false);
  });
  it("keeps legacy images valid and validates explicit presentation roles", () => {
    expect(SceneImageSchema.safeParse({ ref: "assets/x.png" }).success).toBe(true);
    expect(SceneImageSchema.safeParse({ ref: "assets/logo.png", role: "logo" }).success).toBe(true);
    expect(SceneImageSchema.safeParse({ ref: "assets/logo.png", role: "wallpaper" }).success).toBe(false);
  });
});
