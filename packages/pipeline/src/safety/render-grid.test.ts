import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LockedVideoSpec } from "@news/schema";
import {
  checkAudioSync,
  checkContrast,
  checkDeadAir,
  checkOverlap,
  checkPacing,
  checkRichness,
  checkSafeArea,
  checkTransition,
  checkTruncation,
  runRenderGrid,
  type Frame,
  type Rect,
} from "./render-grid.js";
import { encodePngRGBA } from "./png.js";

/**
 * Render-oracle self-tests (Requirement 9.3). Every oracle (N14, N15, N17, N18,
 * N19, N20, N21, N22, N23) has a NON-VACUOUS test: a synthetic known-bad input
 * fires it, and a clean input passes. Frames are built directly in memory — no
 * Remotion render, no browser.
 */

const DARK_BG = { r: 10, g: 12, b: 18 };
const WHITE = { r: 255, g: 255, b: 255 };

function makeFrame(width: number, height: number, bg = DARK_BG): Frame {
  const data = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p += 1) {
    data[p * 4] = bg.r;
    data[p * 4 + 1] = bg.g;
    data[p * 4 + 2] = bg.b;
    data[p * 4 + 3] = 255;
  }
  return { width, height, data };
}

function paint(frame: Frame, rect: Rect, color: { r: number; g: number; b: number }): void {
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) continue;
      const i = (y * frame.width + x) * 4;
      frame.data[i] = color.r;
      frame.data[i + 1] = color.g;
      frame.data[i + 2] = color.b;
      frame.data[i + 3] = 255;
    }
  }
}

function lockedFixture(overrides: Partial<LockedVideoSpec> & { scenes: LockedVideoSpec["scenes"] }): LockedVideoSpec {
  return {
    version: 1,
    title: "Render grid test",
    styleId: "clean-luxury-tech",
    duration: 60,
    ratio: "9:16",
    language: "vi",
    fps: 30,
    durationInFrames: overrides.scenes.reduce((s, sc) => s + sc.durationInFrames, 0),
    audio: {},
    ...overrides,
  };
}

function scene(
  id: string,
  startFrame: number,
  durationInFrames: number,
  narration: string,
  audio?: { src: string; duration: number },
): LockedVideoSpec["scenes"][number] {
  return {
    id,
    component: "hero-announcement",
    durationInSeconds: durationInFrames / 30,
    headline: "H",
    narration,
    props: {},
    startFrame,
    durationInFrames,
    ...(audio ? { audio } : {}),
  };
}

describe("N14 safe-area / overflow", () => {
  it("fires when content paints into the edge margin", () => {
    const f = makeFrame(200, 200);
    paint(f, { x: 0, y: 0, width: 8, height: 200 }, WHITE); // flush against the left edge
    expect(checkSafeArea(f).some((i) => i.check === "N14")).toBe(true);
  });
  it("passes when content stays in the center", () => {
    const f = makeFrame(200, 200);
    paint(f, { x: 80, y: 80, width: 40, height: 40 }, WHITE);
    expect(checkSafeArea(f)).toEqual([]);
  });
});

describe("N15 block overlap", () => {
  it("fires when two blocks intersect", () => {
    const blocks: Rect[] = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 50, y: 50, width: 100, height: 100 },
    ];
    expect(checkOverlap(blocks).some((i) => i.check === "N15")).toBe(true);
  });
  it("passes when blocks are disjoint", () => {
    const blocks: Rect[] = [
      { x: 0, y: 0, width: 40, height: 40 },
      { x: 60, y: 60, width: 40, height: 40 },
    ];
    expect(checkOverlap(blocks)).toEqual([]);
  });
});

describe("N17 truncation", () => {
  const box: Rect = { x: 20, y: 20, width: 160, height: 160 };
  it("fires when content is flush against the container edge", () => {
    const f = makeFrame(200, 200);
    paint(f, { x: 178, y: 20, width: 2, height: 160 }, WHITE); // column at box right edge (179)
    expect(checkTruncation(f, box).some((i) => i.check === "N17")).toBe(true);
  });
  it("passes when content keeps a margin inside the box", () => {
    const f = makeFrame(200, 200);
    paint(f, { x: 40, y: 40, width: 60, height: 60 }, WHITE);
    expect(checkTruncation(f, box)).toEqual([]);
  });
});

describe("N18 contrast / font", () => {
  it("fires when content is low-contrast against the background", () => {
    const f = makeFrame(120, 120);
    paint(f, { x: 30, y: 30, width: 60, height: 60 }, { r: 40, g: 42, b: 48 });
    expect(checkContrast(f).some((i) => i.check === "N18")).toBe(true);
  });
  it("passes for high-contrast white-on-dark text", () => {
    const f = makeFrame(120, 120);
    paint(f, { x: 30, y: 30, width: 60, height: 60 }, WHITE);
    expect(checkContrast(f)).toEqual([]);
  });
});

describe("N19 dead air / blank", () => {
  it("fires on a near-empty frame", () => {
    const f = makeFrame(120, 120);
    expect(checkDeadAir(f).some((i) => i.check === "N19")).toBe(true);
  });
  it("passes when the frame has real content", () => {
    const f = makeFrame(120, 120);
    paint(f, { x: 20, y: 20, width: 80, height: 80 }, WHITE);
    expect(checkDeadAir(f)).toEqual([]);
  });
});

