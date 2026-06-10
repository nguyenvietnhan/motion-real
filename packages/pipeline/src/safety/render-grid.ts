import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CAPTION_BAND,
  CONTENT_ZONE,
  CANVAS,
  T_TRANSITION_SECONDS,
  type LockedVideoSpec,
} from "@news/schema";
import { makeReport, type SafetyIssue, type SafetyReport } from "../types.js";
import { MAX_CAPTION_LINE_CHARS } from "../audio/captions.js";
import { decodePng } from "./png.js";
import {
  analyzeFrame,
  backgroundColor,
  colorDistance,
  contrastRatio,
  relativeLuminance,
  type Frame,
  type FrameStats,
  type Rgb,
} from "./frame-stats.js";

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
 * defects can only be approximated. `runRenderGrid` auto-runs the frame-only
 * oracles (N14 content-zone + caption-clearance, N18, N19, N30), the pure
 * spec-level oracles (N20, N22, N28, N29), and a coarse adjacent-still
 * transition check (N21). Three oracles are exported + self-tested but are NOT
 * auto-run, because a flat midpoint still lacks the inputs they need:
 *   - N15 (overlap) and N17 (truncation) need per-block layout rects / a content
 *     box, which a flat raster does not carry — feed them those hints to use them.
 *   - N23 (richness) needs several frames per scene; and because the always-on
 *     ambient tilt (useTilt) moves every scene's pixels each frame, an
 *     inter-frame-motion oracle cannot separate a rich scene from a lazy static
 *     one on a real render. Richness is instead nudged by N30 + N19 + the
 *     visualization playbook guidance. The function stays for callers that sample
 *     tilt-free frames.
 */

export type { Frame };
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
  /** Allowed |audio − video| drift in seconds (N22), on top of transition padding. */
  audioDriftTolerance?: number;
  /**
   * Outer decorative-frame ring (as a fraction of the smaller canvas side) that
   * N14 ignores: a thin editorial border / corner ticks at the very edge is
   * chrome the host platform overlays anyway, not content. Genuine content
   * pushed into the platform-UI reserve still lies INSIDE this ring and fires.
   */
  chromeMarginRatio?: number;
  /** Soft target total duration in seconds (N28-duration); 0/undefined disables. */
  targetDurationSeconds?: number;
  /** Allowed +/- seconds around the duration target before the soft check warns. */
  durationTolerance?: number;
  /** A scene longer than this many seconds must show motion (N23). */
  richnessMinSeconds?: number;
  /** Below this inter-frame diff fraction a long scene is a static hold (N23). */
  staticDiffFraction?: number;
  /** Max fraction of the caption-clearance gap that may be content before N14 fires (HARD). */
  captionClearanceTolerance?: number;
  /**
   * Whether to enforce a clearance gap ABOVE the divider (content must not sit
   * flush on the divider from above). Default on. A future layout grammar that
   * doesn't draw a divider at CONTENT_ZONE.bottom can turn this off — the oracle
   * reads the same zone the composition draws from, so it never asserts a rule
   * the layout itself doesn't hold.
   */
  dividerClearanceAbove?: boolean;
  /** Max fraction of the above-divider clearance band that may be content before N14 fires (HARD). */
  dividerClearanceAboveTolerance?: number;
  /** Above this content-zone fill fraction, a scene reads as overcrowded (N30, advisory). */
  densityFraction?: number;
};

const DEFAULTS: Required<RenderGridOptions> = {
  contentThreshold: 60,
  safeAreaMarginRatio: 0.05,
  safeAreaTolerance: 0.005,
  deadAirFraction: 0.004,
  minContrast: 3,
  maxWordsPerSecond: 3.0,
  audioDriftTolerance: 0.5,
  chromeMarginRatio: 0.045,
  targetDurationSeconds: 0,
  durationTolerance: 20,
  richnessMinSeconds: 4,
  staticDiffFraction: 0.005,
  captionClearanceTolerance: 0.01,
  dividerClearanceAbove: true,
  dividerClearanceAboveTolerance: 0.01,
  densityFraction: 0.6,
};

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

// --- N14 (zone-aware): content must live in the content zone / caption band ---

