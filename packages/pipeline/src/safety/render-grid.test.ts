import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LockedVideoSpec } from "@news/schema";
import {
  checkAudioSync,
  checkCaptions,
  checkCaptionClearance,
  checkDividerClearanceAbove,
  checkDensity,
  checkContentZone,
  checkContrast,
  checkDeadAir,
  checkDuration,
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
    captions: [],
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

describe("N14 caption clearance", () => {
  it("fires when content reaches into the caption clearance gap", () => {
    const f = makeFrame(1080, 1920);
    paint(f, { x: 120, y: 1205, width: 500, height: 20 }, WHITE); // inside the gap band
    expect(checkCaptionClearance(f).some((i) => i.check === "N14")).toBe(true);
  });
  it("passes when content stays above the divider, clear of the gap", () => {
    const f = makeFrame(1080, 1920);
    paint(f, { x: 120, y: 400, width: 500, height: 300 }, WHITE); // up in the content zone
    expect(checkCaptionClearance(f)).toEqual([]);
  });
});

describe("N14 above-divider clearance", () => {
  // The divider is drawn at CONTENT_ZONE.bottom (1190); the oracle scans the thin
  // band just above it (1174..1188).
  it("fires when content sits flush on the divider from above", () => {
    const f = makeFrame(1080, 1920);
    paint(f, { x: 120, y: 1178, width: 500, height: 12 }, WHITE); // flush above the divider
    expect(checkDividerClearanceAbove(f).some((i) => i.check === "N14")).toBe(true);
  });
  it("passes when content keeps a clear gap above the divider", () => {
    const f = makeFrame(1080, 1920);
    paint(f, { x: 120, y: 400, width: 500, height: 300 }, WHITE); // up in the content zone
    expect(checkDividerClearanceAbove(f)).toEqual([]);
  });
  it("is a no-op when divider-clearance enforcement is turned off (future layout)", () => {
    const f = makeFrame(1080, 1920);
    paint(f, { x: 120, y: 1178, width: 500, height: 12 }, WHITE); // would otherwise fire
    expect(checkDividerClearanceAbove(f, undefined, { dividerClearanceAbove: false })).toEqual([]);
  });
});

describe("N30 content density", () => {
  it("warns when content fills most of the content zone (overcrowded)", () => {
    const f = makeFrame(1080, 1920);
    paint(f, { x: 90, y: 110, width: 900, height: 1060 }, WHITE); // packs the content zone
    const issues = checkDensity(f, "scene-01");
    expect(issues.some((i) => i.check === "N30" && i.severity === "warning")).toBe(true);
  });
  it("passes for a clean scene with breathing room", () => {
    const f = makeFrame(1080, 1920);
    paint(f, { x: 200, y: 300, width: 500, height: 260 }, WHITE);
    expect(checkDensity(f, "scene-01")).toEqual([]);
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
  it("emits the requested severity (warning when eased in)", () => {
    const blocks: Rect[] = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 50, y: 50, width: 100, height: 100 },
    ];
    expect(checkOverlap(blocks, "scene-01", "warning").every((i) => i.severity === "warning")).toBe(true);
  });
  it("ignores a negligible sub-pixel touch (below the area tolerance)", () => {
    // Two big blocks sharing only a 1px-wide sliver — a rounding/border touch,
    // not stacked content — stays under the 2% tolerance and must not fire.
    const blocks: Rect[] = [
      { x: 0, y: 0, width: 200, height: 200 },
      { x: 199, y: 0, width: 200, height: 200 },
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

describe("N14 zone-aware (content zone / caption band)", () => {
  it("fires when content paints into the bottom platform-UI reserve", () => {
    const f = makeFrame(1080, 1920); // full canvas so zones map 1:1
    paint(f, { x: 300, y: 1700, width: 480, height: 150 }, WHITE); // below the caption band
    expect(checkContentZone(f, "scene-01").some((i) => i.check === "N14")).toBe(true);
  });
  it("passes when content stays in the content zone and a caption sits in the band", () => {
    const f = makeFrame(1080, 1920);
    paint(f, { x: 200, y: 300, width: 600, height: 600 }, WHITE); // inside CONTENT_ZONE
    paint(f, { x: 220, y: 1330, width: 600, height: 120 }, WHITE); // inside CAPTION_BAND
    expect(checkContentZone(f, "scene-01")).toEqual([]);
  });
  it("tolerates a thin decorative frame border + corner ticks at the very edge", () => {
    const f = makeFrame(1080, 1920);
    paint(f, { x: 200, y: 300, width: 600, height: 600 }, WHITE); // real content, in zone
    // A 4px editorial border just inside the canvas edge (inset ~40px) + ticks.
    paint(f, { x: 40, y: 40, width: 1000, height: 4 }, WHITE); // top
    paint(f, { x: 40, y: 1876, width: 1000, height: 4 }, WHITE); // bottom (in UI reserve)
    paint(f, { x: 40, y: 40, width: 4, height: 1840 }, WHITE); // left
    paint(f, { x: 1036, y: 40, width: 4, height: 1840 }, WHITE); // right
    expect(checkContentZone(f, "scene-01")).toEqual([]);
  });
});

describe("N29 caption track", () => {
  it("fires when a narrated scene has no caption cue", () => {
    const locked = lockedFixture({
      scenes: [scene("scene-01", 0, 90, "Một câu đọc thử", { src: "a.wav", duration: 3 })],
      captions: [],
    });
    expect(checkCaptions(locked).some((i) => i.check === "N29")).toBe(true);
  });
  it("fires when a caption line is too long to fit one line", () => {
    const locked = lockedFixture({
      scenes: [scene("scene-01", 0, 90, "Một câu đọc thử", { src: "a.wav", duration: 3 })],
      captions: [{ startFrame: 0, endFrame: 60, text: "x".repeat(80), sceneId: "scene-01" }],
    });
    expect(checkCaptions(locked).some((i) => i.check === "N29")).toBe(true);
  });
  it("passes when each narrated scene has a short in-range cue", () => {
    const locked = lockedFixture({
      scenes: [scene("scene-01", 0, 90, "Một câu đọc thử", { src: "a.wav", duration: 3 })],
      captions: [{ startFrame: 0, endFrame: 60, text: "Dòng phụ đề ngắn gọn", sceneId: "scene-01" }],
    });
    expect(checkCaptions(locked)).toEqual([]);
  });
  it("does not require captions for a scene without narration", () => {
    const locked = lockedFixture({
      scenes: [scene("scene-01", 0, 90, "Không có audio")],
      captions: [],
    });
    expect(checkCaptions(locked)).toEqual([]);
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
  it("passes a multi-scene timeline where video exceeds audio only by transition padding", () => {
    // T_TRANSITION = 12 frames @ 30fps = 0.4s. Middle scene gets 2T (0.8s),
    // first/last get T (0.4s) of padding by lock design — not a real drift.
    // Real locks OVERLAP transitions, so total = Σspeech + (n−1)·T = 900 + 24.
    const locked = lockedFixture({
      durationInFrames: 924,
      scenes: [
        scene("scene-01", 0, 312, "n", { src: "a.mp3", duration: 10 }), // 10.4s video, +T
        scene("scene-02", 312, 324, "n", { src: "b.mp3", duration: 10 }), // 10.8s video, +2T
        scene("scene-03", 636, 312, "n", { src: "c.mp3", duration: 10 }), // 10.4s video, +T
      ],
    });
    expect(checkAudioSync(locked)).toEqual([]);
  });
  it("still fires when a scene drifts beyond the transition padding", () => {
    const locked = lockedFixture({
      durationInFrames: 924,
      scenes: [
        scene("scene-01", 0, 312, "n", { src: "a.mp3", duration: 10 }),
        scene("scene-02", 312, 360, "n", { src: "b.mp3", duration: 10 }), // 12s video, +2s drift
        scene("scene-03", 672, 312, "n", { src: "c.mp3", duration: 10 }),
      ],
    });
    expect(checkAudioSync(locked).some((i) => i.check === "N22" && i.sceneId === "scene-02")).toBe(true);
  });
});

describe("N28 duration target (soft)", () => {
  const narrated = (frames: number) =>
    lockedFixture({ scenes: [scene("scene-01", 0, frames, "n", { src: "a.mp3", duration: frames / 30 })] });
  it("is disabled when no target is set", () => {
    expect(checkDuration(narrated(3600))).toEqual([]);
  });
  it("warns when the video is well under the target", () => {
    // 70s video vs a 120s target (±20s → min 100s).
    const issues = checkDuration(narrated(70 * 30), { targetDurationSeconds: 120 });
    expect(issues.some((i) => i.check === "N28" && /under/.test(i.message))).toBe(true);
  });
  it("warns when the video is well over the target", () => {
    const issues = checkDuration(narrated(180 * 30), { targetDurationSeconds: 120 });
    expect(issues.some((i) => i.check === "N28" && /over/.test(i.message))).toBe(true);
  });
  it("passes within the tolerance band", () => {
    const issues = checkDuration(narrated(125 * 30), { targetDurationSeconds: 120 });
    expect(issues).toEqual([]);
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
