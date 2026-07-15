import { Easing, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FPS } from "@motionreal/schema";

/**
 * Deterministic motion helpers for render runtime (not authored scenes).
 * Pure functions of the frame — no randomness / wall-clock.
 */

/** Same curve as the old theme easing.out control points. */
export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);

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
