import {
  FPS,
  LockedVideoSpecSchema,
  secondsToFrames,
  validateLockedTimings,
  type LockedVideoSpec,
  type VideoSpec,
} from "@news/schema";
import type { TtsManifest } from "./types.js";

/**
 * Convert a validated VideoSpec into a frame-accurate LockedVideoSpec by
 * resolving each scene's duration from MEASURED TTS audio (not the planner's
 * target seconds). Mirrors news_video_tool's lock step and math_video_tool's
 * "duration follows natural voice" rule: the resulting render duration may
 * exceed the requested preset, and that is acceptable.
 *
 * Pure and deterministic: same (spec, manifest) → same locked spec. This powers
 * Property 1 (timeline contiguity) and Property 6 (duration monotonicity).
 */
export type LockOptions = {
  fps?: number;
  /** project-relative path to the concatenated (+optional BGM) narration track */
  mixedNarrationSrc?: string;
};

export function lockSpec(spec: VideoSpec, tts: TtsManifest | null, opts: LockOptions = {}): LockedVideoSpec {
  const fps = opts.fps ?? FPS;
  let startFrame = 0;

  const scenes = spec.scenes.map((scene) => {
    const measured = tts?.byScene[scene.id];
    const seconds = measured?.duration ?? scene.durationInSeconds;
    const durationInFrames = secondsToFrames(seconds, fps);
    const locked = {
      ...scene,
      startFrame,
      durationInFrames,
      audio: measured ? { src: measured.audioPath, duration: measured.duration } : undefined,
    };
    startFrame += durationInFrames;
    return locked;
  });

  const candidate = {
    ...spec,
    fps,
    durationInFrames: startFrame,
    scenes,
    audio: { narrationSrc: opts.mixedNarrationSrc },
  };

  const locked = LockedVideoSpecSchema.parse(candidate);

  const timing = validateLockedTimings(locked);
  if (!timing.ok) {
    // N12: the timeline must be contiguous and end exactly at the total.
    throw new Error(`Locked timing invalid (N12): ${timing.errors.join("; ")}`);
  }

  return locked;
}
