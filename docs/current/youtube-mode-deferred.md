# YouTube Mode Deferred Roadmap

Status: deferred research note. This is not an active task, not current product
scope, and not permission to start implementation. It describes a possible
future chapter-based long-form YouTube workflow, not the current shared 16:9
format plumbing that already exists for geometry, thumbnail behavior, and
caption-off rendering.

Owner gate:
- Do not implement YouTube long-form mode unless the project owner explicitly
  opens a new request to begin that work.
- Do not quietly fold this roadmap into unrelated TikTok, stability, render, or
  desktop-shell cleanup.
- The current product focus remains the stable TikTok/Reels/Shorts 9:16 path.

## Current Decision

YouTube mode is valuable, but too large to build and maintain right now. The
project should first deepen its current strength: reliable short-form TikTok
generation.

The existing 16:9 plumbing and selectable duration tiers may remain as
compatibility/shared-format support, but true chapter-based YouTube authoring is
deferred because it is not just a longer render target. It needs a different
content model, review model, repair model, and performance budget.

## Why It Is Deferred

Long-form YouTube would multiply the number of moving parts that need repeated
fixing:

- different pacing and narration strategy;
- longer scene lifetimes and heavier authored modules;
- multi-sample visual QA rather than one still per scene;
- timestamped repair instead of scene-only repair;
- review UI that can inspect a chapter over time;
- render-time and memory benchmarking for 4-8 minute outputs;
- YouTube-specific publish metadata such as chapter timestamps.

Shipping this before the short-form path is consistently excellent would split
attention across two workflows with very different failure modes.

## Product Model For Later

Do not model YouTube as "TikTok with more scenes." A future YouTube mode should
use a chapter-based structure:

```text
video
  chapters[]
    visualBeats[]
      authored JSX/SVG motion inside one chapter scene/module
```

Recommended future chapter-mode tiers. These are not the same as the current
shared-format `durationTier` table:

- 4 minutes: pilot tier only, used first to validate the whole pipeline.
- 6 minutes: add only after 4-minute videos are stable.
- 8 minutes: add only after real render-time and memory benchmarks look safe.

Suggested chapter counts:

- 4 minutes: about 5-7 chapters.
- 6 minutes: about 7-9 chapters.
- 8 minutes: about 8-11 chapters.

Each chapter may last longer than a TikTok scene, but it must not be visually
static. It should contain internal visual beats: diagrams changing, labels
appearing, comparison tables unfolding, arrows moving, camera pans/zooms, and
other deterministic motion that supports the narration.

## Authoring Constraints

Keep MotionReal's pure AUTHOR mode:

- authored scenes remain fresh Remotion React modules;
- authored visuals remain raw JSX/SVG/CSS;
- do not reintroduce a template catalog, block toolkit, or theme-token leash;
- do not allow authored scenes to import arbitrary packages.

If a future YouTube mode wants transitions or timeline helpers beyond the
current allowed authored imports, put them in the engine/composition layer or
explicitly update the contract first. Do not let AI-authored scene files import
new packages just because this note mentions a future idea.

`visualBeats[]` should be treated as metadata for planning, QA, and repair, not
as a hidden template system. The visual implementation should still live in the
authored module.

## Pipeline Shape For Later

Future YouTube work should likely be a separate authoring path that shares the
same renderer and safety principles:

1. Plan chapters, not many short scenes.
2. Plan visual beats inside each chapter.
3. Author longer chapter modules with deterministic frame-based motion.
4. Render a draft first.
5. Generate a filmstrip per chapter from multiple timestamps.
6. Run timestamp-aware visual QA and repair.
7. Export YouTube chapter timestamps for the publish description.

The manifest may need a new shape or a versioned extension, for example:

```json
{
  "format": "youtube",
  "durationTier": 1,
  "chapters": [
    {
      "id": "chapter-01",
      "title": "Core idea",
      "startSeconds": 0,
      "targetDurationSeconds": 40,
      "sceneId": "scene-01",
      "visualBeats": [
        {
          "id": "beat-01",
          "atSeconds": 0,
          "intent": "Introduce the central metaphor"
        }
      ]
    }
  ]
}
```

This is illustrative only. Do not implement this schema without a fresh design
pass.

## Review And QA

One midpoint still per scene is not enough for YouTube chapters. A future path
should sample multiple timestamps per chapter:

- chapter start;
- 25%;
- 50%;
- 75%;
- chapter end;
- any declared visual beat timestamps.

Visual issues should be reported with precise context:

```text
sceneId + chapterId + beatId + timestamp/fraction + issue
```

Repair prompts should reference the exact timestamp or beat that failed, rather
than asking the model to rewrite a whole scene blindly.

For filmstrip generation, prefer repeated targeted still renders with a reused
browser/session where practical, rather than rendering large continuous frame
ranges just to inspect a few samples.

## Performance And Risk

Before adding 6-minute or 8-minute tiers, benchmark real generated videos:

- render time;
- peak memory;
- still/filmstrip generation time;
- repair-loop cost;
- stability under cancel/retry;
- draft and full render behavior.

Longer chapters mean more frames, more DOM lifetime, and more frame-by-frame
animation work. Treat 8-minute rendering as unproven until measured.

## YouTube Publish Metadata

If chapters become first-class later, use them to generate YouTube description
timestamps:

```text
00:00 Introduction
00:42 First concept
01:25 How it works
```

The generated timestamps should follow YouTube chapter conventions and should
come from the resolved chapter timeline, not from guessed text.

## Recommended Future First Slice

When the owner explicitly asks to begin YouTube work, start with a limited
4-minute pilot:

- no 6-minute or 8-minute tier yet;
- no broad shell/desktop migration at the same time;
- no rewrite of the TikTok path;
- chapter plan plus visual beats;
- multi-still filmstrip review;
- timestamp-aware QA/repair;
- full benchmark report before expanding scope.

Until then, keep this file as a roadmap note only.
