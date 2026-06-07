import { type DecodedImage } from "./png.js";

/**
 * Pure pixel/color math for the Tier-3 render oracles (extracted from
 * render-grid.ts for single responsibility). Nothing here knows about oracles,
 * the locked spec, or safety issues — just decoded frames in, numbers out. All
 * functions are deterministic and side-effect free.
 */

export type Frame = DecodedImage;
export type Rgb = { r: number; g: number; b: number };

export type FrameStats = {
  bg: Rgb;
  total: number;
  contentCount: number;
  contentFraction: number;
  avgContent: Rgb | null;
};

/** L1 (channel-sum) distance between a reference color and an (r,g,b) sample. */
export function colorDistance(a: Rgb, r: number, g: number, b: number): number {
  return Math.abs(a.r - r) + Math.abs(a.g - g) + Math.abs(a.b - b);
}

/** WCAG relative luminance for an 8-bit sRGB triple. */
export function relativeLuminance(r: number, g: number, b: number): number {
  const f = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio between two relative luminances. */
export function contrastRatio(l1: number, l2: number): number {
  const hi = Math.max(l1, l2) + 0.05;
  const lo = Math.min(l1, l2) + 0.05;
  return hi / lo;
}

/** Estimate the background color as the most frequent (coarsely quantized) pixel. */
export function backgroundColor(frame: Frame): Rgb {
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

/** Background color + content-pixel stats (count, fraction, average content color). */
export function analyzeFrame(frame: Frame, threshold: number): FrameStats {
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
