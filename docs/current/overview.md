# Overview

MotionReal is a Remotion-based video generator. It turns a prompt, URL, and
optional local images into a short editorial MP4.

The stable production path today is TikTok/Reels/Shorts-style 9:16. YouTube
16:9 has shared primitives, but not the finished long-form author-by-segment
production workflow.

## Current Product Shape

- Desktop app: Electron UI for create, settings, model connection, review, BGM,
  thumbnail, and export.
- Runtime authoring: 9router-compatible model gateway returns authored scene
  code and manifest text.
- Rendering: Remotion renders one locked spec through `NewsVideo`.
- Voice: Vivibe for Vietnamese, ElevenLabs for Vietnamese or English depending
  on selection and configuration.
- Captions: generated centrally from narration and TTS timing. TikTok burns in a
  karaoke caption line; YouTube-format composition omits burned captions.

## Stable Path

TikTok short-form:

```text
prompt / URL / images
-> AI-authored scene modules + manifest
-> hidden stills/refine in desktop
-> admission + safety checks
-> TTS + timing lock
-> draft render
-> user review
-> full render
```

## Not Production-Ready Yet

YouTube long-form is not yet the stable end-to-end path. The codebase has
format-aware geometry, schema fields, thumbnail rendering, prompt budgeting, and
caption-off composition behavior, but the real author-by-segment long-form video
workflow remains future work.

## Invariants

- AUTHOR mode only.
- No authored-facing templates or layout blocks.
- Safety grid catches system defects.
- Draft-first before full render.
- Generated artifacts live under `VIDEO_TOOL_HOME/.video-tool/`.

