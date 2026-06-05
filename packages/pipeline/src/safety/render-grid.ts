import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LockedVideoSpec } from "@news/schema";
import { makeReport, type SafetyIssue, type SafetyReport } from "../types.js";
import { decodePng, type DecodedImage } from "./png.js";

/**
 * Tier-3 deterministic-render oracles (N14–N23; Requirement 9). These inspect
 * rendered frames (per-scene PNG stills) and the locked spec to catch layout,
 * legibility, pacing, transition, and richness defects that the static + build
 * tiers cannot see. They are the web analogue of math_video_tool's post-render
 * oracle suite (F4/F5/F15/F18/F20/F21/F24/F29).
 *
 * N16 (determinism) lives in determinism.ts and is intentionally NOT duplicated
 * here. Every oracle below ships with a non-vacuous self-test (render-grid.test)
 * proving it fires on a known-bad input and passes on a clean one.
 *
 * Limitations are honest and documented: from a single midpoint still some
 * defects can only be approximated. N15 (overlap) and N17 (truncation) need
 * layout hints (block rects / a content box) that a flat raster does not carry,
 * so they are exported as oracles you feed those hints to; `runRenderGrid`
 * invokes the frame-only oracles (N14/N18/N19), the pure spec-level oracles
 * (N20/N22), and a coarse adjacent-still transition check (N21). N23 (richness)
 * needs several frames per scene and is exported for callers that sample them.
 */

export type Frame = DecodedImage;
export type Rect = { x: number; y: number; width: number; height: number };

export type RenderGridOptions = {
  /** Max channel-sum distance from the background before a pixel counts as "content". */
  contentThreshold?: number;
  /** Fraction of the safe-area band that may be content before N14 fires. */
  safeAreaMarginRatio?: number;
  safeAreaTolerance?: number;
  /** Below this content fraction a frame is "dead air" (N19). */
  deadAirFraction?: number;
  /** Minimum acceptable text/background contrast ratio (N18). */
  minContrast?: number;
  /** Max words-per-second before a scene is too short for its narration (N20). */
  maxWordsPerSecond?: number;
  /** Allowed |audio − video| drift in seconds (N22). */
  audioDriftTolerance?: number;
  /** A scene longer than this many seconds must show motion (N23). */
  richnessMinSeconds?: number;
  /** Below this inter-frame diff fraction a long scene is a static hold (N23). */
  staticDiffFraction?: number;
};

const DEFAULTS: Required<RenderGridOptions> = {
  contentThreshold: 60,
  safeAreaMarginRatio: 0.05,
  safeAreaTolerance: 0.005,
  deadAirFraction: 0.004,
  minContrast: 3,
  maxWordsPerSecond: 3.0,
  audioDriftTolerance: 0.5,
  richnessMinSeconds: 4,
  staticDiffFraction: 0.005,
};

type Rgb = { r: number; g: number; b: number };

function colorDistance(a: Rgb, r: number, g: number, b: number): number {
  return Math.abs(a.r - r) + Math.abs(a.g - g) + Math.abs(a.b - b);
}

function relativeLuminance(r: number, g: number, b: number): number {
  const f = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(l1: number, l2: number): number {
  const hi = Math.max(l1, l2) + 0.05;
  const lo = Math.min(l1, l2) + 0.05;
  return hi / lo;
}

/** Estimate the background color as the most frequent (coarsely quantized) pixel. */
function backgroundColor(frame: Frame): Rgb {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  const { width, height, data } = frame;
  const stepX = Math.max(1, Math.floor(width / 64));
  const stepY = Math.max(1, Math.floor(height / 64));
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const i = (y * width + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.count += 1;
      } else {
        buckets.set(key, { count: 1, r, g, b });
      }
    }
  }
  let best: { count: number; r: number; g: number; b: number } | null = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) best = bucket;
  }
  return best ? { r: best.r, g: best.g, b: best.b } : { r: 0, g: 0, b: 0 };
}

type FrameStats = {
  bg: Rgb;
  total: number;
  contentCount: number;
  contentFraction: number;
  avgContent: Rgb | null;
};

