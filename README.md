# MotionReal

[![CI](https://github.com/nguyenvietnhan/news_remotion_tool/actions/workflows/ci.yml/badge.svg)](https://github.com/nguyenvietnhan/news_remotion_tool/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

AI-driven **short-form** video generator on Remotion. Give a Vietnamese or
English prompt (optional URLs and local images); the app plans content, writes
fresh scene modules, speaks narration, and renders a publishable MP4.

**Product path:** TikTok / Reels / Shorts **9:16** only. Create can pick a
short-form duration tier (~45s / ~90s / ~150s / ~210s). No YouTube / landscape format.

## How it works

- **Pure AUTHOR:** for every video the runtime AI writes new Remotion React
  scenes (raw JSX/SVG/CSS). No template catalog, no authored layout-block kit,
  no authored theme tokens.
- **Authored imports only:** `react`, `remotion`, `@motionreal/compositions`
  (including `SceneImage`), and `zod`. Admission rejects everything else.
- **Pipeline owns** captions, TTS, timing lock, safety grid, cache, and render.
  Authored scenes never draw subtitles or call the network/filesystem.
- **Draft before full** by default. Desktop can use stills-only review modes;
  `skip_edit` is the explicit unattended mode and auto-exports full after refine/stills.
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
  → draft MP4 or stills-only preview (Settings review mode)
  → review → full MP4
```

## Requirements

| Need | Notes |
| --- | --- |
| **Node.js** `>= 24`, **npm** `>= 11` | See root `package.json` `engines` |
| **9router** (desktop AI) | External binary on `PATH`. Not vendored in this repo. App expects OpenAI-compatible chat at `http://localhost:20128/v1`. Launcher tries `9router -n -t --skip-update` if nothing is already listening. |
| **DeepSeek Harness** (Video Agent preview) | Use the sibling checkout at pinned commit `466404c927e2209ba7f242038b6922f10c0405cd` (compatibility rechecked: 2026-09-01) and run `pnpm run build` there so `apps/cli/lib/bin.js` exists. Alternatively set `MOTIONREAL_DSH_CLI` to that built file. The app starts it with the Node executable supplied by the dev launcher; `MOTIONREAL_NODE_BIN` can override that executable. Startup validates the `host.describe` protocol shape, while exact revision remains mandatory before deleting persisted Harness history. These checks do not replace native Harness/9router acceptance. |
| **TTS** | VieNeu Local (Vietnamese developer preview), Vivibe (Vietnamese), or ElevenLabs — see [`docs/current/tts-providers.md`](docs/current/tts-providers.md). Missing local runtime/credentials **block** production render; never silently fall back to `mock` / `none`. |
| **Chromium / Remotion browser** | Needed for real video stills/MP4 (`npm run smoke`, desktop/CLI render). **Not** required for `npm run typecheck`, `npm test`, or `npm run build`; build bundles Remotion and the Electron main/preload/renderer but does not encode a video. |

Windows-friendly commands below may use `npm.cmd` under PowerShell execution policy.

## Setup

```bash
npm install
copy .env.example .env
```

Fill `.env` (or configure later in the desktop **Settings** UI):

| Area | Notes |
| --- | --- |
| **TTS** | VieNeu Local (Vietnamese developer preview), Vivibe, or ElevenLabs — see [`docs/current/tts-providers.md`](docs/current/tts-providers.md). |
| **AI planner** | Desktop uses a **local 9router-compatible gateway** for model chat (not an in-repo binary). CLI / env-based OpenAI-compatible vars also appear in `.env.example` for non-desktop tooling. |
| **Storage** | `VIDEO_TOOL_HOME` (default `.video-tool`) holds projects, cache, BGM library under `.video-tool/`. |

Optional machine-only tool config: copy `.mcp.example.json` → `.mcp.json` (gitignored). Do not commit absolute paths.

## First video

### A. Desktop (full product path)

1. Install deps and create `.env` (above).
2. Install **9router** and ensure it is on `PATH`. Start it if needed:
   `9router -n -t --skip-update` (port **20128**).
3. Launch the app:

```bash
npm --prefix apps/desktop run app
```

4. In **Settings**, connect an AI account via the gateway UI and pick a model.
5. Configure voice (Vivibe / ElevenLabs) with a real API key + voice id.
6. On **Home**, enter a prompt (optional URLs/images), create, wait for draft,
   review, then approve full export.

### Queue production

The **Queue** tab stores containers and jobs in `VIDEO_TOOL_HOME/queues.json`.
Jobs and the FIFO Start schedule survive restart. After stale project state is
reconciled, the app resumes scheduled work automatically when Full auto is still
valid. Queue is unattended-only and requires the shared **Full auto** preset:
`reviewMode=skip_edit`, script review off, and crawled-image human review off.
Apply it explicitly from Queue or Settings.

Queue jobs run serially through the same process-wide workflow gate as Home,
manual project actions, and thumbnails. Home create/smoke spills into the
ephemeral `home` queue while another workflow is active. Picked, pasted, or
dropped images are persisted with queued jobs and promoted into the project
when the job starts. An interrupted job keeps its `projectId` and resumes from
existing artifacts instead of creating a duplicate. Any structured TTS provider
failure pauses the whole persisted chain; fix/test the voice in Settings, then
resume the Queue.

### Video Agent preview

The **Video Agent** tab embeds the native DeepSeek Harness chat and tool
timeline. MotionReal starts one shared Harness runtime in the background; click
**Tạo video mới** to make a separate Agent workspace and chat session for that video.
Research and downloaded assets stay in that workspace.
The Agent submits assets and the final brief through the narrow
`motionreal_submit_assets` and `motionreal_submit_brief` tools. MotionReal then
validates each submission and stops for explicit asset and brief review. After
approval, MotionReal creates the normal project and content plan; the owning
Harness Session writes scene TSX, while the shared Workspace engine still owns
stills, review, TTS, and final render. Deleting the video removes its Agent
workspace and removes its exact Harness session data through a recoverable
deletion journal. This remains a developer preview with
broad built-in Harness tool access.
The agreed target workflow and implementation boundary are recorded in
[`docs/current/video-agent-workflow.md`](docs/current/video-agent-workflow.md).

### B. Offline-friendly checks (no paid APIs)

```bash
npm run typecheck
npm test
npm run build
```

Optional real Chromium stills smoke (downloads browser if needed; no TTS):

```bash
npm run smoke
```

Pipeline CLI (no-voice sample draft MP4 — needs Remotion browser; no Vivibe):

```bash
npx tsx packages/pipeline/src/cli/cli.ts render --sample
```

Environment doctor:

```bash
npx tsx packages/pipeline/src/cli/cli.ts doctor
```

## Run the desktop app

```bash
npm --prefix apps/desktop run app
```

That launcher builds Electron main/preload, starts the Vite renderer, tries to
ensure the **external** 9router gateway is up when possible, and opens the UI.
Project data shares the repo `VIDEO_TOOL_HOME` / `.video-tool` tree with
CLI/scripts.

Other useful scripts (repo root unless noted):

| Command | Purpose |
| --- | --- |
| `npm.cmd run typecheck` | Workspace TypeScript check |
| `npm.cmd test` | Vitest suite |
| `npm.cmd run build` | Remotion **webpack bundle only** (no browser download, no video render) |
| `npm.cmd run smoke` | Real stills / determinism smoke (Chromium) |
| `npm.cmd run smoke:vieneu` | VieNeu Local TTS WAV synthesis and duration check |
| `npm.cmd run calibrate:voice -- --provider=vieneu` | Calibrate voice narration rate (words/sec) |
| `npm.cmd run studio` | Remotion Studio (`apps/remotion`) |
| `npm --prefix apps/desktop run smoke:gateway` | Gateway smoke (live 9router) |

## Repository map

| Path | Role |
| --- | --- |
| `apps/desktop` | Electron product: create, persistent Queue, workspace stages, settings, gateway, refine, BGM, diagnostics, export |
| `apps/remotion` | Remotion root / composition entry |
| `packages/pipeline` | Authoring admission, ingest, TTS orchestration, lock, render, safety, store, CLI, tools facade |
| `packages/schema` | Specs, lock model, geometry, captions helpers |
| `packages/compositions` | Registry, master video + thumbnail, authored-facing `SceneImage` |
| `packages/blocks` | Render-runtime internals only — **not** for authored scene imports |
| `packages/theme` | Neutral runtime theme for internals — **not** authored-facing |
| `packages/tts` | Vivibe + ElevenLabs + VieNeu Local clients and audio helpers |
| `docs/current/` | Durable product/architecture docs |
| `docs/third-party.md` | Third-party and bundled-asset attribution |
| `AI_CONTRACT.md` | Canonical rules for AI agents (entry: `AGENTS.md`) |
| `.env.example` | Env template |

Runtime artifacts: `VIDEO_TOOL_HOME/.video-tool/` (projects, renders, cache, BGM).
Do not commit generated project trees or secrets.

## Documentation

| Doc | Use when |
| --- | --- |
| `AI_CONTRACT.md` | Agent/human contract: invariants, safety, workflow |
| `CONTRIBUTING.md` | Setup, checks, PR expectations, sensitive files |
| `SECURITY.md` | Private vulnerability reporting |
| `CODE_OF_CONDUCT.md` | Community standards |
| `docs/current/architecture.md` | Packages, data flow, media protocol, research, recovery |
| `docs/current/authoring-contract.md` | Rules for generated scene modules |
| `docs/current/content-guide.md` | Story, evidence, language, motion guidance |
| `docs/current/maintenance.md` | Refactor guardrails, residual risks, log reading |
| `docs/current/video-agent-workflow.md` | Video Agent lifecycle, Harness handoff, and review gates |
| `docs/current/video-agent-roadmap.md` | Phased delivery and acceptance milestones for Video Agent |
| `docs/current/tts-providers.md` | VieNeu Local, Vivibe, and ElevenLabs TTS setup and protocols |
| `docs/third-party.md` | Fonts, BGM, dependency attribution |

Prefer `docs/current/` over ad-hoc notes. Do not leave long-lived plans under
`docs/working/` — sync outcomes into durable docs, then delete the note.

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

## Support

This project is provided as-is under MIT. Help is **best effort** via GitHub
Issues only — no SLA, no guaranteed response time. Please redact secrets from
logs. Security issues: see [`SECURITY.md`](SECURITY.md).

## License

Copyright (c) 2026 Nguyen Viet Nhan. Released under the [MIT License](LICENSE).

Third-party packages and some bundled assets have their own terms — see
[`docs/third-party.md`](docs/third-party.md).
