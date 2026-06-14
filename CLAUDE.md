# CLAUDE.md — news_remotion_tool

This project turns a Vietnamese-language prompt into a finished 9:16 short-form
news MP4. The AI **authors brand-new Remotion (React) scene components for every
video** (pure AUTHOR mode), composing a small library of reusable, slot-based
**layout blocks** (`@news/blocks`) for on-brand consistency. Visual diversity is
unbounded code; quality stays stable through an enumerated **safety grid
(N1–N30)**.

> This file is the always-on, self-sufficient contract for any agent working in
> this repo — its rules are binding on their own.

## 1. Read first

> **If you are AUTHORING a video (the common task), open these before writing any
> scene:** `docs/authoring-contract.md` (the code how-to) and
> `docs/visualization-playbook.md` (the menu of visual forms).

- `docs/vision.md` — why the tool exists, the invariants, what is out of scope.
- `docs/architecture.md` — current-state architecture, package map, data flow,
  god-file map → `docs/refactor-backlog.md`.
- `docs/authoring-contract.md` — the authoring contract (required exports, import
  whitelist, banned APIs, blocks, layout zones, design rules).
- `docs/visualization-playbook.md` — the menu of visual FORMS per content shape.
- `docs/ai-content-guide.md` — the content contract the authoring AI must follow.
- `docs/design-language.md` — the LOOK every authored scene must follow.
- `docs/adr/` — architecture decision records (the why behind the structure).
- `packages/blocks/src/index.ts` — the slot-based blocks authored scenes compose.
- `packages/compositions/src/registry.ts` — the registry contract.

## 2. Architecture (one orchestration package: `@news/pipeline`)

```
Topic -> AI authors scenes .tsx + manifest.json
-> admission gate (N4/N5) -> manifest->VideoSpec -> static grid (N1-N9)
-> Vivibe TTS (+ breath gaps + SRT) -> lockSpec (transition-aware, caption cues)
-> build grid (N10-N13) -> determinism guard (N16)
-> Remotion render (TransitionSeries + caption track) -> MP4
-> render oracles (N14, N18-N22, N28-N30; N15/N17 over measured layouts; N23 exported, not auto-run) -> review loop (N24-N25) -> done
```

| Package | Role |
| --- | --- |
| `@news/schema` | Renderer-agnostic `VideoSpec`/`LockedVideoSpec`, timing consts, layout zones, `CaptionCue`, free-pacing validation |
| `@news/design` | Multi-language design system: `core.ts` (color math + token model) ← `languages/*.ts` (self-contained looks) ← `style-packs.ts` (registry + `makeTheme`) |
| `@news/blocks` | Slot-based layout blocks (Frame, Content, Story, TitleBlock, Panel, IdeaPanel, KeyPoints, Callout, StatChip/StatBlock/CountUp/BarChart, SceneImage, Captions) + surface-kit + theme context + motion |
| `@news/compositions` | Registry + master `VideoComposition` (TransitionSeries + caption overlay); NO built-in templates |
| `@news/tts` | Vivibe/LucyLab client, audio measure/concat-with-gaps/mix, SRT capture |
| `@news/pipeline` | authoring/admission + manifest, ingest, tts, captions, lock, sfx, store, cache, determinism, renderer, review, orchestrator, cli, safety grid |
| `@news/mcp` | MCP server exposing the pipeline as tools |
| `apps/remotion` | Remotion root, sample fixture, studio/render entry |
| `apps/desktop` | Electron desktop app (create/workspace/settings UI, 9router gateway, license manager) wrapping the pipeline |

## 3. The Safety Grid (N1–N30)

Hard errors block lock/render/done; warnings are advisory. Every check ships
with a **non-vacuous self-test** (a known-bad fixture proving it fires) — when a
new defect class is found by eye, graduate it into a new oracle + self-test.

- Tier 1 static lint (pre-TTS): N1 structure (free pacing), N2 unknown component,
  N3 per-component Zod props, N4 authored-import whitelist, N5 forbidden API,
  N6/N7 phonetics/spaced abbreviations, N8 number rules, N9 evidence-gate/media
  bans, N26 hook quality, N27 CTA quality.
