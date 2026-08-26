---
name: scene-authoring
description: Author or refine one experimental HyperFrames HTML composition after make-video has approved its plan, timing, and local assets. Do not select the video workflow, research facts, or render final delivery.
---

# Scene authoring

Read `video-plan.json`, `claims.json`, `assets.json`, and `timing.json` before
writing `starter-hf/<slug>/index.html`. Every rendered media path is local.

- Write fresh deterministic HTML/CSS/GSAP; do not copy a scene or timeline from
  a previous job and do not use a generator/template layout catalog. Each beat
  has one primary shot tagged with the metadata required by authoring-policy.
- Implement each beat's `start_state → state_changes → end_state`; each state
  change has a focal visual result tied to narration.
- Use visual metaphor and transition intent, not a fixed layout rotation.
- Background scanlines, pulses, universal breathing, idle wobble, and root-wide
  tweening never count as semantic motion.
- A readable hold is valid when it serves comprehension. Fade is optional and
  must be justified by transition intent.
- Captions use timing-derived central generation; scenes do not invent their
  own timing or facts.

For mandatory V2 creative rewrite, read V1 contact sheets as images before
writing. Keep claims/narration/timing/local paths/captions, but freely replace
V1's layout, typography hierarchy, media framing, transitions and motion. A
color tweak, new glow, decorative frame, extra icon, or pulse alone is not a
rewrite. V3 is only for an image-backed severe V2 defect.

After authoring, use the snapshot plan supplied by `make-video`. This skill does
not render review or delivery MP4s.
