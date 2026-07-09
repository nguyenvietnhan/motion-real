import type { SceneCard } from "../shared/types.js";

/** Seek target for a scene rail click; undefined when timing is missing/invalid. */
export function seekSecondsForScene(scene: SceneCard | undefined): number | undefined {
  const start = scene?.timeline?.startSeconds;
  if (typeof start !== "number" || !Number.isFinite(start) || start < 0) return undefined;
  return start;
}

/**
 * Active scene index at `seconds` using half-open [start, end) intervals,
 * except the final scene may include its endpoint. Overlaps resolve to the
 * earliest matching scene. Invalid timing is skipped (never throws).
 */
export function sceneIndexAtSeconds(scenes: readonly SceneCard[], seconds: number): number | undefined {
  if (!Number.isFinite(seconds) || seconds < 0 || scenes.length === 0) return undefined;
  let lastValidIndex: number | undefined;
  for (let i = 0; i < scenes.length; i += 1) {
    const t = scenes[i]?.timeline;
    if (!t || !Number.isFinite(t.startSeconds) || !Number.isFinite(t.endSeconds) || t.endSeconds <= t.startSeconds) {
      continue;
    }
    lastValidIndex = i;
    const isLast = i === scenes.length - 1;
    if (isLast) {
      if (seconds >= t.startSeconds && seconds <= t.endSeconds) return i;
    } else if (seconds >= t.startSeconds && seconds < t.endSeconds) {
      return i;
    }
  }
  // Past the final endpoint: keep final scene if we have one.
  if (lastValidIndex !== undefined) {
    const t = scenes[lastValidIndex]!.timeline!;
    if (seconds >= t.endSeconds) return lastValidIndex;
  }
  return undefined;
}
