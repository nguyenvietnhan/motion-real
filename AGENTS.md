# Agent Guide — news_remotion_tool

This project turns a Vietnamese-language prompt into a finished 9:16 short-form
news MP4. Unlike the HyperFrames-based `news_video_tool` (which locked the AI
into ~40 fixed templates), here the AI **picks and parameterizes — and in Phase
2, authors — real Remotion (React) scene components**. Visual diversity is
unbounded code; quality stays stable through an enumerated **safety grid
(N1–N28)** that mirrors `math_video_tool`'s F1–F30 lint/oracle/review system.

> `math_video_tool` and `news_video_tool` are reference designs only. Do not
> modify them. This repo is self-contained.

## Read First

- `README.md` — setup, CLI verbs, pipeline overview.
- `docs/ai-content-guide.md` — the content contract the AI planner must follow.
- `docs/providers/vivibe.md` — Vivibe/LucyLab TTS provider notes.
- `.kiro/specs/render-pipeline/{requirements,design,tasks}.md` — the full spec.
- `packages/compositions/src/registry.ts` — the registry contract; each scene
  component owns its Zod prop schema, `promptGuide`, and `example` (the source
  of truth for what the planner may emit).

## Architecture (one new orchestration package: `@news/pipeline`)

```
Prompt -> planner (PICK mode) -> video-spec.json (open component id + free props)
-> static grid (N1-N9) -> Vivibe TTS -> lockSpec (frame-accurate)
-> build grid (N10-N13) -> determinism guard (N16) -> Remotion render -> MP4
-> render oracles (N14-N23) -> review loop (N24-N25) -> done
```

| Package | Role |
| --- | --- |
| `@news/schema` | Renderer-agnostic `VideoSpec`/`LockedVideoSpec`, pacing, structural validation |
| `@news/design` | Theme tokens + motion language |
| `@news/compositions` | Registered scene components + registry + master `VideoComposition` |
| `@news/tts` | Vivibe/LucyLab client, audio measure/concat/mix |
| `@news/pipeline` | planner, tts, lock, sfx, store, cache, determinism, renderer, review, orchestrator, cli, safety grid, AUTHOR-mode admission |
| `apps/remotion` | Remotion root, sample fixture, studio/render entry |

## The Safety Grid (N1–N28)

Hard errors block lock/render/done; warnings are advisory. Every check ships
with a **non-vacuous self-test** (a known-bad fixture proving it fires) — when a
new defect class is found by eye, graduate it into a new oracle + self-test.

- Tier 1 static lint (pre-TTS): N1 structure, N2 unknown component, N3 per-component
  Zod props, N4 authored-import whitelist, N5 forbidden API, N6/N7 phonetics/spaced
  abbreviations, N8 number rules, N9 evidence-gate/media bans.
- Tier 2 build/type (pre-render): N10 typecheck, N11 bundle, N12 locked timing, N13 scene audio.
- Tier 3 render oracles (post-render): N14 safe-area, N15 overlap, N16 determinism,
  N17 truncation, N18 contrast/font, N19 dead-air, N20 pacing, N21 transition/flicker,
  N22 audio-sync, N23 richness.
- Tier 4 review loop (before "done"): N24 keyframes/contact sheet, N25 self-critique
  checklist, N26 hook quality, N27 CTA quality, N28 template-fit.

## AI Authority Model

- **PICK mode (default):** the planner emits only ids returned by
  `listComponents()` and supplies Zod-valid `props`. Total safety: code is
  repo-owned, props are validated.
- **AUTHOR mode (Phase 2):** the AI writes a new `.tsx` scene. It is admitted
  only through `admitAuthoredComponent` (AST gate: import whitelist + banned-API
  blacklist + required `default`/`schema`/`example` exports, N4/N5), then a
  typecheck + registration handshake. The planner may reference an authored id
  only after admission. Authored scene code runs only inside the Remotion render
  context.

## Content Rules

Follow `docs/ai-content-guide.md` exactly. Highlights:

- Output a valid `VideoSpec`: `version:1`, `styleId:"clean-luxury-tech"`,
  `ratio:"9:16"`, `language:"vi"`, `duration` ∈ {60,90,120,180}; sequential
  `scene-NN` ids; scene durations sum to the preset.
- `duration` is a pacing target, not a wall-clock guarantee. A longer
  `renderDuration` after natural Vietnamese TTS is NOT a rerender reason if the
  voice is complete, uncut, and unrushed.
- Open scene-01 with a direct hook (no greeting/definition); end with a
  topic-specific CTA (no generic subscribe/like/follow).
- Never invent sources, dates, prices, percentages, benchmarks, or quotes not
  in the prompt/context (evidence gate, N9).
- No subtitles/captions/karaoke; no media payloads (`assetRef`, image/logo URL,
  screenshot, upload, auto-fetch).
- Vietnamese display + narration; keep brand/model names in English; no phonetic
  spellings (`Ô pân A I`) and no spaced abbreviations (`A I`, `G P T`). Display
  numbers compact (`92%`, `2026`); spell numbers out naturally in narration.
- Do not manually number `insight-stack`/list items; components add numbering.

## Runtime Rules

- Preserve the configured TTS provider/voice. If Vivibe is configured (or
  `brief.tts.provider === "vivibe"`), use it; do not silently fall back to
  `mock`/`none` unless the user asks for no voice.
- If TTS config is incomplete, STOP and report the exact missing key/endpoint/
  voice id. Do not substitute a lower-quality voice.
- After the MP4 renders and the review gate passes, report the path and STOP. No
  extra screenshot/preview/QA loops unless asked.

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
  `Date`, network, and fs are forbidden in scene code (enforced by N5 lint for
  registered scenes and the AUTHOR admission gate). Use Remotion's `random(seed)`.

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
