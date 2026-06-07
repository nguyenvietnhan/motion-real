---
name: news-video-author
description: >-
  Author a Vietnamese 9:16 short-form NEWS video in pure AUTHOR mode on this
  Remotion pipeline. Activate when the user asks to make/produce a news video,
  short, reel, or bulk-produce videos from URLs/topics with this tool.
keywords:
  - news video
  - short-form
  - remotion
  - vietnamese
  - author mode
  - style pack
  - bulk
  - mcp
---

# Skill: Author a news video (pure AUTHOR mode)

This skill is the entry point for producing a video with `news_remotion_tool`.
It is a **pointer to the canonical contracts**, not a copy of them — always read
the referenced files so the rules can never drift. There is **no in-tool LLM
planner**: you (the driving agent) are the authoring brain; the tool drives the
proven single-process orchestrator.

## Read these first (canonical, binding)

- `AGENTS.md` — the always-on contract (pipeline, safety grid N1–N30, runtime
  rules, hygiene, determinism). Binding on its own.
- `.kiro/steering/authoring-contract.md` — how to write admissible scene `.tsx`
  (required exports, import whitelist, banned APIs, blocks, layout zones,
  reading style-pack chrome tokens from the theme).
- `docs/visualization-playbook.md` — the menu of visual FORMS; run every scene
  through it so you vary the presentation (not count-up + numbered list every time).
- `docs/design-language.md` — the LOOK (squared, bold ink borders, light warm
  cream base, per-project dominant accent).
- `docs/ai-content-guide.md` — the content contract (hook, CTA, evidence gate,
  Vietnamese number/phonetics rules, captions).

## The workflow (scaffold → author → draft → review → full)

1. **(Optional) Ground with a source.** `ingest <url>` writes
   `planning/<id>.md` (text + metadata only — never media). Read it as research;
   it is NEVER read at render time, so determinism is preserved. The evidence
   gate (N9) still governs what reaches the screen — never fabricate figures.
2. **Scaffold.** Create a self-contained project (brief + empty manifest +
   `authored/` dir) via `scaffold_project` (MCP) / `author scaffold` (CLI) /
   `scripts/new-video.ts`.
3. **Author.** Write fresh `.tsx` scene modules under `projects/<id>/authored/`
   per the authoring-contract; compose `@news/blocks` for text/structure and
   author bespoke SVG/CSS imagery for the signature beats. Fill `manifest.json`
   (`version:1`, `ratio:"9:16"`, `language:"vi"`, sequential `scene-NN`, optional
   `theme.stylePackId`). Do NOT copy a previous project's scenes.
4. **Draft (always).** Render a fast low-res draft (`render_draft` / `render --draft`)
   and let the user review it. A cheap `stills` pass first is encouraged.
5. **Full (only after approval).** `render_full` is **refused** unless a prior
   draft exists (draft-first gate); override only with `forceFull` when the user
   explicitly asks. Report the MP4 path and STOP.

## Style packs (selectable look)

Set `manifest.theme.stylePackId` per project:

- `bold-editorial` (default) — bold ink borders, hard-offset shadow, grid +
  registration ticks, full accent set. The current signature look.
- `clean-premium` — hairline/none borders, soft shadow, no grid/ticks, single
  accent, airy spacing (restrained, "premium") — Be Vietnam Pro display face.

An unknown `stylePackId` is a hard error before TTS (lists the registered ids).
No id ⇒ `bold-editorial`. Read chrome tokens from the theme in authored scenes;
never hard-code chrome. See `packages/design/src/style-packs.ts`.

## Programmatic surfaces (same orchestrator, same guarantees)

MCP tools (`.kiro/settings/mcp.json` → server `news`): `ingest_url`,
`scaffold_project`, `render_draft`, `render_full`, `doctor`, `list_projects`,
`tracker_list` / `tracker_add` / `tracker_update`. Equivalent CLI verbs:
`ingest`, `tracker`, `bulk`, `doctor`, `mcp`. For overnight bulk, queue items in
the tracker and run the resumable bulk loop (`bulk` / `runBulkLoop`); authoring
of each item is still done by you between scaffold and draft.

## Invariants you must never bypass (any surface)

- The full `N1–N30` safety grid gates lock/render/done; hard checks block.
- Determinism: scene visuals are pure functions of the frame (no `Math.random`/
  `Date`/network/fs in block/scene code; use Remotion `random(seed)`).
- Evidence gate (N9): never fabricate sources/dates/prices/percentages/quotes.
- Vietnamese: digits as digits in display AND narration; brand/model names in
  English; no phonetic spellings or spaced abbreviations.
- Burned-in karaoke captions are produced centrally — never author caption text
  per scene.
- Draft-first: never jump straight to a full render.
- Voice: keep the configured Vivibe provider/voice; if config is incomplete,
  STOP and report the exact missing key/voice id — never downgrade to mock/none.
- Hygiene: generated artifacts only under `.video-tool/` + `planning/`; never the
  repo root.

Run `doctor` first if anything looks misconfigured — it reports every failure
(Vivibe `.env`, ffmpeg, browser, registry, style packs, fonts, MCP wiring) with
remediation.
