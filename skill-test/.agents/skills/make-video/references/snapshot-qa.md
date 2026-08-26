# Snapshot QA

Run `python tools/video_pipeline.py snapshots --job <slug> --iteration v1`
after `timing.json` exists. It writes a V1 plan and capture directory under
`starter-hf/<slug>/qa/snapshots/v1`. Repeat for V2 after the creative rewrite.

Capture every timestamp in `capture_times`. The plan contains:

- storyboard frames at each beat start, state change, and end;
- four numbered motion-strip frames per declared motion window.

Review storyboard frames for composition, caption, source framing, and visual
diversity. Review motion-strip frames in order for an intentional focal-object
state change. A background pulse, scanline, or global drift is not progression.

Attach the actual local PNG/contact-sheet images to Gemini before reviewing.
In `qa.json`, `creative_reviews.v1` and `creative_reviews.v2` each need one
entry per beat with `beat_id`, `evidence_file`, a visual observation, and an
action. Do not write a pass based on the narrative plan or source code.

V1 always routes to a creative V2 rewrite. V2 may only route to V3 for a
specific severe, image-backed finding. Snapshot strips are not a substitute for
the user's review of the standard-quality MP4.
