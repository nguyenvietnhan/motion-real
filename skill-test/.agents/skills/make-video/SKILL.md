---
name: make-video
description: Create an experimental 9:16 HyperFrames R&D video from a factual topic. This is the only end-to-end creation workflow in skill-test; it owns the job contract, review render, and approval boundary. Do not use for MotionReal's Remotion production path.
---

# Make Video — experimental R&D workflow

This workflow is limited to `skill-test/`. It is not a MotionReal production
path and must never claim Remotion/TSX production-contract compliance.

Use it for a new 9:16 experimental video. Validate 75–105 seconds first; do
not promise 300-second support until a separate 240–300 second regression job
has passed.

`make-video` owns the end-to-end flow. Load the supporting skills only at the
named stage: `research-grounding` for ledgers, `voice-vieneu` for timing,
`scene-authoring` for HTML/GSAP, and `motion-doctrine` only to review a motion
plan. No supporting skill may independently render, publish, or change the
approval policy.

Read before acting:

- [Job contract](references/job-contract.md)
- [Asset policy](references/asset-policy.md)
- [Snapshot QA](references/snapshot-qa.md)
- [Authoring policy](references/authoring-policy.md)

## Stages

1. Create `jobs/<slug>/brief.json` with topic, target duration, audience,
   viewer promise, voice, and visual direction. Keep the job new; never copy
   a prior job's script, voice, HTML, or timeline.
2. Run preflight before research. Declare `web-download` and `snapshot-view`
   only when the active agent actually has both capabilities:

   ```powershell
   python tools/video_pipeline.py preflight --job <slug> --capability web-download --capability snapshot-view
   ```

   A failed preflight stops the workflow. Runtime state is recorded in
   `jobs/<slug>/runtime.json`.
3. Research into `research.md`, then write `claims.json`, stage allowed local
   media in `starter-hf/<slug>/assets/`, and write `assets.json`.
4. Write `video-plan.json`, which references claim/asset ids but never copies
   their source metadata. Validate it before TTS:

   ```powershell
   python tools/video_pipeline.py validate --job <slug>
   ```

5. Generate voice and derived timing. `video-plan.json` is content-only and
   remains unchanged after this step:

   ```powershell
   python tools/vieneu-tts/gen_beats_batch.py <slug>
   python tools/vieneu-tts/merge_voice.py <slug>
   ```

6. Author V1 as a fresh `starter-hf/<slug>/index.html` from the ledgers, plan
   and `timing.json`. It is a positioning draft, not the review candidate.
   Generate captions after timing exists. Follow `scene-authoring`; do not use
   a layout menu, global scanline/pulse, or a copied HTML generator. Audit and
   archive it before rewrite:

   ```powershell
   python tools/video_pipeline.py audit-author --job <slug> --iteration v1
   ```
7. Generate and inspect V1 snapshot matrix and motion strips before any MP4:

   ```powershell
   python tools/video_pipeline.py snapshots --job <slug> --iteration v1
   cd starter-hf/<slug>
   npx --no-install hyperframes snapshot --at <timestamps-from-qa-plan> --output qa/snapshots/v1
   ```

   Attach the resulting PNG/contact sheet files to Gemini's image context and
   write V1 findings in `qa.json`. Do not infer a pass from plan/code text.
   Then perform the mandatory creative V2 rewrite. V2 may replace all visual
   code but keeps claims, narration, timing, local paths and captions. Audit,
   snapshot, and review V2 the same way:

   ```powershell
   python tools/video_pipeline.py audit-author --job <slug> --iteration v2
   python tools/video_pipeline.py snapshots --job <slug> --iteration v2
   python tools/video_pipeline.py qa-gate --job <slug> --phase pre-review
   ```

   A V3 rewrite is allowed only for an evidence-backed severe V2 finding. It is
   never an automatic loop for subjective taste.
8. Run HyperFrames check, then render a standard review MP4 only after the V2
   gate succeeds:

   ```powershell
   powershell -File starter-hf/scripts/render-hidden.ps1 -Slug <slug> -Verb check
   powershell -File starter-hf/scripts/render-hidden.ps1 -Slug <slug> -Verb review
   python tools/video_pipeline.py verify-output --job <slug>
   powershell -File starter-hf/scripts/check-motion.ps1 -VideoPath jobs/<slug>/output/review.mp4 -ReportPath jobs/<slug>/motion-diagnostic.json
   python tools/video_pipeline.py map-motion --job <slug>
   python tools/video_pipeline.py qa-gate --job <slug> --phase handoff
   ```

   `check-motion` is diagnostic only: `findings` and `inconclusive` are not a
   visual-quality pass and must be surfaced in the review bundle.
9. Stop for user review of `jobs/<slug>/output/review.mp4`. Only explicit
   approval allows the high-quality delivery render:

   ```powershell
   powershell -File starter-hf/scripts/render-hidden.ps1 -Slug <slug> -Verb delivery
   python tools/video_pipeline.py verify-output --job <slug> --video jobs/<slug>/output/video.mp4
   ```

Unknown/restricted assets are allowed by the user's policy, but remain visible
as warnings in `qa.json`. Never publish automatically.
