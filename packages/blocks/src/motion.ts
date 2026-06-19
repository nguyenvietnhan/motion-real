import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { easing } from "@news/theme";
import { FPS } from "@news/schema";
import { useSceneDurationInFrames } from "./scene-timing.js";

/**
 * Deterministic motion helpers shared by blocks. All are pure functions of the
 * frame (no randomness, no wall-clock time), so they pass the forbidden-API lint
 * and keep renders byte-identical (N16).
 *
 * FPS-AWARE: timing args are expressed in "30fps-reference frames" (or seconds)
 * and scaled by the actual render fps, so an entrance that takes 0.6s at the
 * 30fps final takes the SAME 0.6s in the 10fps fast draft (the draft is a
 * faithful preview, just lower-res). Numeric helpers used here are only
 * abs/max/min/round — never the random generator.
 */

const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Scale a 30fps-reference frame count to the actual render fps. */
export function useFrameScale(): number {
  const { fps } = useVideoConfig();
  return fps / FPS;
}

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

/** Eased 0..1 ramp over [delay, delay+len] (30fps-reference) — for counters / bars. */
export function useRamp(delay = 0, len = 26): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = fps / FPS;
  const t = (frame - delay * k) / Math.max(1, len * k);
  return Math.min(1, Math.max(0, easeOut(Math.min(1, Math.max(0, t)))));
}

/**
 * Pure eased 0..1 ramp — read `frame`+`fps` ONCE in a component, then call this
 * per item inside a `.map` (rules-of-hooks safe). `delay`/`len` are 30fps-ref.
 */
export function frameRamp(frame: number, fps: number, delay = 0, len = 16): number {
  const k = fps / FPS;
  return easeOut(Math.min(1, Math.max(0, (frame - delay * k) / Math.max(1, len * k))));
}

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

/** Hook giving 0..1 progress through the current scene (fps-independent). */
export function useSceneProgress(): number {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return durationInFrames > 1 ? Math.min(1, Math.max(0, frame / (durationInFrames - 1))) : 0;
}

/**
 * Approximate 0..1 progress within a scene, based on the SEQUENCE-relative frame
 * over an assumed scene length. (Inside a `TransitionSeries.Sequence`,
 * `useCurrentFrame()` is sequence-relative but `useVideoConfig().durationInFrames`
 * is the whole composition — so true per-scene progress isn't available without
 * threading the scene duration. For slow ambient motion an assumed span is plenty.)
 */
export function useApproxSceneProgress(assumedSeconds = 10): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return Math.min(1, Math.max(0, frame / Math.max(1, assumedSeconds * fps)));
}

/**
 * `useExactSceneProgress` — 0..1 progress through THIS scene, using the scene's
 * real duration (from `SceneTimingProvider`). 0 at the first frame, 1 at the
 * last. Use this when an effect must finish exactly at the scene end.
 */
export function useExactSceneProgress(): number {
  const frame = useCurrentFrame();
  const dur = useSceneDurationInFrames();
  return dur > 1 ? Math.min(1, Math.max(0, frame / (dur - 1))) : 0;
}

/**
 * `useTilt` — the "living card" effect (used with a 3D `perspective` + `rotateY`
 * by the scene wrapper): the content block enters leaning slightly to one side
 * and rotates in DEPTH to the other side by the moment the scene ends, like a
 * plank being tipped from edge to edge. Returns degrees (feed to `rotateY`).
 * Apply to the ONE parent wrapper holding all the scene's floating blocks.
 *
 * N14-safe: symmetric (−max → +max), so at the scene MIDPOINT (where the
 * safe-area oracle samples) the tilt is ~0°; and 3D `rotateY` foreshortens
 * (pulls content inward), never pushing it past the zone edges.
 */
export function useTilt(maxDeg = 5): number {
  const p = useExactSceneProgress();
  return interpolate(p, [0, 1], [-maxDeg, maxDeg], CLAMP);
}

/**
 * `useKenBurnsScale` — a very slow background zoom for depth (apply to a BG layer
 * only, never to zoned content). Eases from 1.0 to `to` across the scene.
 */
export function useKenBurnsScale(to = 1.06): number {
  const p = useApproxSceneProgress(12);
  return 1 + (to - 1) * easeInOutSoft(p);
}

/**
 * `useIntroZoom` — a one-time entrance "push in" that settles to scale 1.0 well
 * before the scene midpoint. Because it is 1.0 by the midpoint, the N14 oracle
 * (which samples the midpoint still) never sees the transient scale. `fromScale`
 * is the starting zoom; `settleSec` how long it takes to settle.
 */
export function useIntroZoom(fromScale = 1.045, settleSec = 0.55): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = easeOut(Math.min(1, Math.max(0, frame / Math.max(1, settleSec * fps))));
  return fromScale + (1 - fromScale) * t;
}

/**
 * `usePop` — a one-time emphasis pulse (scale 1 → peak → 1) centered shortly
 * after `delaySec`. Settles back to 1.0, so a midpoint still sees scale 1.0
 * (N14-safe). Use for an important number/figure ("zoom in then back out").
 */
export function usePop(delaySec = 0, peak = 1.12, riseSec = 0.2, fallSec = 0.36): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const d = delaySec * fps;
  const r = Math.max(1, riseSec * fps);
  const f = Math.max(1, fallSec * fps);
  return interpolate(frame, [d, d + r, d + r + f], [1, peak, 1], {
    ...CLAMP,
    easing: (t) => easeOut(t),
  });
}

/** A gentle symmetric ease for drift (slow at the ends, never jerky). */
function easeInOutSoft(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}