/**
 * Zone-aware N14 (author-mode-v2 R15.4): authored content must stay inside the
 * CONTENT_ZONE and captions inside the CAPTION_BAND; nothing may paint into the
 * platform-UI reserve (bottom band / right action rail). We allow content in the
 * union of the content zone and the caption band (captions paint there), and
 * flag any meaningful content outside that union — which catches content sliding
 * into the bottom UI reserve or out past the safe margins. Zones are defined in
 * the 1080×1920 space and scaled to the actual still size.
 */
export function checkContentZone(frame: Frame, sceneId?: string, options?: RenderGridOptions): SafetyIssue[] {
  const o = opt(options);
  const { width, height, data } = frame;
  const bg = backgroundColor(frame);
  const sx = width / CANVAS.width;
  const sy = height / CANVAS.height;
  // Allowed band: from the top of the content zone down through the bottom of
  // the caption band, within the widest horizontal margins. This flags content
  // in the top margin, the side margins, and the bottom platform-UI reserve
  // (below the caption band) — without nitpicking the small gap between the
  // content zone and the caption band.
  const allowed = {
    top: CONTENT_ZONE.top * sy,
    bottom: CAPTION_BAND.bottom * sy,
    left: Math.min(CONTENT_ZONE.left, CAPTION_BAND.left) * sx,
    right: Math.max(CONTENT_ZONE.right, CAPTION_BAND.right) * sx,
  };
  const inside = (x: number, y: number) =>
    x >= allowed.left && x <= allowed.right && y >= allowed.top && y <= allowed.bottom;

  // Ignore a thin decorative-frame ring at the very canvas edge (editorial
  // border + corner registration ticks are chrome the platform overlays, not
  // content). Content genuinely intruding into the UI reserve sits inside this
  // ring and is still flagged.
  const ring = Math.floor(Math.min(width, height) * o.chromeMarginRatio);
  const inChromeRing = (x: number, y: number) =>
    x < ring || x >= width - ring || y < ring || y >= height - ring;

  let total = 0;
  let outside = 0;
  const stepX = Math.max(1, Math.floor(width / 256));
  const stepY = Math.max(1, Math.floor(height / 256));
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      total += 1;
      const i = (y * width + x) * 4;
      if (colorDistance(bg, data[i]!, data[i + 1]!, data[i + 2]!) <= o.contentThreshold) continue;
      if (!inside(x, y) && !inChromeRing(x, y)) outside += 1;
    }
  }
  const fraction = total > 0 ? outside / total : 0;
  if (fraction > o.safeAreaTolerance) {
    return [
      {
        check: "N14",
        severity: "error",
        sceneId,
        message: `Content paints outside the content zone / caption band (${(fraction * 100).toFixed(2)}% of sampled pixels), e.g. into the platform-UI reserve; keep content inside the content zone.`,
      },
    ];
  }
  return [];
}

// --- N14 (caption clearance): authored content must keep clear of captions (HARD) ---

/**
 * Authored content must NOT creep down toward the caption band — there must be a
 * visible gap (the global divider line sits at the content-zone bottom, above
 * this gap). We scan ONLY the clearance gap between the content zone and the
 * caption band: captions never render there, so ANY meaningful content in this
 * band is authored overflow drifting into the captions, and is a hard error.
 * (Scanning the caption band itself would false-positive on the burned-in
 * captions, so we deliberately scan the gap above it.)
 */
export function checkCaptionClearance(frame: Frame, sceneId?: string, options?: RenderGridOptions): SafetyIssue[] {
  const o = opt(options);
  const { width, height, data } = frame;
  const bg = backgroundColor(frame);
  const sx = width / CANVAS.width;
  const sy = height / CANVAS.height;
  // The gap between the content zone and the caption band. Start a few px below
  // the content-zone bottom so the global divider line (drawn at that boundary)
  // is not counted as overflow.
  const top = Math.floor((CONTENT_ZONE.bottom + 8) * sy);
  const bottom = Math.floor(CAPTION_BAND.top * sy);
  const left = Math.floor(CONTENT_ZONE.left * sx);
  const right = Math.ceil(CONTENT_ZONE.right * sx);
  // Need enough vertical resolution to resolve the ~32px gap; on tiny frames the
  // band collapses and would false-positive, so skip (real stills are full/half res).
  if (bottom - top < 6) return [];
  let band = 0;
  let content = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      band += 1;
      const i = (y * width + x) * 4;
      if (colorDistance(bg, data[i]!, data[i + 1]!, data[i + 2]!) > o.contentThreshold) content += 1;
    }
  }
  const fraction = band > 0 ? content / band : 0;
  if (fraction > o.captionClearanceTolerance) {
    return [
      {
        check: "N14",
        severity: "error",
        sceneId,
        message: `Content reaches into the caption clearance gap (${(fraction * 100).toFixed(2)}% of the gap band); keep authored content above the divider, clear of the caption band.`,
      },
    ];
  }
  return [];
}

