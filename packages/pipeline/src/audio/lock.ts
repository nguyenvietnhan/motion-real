import {
  DEFAULT_HOLD_SECONDS,
  FPS,
  LockedVideoSpecSchema,
  transitionFrames,
  secondsToFrames,
  validateLockedTimings,
  type CaptionCue,
  type LockedVideoSpec,
  type VideoSpec,
} from "@motionreal/schema";
import type { TtsManifest } from "../types.js";
import { buildSceneCaptionCues } from "./captions.js";

/**
 * Convert a validated VideoSpec into a frame-accurate LockedVideoSpec by
 * resolving each scene's duration from MEASURED TTS audio, then laying scenes on
 * a TRANSITION-AWARE timeline (author-mode-v2 R5): adjacent scene sequences
 * overlap by `T = T_TRANSITION`, and the overlap lands on the silent breath gap
 * between narration clips, so no speech is clipped.
 *
 * For `n` scenes with measured speech frames `s_i`:
 *   d_1 = s_1 + T,  d_i = s_i + 2T (middle),  d_n = s_n + T,  (n = 1 → d_1 = s_1)
 *   total video frames = Σ d_i − (n−1)·T = Σ s_i + (n−1)·T = assembled audio.
 * Each scene's `startFrame` is its composition-timeline start (accounting for
 * the overlaps); the speech of scene i begins at `audioStart_i` (T after the
 * scene's sequence starts), which is where its caption cues are anchored.
 *
 * Pure and deterministic: same (spec, manifest) → same locked spec.
 */
export type LockOptions = {
  fps?: number;
  /** project-relative path to the concatenated (+optional BGM) narration track */
  mixedNarrationSrc?: string;
};

export function lockSpec(spec: VideoSpec, tts: TtsManifest | null, opts: LockOptions = {}): LockedVideoSpec {
  const fps = opts.fps ?? FPS;
  const n = spec.scenes.length;
  const T = n > 1 ? transitionFrames(fps) : 0;

  // 1) Per-scene speech frames s_i (measured audio, or a default hold if none).
  const speech = spec.scenes.map((scene) => {
    const measured = tts?.byScene[scene.id];
    const seconds = measured?.duration ?? scene.durationInSeconds ?? DEFAULT_HOLD_SECONDS;
    return Math.max(1, secondsToFrames(seconds, fps));
  });

  // 2) Sequence durations d_i and composition-timeline start frames.
  const captions: CaptionCue[] = [];
  let visualStart = 0;
  let audioCursor = 0; // start of the current scene's speech in the assembled audio
  const scenes = spec.scenes.map((scene, i) => {
    const s = speech[i]!;
    const headT = i === 0 ? 0 : T; // overlap shared with the previous scene
    const tailT = i === n - 1 ? 0 : T; // overlap shared with the next scene
    const durationInFrames = s + headT + tailT;

    const measured = tts?.byScene[scene.id];
    const locked = {
      ...scene,
      startFrame: visualStart,
      durationInFrames,
      audio: measured ? { src: measured.audioPath, duration: measured.duration } : undefined,
    };

    // Caption cues for this scene are anchored at the scene's SPEECH start in the
    // assembled audio track (audioCursor), not the visual sequence start.
    if (measured) {
      captions.push(
        ...buildSceneCaptionCues({
          sceneId: scene.id,
          narration: scene.narration,
          srt: measured.srt,
          audioStartFrame: audioCursor,
          speechFrames: s,
          fps,
          totalFrames: Number.MAX_SAFE_INTEGER, // clamped to the real total below
        }),
      );
    }

    // Advance cursors: the next sequence overlaps this one by T; the next speech
    // clip starts after this clip + one breath gap (= T frames of silence).
    visualStart += durationInFrames - tailT;
    audioCursor += s + (i === n - 1 ? 0 : T);
    return locked;
  });

  const total = scenes.length > 0 ? scenes.at(-1)!.startFrame + scenes.at(-1)!.durationInFrames : 0;

  // Clamp caption cues to the real total now that it is known.
  const clampedCaptions = captions
    .map((cue) => {
      const startFrame = Math.min(cue.startFrame, Math.max(0, total - 1));
      const endFrame = Math.min(cue.endFrame, total);
      const words = cue.words
        ?.map((w) => ({
          ...w,
          startFrame: Math.min(Math.max(w.startFrame, startFrame), Math.max(startFrame, endFrame - 1)),
          endFrame: Math.min(w.endFrame, endFrame),
        }))
        .filter((w) => w.endFrame > w.startFrame);
      return { ...cue, startFrame, endFrame, ...(words ? { words } : {}) };
    })
    .filter((cue) => cue.endFrame > cue.startFrame);

  const candidate = {
    ...spec,
    fps,
    durationInFrames: total,
    scenes,
    audio: { narrationSrc: opts.mixedNarrationSrc },
    captions: clampedCaptions,
  };

  const locked = LockedVideoSpecSchema.parse(candidate);

  const timing = validateLockedTimings(locked);
  if (!timing.ok) {
    // N12: transition-aware timeline must tile [0, total) with no gaps.
    throw new Error(`Locked timing invalid (N12): ${timing.errors.join("; ")}`);
  }

  return locked;
}
