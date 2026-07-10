# MotionReal

AI-driven **short-form** video generator on Remotion. Give a Vietnamese or
English prompt (optional URLs and local images); the app plans content, writes
fresh scene modules, speaks narration, and renders a publishable MP4.

**Product path:** TikTok / Reels / Shorts **9:16** only (default pacing ~45s).
No YouTube / landscape format or duration picker.

## How it works

- **Pure AUTHOR:** for every video the runtime AI writes new Remotion React
  scenes (raw JSX/SVG/CSS). No template catalog, no authored layout-block kit,
  no authored theme tokens.
- **Authored imports only:** `react`, `remotion`, `@motionreal/compositions`
  (including `SceneImage`), and `zod`. Admission rejects everything else.
- **Pipeline owns** captions, TTS, timing lock, safety grid, cache, and render.
  Authored scenes never draw subtitles or call the network/filesystem.
- **Draft before full**, every time. Full export is an explicit approval step.
- **URL-grounded create** (desktop): up to 5 links, concurrent extract, bounded
  text budgets. Planner sees labeled untrusted sources; code authoring only
  sees the approved plan/claims (no raw article paste into TSX prompts).
- **Fresh author apply** is transactional (stage → admit staged files → backup →
  promote). Cancel mid-create is not treated as a hard project failure.

Typical desktop path:

```text
Create (prompt / URLs / images)
  → content plan (+ optional claim repair / demote-soften on URL runs)
  → author TSX + manifest
  → hidden stills / refine (desktop)
  → draft MP4 → review → full MP4
```

## Requirements

- **Node.js** `>= 24` and **npm** `>= 11` (see root `package.json` `engines`)
- Windows-friendly commands below use `npm.cmd` (PowerShell execution policy)

## Setup

```bash
npm install
copy .env.example .env
```

Fill `.env` (or configure later in the desktop **Settings** UI):

| Area | Notes |
| --- | --- |
| **TTS** | Vivibe (Vietnamese) or ElevenLabs — see `docs/providers/`. Missing credentials must **block** render; never silent fall back to `mock` / `none`. |
| **AI planner** | OpenAI-compatible API (desktop also uses a local 9router-style gateway for model chat). |
| **Storage** | `VIDEO_TOOL_HOME` (default `.video-tool`) holds projects, cache, BGM library under `.video-tool/`. |

Optional machine-only tool config: copy `.mcp.example.json` → `.mcp.json` (gitignored). Do not commit absolute paths.

## Run the desktop app

```bash
npm --prefix apps/desktop run app
```

That launcher builds Electron main/preload, starts the Vite renderer, ensures
the model gateway is up when possible, and opens the UI. Project data shares the
repo `VIDEO_TOOL_HOME` / `.video-tool` tree with CLI/scripts.

Other useful scripts (repo root unless noted):

| Command | Purpose |
| --- | --- |
| `npm.cmd run typecheck` | Workspace TypeScript check |
| `npm.cmd test` | Vitest suite |
| `npm.cmd run build` | Remotion **webpack bundle only** (no browser download, no video render) |
| `npm.cmd run smoke` | Smoke script |
| `npm.cmd run studio` | Remotion Studio (`apps/remotion`) |
| `npm --prefix apps/desktop run smoke:gateway` | Gateway smoke |

## Repository map

| Path | Role |
| --- | --- |
| `apps/desktop` | Electron product: create, workspace stages, settings, gateway, refine, BGM, diagnostics, export |
| `apps/remotion` | Remotion root / composition entry |
| `packages/pipeline` | Authoring admission, ingest, TTS orchestration, lock, render, safety, store, CLI, tools facade |
| `packages/schema` | Specs, lock model, geometry, captions helpers |
| `packages/compositions` | Registry, master video + thumbnail, authored-facing `SceneImage` |
| `packages/blocks` | Render-runtime internals only — **not** for authored scene imports |
| `packages/theme` | Neutral runtime theme for internals — **not** authored-facing |
| `packages/tts` | Vivibe + ElevenLabs clients and audio helpers |
| `docs/current/` | Durable product/architecture docs |
| `docs/providers/` | TTS provider setup |
| `AI_CONTRACT.md` | Canonical rules for AI agents (entry: `AGENTS.md`) |
| `.env.example` | Env template |

Runtime artifacts: `VIDEO_TOOL_HOME/.video-tool/` (projects, renders, cache, BGM).
Do not commit generated project trees or secrets.

## Documentation

| Doc | Use when |
| --- | --- |
| `AI_CONTRACT.md` | Agent/human contract: invariants, safety, workflow |
| `docs/current/architecture.md` | Packages, data flow, media protocol, research, recovery |
| `docs/current/authoring-contract.md` | Rules for generated scene modules |
| `docs/current/content-guide.md` | Story, evidence, language, motion guidance |
| `docs/current/maintenance.md` | Refactor guardrails, residual risks, log reading |
| `docs/providers/vivibe.md` / `elevenlabs.md` | TTS credentials and API notes |

Prefer `docs/current/` over ad-hoc notes. Do not leave long-lived plans under
`docs/working-notes/` — sync outcomes into durable docs, then delete the note.

## Development notes

- Sensitive areas: `packages/pipeline` orchestrator / render-grid, desktop
  workspace controller — change only with focused tests and clear scope.
- Authored-scene bugs that repeat should become schema, normalizer, admission,
  or render-oracle checks — not only prompt text.
- Layout/visual taste checks stay **advisory** unless live code marks a hard
  integrity failure.
- After authoring or provider-facing changes, run:

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```