- Tier 2 build/type (pre-render): N10 typecheck, N11 bundle, N12 locked timing, N13 scene audio.
- Tier 3 render oracles (post-render). Auto-run on every render: N14 content-zone/caption-clearance
  (hard), N16 determinism (hard), N18 contrast/font, N19 dead-air, N20 pacing,
  N21 transition/flicker, N22 audio-sync, N28 duration target, N29 captions, N30
  content density (advisory). Also auto-run over a measure pass: N15 overlap and
  N17 truncation (WARNINGS). Exported + self-tested but NOT auto-run: N23 richness.
- Tier 4 review loop (before "done"): N24 keyframes/contact sheet, N25 self-critique checklist.

## 4. AI Authority Model

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

## 5. Authoring & render — the reliable path

To make a video, DON'T improvise. Scaffold a build script and run it:

```bash
npx tsx scripts/new-video.ts <project-id> "Video title"   # writes scripts/build-<id>.ts
npx tsx scripts/build-<id>.ts stills                       # fast layout check (mock voice)
npx tsx --env-file=.env scripts/build-<id>.ts draft vivibe # draft for the user to review
npx tsx --env-file=.env scripts/build-<id>.ts full  vivibe # final, only after approval
```

This runs the whole pipeline in ONE process that imports `@news/pipeline` from
source — a single `@news/compositions` registry instance, the exact path the
test suite exercises. Do NOT manually create the `projects/<id>/` dir, run
authored scenes via `tsx -e` inline, or hand-roll `cli.ts render` — those paths
can resolve a SECOND registry instance ("not found" errors).

## 6. Content Rules

Follow `docs/ai-content-guide.md` exactly. Highlights:

- Output a valid manifest: `version:1`, `styleId:"clean-luxury-tech"` (a FIXED
  format discriminator — not the look), `ratio:"9:16"`, `language:"vi"`;
  sequential `scene-NN` ids. The selectable LOOK is `theme.stylePackId`
  (`"bold-editorial"` default, `"galaxy"`, …). **Free pacing**: scene count and
  total duration are NOT fixed presets.
- Open scene-01 with a direct hook (no greeting/definition); end with a
  topic-specific CTA (no generic subscribe/like/follow).
- Never **fabricate** specifics — sources, dates, prices, percentages,
  benchmarks, quotes (evidence gate, N9). When unsure of a number, show the idea
  without inventing a figure.
- **Captions are REQUIRED** and generated centrally from each scene's `narration`
  (timed from the TTS SRT), burned in as word-paged karaoke. Do NOT put caption
  text in scene props.
- No media payloads: the ban is ONLY real/external assets (photos, screenshots,
  logos, uploads, image/video URLs, auto-fetch). Anything you DRAW in SVG/CSS is
  allowed and ENCOURAGED.
- **Layout**: primary content in the upper **content zone** (compose `Content`);
  bottom **caption band** + **platform-UI reserve** stay clear. A global black
  divider is drawn at the content-zone bottom; content creeping below it is a hard
  N14 error.
- **Design language**: read EVERY visual decision from `useTheme()` — colors,
  corners, surface grammar, backdrop — and NEVER hard-code a color, corner,
  border, or shadow. See `docs/design-language.md`.
- **Visualize diversely**: run EVERY scene through `docs/visualization-playbook.md`.
  A video that is mostly the same `TitleBlock`+`KeyPoints`/`CountUp` is a FAIL.
- **One idea per scene; don't overcrowd, don't leave sparse.** Condense narration
  to the essential sentence.
- Vietnamese display + narration; brand/model names in English; no phonetic
  spellings or spaced abbreviations. **Write numbers as DIGITS** in BOTH display
  and narration. Dates as `ngày 5 tháng 6 năm 2026`; scale words in Vietnamese.
- Do not manually number list/`KeyPoints` items; blocks add numbering.

## 7. Runtime Rules

- Preserve the configured TTS provider/voice. If Vivibe is configured, use it; do
  not silently fall back to `mock`/`none` unless the user asks for no voice.
- If TTS config is incomplete, STOP and report the exact missing key/endpoint/
  voice id. Do not substitute a lower-quality voice.
