import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FPS, geometry, T_TRANSITION, T_TRANSITION_SECONDS, tierSeconds, type LockedVideoSpec } from "@motionreal/schema";
import {
  checkAudioSync,
  checkCaptions,
  checkCaptionClearance,
  checkDividerClearanceAbove,
  checkInFrame,
  checkLateSafeArea,
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
  RENDER_ORACLES,
  type Frame,
  type Rect,
} from "./render-grid.js";
import * as renderGridModule from "./render-grid.js";
import { encodePngRGBA } from "./png.js";
import { STALE_TIER3_BRIEF_SHAPE } from "../__fixtures__/authoring-failure-incidents.js";

/**
 * Render-oracle self-tests. Every oracle (N14, N15, N17, N18,
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
    format: "tiktok",
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

describe("N14 checkInFrame (format-aware edge ring)", () => {
  // The ONE format-aware layout oracle (D7/O5): content bleeding into the outer
  // safe-margin ring fires; clean center passes — for BOTH formats.
  it("tiktok (9:16): fires when content bleeds into the edge ring", () => {
    const g = geometry();
    const f = makeFrame(g.canvas.width, g.canvas.height);
    paint(f, { x: 0, y: 0, width: 8, height: g.canvas.height }, WHITE); // flush on the left edge
    const issues = checkInFrame(f, g, "scene-01");
    expect(issues.some((i) => i.check === "N14")).toBe(true);
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
  });
  it("fires when content bleeds into the right edge ring", () => {
    const g = geometry();
    const f = makeFrame(g.canvas.width, g.canvas.height);
    paint(f, { x: g.canvas.width - 8, y: 0, width: 8, height: g.canvas.height }, WHITE); // flush on the right edge
    expect(checkInFrame(f, g, "scene-01").some((i) => i.check === "N14")).toBe(true);
  });
  it("passes when content stays in the center", () => {
    const g = geometry();
    const f = makeFrame(g.canvas.width, g.canvas.height);
    paint(f, { x: Math.floor(g.canvas.width / 2) - 100, y: Math.floor(g.canvas.height / 2) - 100, width: 200, height: 200 }, WHITE);
    expect(checkInFrame(f, g)).toEqual([]);
  });
});

describe("N14 caption clearance", () => {
  it("fires when content reaches into the caption clearance gap", () => {
    const f = makeFrame(1080, 1920);
    paint(f, { x: 120, y: 1360, width: 500, height: 8 }, WHITE); // inside the gap band (1358..1370)
    expect(checkCaptionClearance(f).some((i) => i.check === "N14")).toBe(true);
  });
  it("passes when content stays above the divider, clear of the gap", () => {
    const f = makeFrame(1080, 1920);
    paint(f, { x: 120, y: 400, width: 500, height: 300 }, WHITE); // up in the content zone
    expect(checkCaptionClearance(f)).toEqual([]);
  });
});

describe("N14 above-divider clearance", () => {
  // The divider is drawn at CONTENT_ZONE.bottom (1350); the oracle scans the thin
  // band just above it (1334..1348).
  it("fires when content sits flush on the divider from above and the divider profile is enabled", () => {
    const f = makeFrame(1080, 1920);
    paint(f, { x: 120, y: 1338, width: 500, height: 10 }, WHITE); // flush above the divider
    expect(checkDividerClearanceAbove(f, undefined, { dividerClearanceAbove: true }).some((i) => i.check === "N14")).toBe(true);
  });
  it("passes when content keeps a clear gap above the divider and the divider profile is enabled", () => {
    const f = makeFrame(1080, 1920);
    paint(f, { x: 120, y: 400, width: 500, height: 300 }, WHITE); // up in the content zone
    expect(checkDividerClearanceAbove(f, undefined, { dividerClearanceAbove: true })).toEqual([]);
  });
  it("is a no-op by default because the production theme does not draw a divider", () => {
    const f = makeFrame(1080, 1920);
    paint(f, { x: 120, y: 1338, width: 500, height: 10 }, WHITE); // would otherwise fire
    expect(checkDividerClearanceAbove(f)).toEqual([]);
  });
  it("does NOT fire on sparse decorative speckle in the band (not overflow)", () => {
    // The bug this guards: a decorative backdrop paints isolated 1–4px dots (+ a
    // faint nebula glow) in the thin band above the divider. A raw per-pixel
    // count read them as "content flush on the divider" on every scene,
    // hard-blocking the render. Scattered specks never form a solid run, so the
    // run-based count must drop them — while real overflow (above) still fires.
    const f = makeFrame(1080, 1920);
    // ~40 tiny stars (2–3px) sprinkled across the band 1334..1348, each isolated.
    let seed = 1;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let n = 0; n < 40; n += 1) {
      const sx = 100 + Math.floor(rnd() * 800);
      const sy = 1335 + Math.floor(rnd() * 12);
      paint(f, { x: sx, y: sy, width: 2 + Math.floor(rnd() * 2), height: 2 }, WHITE);
    }
    expect(checkDividerClearanceAbove(f, undefined, { dividerClearanceAbove: true })).toEqual([]);
  });
});

describe("N14 late-sample (post-midpoint drift)", () => {
  // Re-runs the three N14 pixel oracles on a late still, downgrading every issue
  // to a WARNING tagged "[late sample]". Non-vacuous: a known-bad late frame
  // fires (as a warning), a clean one passes.
  it("fires as a WARNING (not error) when late content drifts into the caption gap", () => {
    const f = makeFrame(1080, 1920);
    paint(f, { x: 120, y: 1360, width: 500, height: 8 }, WHITE); // in the gap band 1358..1370
    const issues = checkLateSafeArea(f, "scene-03");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.check === "N14")).toBe(true);
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
    expect(issues.every((i) => i.message.startsWith("[late sample]"))).toBe(true);
    expect(issues.every((i) => i.sceneId === "scene-03")).toBe(true);
  });
  it("fires as a WARNING when late content sits flush on the divider from above", () => {
    const f = makeFrame(1080, 1920);
    paint(f, { x: 120, y: 1338, width: 500, height: 10 }, WHITE); // flush above the divider
    const issues = checkLateSafeArea(f, undefined, { dividerClearanceAbove: true });
    expect(issues.some((i) => i.check === "N14" && i.severity === "warning")).toBe(true);
  });
  it("passes (no issues) on a clean late still", () => {
    const f = makeFrame(1080, 1920);
    paint(f, { x: 200, y: 400, width: 500, height: 300 }, WHITE); // up in the content zone
    expect(checkLateSafeArea(f, "scene-03")).toEqual([]);
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
    paint(f, { x: 220, y: 1400, width: 600, height: 120 }, WHITE); // inside CAPTION_BAND (1370..1650)
    expect(checkContentZone(f, "scene-01")).toEqual([]);
  });
  it("tolerates a thin decorative frame border + corner ticks at the very edge", () => {
    const f = makeFrame(1080, 1920);
    paint(f, { x: 200, y: 300, width: 600, height: 600 }, WHITE); // real content, in zone
    // A 4px decorative border just inside the canvas edge (inset ~40px) + ticks.
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
    // Lock-shaped pad: first/last +T, middle +2T (T = T_TRANSITION_SECONDS).
    // Overlap timeline: total frames = Σspeech + (n−1)·T.
    const speechSec = 10;
    const speechF = speechSec * FPS;
    const firstDur = speechF + T_TRANSITION;
    const midDur = speechF + 2 * T_TRANSITION;
    const lastDur = speechF + T_TRANSITION;
    // Overlap starts: each next scene starts T before the previous sequence ends.
    const midStart = firstDur - T_TRANSITION;
    const lastStart = midStart + midDur - T_TRANSITION;
    const total = lastStart + lastDur;
    expect(T_TRANSITION_SECONDS).toBeGreaterThan(0);
    const locked = lockedFixture({
      durationInFrames: total,
      scenes: [
        scene("scene-01", 0, firstDur, "n", { src: "a.mp3", duration: speechSec }),
        scene("scene-02", midStart, midDur, "n", { src: "b.mp3", duration: speechSec }),
        scene("scene-03", lastStart, lastDur, "n", { src: "c.mp3", duration: speechSec }),
      ],
    });
    expect(checkAudioSync(locked)).toEqual([]);
  });
  it("still fires when a scene drifts beyond the transition padding", () => {
    const speechSec = 10;
    const speechF = speechSec * FPS;
    const firstDur = speechF + T_TRANSITION;
    // Middle scene: +2s beyond speech+2T padding → residual 2s > audioDriftTolerance.
    const midDur = speechF + 2 * T_TRANSITION + 2 * FPS;
    const lastDur = speechF + T_TRANSITION;
    const midStart = firstDur - T_TRANSITION;
    const lastStart = midStart + midDur - T_TRANSITION;
    const total = lastStart + lastDur;
    const locked = lockedFixture({
      durationInFrames: total,
      scenes: [
        scene("scene-01", 0, firstDur, "n", { src: "a.mp3", duration: speechSec }),
        scene("scene-02", midStart, midDur, "n", { src: "b.mp3", duration: speechSec }),
        scene("scene-03", lastStart, lastDur, "n", { src: "c.mp3", duration: speechSec }),
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

  it("incident fixture: stale tier-3 brief shape judges 142s against the stored 60s target", () => {
    expect(STALE_TIER3_BRIEF_SHAPE).toMatchObject({ format: "tiktok", durationTier: 3, duration: 60 });

    const issues = checkDuration(narrated(142 * 30), { targetDurationSeconds: STALE_TIER3_BRIEF_SHAPE.duration });

    expect(issues).toContainEqual(expect.objectContaining({ check: "N28", severity: "warning" }));
    expect(issues.map((issue) => issue.message).join(" ")).toMatch(/over the 60s target/);
  });

  it("does not warn a 142s TikTok tier-3 render when evaluated against the resolved tier target", () => {
    const issues = checkDuration(narrated(142 * 30), {
      targetDurationSeconds: tierSeconds(3),
    });

    expect(issues).toEqual([]);
  });
});

describe("N23 visual richness", () => {
  function motionFrame(x: number): Frame {
    const frame = makeFrame(80, 80);
    paint(frame, { x, y: 28, width: 18, height: 18 }, WHITE);
    return frame;
  }

  it("fires when a long scene has no motion", () => {
    const a = makeFrame(60, 60);
    paint(a, { x: 10, y: 10, width: 20, height: 20 }, WHITE);
    const b = makeFrame(60, 60);
    paint(b, { x: 10, y: 10, width: 20, height: 20 }, WHITE);
    expect(checkRichness([a, b], 8, "scene-02").some((i) => i.check === "N23")).toBe(true);
  });

  it("fires when a long scene moves only early, then holds a static tail", () => {
    const issues = checkRichness(
      [motionFrame(8), motionFrame(30), motionFrame(30), motionFrame(30)],
      8,
      "scene-02",
    );

    expect(issues.some((i) => i.check === "N23" && /static tail/.test(i.message))).toBe(true);
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
  });

  it("passes when a long scene shows motion", () => {
    const a = makeFrame(60, 60, { r: 0, g: 0, b: 0 });
    const b = makeFrame(60, 60, { r: 255, g: 255, b: 255 });
    expect(checkRichness([a, b], 8, "scene-02")).toEqual([]);
  });

  it("passes when a long scene keeps staged motion into later samples", () => {
    expect(checkRichness([motionFrame(8), motionFrame(24), motionFrame(40), motionFrame(56)], 8, "scene-02")).toEqual(
      [],
    );
  });

  it("ignores short scenes", () => {
    expect(checkRichness([motionFrame(8), motionFrame(30), motionFrame(30), motionFrame(30)], 2, "scene-02")).toEqual(
      [],
    );
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

  function fullFrame(rect: Rect): Buffer {
    const g = geometry();
    const f = makeFrame(g.canvas.width, g.canvas.height);
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

  it("runs the in-frame oracle for short-form stills", async () => {
    const g = geometry();
    await writeFile(join(dir, "scene-01.png"), fullFrame({ x: g.canvas.width - 8, y: 0, width: 8, height: g.canvas.height }));
    const locked = lockedFixture({
      format: "tiktok",
      ratio: "9:16",
      language: "en",
      scenes: [scene("scene-01", 0, 600, "one short line")],
    });

    const report = await runRenderGrid(locked, { framesDir: dir });

    expect(report.issues.some((i) => i.check === "N14" && /frame edge ring|edge ring/i.test(i.message))).toBe(true);
  });

  it("runs TikTok caption/divider zone oracles on short-form stills", async () => {
    await writeFile(join(dir, "scene-01.png"), fullFrame({ x: 220, y: 768, width: 1000, height: 10 }));
    const locked = lockedFixture({
      format: "tiktok",
      ratio: "9:16",
      language: "en",
      scenes: [scene("scene-01", 0, 600, "one short line")],
    });

    const report = await runRenderGrid(locked, { framesDir: dir });

    expect(report.issues.filter((i) => i.check === "N14")).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("does not auto-run above-divider clearance when the production divider is absent", async () => {
    await writeFile(join(dir, "scene-01.png"), fullFrame({ x: 120, y: 1338, width: 500, height: 10 }));
    const locked = lockedFixture({
      scenes: [scene("scene-01", 0, 600, "tu mot hai ba bon")],
    });

    const report = await runRenderGrid(locked, { framesDir: dir });

    expect(report.issues.some((i) => /flush on the divider/i.test(i.message))).toBe(false);
  });

  it("can still run above-divider clearance when a divider profile opts in", async () => {
    await writeFile(join(dir, "scene-01.png"), fullFrame({ x: 120, y: 1338, width: 500, height: 10 }));
    const locked = lockedFixture({
      scenes: [scene("scene-01", 0, 600, "tu mot hai ba bon")],
    });

    const report = await runRenderGrid(locked, { framesDir: dir }, { dividerClearanceAbove: true });

    expect(report.issues.some((i) => /flush on the divider/i.test(i.message))).toBe(true);
  });

});

describe("oracle registry (drift guard)", () => {
  it("has at least one registered oracle", () => {
    expect(RENDER_ORACLES.length).toBeGreaterThan(0);
  });

  it("every oracle id is unique", () => {
    const ids = RENDER_ORACLES.map((o) => o.id);
    expect(new Set(ids).size, `duplicate oracle id in registry: ${ids.join(", ")}`).toBe(ids.length);
  });

  it("every auto-run oracle declares a runnable phase with a run fn", () => {
    for (const oracle of RENDER_ORACLES) {
      if (oracle.phase === "manual") {
        expect("run" in oracle, `${oracle.id} is manual and must not carry a run fn`).toBe(false);
      } else {
        expect(typeof (oracle as { run: unknown }).run, `${oracle.id} (${oracle.phase}) needs a run fn`).toBe(
          "function",
        );
      }
    }
  });

  // The drift guard the §6.3 decision is really about: a new `check*` oracle
  // added to render-grid.ts but NOT entered in RENDER_ORACLES would silently be
  // un-classified (and, if auto-run-worthy, un-run). We introspect the module's
  // own exports — counting every exported `check*` function — and assert the
  // registry has exactly one entry per such function. Adding `checkFoo` without
  // a registry entry makes the counts diverge → red test, not a silent gap.
  it("registry has exactly one entry per exported check* oracle (adding one without registering fails)", () => {
    const checkFns = Object.keys(renderGridModule)
      .filter((k) => /^check[A-Z]/.test(k))
      .filter((k) => typeof (renderGridModule as Record<string, unknown>)[k] === "function")
      .sort();
    // Every exported oracle function must be classified in the registry.
    expect(
      RENDER_ORACLES.length,
      `exported check* fns (${checkFns.length}: ${checkFns.join(", ")}) ` +
        `!= registry entries (${RENDER_ORACLES.length}). Add the new oracle to RENDER_ORACLES.`,
    ).toBe(checkFns.length);

    // And the registry ids are the stable contract the rest of the plan refers
    // to — pin them so a rename is also a conscious edit.
    const KNOWN = [
      "pacing",
      "audio-sync",
      "duration",
      "captions",
      "content-zone",
      "caption-clearance",
      "divider-clearance-above",
      "density",
      "dead-air",
      "contrast",
      "transition",
      "safe-area",
      "in-frame",
      "late-safe-area",
      "overlap",
      "truncation",
      "richness",
    ];
    const registered = new Set(RENDER_ORACLES.map((o) => o.id));
    for (const id of KNOWN) {
      expect(registered.has(id), `oracle "${id}" missing from RENDER_ORACLES`).toBe(true);
    }
    expect(registered.size, "RENDER_ORACLES has an id not in the KNOWN list — add it").toBe(KNOWN.length);
  });
});
