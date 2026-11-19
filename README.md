# MotionReal

MotionReal is an Electron and Remotion desktop application for generating 9:16 short-form videos (Vietnamese or English) from a text brief, optional reference URLs, and local images.

Instead of filling a fixed set of visual templates, the app asks a language model to write fresh Remotion React scene modules for each video, validates those modules against a strict import and runtime boundary, locks timing to real TTS audio, runs automated visual and safety checks, and renders a draft before final MP4 export.

## Project status

This repository is under active development. The core single-video pipeline works end to end on `main`, while two larger automation tracks are still in progress and kept clearly separated from the stable path:

| Area | Status | Notes |
| --- | --- | --- |
| Core 9:16 authoring & render pipeline (`packages/*`, `apps/remotion`, `apps/desktop`) | Working on `main` | End-to-end flow: content planning, optional URL extraction and claim checks, isolated TSX scene authoring, admission checks, TTS + timing lock, captions, bounded self-repair, draft preview, and explicit full MP4 export. Includes offline `typecheck`, 120+ Vitest test files, and webpack build checks. |
| Batch queue (`apps/desktop/src/main/queue`, `views/queue.tsx`) | In progress on `main` | Serial container-based queue (`QueueStore`, `QueueRunner`, Home-to-queue spillover) is implemented with unit tests. Unattended end-to-end hardening, restart/retry ergonomics, and preset guardrails are still being refined. |
| AI Video Agent via DeepSeek Harness (`codex/video-agent-harness`) | In progress (feature branch) | Conversational agent workflow embedding a managed DeepSeek Harness runtime with isolated per-video workspaces and narrow handoff tools (`motionreal_submit_assets`, `motionreal_submit_brief`, `motionreal_submit_authoring`). Kept off `main` while runtime lifecycle, session cleanup, and acceptance checks are still stabilizing. |
| Authoring & motion experiments (`skill-test/`) | Experimental | Standalone scratchpad for testing motion-choreography heuristics, caption timing, and Hyperframes/Remotion authoring patterns outside the main desktop runtime. |

## Architecture overview

The core design rule is that authoring, admission, and rendering share a single process and a single `@motionreal/compositions` registry instance. A few deliberate constraints follow from that:

- **Code-generated scenes, strict sandbox boundary:** Every video gets newly authored Remotion TSX modules rather than prebuilt layout blocks. Admission rejects any import outside `react`, `remotion`, `@motionreal/compositions` (including `SceneImage`), and `zod`. Authored scenes never draw subtitles or touch the network/filesystem.
- **Pipeline owns timing, audio, and safety:** Narration (Vivibe or ElevenLabs), word-level timing locks, captions, BGM mixing, caching, and render safety grids live in `packages/pipeline`. Missing TTS credentials fail explicitly rather than falling back to silent or mock audio.
- **Untrusted URL isolation:** When a brief includes reference links (up to 5 URLs), source extraction runs with bounded text budgets and explicit untrusted-source framing during planning. Scene code authoring only sees the approved plan and claims, never raw scraped article dumps.
- **Transactional apply and bounded repair:** Newly generated scenes are staged, checked by admission, backed up, and promoted atomically so cancelling mid-run does not corrupt project state. Validation and layout issues go through a bounded generate-validate-repair loop (`CustomLoopAgentWorker`).
- **Serial execution by design:** Because Remotion's webpack bundle and composition registry live in one process, batch queue execution is strictly serialized (one active render chain at a time) rather than parallelized.

Typical desktop workflow:

```text
brief (prompt / URLs / local images)
  -> content plan (+ URL extraction & claim checks)
  -> scene TSX + manifest generation (admission-gated)
  -> hidden stills + bounded refine / repair loop
  -> draft MP4 or stills-only preview
  -> review -> full 9:16 MP4 export
```

