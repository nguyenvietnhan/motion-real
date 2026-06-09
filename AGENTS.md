# Agent Guide — news_remotion_tool

This project turns a Vietnamese-language prompt into a finished 9:16 short-form
news MP4. Unlike the HyperFrames-based `news_video_tool` (which locked the AI
into ~40 fixed templates), here the AI **authors brand-new Remotion (React)
scene components for every video** (pure AUTHOR mode), composing a small library
of reusable, slot-based **layout blocks** (`@news/blocks`) for on-brand
consistency. Visual diversity is unbounded code; quality stays stable through an
enumerated **safety grid (N1–N30)** that mirrors `math_video_tool`'s F-grid
lint/oracle/review system.

> `math_video_tool` and `news_video_tool` are reference designs only. Do not
> modify them. This repo is self-contained.

## Read First

> **This file (AGENTS.md) is the always-on, self-sufficient contract — its rules
> are binding on their own.** The docs below are the deep-dives. **If you are
> AUTHORING a video (the common task), you MUST open these two before writing any
> scene:** `.kiro/steering/authoring-contract.md` (the code how-to) and
> `docs/visualization-playbook.md` (the menu of visual forms). The rest are
> reference, read as needed.

- `README.md` — setup, CLI verbs, pipeline overview.
- `docs/ai-content-guide.md` — the content contract the authoring AI must follow.
- `docs/design-language.md` — the LOOK: the design system/philosophy every
  authored scene (and bespoke visual) must follow.
- `docs/visualization-playbook.md` — the menu of visual FORMS per content shape;
  read it before authoring scenes so you vary the presentation instead of
  defaulting to count-up + numbered list.
- `docs/providers/vivibe.md` — Vivibe/LucyLab TTS provider notes.
- `.kiro/specs/author-mode-v2/{requirements,design,tasks}.md` — the current spec
  (the older `render-pipeline` spec is historical PICK-mode record).
- `.kiro/steering/authoring-contract.md` — the authoring contract (required
  exports, import whitelist, banned APIs, blocks, layout zones, design rules).
- `packages/blocks/src/index.ts` — the slot-based blocks authored scenes compose.
- `packages/compositions/src/registry.ts` — the registry contract; each authored
  scene owns its Zod prop schema, `promptGuide`, and `example`.

## Architecture (one new orchestration package: `@news/pipeline`)

```
Topic -> AI authors scenes .tsx + manifest.json
-> admission gate (N4/N5) -> manifest->VideoSpec -> static grid (N1-N9)
-> Vivibe TTS (+ breath gaps + SRT) -> lockSpec (transition-aware, caption cues)
-> build grid (N10-N13) -> determinism guard (N16)
-> Remotion render (TransitionSeries + caption track) -> MP4
-> render oracles (N14, N18-N22, N28-N30; N15/N17/N23 exported, not auto-run) -> review loop (N24-N25) -> done
```

| Package | Role |
| --- | --- |
| `@news/schema` | Renderer-agnostic `VideoSpec`/`LockedVideoSpec`, timing consts, layout zones, `CaptionCue`, free-pacing validation |
| `@news/design` | Theme tokens (squared, light cream base) + color/motion |
| `@news/blocks` | Slot-based layout blocks (Frame, Content, **Story** (framed HeaderBar+Footer skeleton), TitleBlock, Panel, IdeaPanel, KeyPoints, Callout, StatChip/StatBlock/CountUp/BarChart, Captions) + theme context + motion |
| `@news/compositions` | Registry + master `VideoComposition` (TransitionSeries + caption overlay); NO built-in templates |
| `@news/tts` | Vivibe/LucyLab client, audio measure/concat-with-gaps/mix, SRT capture |
| `@news/pipeline` | authoring/admission + manifest, tts, captions, lock, sfx, store, cache, determinism, renderer, review, orchestrator, cli, safety grid |
| `apps/remotion` | Remotion root, sample fixture, studio/render entry |

## The Safety Grid (N1–N30)

Hard errors block lock/render/done; warnings are advisory. Every check ships
with a **non-vacuous self-test** (a known-bad fixture proving it fires) — when a
new defect class is found by eye, graduate it into a new oracle + self-test.

- Tier 1 static lint (pre-TTS): N1 structure (free pacing), N2 unknown component,
  N3 per-component Zod props, N4 authored-import whitelist, N5 forbidden API,
  N6/N7 phonetics/spaced abbreviations, N8 number rules, N9 evidence-gate/media
  bans, N26 hook quality, N27 CTA quality.
