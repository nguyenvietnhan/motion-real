# News Remotion Tool

AI-driven Vietnamese short-form editorial video generator built on
[Remotion](https://remotion.dev) (React). This is the successor experiment to
the HyperFrames-based `news_video_tool`: instead of filling ~40 locked templates
with JSON, the AI **authors brand-new React scene components for every video**
(pure AUTHOR mode), writing every scene as raw JSX/SVG by hand — there is no
layout-block toolkit (it was deleted; reusing it made every video look the same).
The one authored-facing import beyond react/remotion/zod is `<SceneImage>` (via
`@news/compositions`) for the user-attached + crawled-image feature. Visual
diversity is unbounded code; quality stays stable through an enumerated **safety
grid (N1–N30)**.

The hardened delivery path today is TikTok/Reels/Shorts-style 9:16. The
freeform-engine work has added format-aware schema geometry, prompt budgeting,
caption-off behavior, and clean brand-card thumbnails for YouTube-style 16:9,
but long-form YouTube author-by-segment / true 16:9 main-video production remains
the pending Group J work in `docs/specs/freeform-engine/tasks.md`.

It mirrors the stability/diversity tradeoff that `math_video_tool` made with
Manim — but on the web stack the news pipeline already uses (React, Vite, Node,
headless Chromium, ffmpeg).

```text
Topic/URL -> AI authors scene .tsx + manifest.json
-> optional hidden no-TTS stills/vision refine loop in the desktop app
-> admission gate (N4/N5) -> manifest -> VideoSpec -> static grid (N1-N9)
-> Vivibe TTS (+ breath gaps + SRT) -> lockSpec (transition-aware, caption cues)
-> build grid (N10-N13) -> determinism guard (N16)
-> Remotion render (TransitionSeries + TikTok caption track) -> MP4
-> render oracles (N14, N18-N22, N28-N30; N15/N17/N23 exported, not auto-run) -> review loop (N24-N25) -> done
```

## Why Remotion

- Each scene is a deterministic function of the frame number (`useCurrentFrame`),
  so renders are reproducible and hashable — the same property the old build
  cache relied on.
- Diversity is unbounded code (CSS / SVG / Canvas / WebGL), not a closed enum.
- Stability comes from admission/security gates, per-component Zod schemas,
  render-integrity checks, and the N1–N30 safety grid. There is no authored-facing
  design system; scenes hard-code their own visuals.
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

# Environment readiness (Vivibe .env, ffmpeg, browser, registry, neutral theme/fonts, MCP):
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

# MCP server (typed tools over stdio; also registered in .mcp.json):
npx tsx packages/pipeline/src/cli/cli.ts mcp
npx tsx --env-file=.env packages/mcp/src/bin.ts
```

Render quality is `full` (30 fps deliverable) by default; a `draft` quality
renders a fast, lower-res, 10 fps preview. Background music is managed through
the per-machine BGM library under `VIDEO_TOOL_HOME/.video-tool/bgm/`; a project
stores the chosen library filename in `manifest.json` and the MCP render tools
resolve it at render time. No selected BGM means no music.

For the supported local authoring path, prefer the scaffolded build scripts:
`npx tsx scripts/new-video.ts <project-id> "Video title"`, then run the generated
`scripts/build-<project-id>.ts` through `stills`, `draft`, and finally `full`
after review.

## Workspace layout

| Package | Role |
| --- | --- |
| `packages/schema` | Renderer-agnostic `VideoSpec`/`LockedVideoSpec`, timing consts, format geometry, layout zones, duration tiers, `CaptionCue`, free-pacing validation |
| `packages/theme` | One NEUTRAL theme (post-freeform-pivot; replaced the deleted multi-language `packages/design`): holds the `Theme` shape + a 2-layer cross-model defense (typed aliases + Proxy fallback) so the render runtime + `SceneImage` resolve `useTheme()`. OFF the authored import whitelist — authored scenes hard-code all their own visuals |
| `packages/blocks` | Render RUNTIME internals consumed by `packages/compositions` (NOT authored-facing): Captions, layout-probe, scene-timing, motion, theme-context, chrome surface-kit, fonts — plus the single authored-facing survivor `SceneImage`, re-exported through `@news/compositions`. The slot-based layout blocks were DELETED (they made every video look the same) |
| `packages/compositions` | Registry + master `VideoComposition` (TransitionSeries + TikTok caption overlay), `ThumbnailComposition`; NO built-in templates |
| `packages/tts` | Vivibe/LucyLab client, audio measure/concat-with-gaps/mix, SRT capture |
| `packages/pipeline` | authoring/admission, manifest, ingest, tts, captions, lock, BGM handoff, no-TTS stills, thumbnail render, store, cache, determinism, renderer, review, orchestrator, cli, safety grid |
| `packages/mcp` | Typed MCP tools over the single-process pipeline (`scaffold_project`, `render_stills`, `render_draft`, `render_full`, reports, tracker, doctor) |
| `apps/remotion` | Remotion root, sample fixture, `NewsVideo` and `Thumbnail` composition entries |
| `apps/desktop` | Electron GUI, 9router gateway, create/workspace/settings flow, hidden stills/vision refine, BGM and thumbnail UI |

## Status

The 9:16 pipeline runs end-to-end in pure AUTHOR mode — author scenes → optional
hidden stills/vision refine → admission gate → static grid → TTS → lock → build
grid → determinism guard → Remotion render → render oracles → review loop — and
is exercised by real test renders. There are
**no** built-in scene templates: every video's scenes are authored fresh and
admitted through the AST gate (import whitelist + banned-API blacklist + required
`default`/`schema`/`example` exports). The full safety grid `N1`–`N30` ships,
each check with a non-vacuous self-test. Current hard blockers are
admission/security and render-integrity classes; layout/aesthetic checks are
warnings that feed refine rather than block render.

Checks: `npm run typecheck`, `npm test`, `npm run build`.

See `CLAUDE.md` for the agent contract, `docs/architecture.md` for the current
architecture, `docs/ai-content-guide.md` for the content contract, and
`docs/design-language.md` for the design system.

For the authoring skill see `.claude/commands/news-video.md`.

## Desktop app (`apps/desktop`) — pure-AUTHOR + self-repair

The Electron desktop GUI drives the SAME engine in **pure AUTHOR mode**: for each
project the selected AI model writes brand-new `.tsx` scene modules (it returns a
manifest + one `.tsx` block per scene), which are admitted through the same gate
and rendered. There is no scene-kit/template fallback.

Before the first draft is exposed, the desktop app can run the hidden
stills-first refine path: render no-TTS PNG stills, do one creative bootstrap
rewrite, then run up to `refinePasses` vision QA rounds (early-stopping after two
clean passes when enabled), and only then render the actual draft MP4.
Post-draft edits use the same stills/vision path scoped to the edited scene(s).
Infrastructure failures (missing voice key, gateway/network, Chromium crash) are
classified separately and shown to you to fix; only content defects get the
**"Sửa bằng AI"** button on the error screen.

**Cost/latency expectation:** every author/reauthor call carries the full
authoring contract, so it is a large prompt. To bound cost, a repair sends only
the flagged scene(s) — not the whole video — so one "Sửa bằng AI" pass still
re-runs the model + a draft render and can take tens of seconds.

See `docs/architecture.md` for the desktop app's authoring + self-repair flow.
