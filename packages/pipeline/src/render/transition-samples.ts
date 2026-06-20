import { transitionFrames, type LockedVideoSpec } from "@news/schema";

/** Fractions through each fixed transition overlap that are useful for QA. */
export const DEFAULT_TRANSITION_SAMPLE_FRACTIONS = [0.25, 0.5, 0.75] as const;

export function transitionSampleTag(fraction: number): string {
  return `t${Math.round(fraction * 100)}`;
}

export function transitionSampleFileName(fromSceneId: string, toSceneId: string, fraction: number): string {
  return `${fromSceneId}-to-${toSceneId}.${transitionSampleTag(fraction)}.png`;
}

export function transitionSampleFrame(spec: LockedVideoSpec, fromSceneIndex: number, fraction: number): number | null {
  const next = spec.scenes[fromSceneIndex + 1];
  if (!next) return null;
  const T = Math.max(1, transitionFrames(spec.fps));
  const offset = Math.min(T - 1, Math.max(0, Math.round(fraction * T)));
  return Math.min(Math.max(0, next.startFrame + offset), Math.max(0, spec.durationInFrames - 1));
}