// --- N14 (above-divider clearance): content must keep a gap ABOVE the divider (HARD) ---

/**
 * Symmetric partner to `checkCaptionClearance`: that one scans BELOW the divider
 * (content drifting down into the caption gap); this scans a thin band JUST ABOVE
 * the divider, so content that sits flush ON the divider from above is caught
 * too. Unlike the `Story`-layout fix (which only constrains scenes built with
 * `<Story>`), this oracle works on the rendered pixels and so guards EVERY scene
 * — including ones authored directly with `<Frame>` that bypass `Story`.
 *
 * It reads the SAME `CONTENT_ZONE.bottom` the composition's `CaptionDivider` is
 * drawn from, so it asserts exactly "don't touch the divider that is actually
 * drawn" — never a hard-coded y. A future layout grammar that draws no divider
 * there sets `dividerClearanceAbove: false` and this becomes a no-op, so the
 * oracle never outlives the rule it enforces.
 *
 * The scanned band (`ABOVE_DIVIDER_BAND` px, in canvas space) is deliberately
 * thinner than `Story`'s 24px clearance, so content that correctly clears the
 * divider never lands in it — only genuinely-flush content fires.
 */
const ABOVE_DIVIDER_BAND = 16;

export function checkDividerClearanceAbove(frame: Frame, sceneId?: string, options?: RenderGridOptions): SafetyIssue[] {
  const o = opt(options);
  if (!o.dividerClearanceAbove) return [];
  const { width, height, data } = frame;
  const bg = backgroundColor(frame);
  const sx = width / CANVAS.width;
  const sy = height / CANVAS.height;
  // The thin band immediately ABOVE the divider line. The divider is drawn AT
  // CONTENT_ZONE.bottom (downward), so we stop a couple px short of it to avoid
  // counting the divider itself as content.
  const bottom = Math.floor((CONTENT_ZONE.bottom - 2) * sy);
  const top = Math.floor((CONTENT_ZONE.bottom - ABOVE_DIVIDER_BAND) * sy);
  const left = Math.floor(CONTENT_ZONE.left * sx);
  const right = Math.ceil(CONTENT_ZONE.right * sx);
  // On a tiny still the band collapses and would false-positive; skip (real
  // stills are full/half res, same guard as the below-divider scan).
  if (bottom - top < 6) return [];
  let band = 0;
  let content = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      band += 1;
      const i = (y * width + x) * 4;
      if (colorDistance(bg, data[i]!, data[i + 1]!, data[i + 2]!) > o.contentThreshold) content += 1;
    }
  }
  const fraction = band > 0 ? content / band : 0;
  if (fraction > o.dividerClearanceAboveTolerance) {
    return [
      {
        check: "N14",
        severity: "error",
        sceneId,
        message: `Content sits flush on the divider from above (${(fraction * 100).toFixed(2)}% of the band just above the divider); keep a clear gap above the line.`,
      },
    ];
  }
  return [];
}

// --- N15: block overlap (HARD) --------------------------------------------

/**
 * Overlap area of two rects, 0 when disjoint. Used (not a boolean intersect) so
 * a tiny shared edge from sub-pixel rounding doesn't count as a real overlap.
 */
function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * N15 — sibling layout blocks must not overlap. `blocks` are the measured rects
 * of the COMPOSED `@news/blocks` units (from the layout probe), which are
 * siblings in the content column, so any real overlap between them is stacked,
 * illegible content. A small `tolerance` fraction of the smaller block's area is
 * ignored so a 1–2px touch from rounding/borders never false-fires. `severity`
 * defaults to "error" (the historical hard-gate); callers easing it in pass
 * "warning".
 */
