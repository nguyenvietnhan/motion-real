# Contributing to MotionReal

Thanks for helping improve MotionReal. This guide is for humans and tools that
change code in this monorepo.

## Prerequisites

- **Node.js** `>= 24` and **npm** `>= 11` (see root `package.json` `engines`)
- Windows, macOS, or Linux. Primary development has historically been Windows;
  CI runs on Ubuntu (`typecheck` / `test` / webpack `build` only).
- For the **desktop AI path**: a **9router** (or compatible) binary on `PATH`,
  listening on `http://localhost:20128`. The app does **not** vendor 9router.
- For real narration: Vivibe and/or ElevenLabs credentials (see
  `docs/providers/`). Production paths must not silently fall back to `mock` /
  `none`.

## Setup

```bash
npm install
cp .env.example .env   # Windows: copy .env.example .env
```

Fill `.env` as needed. Runtime project data lives under
`VIDEO_TOOL_HOME` (default `.video-tool/`) and is gitignored.

Optional local MCP config: copy `.mcp.example.json` → `.mcp.json` (gitignored).

## Required checks

Before opening a PR that touches pipeline, blocks, compositions, or desktop
authoring, run from the repo root:

```bash
npm run typecheck
npm test
npm run build
```

On Windows PowerShell, `npm.cmd run …` is fine if `npm` is constrained by
execution policy.

- `typecheck` — workspace TypeScript
- `test` — Vitest (render tests mock `@remotion/renderer`; no Chromium download)
- `build` — Remotion **webpack bundle only** (no video encode)

Optional:

```bash
npm run smoke                    # real Chromium stills smoke (manual)
npm --prefix apps/desktop run app
npm --prefix apps/desktop run smoke:gateway
```

## Product rules (do not break)

Read `AI_CONTRACT.md` first. Highlights:

- **Pure AUTHOR only** — AI writes fresh Remotion scene modules; no template
  catalog or authored layout-block toolkit.
- Authored scenes may import only `react`, `remotion`, `zod`, and
  `@motionreal/compositions` (including `SceneImage`).
- Do not reintroduce authored-facing theme tokens or layout blocks (`Frame`,
  `Story`, `TitleBlock`, …).
- Never invent facts/numbers/sources; never silent-fallback TTS provider/voice.
- Draft-before-full by default unless the caller passes `forceFull`.

Durable design docs: `docs/current/`.

## Sensitive areas

Treat these as high-risk. Prefer small, tested changes with a clear behavior
boundary:

- `packages/pipeline/src/orchestrator.ts`
- `packages/pipeline/src/safety/render-grid.ts`
- `packages/pipeline/src/render/renderer.ts`
- `apps/desktop/src/main/workspace/workspace-controller.ts`
- `apps/desktop/src/main/authoring/ninerouter-backend.ts`
- `apps/desktop/src/main/index.ts` (Electron composition root)

Do not split large orchestration files for line count alone (see
`docs/current/maintenance.md`).

Repeated AI-output bugs should become schema checks, normalizers, admission
rules, or render oracles with regression tests — not only prompt text.

## Pull requests

- Keep the diff scoped to one problem.
- Do not commit secrets, `.env`, or generated project trees under `.video-tool/`.
- Do not delete successful renders, user project state, or caches unless the
  issue explicitly asks for it.
- Match existing TypeScript style; avoid drive-by refactors.
- Update `docs/current/` when behavior contracts change.
- Fill the PR template checklist.

## Repository name

The product is **MotionReal** (`nguyenvietnhan/motion-real`). Prefer linking
issues/PRs against the remote URL in the root `package.json` `repository` field.

## License

By contributing, you agree that your contributions are licensed under the MIT
License (root `LICENSE`).
