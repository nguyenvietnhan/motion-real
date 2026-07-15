import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { easing } from "@motionreal/theme";
import { FPS } from "@motionreal/schema";

/**
 * Deterministic motion helpers for render runtime (not authored scenes).
 * Pure functions of the frame — no randomness / wall-clock.
 */

/** Cubic-bezier evaluator usable inside Remotion's `interpolate` easing option. */
export function bezier(p: readonly [number, number, number, number], t: number): number {
  const [x1, y1, x2, y2] = p;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u: number) => ((ay * u + by) * u + cy) * u;
  let u = t;
  for (let i = 0; i < 5; i += 1) {
    const x = sampleX(u) - t;
    const d = (3 * ax * u + 2 * bx) * u + cx;
    if (Math.abs(d) < 1e-6) break;
    u -= x / d;
  }
  return sampleY(Math.min(1, Math.max(0, u)));
}

/** Shared ease-out curve for entrances. */
export const easeOut = (t: number): number => bezier(easing.out, t);

/** Spring-based 0..1 entrance progress. `delay`/`durationInFrames` are 30fps-reference. */
export function useReveal(delay = 0, durationInFrames = 22): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = fps / FPS;
  return spring({
    frame: frame - delay * k,
    fps,
    durationInFrames: Math.max(1, Math.round(durationInFrames * k)),
    config: { damping: 200, mass: 0.9, stiffness: 120 },
  });
}

/**
 * One-time entrance "push in" that settles to scale 1.0 well before midpoint
 * (N14-safe). Used by master composition for emphasis:"zoom".
 */
export function useIntroZoom(fromScale = 1.045, settleSec = 0.55): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = easeOut(Math.min(1, Math.max(0, frame / Math.max(1, settleSec * fps))));
  return fromScale + (1 - fromScale) * t;
}
