# HyperFrames runtime for experimental jobs

This folder is runtime source for `skill-test` experimental jobs. It is not a
MotionReal production runtime.

```text
starter-hf/<slug>/
  index.html
  assets/              staged local web media
  voice/               narration.m4a and source WAVs
  qa/                  V1/V2 source archive, plans, and PNG snapshots

jobs/<slug>/output/
  review.mp4           standard-quality user review
  video.mp4            high-quality delivery after approval
```

## Setup

HyperFrames is pinned in `package.json`; install exactly the lockfile contents:

```powershell
cd starter-hf
npm ci --ignore-scripts
```

Run `npx --no-install hyperframes doctor --json` before a new job. This checks
the installed CLI, Node 22+, FFmpeg, FFprobe, and Chrome.

## Commands

```powershell
# From skill-test root
python tools/video_pipeline.py validate --job <slug>
python tools/video_pipeline.py audit-author --job <slug> --iteration v1
python tools/video_pipeline.py snapshots --job <slug> --iteration v1
# Review actual V1 PNG/contact sheets, then write the evidence in qa.json.
python tools/video_pipeline.py audit-author --job <slug> --iteration v2
python tools/video_pipeline.py snapshots --job <slug> --iteration v2
python tools/video_pipeline.py qa-gate --job <slug> --phase pre-review
node starter-hf/scripts/gen-captions.mjs <slug>

# Quality checks and render lifecycle
powershell -File starter-hf/scripts/render-hidden.ps1 -Slug <slug> -Verb check
powershell -File starter-hf/scripts/render-hidden.ps1 -Slug <slug> -Verb review
powershell -File starter-hf/scripts/check-motion.ps1 -VideoPath jobs/<slug>/output/review.mp4 -ReportPath jobs/<slug>/motion-diagnostic.json
python tools/video_pipeline.py map-motion --job <slug>
# Acknowledge every freeze finding in qa.json before delivery.
python tools/video_pipeline.py qa-gate --job <slug> --phase handoff
powershell -File starter-hf/scripts/render-hidden.ps1 -Slug <slug> -Verb delivery
```

Use snapshot plans before review render. New schemaVersion 2 jobs are blocked
from review/delivery render until the relevant creative QA gate passes.
`check-motion.ps1` is a diagnostic; it never proves semantic motion and returns
`ok`, `findings`, or `inconclusive`.
