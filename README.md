# News Remotion Tool

AI-driven Vietnamese short-form news video generator built on
[Remotion](https://remotion.dev) (React). This is the successor experiment to
the HyperFrames-based `news_video_tool`: instead of filling ~40 locked
templates with JSON, the AI writes/picks **real React scene components**, so
visuals can be as diverse as code allows while staying deterministic and
cache-friendly.

It mirrors the stability/diversity tradeoff that `math_video_tool` made with
Manim — but on the web stack the news pipeline already uses (React, Vite, Node,
headless Chromium, ffmpeg).

```text
Prompt -> AI Planner -> video-spec.json (open component registry + free props)
-> structural + per-component validation -> Vivibe TTS
-> locked spec (frame-accurate timing) -> Remotion <Composition>
-> remotion render -> MP4
```

## Why Remotion

- Each scene is a deterministic function of the frame number (`useCurrentFrame`),
  so renders are reproducible and hashable — the same property the old build
  cache relied on.
- Diversity is unbounded code (CSS / SVG / Canvas / WebGL), not a closed enum.
- Stability comes from a per-component Zod schema plus the shared design system,
  not from forbidding the AI to touch visuals.
- `@remotion/player` gives instant scrubbing preview, replacing HyperFrames Studio.

## License note

Remotion is free for individuals, non-profits, and for-profit orgs up to 3
people. A prompt-to-video product at company scale (4+) needs a Remotion
company license. See https://remotion.dev/docs/license. This repo assumes the
free tier (individual / non-profit).

## Setup

```bash
npm install
cp .env.example .env   # add Vivibe + AI keys when ready
npm run studio         # open Remotion Studio with the bundled sample
```

## Render the sample (no voice)

```bash
npm run render -- NewsVideo out/sample.mp4
```

## CLI (`@news/pipeline`)

```bash
# Plan a project from a prompt (mock planner needs no API key):
npx tsx packages/pipeline/src/cli.ts create "<prompt>" --duration 60 \
  --provider mock|deepseek|openai-compatible --tts vivibe|mock|none

# Render a planned project (TTS -> lock -> build grid -> determinism -> render -> review):
npx tsx packages/pipeline/src/cli.ts render <projectId> --tts none --concurrency 2

# No-voice visual draft of the bundled sample (no Vivibe needed):
npx tsx packages/pipeline/src/cli.ts render --sample

# Environment readiness (Vivibe .env, ffmpeg, browser, registry):
npx tsx packages/pipeline/src/cli.ts doctor
```

Genuine per-topic visual variety comes from the AI planner (set `AI_API_KEY` +
`AI_PROVIDER`) and, for brand-new visuals, AUTHOR mode. The `mock` planner is a
deterministic, evidence-safe stub for offline structure/render checks.

## Workspace layout

| Package | Role | Reused from news_video_tool |
| --- | --- | --- |
| `packages/schema` | Renderer-agnostic spec, pacing, structural validation | adapted |
| `packages/design` | Central theme tokens + motion language | adapted from styles |
| `packages/tts` | Vivibe/LucyLab client, audio measure/concat/mix | ported verbatim |
| `packages/compositions` | Remotion scene component registry (the diversity layer) | new |
| `apps/remotion` | Remotion root, sample fixture, studio/render entry | new |

## Status

Phases 1 and 2 of the `render-pipeline` spec are complete. The pipeline runs
end-to-end — plan → static grid → TTS → lock → build grid → determinism guard →
Remotion render → render oracles → review loop — and is exercised by a real test
render. The catalog ships 7 starter scene components (`hero-announcement`,
`price-spotlight`, `insight-stack`, `final-cta`, `quote-pull`,
`comparison-split`, `stat-grid`), the full safety grid `N1`–`N28` (each check
with a non-vacuous self-test), and AUTHOR mode (the AST admission gate +
registration handshake).

Checks: `npm run typecheck`, `npm test`, `npm run build`.

See `.kiro/specs/render-pipeline/{requirements,design,tasks}.md` for the spec and
`AGENTS.md` + `docs/ai-content-guide.md` for the agent and content contracts.
