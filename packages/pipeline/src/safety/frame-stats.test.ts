import { describe, expect, it } from "vitest";
import {
  analyzeFrame,
  backgroundColor,
  colorDistance,
  contrastRatio,
  relativeLuminance,
  type Frame,
} from "./frame-stats.js";

/**
 * Self-tests for the pure pixel/color math under every Tier-3 pixel oracle
 * (extracted from render-grid.ts). Deterministic, no IO.
 */

const BLACK = { r: 0, g: 0, b: 0 };
const WHITE = { r: 255, g: 255, b: 255 };

function frame(width: number, height: number, bg: { r: number; g: number; b: number }): Frame {
  const data = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p += 1) {
    data[p * 4] = bg.r;
    data[p * 4 + 1] = bg.g;
    data[p * 4 + 2] = bg.b;
    data[p * 4 + 3] = 255;
  }
  return { width, height, data };
}

function paint(f: Frame, x0: number, y0: number, w: number, h: number, c: { r: number; g: number; b: number }): void {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const i = (y * f.width + x) * 4;
      f.data[i] = c.r;
      f.data[i + 1] = c.g;
      f.data[i + 2] = c.b;
    }
  }
}

describe("frame-stats", () => {
  it("colorDistance is the L1 channel-sum distance", () => {
    expect(colorDistance(BLACK, 255, 255, 255)).toBe(765);
    expect(colorDistance({ r: 10, g: 20, b: 30 }, 10, 20, 30)).toBe(0);
  });

  it("relativeLuminance + contrastRatio: white-on-black is ~21:1", () => {
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 2);
    expect(relativeLuminance(0, 0, 0)).toBeCloseTo(0, 5);
    const ratio = contrastRatio(relativeLuminance(255, 255, 255), relativeLuminance(0, 0, 0));
    expect(ratio).toBeGreaterThan(20.9);
    expect(ratio).toBeLessThan(21.1);
  });

  it("backgroundColor returns the dominant (most-frequent) pixel color", () => {
    const f = frame(100, 100, WHITE);
    paint(f, 10, 10, 20, 20, BLACK); // small minority block
    const bg = backgroundColor(f);
    expect(bg.r).toBeGreaterThan(200); // white dominates
  });

  it("analyzeFrame reports content fraction + average content color", () => {
    const f = frame(100, 100, BLACK);
    paint(f, 10, 10, 30, 30, WHITE); // a clear minority block (~9%) on a black bg
    const stats = analyzeFrame(f, 60);
    expect(stats.contentFraction).toBeGreaterThan(0.05);
    expect(stats.contentFraction).toBeLessThan(0.15);
    expect(stats.avgContent).not.toBeNull();
    expect(stats.avgContent!.r).toBeGreaterThan(200);
  });

  it("analyzeFrame on an empty frame has no content", () => {
    const stats = analyzeFrame(frame(40, 40, BLACK), 60);
    expect(stats.contentFraction).toBe(0);
    expect(stats.avgContent).toBeNull();
  });
});
