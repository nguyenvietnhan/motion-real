# MotionReal Skill Studio — experimental R&D

`skill-test/` is an experimental HyperFrames pipeline for agent-authored 9:16
video. It is separate from MotionReal's Remotion/TSX production path and does
not claim production-contract compliance.

Use `/make-video <topic>` for a new factual 9:16 job. V1 is validated only for
a 75–105 second benchmark; a 240–300 second regression job is required before
claiming longer-video support.

## Runtime

- Node.js 22+, Python 3.12+, FFmpeg, FFprobe, and Chrome/Chromium.
- Install the pinned HyperFrames runtime once:

  ```powershell
  cd starter-hf
  npm ci --ignore-scripts
  ```

- Every new job runs `python tools/video_pipeline.py preflight --job <slug>
  --capability web-download --capability snapshot-view`. It records the tested
  runtime version and stops when a required capability is absent.

## Pipeline

```text
brief → claims/assets ledgers → video plan → validate → TTS timing
→ author V1 → V1 image review → mandatory creative rewrite V2 → V2 image review
→ standard review MP4
→ user approval → high delivery MP4
```

`make-video` is the only end-to-end workflow. The technical skills under
`.agents/skills/` are helpers; they do not independently render or publish.

## Canonical artifacts

`jobs/<slug>/` holds `claims.json`, `assets.json`, `video-plan.json`,
`timing.json`, `runtime.json`, `qa.json`, and `output/`. Runtime source and
staged local media live in `starter-hf/<slug>/`.

The reviewer must inspect PNG/contact sheets as image input, not reason from
the plan or source code. V2 can replace V1 visual code while keeping factual
and timing artifacts locked; V3 is only for an evidence-backed severe issue.

Old jobs and the untracked `build_index_html.py` / `scratch_build_script.py`
are legacy artifacts. The experimental workflow never calls or rewrites them.