function analyzeFrame(frame: Frame, threshold: number): FrameStats {
  const bg = backgroundColor(frame);
  const { width, height, data } = frame;
  const total = width * height;
  let contentCount = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  for (let p = 0; p < total; p += 1) {
    const i = p * 4;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (colorDistance(bg, r, g, b) > threshold) {
      contentCount += 1;
      sr += r;
      sg += g;
      sb += b;
    }
  }
  const avgContent = contentCount > 0 ? { r: sr / contentCount, g: sg / contentCount, b: sb / contentCount } : null;
  return { bg, total, contentCount, contentFraction: contentCount / total, avgContent };
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function opt(options: RenderGridOptions | undefined): Required<RenderGridOptions> {
  return { ...DEFAULTS, ...(options ?? {}) };
}

// --- N14: safe-area / overflow (HARD) -------------------------------------

export function checkSafeArea(frame: Frame, sceneId?: string, options?: RenderGridOptions): SafetyIssue[] {
  const o = opt(options);
  const { width, height, data } = frame;
  const bg = backgroundColor(frame);
  const mx = Math.max(1, Math.floor(width * o.safeAreaMarginRatio));
  const my = Math.max(1, Math.floor(height * o.safeAreaMarginRatio));

  let bandPixels = 0;
  let bandContent = 0;
  for (let y = 0; y < height; y += 1) {
    const inVBand = y < my || y >= height - my;
    for (let x = 0; x < width; x += 1) {
      const inBand = inVBand || x < mx || x >= width - mx;
      if (!inBand) continue;
      bandPixels += 1;
      const i = (y * width + x) * 4;
      if (colorDistance(bg, data[i]!, data[i + 1]!, data[i + 2]!) > o.contentThreshold) bandContent += 1;
    }
  }
  const fraction = bandPixels > 0 ? bandContent / bandPixels : 0;
  if (fraction > o.safeAreaTolerance) {
    return [
      {
        check: "N14",
        severity: "error",
        sceneId,
        message: `Content paints into the 9:16 safe-area margin (${(fraction * 100).toFixed(2)}% of the edge band); keep content inside the safe rect.`,
      },
    ];
  }
  return [];
}

// --- N15: block overlap (HARD) --------------------------------------------

function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function checkOverlap(blocks: Rect[], sceneId?: string): SafetyIssue[] {
  const issues: SafetyIssue[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    for (let j = i + 1; j < blocks.length; j += 1) {
      if (rectsIntersect(blocks[i]!, blocks[j]!)) {
        issues.push({
          check: "N15",
          severity: "error",
          sceneId,
          message: `Two layout blocks overlap (block ${i} and block ${j}); illegible stacked content.`,
        });
      }
    }
  }
  return issues;
}

// --- N17: text truncation / clipping (HARD) -------------------------------

/**
 * Heuristic: dense content flush against the right or bottom edge of its content
 * box signals a clipped/ellipsized block. Needs the content box as a hint, since
 * a flat raster does not carry layout boxes.
 */
export function checkTruncation(
  frame: Frame,
  contentBox: Rect,
  sceneId?: string,
  options?: RenderGridOptions,
): SafetyIssue[] {
  const o = opt(options);
  const { width, data } = frame;
  const bg = backgroundColor(frame);
  const edgeX = contentBox.x + contentBox.width - 1;
  const edgeY = contentBox.y + contentBox.height - 1;

  let rightContent = 0;
  for (let y = contentBox.y; y <= edgeY; y += 1) {
    const i = (y * width + edgeX) * 4;
    if (colorDistance(bg, data[i]!, data[i + 1]!, data[i + 2]!) > o.contentThreshold) rightContent += 1;
  }
  let bottomContent = 0;
  for (let x = contentBox.x; x <= edgeX; x += 1) {
    const i = (edgeY * width + x) * 4;
    if (colorDistance(bg, data[i]!, data[i + 1]!, data[i + 2]!) > o.contentThreshold) bottomContent += 1;
  }
  const rightFrac = contentBox.height > 0 ? rightContent / contentBox.height : 0;
  const bottomFrac = contentBox.width > 0 ? bottomContent / contentBox.width : 0;
  if (rightFrac > 0.3 || bottomFrac > 0.3) {
    return [
      {
        check: "N17",
        severity: "error",
        sceneId,
        message: `Content is flush against its container edge (right ${(rightFrac * 100).toFixed(0)}%, bottom ${(bottomFrac * 100).toFixed(0)}%); likely truncated/clipped text.`,
      },
    ];
  }
  return [];
}

// --- N18: contrast / font availability (WARNING) --------------------------

export function checkContrast(frame: Frame, sceneId?: string, options?: RenderGridOptions): SafetyIssue[] {
  const o = opt(options);
  const stats = analyzeFrame(frame, o.contentThreshold);
  if (!stats.avgContent) return [];
  const lContent = relativeLuminance(stats.avgContent.r, stats.avgContent.g, stats.avgContent.b);
  const lBg = relativeLuminance(stats.bg.r, stats.bg.g, stats.bg.b);
  const ratio = contrastRatio(lContent, lBg);
  if (ratio < o.minContrast) {
    return [
      {
        check: "N18",
        severity: "warning",
        sceneId,
        message: `Text/background contrast is low (${ratio.toFixed(2)}:1, want ≥ ${o.minContrast}:1); check colors or a failed font load.`,
      },
    ];
  }
  return [];
}

// --- N19: dead air / blank frame (WARNING) --------------------------------

export function checkDeadAir(frame: Frame, sceneId?: string, options?: RenderGridOptions): SafetyIssue[] {
  const o = opt(options);
  const stats = analyzeFrame(frame, o.contentThreshold);
  if (stats.contentFraction < o.deadAirFraction) {
    return [
      {
        check: "N19",
        severity: "warning",
        sceneId,
        message: `Frame is near-empty (${(stats.contentFraction * 100).toFixed(2)}% content); possible dead air / blank frame while narration plays.`,
      },
    ];
  }
  return [];
}

// --- N20: pacing (WARNING, pure spec) -------------------------------------

export function checkPacing(locked: LockedVideoSpec, options?: RenderGridOptions): SafetyIssue[] {
  const o = opt(options);
  const issues: SafetyIssue[] = [];
  for (const scene of locked.scenes) {
    const words = countWords(scene.narration);
    const seconds = scene.durationInFrames / locked.fps;
    if (seconds <= 0) continue;
    const wps = words / seconds;
    if (wps > o.maxWordsPerSecond) {
      issues.push({
        check: "N20",
        severity: "warning",
        sceneId: scene.id,
        message: `${scene.id} is too short for its narration (${words} words in ${seconds.toFixed(1)}s ≈ ${wps.toFixed(2)} w/s, max ${o.maxWordsPerSecond}); give the beat more time.`,
      });
    }
  }
  return issues;
}

// --- N21: transition / flicker (WARNING) ----------------------------------

/** Fraction of pixels that differ beyond the content threshold between two equal-size frames. */
export function frameDiffFraction(a: Frame, b: Frame, threshold = DEFAULTS.contentThreshold): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  const total = a.width * a.height;
  let diff = 0;
  for (let p = 0; p < total; p += 1) {
    const i = p * 4;
    const d =
      Math.abs(a.data[i]! - b.data[i]!) +
      Math.abs(a.data[i + 1]! - b.data[i + 1]!) +
      Math.abs(a.data[i + 2]! - b.data[i + 2]!);
    if (d > threshold) diff += 1;
  }
  return diff / total;
}

