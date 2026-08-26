---
name: voice-vieneu
description: Generate VieNeu narration and the derived timing.json for an approved experimental video-plan when make-video invokes Stage 3. Do not alter the content plan or render video.
---

# Voice VieNeu

This helper runs only after `python tools/video_pipeline.py validate --job <slug>`
passes. It reads narration from `video-plan.json`, writes per-beat WAV/word
metadata under `jobs/<slug>/voice/`, and writes `timing.json`.

```powershell
python tools/vieneu-tts/gen_beats_batch.py <slug>
python tools/vieneu-tts/merge_voice.py <slug>
```

`timing.json`, not the content plan, owns beat start/duration and total duration.
Never silently fall back when VieNeu or FFmpeg is unavailable. `beats.json`
support remains legacy-only for existing jobs.