- Tier 2 build/type (pre-render): N10 typecheck, N11 bundle, N12 locked timing, N13 scene audio.
- Tier 3 render oracles (post-render). **Auto-run on every render** (over the
  per-scene midpoint stills + locked spec): N14 content-zone/caption-clearance
  (hard), N16 determinism (hard, in `determinism.ts`), N18 contrast/font, N19
  dead-air, N20 pacing, N21 transition/flicker, N22 audio-sync, N28 duration
  target, **N29 captions**, N30 content density (advisory: overcrowding).
  **Exported + self-tested but NOT auto-run** (a flat midpoint still lacks the
  inputs they need, so they're available to callers that supply those inputs):
  N15 overlap and N17 truncation (need per-block layout rects / a content box),
  N23 richness (needs multi-frame-per-scene motion, which the always-on ambient
  tilt would mask — so it can't separate a rich scene from a lazy static one).
  Visual richness is instead nudged by N30 + N19 + the playbook guidance.
- Tier 4 review loop (before "done"): N24 keyframes/contact sheet, N25 self-critique
  checklist.

## AI Authority Model

- **Pure AUTHOR mode:** for every video the AI writes new `.tsx` scene modules
  under `projects/<id>/authored/`. Each is admitted only through
  `admitAuthoredComponent` (AST gate: import whitelist incl. `@news/blocks` +
  banned-API blacklist + required `default`/`schema`/`example` exports, N4/N5),
  then self-registers via a registration handshake. A manifest may reference an
  authored id only after admission. Authored scene code runs only inside the
  Remotion render context.
- There is NO PICK mode and no fixed template catalog. Scenes compose
  `@news/blocks` for text/structure and author bespoke code only for imagery; a
  plain text/list scene is a valid first-class choice.

## Authoring & render — the reliable path

To make a video, DON'T improvise. Scaffold a build script and run it:

```bash
npx tsx scripts/new-video.ts <project-id> "Video title"   # writes scripts/build-<id>.ts
# edit the authored scenes for your topic, then:
npx tsx scripts/build-<id>.ts stills                       # fast layout check (mock voice)
npx tsx --env-file=.env scripts/build-<id>.ts draft vivibe # draft for the user to review
npx tsx --env-file=.env scripts/build-<id>.ts full  vivibe # final, only after approval
```

This runs the whole pipeline in ONE process that imports `@news/pipeline` from
source — a single `@news/compositions` registry instance, the exact path the
test suite exercises. Worked examples: `scripts/build-d4rt.ts`, `build-gemma.ts`
(copy the STRUCTURE; author fresh visuals, never copy their scenes).

Do NOT: manually create the `projects/<id>/` dir, run authored scenes via
`tsx -e` inline (top-level-await + resolution traps), or hand-roll
`cli.ts render` against a hand-made project. Those paths can resolve a SECOND
`@news/compositions` registry instance (registration "not found" errors) and
miss the build-script conveniences. The registry handshake now mirrors a stray
instance defensively, but the build-script path above is the supported one.

## Content Rules

Follow `docs/ai-content-guide.md` exactly. Highlights:

- Output a valid `VideoSpec`/manifest: `version:1`, `styleId:"clean-luxury-tech"`,
  `ratio:"9:16"`, `language:"vi"`; sequential `scene-NN` ids. **Free pacing**:
  scene count and total duration are NOT fixed presets; `duration` is an optional
  target only.
- A longer `renderDuration` after natural Vietnamese TTS is NOT a rerender reason
  if the voice is complete, uncut, and unrushed.
- Open scene-01 with a direct hook (no greeting/definition); end with a
  topic-specific CTA (no generic subscribe/like/follow).
- Never **fabricate** specifics — sources, dates, prices, percentages,
  benchmarks, or quotes — and never present invented figures as fact (evidence
  gate, N9). The prompt is research material, not a strict script: you MAY
  enrich it with context you genuinely know/verify to be true (and SHOULD, when
  it sharpens the story), but anything you can't stand behind as real stays out.
  When unsure of a number, show the idea without inventing a figure.
- **Captions are REQUIRED**: the render burns in single-line Vietnamese captions
  generated centrally from each scene's `narration` (timed from the TTS SRT) so
  sound-off viewers can read along. Do NOT put caption/subtitle text in scene
  props — captions are not authored per scene. Captions are word-paged
  **karaoke** (the active word is highlighted with a smooth eased color/scale
  ramp); this is produced centrally too, never authored per scene.
- No media payloads: the ban is ONLY real/external assets — photos, screenshots,
  logos, uploads, image/video URLs (`assetRef`), auto-fetch. Anything you DRAW in
  SVG/CSS — figure/avatar silhouettes, icons, glyphs, diagrams, charts, metaphors
  — is allowed and ENCOURAGED where it aids clarity or polish (e.g. a default-
  avatar silhouette on a speaker card).
- **Layout**: put primary content in the upper **content zone** (compose
  `Content` from `@news/blocks`); the bottom **caption band** + **platform-UI
  reserve** stay clear. Do NOT render the old top-left eyebrow+headline header —
  use `TitleBlock` (eyebrow-free). A global black divider line is drawn at the
  content-zone bottom (the caption boundary) on every video — keep authored
  content ABOVE it: content creeping into the caption clearance gap is a hard
  N14 error that blocks the render.
- **Design language**: squared (no rounded corners), clearly delineated blocks
  (bold ink borders), on a **light warm cream** base (near-black ink) that reads
  in dark/bright/glare — NOT a dark base. The per-project dominant color drives
  accents/data-viz, not the base wash. See `docs/design-language.md`.
- **Visualize diversely; blocks are a guardrail, not the default.** Run EVERY
  scene through `docs/visualization-playbook.md`: name the idea + its content
  shape, and **decompose the narration/headline for an embedded number,
  relationship, change, or process** — if one exists, prefer a visual that
  carries it (e.g. "X nhanh hơn Y" → a two-line divergence chart, not a sentence).
  Pick a form not used yet in this video. The `@news/blocks` exist so layout/look
  stay correct, NOT so you can fill a whole video with the same 3–4 of them; a
  video that is mostly the same `TitleBlock`+`KeyPoints`/`CountUp` is a FAIL.
  Author **bespoke, topic-specific SVG/CSS imagery for the signature beats** —
  code built for THIS topic, not a generic chart. Do NOT bootstrap a new video by
  copying a previous project's authored components and only swapping text; author
  fresh visuals for the new concepts. A clean text/list block is a **deliberate
  choice** for genuinely text content (definition/recap/CTA) — never a lazy
  default for a scene you didn't design.
- **One idea per scene; don't overcrowd — but don't leave it sparse either.**
  Put a single point/figure/comparison in each scene with breathing room; if a
  scene has more, split it. The N30 oracle warns when a scene fills too much of
  the content zone (cluttered). The opposite is just as bad: a scene with only a
  short title + one line reads top-heavy and unbalanced. Give a sparse beat a
  confident visual anchor (a bold stat, a simple bespoke diagram, a metaphor) so
  it fills the content zone with intent — `Content`/`Story` already centre
  vertically, so don't fight that with a tiny block floating at the top. Condense
  narration to the essential sentence — don't read a whole paragraph into one scene.
- Vietnamese display + narration; keep brand/model names in English; no phonetic
  spellings (`Ô pân A I`) and no spaced abbreviations (`A I`, `G P T`). **Write
  numbers as DIGITS in BOTH display and narration** (`92%`, `2026`, `110.000`,
  `920 triệu`, `30 tỷ`) — the TTS layer reads them as natural Vietnamese, so do
  NOT hand-spell ("hai nghìn không trăm hai mươi sáu") and never English-pair a
  year ("hai mươi hai sáu"). Write dates as `ngày 5 tháng 6 năm 2026`; keep scale
  words in Vietnamese (`triệu`/`tỷ`/`phần trăm`); avoid `$` and `1.5M` forms
  (write `1,5 triệu USD`).
- Do not manually number list/`KeyPoints` items; blocks add numbering.

## Runtime Rules

- Preserve the configured TTS provider/voice. If Vivibe is configured (or
  `brief.tts.provider === "vivibe"`), use it; do not silently fall back to
  `mock`/`none` unless the user asks for no voice.
- If TTS config is incomplete, STOP and report the exact missing key/endpoint/
  voice id. Do not substitute a lower-quality voice.
- **Always draft before full (every time).** Never jump straight to a full
  render. First render a fast low-res DRAFT (`quality: "draft"` — 10fps, half-res,
  to `<id>.draft.mp4`), report it to the user, and let them review/give feedback.
  Only render the full-quality MP4 after the user approves the draft (or explicitly
  asks to skip it). A cheap stills pass first is encouraged for layout checks.
  This is now ENFORCED in code: a full render refuses unless a draft exists for
  the project (override only with `forceFull` when the user explicitly asks).
- After the full MP4 renders and the review gate passes, report the path and
  STOP. No extra screenshot/preview/QA loops unless asked.

## Workspace Hygiene

- Generated artifacts live ONLY under `VIDEO_TOOL_HOME/.video-tool/`
  (`projects/<id>/`, shared `cache/tts`, `cache/renders`). Never write scratch
  specs/MP4s/screenshots to the repo root.
- Treat `node_modules`, `dist`, `out`, `.video-tool/cache`, successful renders,
  and `.env` as user-owned runtime state; don't delete unless asked.
- When cleanup is uncertain, quarantine under `.cleanup-quarantine/<timestamp>/`
  instead of deleting.

## Determinism

- Scene visuals are pure functions of the frame. `Math.random`, `Date.now`/
  `Date`, network, and fs are forbidden in block + authored scene code (enforced
  by N5 lint over `@news/blocks` + `@news/compositions` and the AUTHOR admission
  gate). Use Remotion's `random(seed)`. Transitions derive only from frame-based
  timing functions.

## Required Checks

Run after source/registry/schema/guide changes (content-only render jobs don't
need the full loop):

```bash
npm run typecheck   # tsc -p tsconfig.json --noEmit
npm test            # vitest run
npm run build       # Remotion webpack bundle of the app (no browser download)
```

Note: the per-package `tsc -p tsconfig.json` emit is intentionally not the build
path (cross-package source imports via path aliases fall outside each package's
`rootDir`); `npm run build` bundles the app via webpack instead.
