---
description: Author a Vietnamese video with the current freeform Remotion pipeline.
---

# Author a video (pure AUTHOR mode)

This command is only a pointer to the canonical contracts. The stable production
path is TikTok/Reels/Shorts 9:16. YouTube 16:9 has format plumbing, but long-form
author-by-segment and the true 16:9 main-video path are still pending Group J.

## Read first (canonical and binding)

1. `CLAUDE.md` — pipeline, safety grid, runtime rules, MCP usage, and working agreement.
2. `docs/authoring-contract.md` — admissible scene exports/imports and layout rules.
3. `docs/visualization-playbook.md` — choose a visual form from the content shape.
4. `docs/design-language.md` — viewer invariants and current freeform direction.
5. `docs/ai-content-guide.md` — Vietnamese content, evidence, hook, CTA, and TTS rules.

When any text here conflicts with those files, the canonical files win.

## Current authoring surface

- Write a brand-new `.tsx` module for each scene as raw JSX/SVG/CSS.
- Allowed imports are `react`, `remotion`, `zod`, and `@news/compositions`.
- `@news/blocks` and `@news/theme` are runtime internals and are OFF the authored
  import whitelist. Do not use `Frame`, `TitleBlock`, `KeyPoints`, `useTheme`, or
  any deleted layout block.
- Hard-code the scene's visual values. There is no authored-facing theme or style
  pack. `styleId: "clean-luxury-tech"` is only a legacy schema discriminator.
- The only sanctioned image path is `SceneImage` from `@news/compositions` using
  the scene's supplied local `image` reference.

## Workflow

1. Optionally ground a URL with `mcp__news__ingest_url`.
2. Scaffold with `mcp__news__scaffold_project`.
3. Author fresh scene modules under the returned project's `authored/` directory
   and fill its `manifest.json` according to the current schema. Use sequential
   `scene-01`, `scene-02`, ... ids and admitted component ids.
4. Prefer `mcp__news__render_stills` for the cheap visual pass.
5. Render `mcp__news__render_draft`, inspect the safety report, report the draft
   path, and stop for user review.
6. Run `mcp__news__render_full` only after explicit draft approval.

## Invariants

- Never fabricate facts, numbers, sources, dates, prices, benchmarks, or quotes.
- Keep Vietnamese display/narration natural; retain English brand/model names and
  write numbers as digits.
- Captions are generated centrally; never author subtitle text in scene props.
- Scene code is deterministic: no `Math.random`, `Date`, network, filesystem, or
  host APIs. Motion uses frame-derived clamped `interpolate`/`spring` phases that
  resolve rather than oscillate forever.
- Preserve the configured Vivibe provider and voice. Never silently downgrade.
- Generated artifacts stay under `VIDEO_TOOL_HOME/.video-tool/`.

Use `mcp__news__doctor` when environment readiness is uncertain. For library/API
questions, use context7 before answering or changing code.