export function checkTransition(a: Frame, b: Frame, sceneId?: string, options?: RenderGridOptions): SafetyIssue[] {
  const o = opt(options);
  const diff = frameDiffFraction(a, b, o.contentThreshold);
  if (diff < 0.001) {
    return [
      {
        check: "N21",
        severity: "warning",
        sceneId,
        message: "Adjacent scenes are nearly identical (hard cut with no visible transition).",
      },
    ];
  }
  if (diff > 0.98) {
    return [
      {
        check: "N21",
        severity: "warning",
        sceneId,
        message: "Adjacent scenes change almost entirely between frames (possible flicker / clear-and-rebuild).",
      },
    ];
  }
  return [];
}

// --- N22: audio sync (WARNING, pure spec) ---------------------------------

export function checkAudioSync(locked: LockedVideoSpec, options?: RenderGridOptions): SafetyIssue[] {
  const o = opt(options);
  const issues: SafetyIssue[] = [];
  const scenesWithAudio = locked.scenes.filter((s) => typeof s.audio?.duration === "number");
  if (scenesWithAudio.length === 0) return issues; // no narration → nothing to sync

  for (const scene of scenesWithAudio) {
    const audio = scene.audio!.duration;
    const video = scene.durationInFrames / locked.fps;
    if (Math.abs(audio - video) > o.audioDriftTolerance) {
      issues.push({
        check: "N22",
        severity: "warning",
        sceneId: scene.id,
        message: `${scene.id} audio (${audio.toFixed(2)}s) drifts from its video length (${video.toFixed(2)}s) beyond ${o.audioDriftTolerance}s.`,
      });
    }
  }

  const totalAudio = scenesWithAudio.reduce((sum, s) => sum + (s.audio!.duration ?? 0), 0);
  const totalVideo = locked.durationInFrames / locked.fps;
  if (Math.abs(totalAudio - totalVideo) > o.audioDriftTolerance) {
    issues.push({
      check: "N22",
      severity: "warning",
      message: `Total narration (${totalAudio.toFixed(2)}s) drifts from total video (${totalVideo.toFixed(2)}s) beyond ${o.audioDriftTolerance}s.`,
    });
  }
  return issues;
}