Scope is intentionally limited to vertical 9:16 short-form output (~45s / ~90s / ~150s / ~210s duration tiers). Landscape/YouTube formats and manual timeline editing are out of scope.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `apps/desktop` | Electron desktop app (React 19 + Vite): create flow, workspace stages, settings, local gateway integration, refine loop, BGM, diagnostics, export, and WIP batch queue |
| `apps/remotion` | Remotion root and sample fixtures |
| `packages/pipeline` | Authoring admission, URL ingest, TTS orchestration, timing lock, renderer, safety grid, project store, CLI, and internal tool facade |
| `packages/schema` | Renderer-agnostic specs, lock model, 9:16 geometry, caption helpers |
| `packages/compositions` | Composition registry, master video/thumbnail compositions, and `SceneImage` |
| `packages/blocks` | Internal render-runtime components (not exposed to authored scenes) |
| `packages/theme` | Internal neutral runtime theme (not exposed to authored scenes) |
| `packages/tts` | Vivibe and ElevenLabs TTS clients and audio utilities |
| `docs/current/` | Architecture, authoring contract, content guidelines, and maintenance notes |
| `docs/providers/` | Vivibe and ElevenLabs setup notes |
| `docs/working/` | Temporary design notes for in-progress tracks (batch queue, automation) |
| `skill-test/` | Experimental motion/authoring sandbox (separate from the main app) |

## Requirements

- **Node.js** `>= 24` and **npm** `>= 11` (see root `package.json`).
- **Local AI gateway (`9router`)** for running the full desktop generation flow. Not vendored in this repo; the desktop app expects an OpenAI-compatible endpoint at `http://localhost:20128/v1` and tries to launch `9router -n -t --skip-update` if available on `PATH`.
- **TTS credentials** (Vivibe for Vietnamese and/or ElevenLabs) for real narration. See `docs/providers/`.
- **Chromium / Remotion browser** only when rendering actual stills or MP4s (`npm run smoke`, CLI render, or desktop render). Not required for `typecheck`, `test`, or `build`.

## Verification without API keys

You can run the offline check suite locally without AI or TTS credentials (this is the same suite run in GitHub Actions CI):

```bash
npm install
npm run typecheck   # workspace TypeScript check
npm test            # Vitest suite (renderer is mocked, no browser download)
npm run build       # Remotion webpack bundle check (no video encode)
```

On Windows PowerShell with restricted execution policies, use `npm.cmd` in place of `npm`.

Optional rendering checks (requires Chromium / Remotion browser, no TTS keys):

```bash
npm run smoke                                      # real stills & determinism smoke
npx tsx packages/pipeline/src/cli/cli.ts doctor    # environment check
npx tsx packages/pipeline/src/cli/cli.ts render --sample
```

## Running the desktop app

1. Install dependencies and create a local `.env` file:

```bash
npm install
cp .env.example .env   # Windows: copy .env.example .env
```

2. Add TTS credentials in `.env` (or configure them later in desktop Settings) and make sure `9router` is on `PATH` (port `20128`).
3. Launch the Electron app:

```bash
npm --prefix apps/desktop run app
```

This builds the Electron main/preload bundles, starts the Vite renderer, checks the local `9router` gateway, and opens the UI. Runtime project data, caches, and BGM files live under `VIDEO_TOOL_HOME` (default `.video-tool/`, gitignored).

Other useful scripts:

- `npm run studio` -- launch Remotion Studio (`apps/remotion`)
- `npm --prefix apps/desktop run smoke:gateway` -- live gateway check against `9router`

## Documentation

- [`docs/current/architecture.md`](docs/current/architecture.md) -- workspace boundaries, data flow, and desktop main internals
- [`docs/current/authoring-contract.md`](docs/current/authoring-contract.md) -- contract and admission rules for generated scenes
- [`docs/current/content-guide.md`](docs/current/content-guide.md) -- narration, evidence, and motion guidelines
- [`docs/current/maintenance.md`](docs/current/maintenance.md) -- refactor guardrails and known constraints
- [`AI_CONTRACT.md`](AI_CONTRACT.md) -- canonical invariants for contributors and coding agents (entry point: [`AGENTS.md`](AGENTS.md))
- [`CONTRIBUTING.md`](CONTRIBUTING.md) -- local workflow, checks, and PR guidelines
- [`SECURITY.md`](SECURITY.md) -- reporting security issues
- [`docs/third-party.md`](docs/third-party.md) -- third-party and bundled asset attribution

## License

Copyright (c) 2026 Nguyen Viet Nhan. Released under the [MIT License](LICENSE).
