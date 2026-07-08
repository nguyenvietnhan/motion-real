# AI Contract — MotionReal

This is the single canonical contract for any AI or human assistant working in
this repository. Compatibility entry points such as `AGENTS.md` may only point
here or provide thin tool wiring. Vendor-specific assistant files must not carry
separate project rules.

## Project In One Paragraph

MotionReal turns a Vietnamese or English prompt, optionally with URLs/images,
into a publishable Remotion MP4. The stable production path is short-form
TikTok/Reels/Shorts-style 9:16. YouTube 16:9 support exists as shared format
plumbing, thumbnail behavior, geometry, and caption-off rendering, but the true
long-form YouTube author-by-segment path is not a stable workflow.

The visual model is pure AUTHOR mode: for every video, the runtime AI writes
fresh Remotion React scene modules as raw JSX/SVG. There is no template catalog,
authored-facing layout-block toolkit, or authored-facing theme system.

## Read Map

Current docs live under `docs/current/`:

- `architecture.md` — packages, data flow, persistence, and boundaries.
- `authoring-contract.md` — scene module requirements and import rules.
- `content-guide.md` — story, language, evidence, and visual guidance.
- `maintenance.md` — cleanup/refactor rules, residual risks, and how to read
  workspace stage / authoring failure logs.
- `youtube-mode-deferred.md` — deferred roadmap note only; not active scope.

Provider setup lives in `docs/providers/`.

## Non-Negotiable Invariants

- Pure AUTHOR mode only. Every video uses fresh authored `.tsx` scene modules.
- Authored scenes write raw JSX/SVG/CSS by hand.
- Authored scene imports are limited to `react`, `remotion`,
  `@motionreal/compositions`, and `zod`.
- The only authored-facing image primitive is `SceneImage` from
  `@motionreal/compositions`.
- Do not import `@motionreal/blocks`, `@motionreal/theme`, Node APIs, browser host APIs, or
  arbitrary packages from authored scenes.
- Do not reintroduce `Frame`, `Story`, `TitleBlock`, `KeyPoints`, `Panel`,
  `CountUp`, or any authored-facing layout-block toolkit.
- Do not reintroduce style selection or a theme-token leash for authored scenes.
- Scene visuals must be deterministic functions of the frame. No `Math.random`,
  `Date`, network, filesystem, dynamic import, `eval`, or host access.
- Captions are generated centrally from narration. Authored scenes do not render
  subtitles/captions.
- Never fabricate facts, numbers, dates, quotes, prices, benchmarks, or sources.
- Preserve the configured TTS provider and voice. Never silently fall back to
  `mock`, `none`, or another provider when configuration is missing.
- Draft before full, every time.
- Generated runtime artifacts belong under `VIDEO_TOOL_HOME/.video-tool/`.

## Safety Posture

The safety grid is a contract, not a prompt wish list. New repeated AI-output
defects should become schema checks, normalizers, admission rules, or render
oracles with tests.

Current hard blockers are admission/security and render-integrity classes:

- disallowed imports and forbidden APIs;
- unknown components;
- remote/unsafe media;
- crash-class authored type/build errors;
- bundle failure;
- invalid locked timing/audio;
- determinism failure;
- duplicate scene ids;
- empty specs.

Layout and aesthetic checks are advisory warnings unless live code says
otherwise. Do not turn advisory visual/style checks into hard gates without
explicit owner approval.

## Runtime Workflow

For video production:

1. Scaffold or create a project through the supported desktop or pipeline path.
2. Author fresh scene modules and manifest.
3. Render stills for fast visual inspection/refine.
4. Render a draft MP4.
5. Stop for user review.
6. Render full only after explicit approval.

For OpenAI/Remotion/React/Zod/Electron or other library questions, verify against
official/current docs before changing code. For pipeline operations, use the
supported desktop, CLI, or pipeline APIs; do not assume a repo-provided MCP
server exists.

## Development Rules

- Keep changes scoped.
- Do not revert user changes.
- Do not delete generated caches, `.env`, successful renders, or user project
  state unless explicitly asked.
- Do not refactor `orchestrator.ts`, `render-grid.ts`, or desktop workspace flow
  casually. These are sensitive areas.
- Prefer durable docs under `docs/current/` over temporary working notes. Keep
  stage/failure log anchors stable when changing observability.
- Before adding prompt rules, check whether schema validation, a normalizer,
  admission, or an oracle is the correct layer.
- Fixes for repeated AI-output bugs need regression fixtures/tests.
- For source changes touching pipeline, blocks, compositions, or desktop
  authoring, run the relevant checks:

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```
