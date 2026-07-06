# Speech Timing Scene API Decision - 2026-07-06

## Goal

Prepare a small future API for speech-synced visuals without changing prompts,
authored scene contracts, or render behavior in Phase 6.

The API must let authored visuals react to narration timing, but it must not let
authored scenes render captions, depend on TTS providers, read SRT files, or
receive a large timing payload that makes prompts harder to satisfy.

## Current Data

The existing pipeline already has enough timing data for a first speech-sync
surface:

- `TtsManifest.byScene[sceneId].duration` stores measured speech duration.
- `TtsManifest.byScene[sceneId].srt` may store parsed provider SRT segments.
- `lockSpec(...)` resolves scene visual timing and builds `LockedVideoSpec.captions`.
- `CaptionCue.words[]` stores absolute frame windows for karaoke highlighting.
- The master composition renders captions globally; authored scenes do not render
  subtitles.
- `SceneTimingProvider` already gives render-runtime scene duration context.

All frame values below should use integer Remotion frames at `LockedVideoSpec.fps`.

## Decision

The first authored-facing speech-sync API should expose:

1. Scene-local `speechProgress`.
2. A compact scene-local beat map derived from caption cue windows.
3. An active beat id/progress for convenience.

It should not expose raw TTS provider data, SRT text, caption text, or full word
timing windows to authored scenes in the first implementation.

Raw caption cue text and word windows should remain internal to the global
caption renderer and safety/reporting layers. This keeps the existing rule true:
captions are centrally generated and authored scenes do not render subtitles.

## Candidate Types

These are design sketches, not production exports yet.

```ts
export type SceneSpeechBeat = {
  id: string;
  startFrame: number; // scene-relative, inclusive
  endFrame: number; // scene-relative, exclusive
  timingSource: "tts-srt" | "even-split" | "unknown";
};

export type SceneSpeechTiming = {
  sceneId: string;
  fps: number;
  sceneFrame: number;
  sceneDurationInFrames: number;
  speechStartFrame: number; // scene-relative
  speechEndFrame: number; // scene-relative
  speechProgress: number; // 0..1 across speechStartFrame..speechEndFrame
  beats: SceneSpeechBeat[];
  activeBeatId?: string;
  activeBeatProgress?: number; // 0..1 inside active beat
};
```

The future authored convenience surface should be a hook or prop exported through
`@motionreal/compositions`, because that package is already on the authored
import whitelist. Internally it can delegate to `@motionreal/blocks` context.

## Derivation

The master composition can derive the static beat map once per scene:

1. Filter `spec.captions` by `sceneId`.
2. Convert each cue frame window from absolute composition frames to scene-local
   frames by subtracting `scene.startFrame`.
3. Drop cue text before giving data to authored scenes.
4. Merge or cap very dense cues if needed so a scene receives a small beat list.
5. Compute active beat and progress from the current Remotion frame.

`speechStartFrame` should be the first beat start when captions exist. If a
scene has measured speech but no caption cue, derive it from the lock math:
first scene starts at 0, middle/last scenes start after their transition head.

## Fallbacks

When provider SRT exists, caption cues already use its timing but keep clean
narration text. The future beat map should inherit those frame windows and mark
them as `tts-srt`.

When SRT is missing or approximate, the current caption builder falls back to an
even split over clean narration. The future beat map should still exist and mark
those windows as `even-split` or `unknown`. This makes speech-sync advisory and
visual, not a render blocker.

## Performance

The beat map should be precomputed or memoized per scene from the locked spec.
Per-frame work should be limited to a small active-window lookup and progress
math. The hook must remain deterministic and must not read files, call network,
use time, use randomness, or inspect provider-specific artifacts.

## Prompt Complexity

The first prompt contract should not ask the AI to produce timing schemas. The
AI should only learn a small optional visual affordance, for example: "you may
use speech progress for emphasis." Core timing stays pipeline-owned.

If this proves useful, a later contract step can document one or two simple
patterns, such as revealing a chart over `speechProgress` or pulsing a key visual
on `activeBeatProgress`. Do not introduce raw word timing into prompts unless a
specific feature needs it and tests prove the extra surface is stable.

## Future Implementation Order

1. Add typed timing data helpers near schema/compositions.
2. Extend the master composition timing context to include scene-local speech
   timing.
3. Re-export a small hook from `@motionreal/compositions`.
4. Add focused tests proving frame conversion, SRT fallback, and no caption text
   leakage to authored scenes.
5. Only then update authoring docs/prompt guidance.
