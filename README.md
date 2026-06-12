# News Remotion Tool

AI-driven Vietnamese short-form news video generator built on
[Remotion](https://remotion.dev) (React). This is the successor experiment to
the HyperFrames-based `news_video_tool`: instead of filling ~40 locked templates
with JSON, the AI **authors brand-new React scene components for every video**
(pure AUTHOR mode), composing a small library of reusable, slot-based **layout
blocks** (`@news/blocks`) for on-brand consistency. Visual diversity is unbounded
code; quality stays stable through an enumerated **safety grid (N1–N30)**.

It mirrors the stability/diversity tradeoff that `math_video_tool` made with
Manim — but on the web stack the news pipeline already uses (React, Vite, Node,
headless Chromium, ffmpeg).

```text
Topic -> AI authors scene .tsx + manifest.json
-> admission gate (N4/N5) -> manifest -> VideoSpec -> static grid (N1-N9)
-> Vivibe TTS (+ breath gaps + SRT) -> lockSpec (transition-aware, caption cues)
-> build grid (N10-N13) -> determinism guard (N16)
-> Remotion render (TransitionSeries + caption track) -> MP4
-> render oracles (N14, N18-N22, N28-N30; N15/N17/N23 exported, not auto-run) -> review loop (N24-N25) -> done
```

## Why Remotion

- Each scene is a deterministic function of the frame number (`useCurrentFrame`),
  so renders are reproducible and hashable — the same property the old build
  cache relied on.
- Diversity is unbounded code (CSS / SVG / Canvas / WebGL), not a closed enum.
- Stability comes from a per-component Zod schema plus the shared design system
  and the N1–N30 safety grid, not from forbidding the AI to touch visuals.
- `@remotion/player` gives instant scrubbing preview, replacing HyperFrames Studio.

## License note

Remotion is free for individuals, non-profits, and for-profit orgs up to 3
people. A prompt-to-video product at company scale (4+) needs a Remotion company
license. See https://remotion.dev/docs/license. This repo assumes the free tier
(individual / non-profit).

## Setup

```bash
npm install
cp .env.example .env   # add Vivibe (VIETNAMESE_API_KEY / VIETNAMESE_VOICEID) keys
npm run studio         # open Remotion Studio with the bundled sample
```

## Render the sample (no voice)

```bash
npm run render -- NewsVideo out/sample.mp4
```

## CLI (`@news/pipeline`)

The CLI entry is `packages/pipeline/src/cli/cli.ts`. In pure AUTHOR mode you
scaffold a project, let the AI write scene `.tsx` modules into the project's
`authored/` dir + fill `manifest.json`, then render.

```bash
# Scaffold a fresh AUTHOR-mode project (creates authored/ + an empty manifest):
npx tsx packages/pipeline/src/cli/cli.ts author scaffold "<id-or-topic>"

# Render a project end-to-end. DRAFT-FIRST: render a fast preview first, review
# it, then the full render (which is gated on a prior draft):
npx tsx --env-file=.env packages/pipeline/src/cli/cli.ts render <projectId> --draft
npx tsx --env-file=.env packages/pipeline/src/cli/cli.ts render <projectId>
# (use --force-full to bypass the draft-first gate when intentional)

# No-voice visual draft of the bundled sample (no Vivibe needed):
npx tsx packages/pipeline/src/cli/cli.ts render --sample

# Environment readiness (Vivibe .env, ffmpeg, browser, registry, style packs, fonts, MCP):
npx tsx packages/pipeline/src/cli/cli.ts doctor
```

Productization verbs (same single-process orchestrator):

```bash
# Ground a topic from an article (text + metadata only) → planning/<id>.md:
npx tsx packages/pipeline/src/cli/cli.ts ingest <url> [--id <id>]

# Bulk work queue + resumable overnight loop:
npx tsx packages/pipeline/src/cli/cli.ts tracker add <url> --id n1 --title "..." --source "..."
npx tsx packages/pipeline/src/cli/cli.ts tracker list
npx tsx --env-file=.env packages/pipeline/src/cli/cli.ts bulk --tracker tracker.json --limit 20

# MCP server (typed tools over stdio; also registered in .kiro/settings/mcp.json):
npx tsx packages/pipeline/src/cli/cli.ts mcp
npx tsx --env-file=.env packages/mcp/src/bin.ts
```

Render quality is `full` (30 fps deliverable) by default; a `draft` quality
renders a fast, lower-res, 10 fps preview. Background music: drop a `default.mp3`
at the repo root and it is mixed under the narration at ~20% automatically.

For a worked, end-to-end example see `scripts/build-gemma.ts` (authors seven
bespoke scenes + a manifest for a real topic, then renders).

## Workspace layout

| Package | Role |
| --- | --- |
| `packages/schema` | Renderer-agnostic `VideoSpec`/`LockedVideoSpec`, timing consts, layout zones, `CaptionCue`, free-pacing validation |
| `packages/design` | Multi-language design system: each style is a self-contained `StyleLanguage` (editorial, galaxy) deriving its full palette/surface/backdrop/fonts/contract from one dominant hue + color/motion |
| `packages/blocks` | Slot-based layout blocks (Frame, Content, Story, TitleBlock, IdeaPanel, KeyPoints, Callout, StatChip, Panel, StatBlock, CountUp, BarChart, HeaderBar, Footer, Tag, SceneImage, Captions) reading every chrome decision from the theme via the surface-kit + theme context + motion |
| `packages/compositions` | Registry + master `VideoComposition` (TransitionSeries + caption overlay); NO built-in templates |
| `packages/tts` | Vivibe/LucyLab client, audio measure/concat-with-gaps/mix, SRT capture |
| `packages/pipeline` | authoring/admission, manifest, tts, captions, lock, store, cache, determinism, renderer, review, orchestrator, cli, safety grid |
| `apps/remotion` | Remotion root, sample fixture, studio/render entry |

## Status

The pipeline runs end-to-end in pure AUTHOR mode — author scenes → admission gate
→ static grid → TTS → lock → build grid → determinism guard → Remotion render →
render oracles → review loop — and is exercised by real test renders. There are
**no** built-in scene templates: every video's scenes are authored fresh and
admitted through the AST gate (import whitelist + banned-API blacklist + required
`default`/`schema`/`example` exports). The full safety grid `N1`–`N30` ships,
each check with a non-vacuous self-test.

Checks: `npm run typecheck`, `npm test`, `npm run build`.

See `.kiro/specs/author-mode-v2/{requirements,design,tasks}.md` for the current
spec, `AGENTS.md` for the agent contract, `docs/ai-content-guide.md` for the
content contract, and `docs/design-language.md` for the design system.

For productization (selectable looks, URL grounding, the MCP API, bulk
production, ops) see `.kiro/specs/tool-productization/`, the buyer guide
`docs/buyer-guide.md`, and the authoring skill
`.kiro/skills/news-video-author/SKILL.md`.

## Desktop app (`apps/desktop`) — pure-AUTHOR + self-repair

The Electron desktop GUI drives the SAME engine in **pure AUTHOR mode**: for each
project the selected AI model writes brand-new `.tsx` scene modules (it returns a
manifest + one `.tsx` block per scene), which are admitted through the same gate
and rendered. There is no scene-kit/template fallback.

If the draft trips a content/layout oracle, the **generate-validate-repair** loop
asks the model to rewrite only the flagged scene(s) — for layout/contrast defects
(`N14`/`N18`) it attaches the scene's rendered still for vision-guided repair.
Infrastructure failures (missing voice key, gateway/network, Chromium crash) are
classified separately and shown to you to fix; only content defects get the
**"Sửa bằng AI"** button on the error screen.

**Cost/latency expectation:** every author/reauthor call carries the full
authoring contract, so it is a large prompt. To bound cost, a repair sends only
the flagged scene(s) — not the whole video — so one "Sửa bằng AI" pass still
re-runs the model + a draft render and can take tens of seconds.

See `.kiro/specs/desktop-author-mode/{requirements,design,tasks}.md`.