// --- N23: visual richness (WARNING) ---------------------------------------

/** `frames` are samples across one scene; a long scene that barely changes is a static hold. */
export function checkRichness(
  frames: Frame[],
  sceneSeconds: number,
  sceneId?: string,
  options?: RenderGridOptions,
): SafetyIssue[] {
  const o = opt(options);
  if (frames.length < 2 || sceneSeconds < o.richnessMinSeconds) return [];
  let maxDiff = 0;
  for (let i = 1; i < frames.length; i += 1) {
    maxDiff = Math.max(maxDiff, frameDiffFraction(frames[i - 1]!, frames[i]!, o.contentThreshold));
  }
  if (maxDiff < o.staticDiffFraction) {
    return [
      {
        check: "N23",
        severity: "warning",
        sceneId,
        message: `${sceneId ?? "scene"} holds ${sceneSeconds.toFixed(1)}s with almost no motion (max inter-frame change ${(maxDiff * 100).toFixed(2)}%); show, don't tell.`,
      },
    ];
  }
  return [];
}

// --- aggregator -----------------------------------------------------------

export type RenderGridArtifacts = {
  /** Directory holding one PNG per scene named `scene-NN.png`. */
  framesDir: string;
  /** Optional rendered MP4 (reserved for future ffmpeg-based oracles). */
  mp4Path?: string;
};

/**
 * Run the deterministic-render grid over a locked spec + its per-scene stills.
 * Spec-level oracles (N20/N22) always run; frame oracles (N14/N18/N19) run per
 * decoded still; a coarse adjacent-still transition check (N21) runs between
 * consecutive scenes. Missing/undecodable stills become non-blocking warnings so
 * the grid never crashes. N15/N17 (need layout hints) and N23 (needs multiple
 * frames per scene) are exported separately for callers that have those inputs.
 */
export async function runRenderGrid(
  locked: LockedVideoSpec,
  artifacts: RenderGridArtifacts,
  options?: RenderGridOptions,
): Promise<SafetyReport> {
  const issues: SafetyIssue[] = [];

  // Spec-level oracles (no pixels needed).
  issues.push(...checkPacing(locked, options));
  issues.push(...checkAudioSync(locked, options));

  // Decode one still per scene.
  const frames: Array<Frame | null> = [];
  for (const scene of locked.scenes) {
    const path = join(artifacts.framesDir, `${scene.id}.png`);
    try {
      frames.push(decodePng(await readFile(path)));
    } catch (error) {
      frames.push(null);
      issues.push({
        check: "N14",
        severity: "warning",
        sceneId: scene.id,
        message: `Could not load still "${scene.id}.png" (${errMessage(error)}); pixel oracles skipped for this scene.`,
      });
    }
  }

  // Single-frame oracles.
  locked.scenes.forEach((scene, i) => {
    const frame = frames[i];
    if (!frame) return;
    issues.push(...checkSafeArea(frame, scene.id, options));
    issues.push(...checkDeadAir(frame, scene.id, options));
    issues.push(...checkContrast(frame, scene.id, options));
  });

  // Coarse transition check between adjacent scene stills (midpoint proxy).
  for (let i = 0; i < frames.length - 1; i += 1) {
    const a = frames[i];
    const b = frames[i + 1];
    if (a && b) issues.push(...checkTransition(a, b, locked.scenes[i + 1]!.id, options));
  }

  return makeReport(issues, ["render"]);
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
