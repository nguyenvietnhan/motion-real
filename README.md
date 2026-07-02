# MotionReal

MotionReal is an AI-driven Remotion video generator. It turns a prompt, URL, and
optional local images into a publishable MP4.

The stable production path is TikTok/Reels/Shorts-style 9:16. YouTube 16:9
support exists as shared format plumbing and thumbnail/caption behavior, but the
true long-form YouTube author-by-segment production path is not finished.

## Current Model

- Runtime AI authors fresh Remotion scene modules for each video.
- Scenes are raw JSX/SVG/CSS, admitted through the AUTHOR gate before render.
- There is no template catalog and no authored-facing layout-block toolkit.
- Captions, TTS, timing lock, safety checks, and render orchestration are owned
  by the pipeline.

## Setup

```bash
npm install
copy .env.example .env
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Configure Vivibe or ElevenLabs credentials in `.env` or through the desktop app
settings.

Optional local MCP/dev-tool config is intentionally machine-specific. If needed,
copy `.mcp.example.json` to `.mcp.json` and keep local filesystem paths only in
that ignored file.

## Apps And Packages

| Path | Purpose |
| --- | --- |
| `apps/desktop` | Electron UI for create, settings, hidden refine, review, BGM, thumbnail, and export. |
| `apps/remotion` | Remotion root and compositions entry. |
| `packages/schema` | Video specs, locked specs, geometry, timing, captions. |
| `packages/compositions` | Registry, master video composition, thumbnail composition, `SceneImage` re-export. |
| `packages/blocks` | Render runtime internals only. Not authored-facing. |
| `packages/theme` | Neutral runtime theme for render internals. Not authored-facing. |
| `packages/tts` | Vivibe and ElevenLabs clients plus audio helpers. |
| `packages/pipeline` | Authoring, admission, TTS, lock, render, safety, cache, review, store, and internal tool facade. |

## Documentation

- `AI_CONTRACT.md` — single canonical contract for all AI agents.
- `docs/current/overview.md` — product status and invariants.
- `docs/current/architecture.md` — current package map and data flow.
- `docs/current/authoring-contract.md` — authored scene rules.
- `docs/current/content-guide.md` — story, evidence, language, and visuals.
- `docs/current/safety-grid.md` — hard blockers vs advisory checks.
- `docs/current/desktop-flow.md` — desktop create/refine/review flow.
- `docs/current/render-workflow.md` — stills, draft, full, TTS, artifacts.
- `docs/current/maintenance.md` — cleanup and refactor guardrails.

Provider setup lives in `docs/providers/`. Binding decisions live in `docs/adr/`.
Temporary planning notes live in `docs/working-notes/`.

## Health Checks

Use the Windows-safe commands:

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

`npm.cmd run build` verifies the Remotion webpack bundle. It does not render a
video or download a browser.