export function checkOverlap(
  blocks: Rect[],
  sceneId?: string,
  severity: SafetyIssue["severity"] = "error",
  tolerance = 0.02,
): SafetyIssue[] {
  const issues: SafetyIssue[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    for (let j = i + 1; j < blocks.length; j += 1) {
      const a = blocks[i]!;
      const b = blocks[j]!;
      const area = overlapArea(a, b);
      if (area <= 0) continue;
      const minArea = Math.min(a.width * a.height, b.width * b.height);
      if (minArea > 0 && area / minArea <= tolerance) continue; // negligible touch
      issues.push({
        check: "N15",
        severity,
        sceneId,
        message: `Two layout blocks overlap (block ${i} and block ${j}); illegible stacked content.`,
      });
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
  const n = locked.scenes.length;
  const scenesWithAudio = locked.scenes.filter((s) => typeof s.audio?.duration === "number");
  if (scenesWithAudio.length === 0) return issues; // no narration → nothing to sync

  // The lock pads each scene's video by the transitions touching it (T per
  // adjacent transition), so video > audio by a KNOWN amount. Compare the
  // residual drift after subtracting that expected transition padding. The
  // transition length is defined in SECONDS (fps-independent), so this is
  // correct for both the 30fps final and a lower-fps draft.
  const tSeconds = T_TRANSITION_SECONDS;
  locked.scenes.forEach((scene, i) => {
    if (typeof scene.audio?.duration !== "number") return;
    const audio = scene.audio.duration;
    const video = scene.durationInFrames / locked.fps;
    const adjacentTransitions = (i > 0 ? 1 : 0) + (i < n - 1 ? 1 : 0);
    const expectedPadding = adjacentTransitions * tSeconds;
    const residual = video - audio - expectedPadding;
    if (Math.abs(residual) > o.audioDriftTolerance) {
      issues.push({
        check: "N22",
        severity: "warning",
        sceneId: scene.id,
        message: `${scene.id} audio (${audio.toFixed(2)}s) drifts from its video length (${video.toFixed(2)}s, incl. ${expectedPadding.toFixed(2)}s transition) by ${residual.toFixed(2)}s.`,
      });
    }
  });

  const totalAudio = scenesWithAudio.reduce((sum, s) => sum + (s.audio!.duration ?? 0), 0);
  const totalVideo = locked.durationInFrames / locked.fps;
  const expectedTotalPadding = Math.max(0, n - 1) * tSeconds;
  const totalResidual = totalVideo - totalAudio - expectedTotalPadding;
  if (Math.abs(totalResidual) > o.audioDriftTolerance) {
    issues.push({
      check: "N22",
      severity: "warning",
      message: `Total narration (${totalAudio.toFixed(2)}s) drifts from total video (${totalVideo.toFixed(2)}s, incl. ${expectedTotalPadding.toFixed(2)}s transitions) by ${totalResidual.toFixed(2)}s.`,
    });
  }
  return issues;
}

// --- N28-duration: soft total-duration target (WARNING, pure spec) --------

/**
 * Soft duration check: when a target is configured, warn if the finished video
 * lands outside `target ± tolerance`. Advisory only (free pacing stands), but it
 * surfaces "way under/over the brief" so a video that should be ~2 min does not
 * silently ship at ~1 min. "Rather over than under" is the editorial rule, so
 * the message distinguishes the two directions.
 */
export function checkDuration(locked: LockedVideoSpec, options?: RenderGridOptions): SafetyIssue[] {
  const o = opt(options);
  if (!o.targetDurationSeconds || o.targetDurationSeconds <= 0) return [];
  const total = locked.durationInFrames / locked.fps;
  const low = o.targetDurationSeconds - o.durationTolerance;
  const high = o.targetDurationSeconds + o.durationTolerance;
  if (total < low) {
    return [
      {
        check: "N28",
        severity: "warning",
        message: `Video is ${total.toFixed(1)}s — under the ${o.targetDurationSeconds}s target (min ${low.toFixed(0)}s); add scenes/narration ("rather over than under").`,
      },
    ];
  }
  if (total > high) {
    return [
      {
        check: "N28",
        severity: "warning",
        message: `Video is ${total.toFixed(1)}s — over the ${o.targetDurationSeconds}s target (max ${high.toFixed(0)}s); tighten narration.`,
      },
    ];
  }
  return [];
}

// --- N29: caption track (WARNING) -----------------------------------------

/**
 * N29 caption oracle (author-mode-v2 R16): a scene that has narration should
 * carry a caption while it plays, every cue must fit within the video, and a
 * cue line should not be so long it overflows the caption band. Severity is
 * advisory (warning); contrast + in-band placement are guaranteed structurally
 * by the `Captions` block (scrim + CAPTION_BAND), so this focuses on coverage
 * and line length. `maxLineChars` overflow uses a generous 1.4× allowance.
 */
export function checkCaptions(locked: LockedVideoSpec, maxLineChars = MAX_CAPTION_LINE_CHARS): SafetyIssue[] {
  const issues: SafetyIssue[] = [];
  const captions = locked.captions ?? [];

  for (const scene of locked.scenes) {
    const hasSpeech = typeof scene.audio?.duration === "number" && scene.audio.duration > 0;
    if (!hasSpeech) continue;
    const covered = captions.some((c) => c.sceneId === scene.id);
    if (!covered) {
      issues.push({
        check: "N29",
        severity: "warning",
        sceneId: scene.id,
        message: `${scene.id} has narration but no caption cue; viewers with sound off get no caption while it plays.`,
      });
    }
  }

  const overflowLimit = Math.ceil(maxLineChars * 1.4);
  for (const cue of captions) {
    if (cue.text.length > overflowLimit) {
      issues.push({
        check: "N29",
        severity: "warning",
        sceneId: cue.sceneId,
        message: `Caption line is ${cue.text.length} chars (> ${overflowLimit}); it may overflow the single-line caption band.`,
      });
    }
    if (cue.startFrame < 0 || cue.endFrame > locked.durationInFrames || cue.endFrame <= cue.startFrame) {
      issues.push({
        check: "N29",
        severity: "warning",
        sceneId: cue.sceneId,
        message: `Caption cue [${cue.startFrame}, ${cue.endFrame}) is out of the video range [0, ${locked.durationInFrames}).`,
      });
    }
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

// --- N30: content density / overcrowding (WARNING) ------------------------

/**
 * Flags an OVERCROWDED scene: too much of the content zone is filled with
 * content (text + blocks packed edge-to-edge), which reads as cluttered and
 * usually means too many ideas were stuffed into one scene. Advisory only — a
 * legitimately busy chart can be dense — so it surfaces in the report to nudge
 * "one idea per scene / split it / trim text", never blocks the render. Measured
 * over the CONTENT_ZONE (not the whole frame) so empty margins don't dilute it.
 */
export function checkDensity(frame: Frame, sceneId?: string, options?: RenderGridOptions): SafetyIssue[] {
  const o = opt(options);
  const { width, height, data } = frame;
  const bg = backgroundColor(frame);
  const sx = width / CANVAS.width;
  const sy = height / CANVAS.height;
  const top = Math.floor(CONTENT_ZONE.top * sy);
  const bottom = Math.floor(CONTENT_ZONE.bottom * sy);
  const left = Math.floor(CONTENT_ZONE.left * sx);
  const right = Math.floor(CONTENT_ZONE.right * sx);
  if (bottom - top < 40 || right - left < 40) return [];
  let zone = 0;
  let content = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      zone += 1;
      const i = (y * width + x) * 4;
      if (colorDistance(bg, data[i]!, data[i + 1]!, data[i + 2]!) > o.contentThreshold) content += 1;
    }
  }
  const frac = zone > 0 ? content / zone : 0;
  if (frac > o.densityFraction) {
    return [
      {
        check: "N30",
        severity: "warning",
        sceneId,
        message: `${sceneId ?? "scene"} fills ${(frac * 100).toFixed(0)}% of the content zone (> ${(o.densityFraction * 100).toFixed(0)}%) — it reads overcrowded; split it into more scenes or trim text (one idea per scene).`,
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
 * Spec-level oracles (N20/N22/N28/N29) always run; frame oracles
 * (N14/N18/N19/N30) run per decoded still; a coarse adjacent-still transition
 * check (N21) runs between consecutive scenes. Missing/undecodable stills become
 * non-blocking warnings so the grid never crashes. N15/N17 (need layout hints)
 * and N23 (needs tilt-free multi-frame samples) are exported separately for
 * callers that have those inputs — see the file header for why they don't
 * auto-run.
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
  issues.push(...checkDuration(locked, options));
  issues.push(...checkCaptions(locked));

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
    issues.push(...checkContentZone(frame, scene.id, options));
    issues.push(...checkCaptionClearance(frame, scene.id, options));
    issues.push(...checkDividerClearanceAbove(frame, scene.id, options));
    issues.push(...checkDensity(frame, scene.id, options));
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