- **Always draft before full (every time).** Never jump straight to a full render.
  A full render refuses unless a draft exists (override only with `forceFull` when
  the user explicitly asks).
- After the full MP4 renders and the review gate passes, report the path and STOP.

## 8. Workspace Hygiene

- Generated artifacts live ONLY under `VIDEO_TOOL_HOME/.video-tool/`
  (`projects/<id>/`, shared `cache/tts`, `cache/renders`). Never write scratch
  specs/MP4s/screenshots to the repo root.
- Treat `node_modules`, `dist`, `out`, `.video-tool/cache`, successful renders,
  and `.env` as user-owned runtime state; don't delete unless asked.
- When cleanup is uncertain, quarantine under `.cleanup-quarantine/<timestamp>/`.

## 9. Determinism

- Scene visuals are pure functions of the frame. `Math.random`, `Date.now`/
  `Date`, network, and fs are forbidden in block + authored scene code (enforced
  by N5 lint + the AUTHOR admission gate). Use Remotion's `random(seed)`.

## 10. Required Checks

Run after source/registry/schema/guide changes (content-only render jobs don't
need the full loop):

```bash
npm run typecheck          # tsc --noEmit
npx tsx scripts/test.ts    # the test runner (NOT bare tsc — that emits stray .js)
npm run build              # Remotion webpack bundle of the app
```

Note: the per-package `tsc -p tsconfig.json` emit is intentionally NOT the build
path (cross-package source imports via path aliases fall outside each package's
`rootDir`); `npm run build` bundles the app via webpack instead.

## 11. MCP Usage — MANDATORY (do not wait to be reminded)

Use the available MCP servers proactively, every time they apply. This is binding:

- **`context7`** — for ANY question about a library/framework/SDK/API (Remotion,
  Zod, TypeScript, React, Electron, Vitest, Vercel AI SDK, Firecrawl, Pino,
  neverthrow, …). Call `resolve-library-id` → `query-docs`. Do NOT answer library
  questions from training memory.
- **`sequential-thinking`** — for any refactor touching a god-file, any multi-file
  change, or any change to the safety grid / orchestrator / authoring path.
- **`news`** — for every pipeline operation (`scaffold_project`, `render_draft`,
  `render_full`, `get_safety_report`, `doctor`, `ingest_url`, `tracker_*`). Do NOT
  call the CLI when the MCP tool exists.
- **`filesystem`** — to read files outside the cwd or cross-repo (sibling
  `news_video_tool` / `math_video_tool` reference designs).
- **`memory`** — to record durable cross-session facts (architecture decisions,
  design-language invariants). Not for ephemeral task state.
- **`playwright`** — to verify a rendered MP4 / Studio preview / desktop UI. Not
  for general web browsing.

## 12. Working Agreement (anti-debt rules)

These are enforceable, learned from the project's `fix(authoring)` churn:

1. **No `fix(authoring): …` lands without a regression fixture + a vitest case.**
   A class of AI-generated wrong output is permanent; a one-off prompt nudge is
   not. If the fix is a normalizer rule, the fixture is the broken AI output and
   the test asserts the normalized result. If it's an admission rule, the fixture
   lives alongside `packages/pipeline/src/authoring/__fixtures__/`.
2. **No bare `catch {}` / `.catch(() => null)` / `.catch(() => {})` in
   `apps/desktop/src/main/**`.** Every catch either logs (with a scope tag) and
   explains the recovery, or returns a typed `Result` the caller routes. A
   best-effort fallback keeps its behavior but must log a warning so the failure
   is visible.
3. **Don't add a prompt rule before checking if a normalizer or schema validator
   is the right place.** A prompt rule begs the AI to behave; a validator enforces
   it. Shape errors → Zod schema. AST/static → admission. Prompt is the last
   resort.
4. **Draft before full, every time.** Already code-enforced; restated for visibility.
5. **Run `npm run typecheck` + `npx tsx scripts/test.ts` before every commit that
   touches `packages/pipeline/`, `packages/blocks/`, `packages/compositions/`, or
   `apps/desktop/src/main/authoring/`.**