describe("N20 pacing", () => {
  it("fires when a scene is too short for its narration", () => {
    const narration = Array.from({ length: 30 }, (_, i) => `tu${i}`).join(" ");
    const locked = lockedFixture({ scenes: [scene("scene-01", 0, 30, narration)] }); // 30 words in 1s
    expect(checkPacing(locked).some((i) => i.check === "N20")).toBe(true);
  });
  it("passes when the scene gives the narration room", () => {
    const narration = Array.from({ length: 30 }, (_, i) => `tu${i}`).join(" ");
    const locked = lockedFixture({ scenes: [scene("scene-01", 0, 600, narration)] }); // 30 words in 20s
    expect(checkPacing(locked)).toEqual([]);
  });
});

describe("N21 transition / flicker", () => {
  it("fires on a near-identical hard cut", () => {
    const a = makeFrame(60, 60);
    paint(a, { x: 10, y: 10, width: 20, height: 20 }, WHITE);
    const b = makeFrame(60, 60);
    paint(b, { x: 10, y: 10, width: 20, height: 20 }, WHITE);
    expect(checkTransition(a, b).some((i) => i.check === "N21")).toBe(true);
  });
  it("fires on a near-total change (flicker)", () => {
    const a = makeFrame(60, 60, { r: 0, g: 0, b: 0 });
    const b = makeFrame(60, 60, { r: 255, g: 255, b: 255 });
    expect(checkTransition(a, b).some((i) => i.check === "N21")).toBe(true);
  });
  it("passes on a moderate change", () => {
    const a = makeFrame(100, 100);
    paint(a, { x: 30, y: 30, width: 40, height: 40 }, WHITE);
    const b = makeFrame(100, 100);
    paint(b, { x: 30, y: 20, width: 40, height: 40 }, WHITE);
    expect(checkTransition(a, b)).toEqual([]);
  });
});

describe("N22 audio sync", () => {
  it("fires when audio drifts from the scene's video length", () => {
    const locked = lockedFixture({
      scenes: [scene("scene-01", 0, 300, "n", { src: "a.mp3", duration: 12 })], // 10s video vs 12s audio
    });
    expect(checkAudioSync(locked).some((i) => i.check === "N22")).toBe(true);
  });
  it("passes when audio matches the video length", () => {
    const locked = lockedFixture({
      scenes: [scene("scene-01", 0, 300, "n", { src: "a.mp3", duration: 10.1 })],
    });
    expect(checkAudioSync(locked)).toEqual([]);
  });
});

describe("N23 visual richness", () => {
  it("fires when a long scene barely changes", () => {
    const a = makeFrame(60, 60);
    paint(a, { x: 10, y: 10, width: 20, height: 20 }, WHITE);
    const b = makeFrame(60, 60);
    paint(b, { x: 10, y: 10, width: 20, height: 20 }, WHITE);
    expect(checkRichness([a, b], 8, "scene-02").some((i) => i.check === "N23")).toBe(true);
  });
  it("passes when a long scene shows motion", () => {
    const a = makeFrame(60, 60, { r: 0, g: 0, b: 0 });
    const b = makeFrame(60, 60, { r: 255, g: 255, b: 255 });
    expect(checkRichness([a, b], 8, "scene-02")).toEqual([]);
  });
  it("ignores short scenes", () => {
    const a = makeFrame(60, 60);
    const b = makeFrame(60, 60);
    expect(checkRichness([a, b], 2, "scene-02")).toEqual([]);
  });
});

describe("runRenderGrid aggregator", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "news-rendergrid-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function cleanFrame(rect: Rect): Buffer {
    const f = makeFrame(100, 100);
    paint(f, rect, WHITE);
    return encodePngRGBA(f.width, f.height, f.data);
  }

  it("runs spec + frame oracles over decoded stills and reports no errors on clean input", async () => {
    await writeFile(join(dir, "scene-01.png"), cleanFrame({ x: 30, y: 30, width: 40, height: 40 }));
    await writeFile(join(dir, "scene-02.png"), cleanFrame({ x: 30, y: 20, width: 40, height: 40 }));
    const locked = lockedFixture({
      scenes: [scene("scene-01", 0, 600, "tu mot hai ba bon"), scene("scene-02", 600, 600, "tu nam sau bay tam")],
    });

    const report = await runRenderGrid(locked, { framesDir: dir });
    expect(report.ranTiers).toEqual(["render"]);
    expect(report.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("is resilient to a missing still (warns, does not crash)", async () => {
    await writeFile(join(dir, "scene-01.png"), cleanFrame({ x: 30, y: 30, width: 40, height: 40 }));
    const locked = lockedFixture({
      scenes: [scene("scene-01", 0, 600, "tu mot hai ba"), scene("scene-02", 600, 600, "tu nam sau bay")],
    });

    const report = await runRenderGrid(locked, { framesDir: dir });
    expect(report.issues.some((i) => i.sceneId === "scene-02" && /could not load still/i.test(i.message))).toBe(true);
  });
});
