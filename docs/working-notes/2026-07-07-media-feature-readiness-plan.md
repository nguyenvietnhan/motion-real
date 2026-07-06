# MotionReal Media Feature Readiness Plan - 2026-07-07

## Muc Dich

File nay la plan tam rieng cho cac tinh nang media tiep theo: SFX va
speech-synced visuals. No thay the cac ghi chu tam truoc do ve refactor va
speech timing de workspace bot roi.

Muc tieu khong phai bat ca hai tinh nang cung luc. Muc tieu la tao mot nen
chung ro rang de sau nay SFX va speech-sync cung dung duoc ma khong phai lai
refactor nang cac godfile vua tach.

## Nguyen Tac

1. Default user behavior phai khong doi cho den khi co feature flag/toggle ro.
2. Mo kien truc cho ca SFX va speech-sync, nhung moi lan chi prototype mot
   vertical slice.
3. Khong dua core safety/feature behavior vao prompt-only control.
4. Khong de authored scenes doc TTS provider data, SRT raw, file system, network,
   hoac caption text.
5. Captions van do pipeline/master composition render tap trung; authored scenes
   khong render subtitles.
6. Moi data surface moi phai co owner: settings, schema, lock/timing, audio ops,
   composition context, hoac authoring prompt.
7. Prompt guidance la buoc cuoi, sau khi typed surface va tests da ro.

## Current Baseline

Da co mot so nen thap trong code:

- `SceneSpec.sfx` da co tag `none`, `transition`, `alert`, `emphasis`,
  `success`.
- `packages/pipeline/src/audio/sfx.ts` da co pure cue mapping
  `getSfxCues(...)`, nhung chua phai user-facing feature hoan chinh.
- `packages/pipeline/src/audio/tts.ts` va `packages/tts/src/audio-ops.ts` da co
  narration concat va BGM mix path.
- Locked spec da co caption cues tu TTS/SRT fallback path.
- `@motionreal/compositions` la package duy nhat hop le de authored scenes nhan
  future hook/prop nho, neu can speech-sync visual surface.

Nhung chua nen goi day la feature done:

- Chua co main Settings toggle cho SFX.
- Chua co asset/mixing pipeline cho SFX cue production.
- Chua co authored-facing speech timing hook/prop.
- Chua co prompt contract cho SFX/speech-sync.
- Chua co internal flag prototype cho mot trong hai surface.

## Phase A - Shared Media Feature Foundation

Goal: chot nen chung truoc khi lam SFX hoac speech-sync implementation.

Output:

- Mot decision note hoac typed sketch tra loi:
  - feature flag nam o dau;
  - main Settings toggle shape;
  - default off/on policy cho dev va user;
  - data owner cua media metadata;
  - rollback path khi toggle off;
  - test lane cho audio/timing/composition changes.

Acceptance:

- Toggle off khong doi output audio, locked timing, render cache key, prompt, hay
  authored scene contract.
- Settings/UI khong noi mot gia tri trong khi engine dung gia tri khac.
- Shared foundation khong buoc ca SFX va speech-sync phai ship cung luc.

Verification:

```powershell
git diff --check
npm.cmd run typecheck
```

## Phase B - SFX Track Design

Goal: bien SFX thanh mot feature co owner ro, khong phai prompt-only accent.

Decisions can chot:

- Toggle location: main Settings.
- Behavior: on/off only, khong multi-level.
- Data model:
  - scene `sfx` tag;
  - cue asset identity;
  - absolute/scene-local mix timing;
  - default low volume;
  - cache key impact.
- Mixing owner: audio ops/TTS assembly layer, not authored scenes.
- Asset owner: bundled app/pipeline assets, not loose root files.

Anti-overuse rule:

- Default scene tag la `none`.
- SFX chi nen xuat hien o section break, strong transition, alert beat, emphasis
  beat, hoac final success beat.
- Can cap so cue tren video hoac tren phut truoc khi cho AI tu do chon.

Acceptance:

- SFX off means no SFX asset lookup, no mix, no output/audio/cache change.
- SFX on still preserves narration provider/voice and never falls back silently.
- Existing low-level `getSfxCues(...)` is either promoted into the chosen path or
  explicitly retired; khong de mot unused helper lam nguoi sau hieu nham.

## Phase C - Speech-Synced Visual Track Design

Goal: cho authored visuals phan ung voi speech timing ma khong lo TTS internals
ra authored scene contract.

Preferred API shape:

```ts
export type SceneSpeechBeat = {
  id: string;
  startFrame: number;
  endFrame: number;
  timingSource: "tts-srt" | "even-split" | "unknown";
};

export type SceneSpeechTiming = {
  sceneId: string;
  fps: number;
  sceneFrame: number;
  sceneDurationInFrames: number;
  speechStartFrame: number;
  speechEndFrame: number;
  speechProgress: number;
  beats: SceneSpeechBeat[];
  activeBeatId?: string;
  activeBeatProgress?: number;
};
```

Boundary:

- Scene data is scene-local frames only.
- No caption text, raw SRT, provider names, audio paths, or full word windows in
  authored props.
- Master composition/context can compute active beat/progress from locked spec.
- `@motionreal/compositions` may expose a small hook/prop because authored scenes
  already may import it.

Acceptance:

- Captions remain centrally rendered.
- Approximate/even-split captions still produce advisory beat timing, not a hard
  gate.
- Prompt guidance stays tiny: at most one or two optional patterns after tests.

## Phase D - Choose First Vertical Slice

Recommendation:

- Prototype SFX first if the goal is a visible feature with lower prompt and
  composition risk.
- Keep speech-sync design ready, but do not prototype speech-sync in the same
  slice as SFX.

First prototype rules:

- Internal/dev flag only.
- One feature surface only.
- Toggle off means byte/behavior-equivalent default path where practical.
- Add focused tests before any full gate.
- No broad orchestrator/workspace rewrite.

## Suggested Execution Order

1. Phase A shared foundation decision.
2. Phase B SFX design.
3. Phase C speech-sync design.
4. Phase D choose one vertical slice.
5. Prototype chosen slice behind internal flag.

Do not implement both SFX and speech-sync in one branch unless a later owner
decision accepts the larger blast radius.

## Current Status

| Area | Status | Next step |
| --- | --- | --- |
| Shared foundation | pending | Phase A decision note. |
| SFX | pending | Phase B design, starting from existing `sfx` schema/helper audit. |
| Speech-sync | pending | Phase C design, starting from locked caption cue timing. |
| Prototype | pending | Choose one vertical slice after A-C. |

