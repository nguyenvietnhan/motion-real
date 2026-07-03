# Temporary Task - Deferred Repo Cleanup Plan

Status: MCP cleanup and workspace namespace cleanup completed; style
compatibility cleanup still pending.

This is a temporary working note for the remaining repo-noise items that were
intentionally deferred after the repo hygiene cleanup. It is not project
contract. Current contract remains `AI_CONTRACT.md` plus `docs/current/`.

Delete this file only after the deferred cleanup slices below are complete,
current docs are synced, checks pass, and the owner approves cleanup of this
temporary note.

## Resume Instructions For A Fresh Agent

Start here if this is a new session with no chat history:

1. Read `AI_CONTRACT.md`.
2. Read `docs/current/maintenance.md` and `docs/current/architecture.md`.
3. Read this file.
4. Run:

```bash
git status --short
rg -n "packages/mcp|mcpServers|server-filesystem|stylePackId|clean-luxury-tech|stylePack|deleted design-registry|legacy package namespace" .mcp.example.json package.json package-lock.json tsconfig.json vitest.config.ts apps packages docs/current README.md AI_CONTRACT.md
```

Do not start implementation until the dirty worktree and current references are
understood.

## Per-Task Workflow

Before each main cleanup task:

1. Run `git status --short`.
2. Re-audit the task's current source/noise references with `rg`.
3. Read the directly touched code/docs before editing.
4. Confirm the task can stay inside the intended slice and guardrails.

After each main cleanup task:

1. Re-run the same status/noise audit to catch stale references and accidental
   scope creep.
2. Run the targeted checks listed for that task, then broader checks when the
   slice requires them.
3. Review `git diff --stat` and the relevant diff before committing.
4. Commit the slice separately.
5. Report what changed, what checks ran, any residual risk, and the next
   recommended task before starting the next source slice.

## Completed Cleanup Slices

The repo-noise cleanup was committed in small slices:

- `d244d2f` `docs: consolidate ai agent entrypoints`
- `ad5e3b0` `refactor: use virtual built-in default bgm`
- `728d247` `refactor(desktop): canonicalize brand assets`
- `5a73158` `chore(desktop): move renderer audit fixtures`
- `cabbbe7` `fix(desktop): allow bundled bgm media previews`
- `d6030ca` `chore: move script templates under templates`
- `d06830a` `chore: remove empty workspace settings`
- `c54594f` `docs: sync repo cleanup notes`
- `2ba8af7` `chore: remove repo noise cleanup note`

Deferred cleanup then proceeded in separate slices:

- `06d9291` `refactor: move internal tool facade out of mcp package`
- `178f51f` `chore: de-scope legacy mcp stdio server`
- `74c3c1a` `chore: make mcp config local-only`
- `8865509` `docs: update namespace cleanup plan`
- `0995acf` `refactor: rename workspace namespace to motionreal`

The last full verification before this note reported:

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

The full test lane reported 92 files / 887 tests plus the heavy lane with 1 file
/ 13 tests.

## Completed Surface 1 - MCP Config And Legacy MCP Package

MCP cleanup is complete.

Completed outcomes:

- the internal `createTools` facade is pipeline-owned;
- product code imports `createTools` and `ToolDeps` from `@motionreal/pipeline`;
- the legacy MCP stdio package has been deleted;
- the legacy stdio server entry has been removed from tracked config;
- MCP SDK and package-lock references for that removed package are gone;
- CLI doctor/remediation text no longer references the removed MCP wiring;
- `.mcp.json` is ignored local-only config;
- `.mcp.example.json` is the tracked template and has no filesystem server or
  absolute machine path.

Guardrail:

- do not reintroduce a product dependency on the removed MCP stdio package or a
  package-local owner for the internal tool facade.

## Completed Surface 2 - Workspace Namespace

The owner decision is complete:

- the old workspace package namespace is not acceptable as the current
  namespace;
- do not keep compatibility aliases for old authored scenes/projects;
- old generated projects/scenes are not a preservation requirement for this
  cleanup;
- `@motionreal/*` is the only current scoped workspace namespace.

NS-1 migrated active source/config/package metadata to `@motionreal/*`.

Completed outcomes:

- root package metadata now uses `motionreal`;
- workspace packages and dependencies now use `@motionreal/*`;
- TypeScript, Vitest, Electron, Remotion, renderer, and authored-typecheck path
  aliases now resolve `@motionreal/*`;
- source imports, comments describing active architecture, tests, and authored
  fixtures now use `@motionreal/*`;
- authored-scene admission and prompt/contract guidance now whitelist
  `@motionreal/compositions`;
- the authored import normalizer no longer rescues old-namespace imports and
  only re-homes current-namespace `SceneImage` mistakes from
  `@motionreal/blocks` / `@motionreal/theme` to `@motionreal/compositions`;
- local `node_modules` workspace links were refreshed so stale workspace
  symlinks do not hide unresolved imports.

NS-2 completed the final namespace text sweep. It removed old namespace literals
from current docs, ADRs, comments, user-facing guidance, and this working note.
It did not change style compatibility behavior.

Post-NS-2 state:

- no old workspace namespace literals remain in source, current docs, ADRs, or
  working notes;
- product-facing instructions continue to use only `@motionreal/*`;
- style compatibility behavior remains a separate cleanup surface.

## Deferred Surface 3 - Style Compatibility

The remaining cleanup surface is style compatibility, not package namespace.

Current evidence from the latest scans includes:

- `packages/schema/src/index.ts`
  - schema still accepts `stylePackId`;
  - schema has `styleId: "clean-luxury-tech"`.
- `packages/theme/src/theme.ts`
  - `stylePackId` is accepted/ignored by neutral theme compatibility shims.
- `packages/compositions/src/video.tsx`
  - passes `spec.theme?.stylePackId` into `makeTheme(...)`.
- `packages/pipeline/src/authoring/manifest.ts`
  - writes compatibility defaults.
- `packages/pipeline/src/types.ts`
  - still has style fields/types.
- `packages/pipeline/src/orchestrator.ts`
  - writes the current `styleId: "clean-luxury-tech"` default.
- tests across schema/theme/pipeline/render/cache still use
  `clean-luxury-tech`.
- `apps/desktop/src/main/workspace/workspace-controller.ts`
  - has a compatibility comment mentioning `stylePackId`.
- `apps/desktop/src/main/agent/agent-worker.ts`
  - notes the old `stylePackId` is gone from worker inputs.

These strings are tied to stored manifest compatibility and render defaults.
Removing them without a focused style slice can break tests or current render
defaults.

Sensitive behavior areas:

- `packages/pipeline/src/orchestrator.ts`;
- `packages/pipeline/src/safety/render-grid.ts`;
- `apps/desktop/src/main/workspace/workspace-controller.ts`.

`render-grid.ts` may not show a direct legacy-string match, but its tests cover
render/layout behavior that can regress if style/theme defaults change. Those
files must not be casually edited as part of cleanup.

### Proposed Style Compatibility Plan

Step STYLE-0: classify every match.

```bash
git status --short
rg -n "stylePackId|clean-luxury-tech|stylePack|deleted design-registry|design registry" packages apps docs/current README.md
```

Classify as:

- stored-project compatibility that must remain;
- write-time default that can be stopped;
- docs/comment noise that can be updated safely;
- test fixture that needs replacement only after behavior changes.

Separately classify sensitive downstream behavior that may not show a direct
legacy-string match, especially render-grid/orchestrator/workspace behavior.

Step STYLE-1: remove docs/comment noise only.

Do not touch schema/orchestrator/render-grid/workspace behavior in this first
slice.

Required checks:

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Step STYLE-2: stop writing legacy style fields only if compatible readers stay.

Likely touched areas:

- manifest creation/defaulting;
- theme compatibility;
- schema read compatibility;
- tests for stored projects.

Required targeted checks:

```bash
npm.cmd test -- packages/schema/src/schema.test.ts
npm.cmd test -- packages/theme/src/theme.test.ts
npm.cmd test -- packages/pipeline/src/authoring/manifest.test.ts
npm.cmd test -- packages/pipeline/src/audio/lock.test.ts
npm.cmd test -- packages/pipeline/src/orchestrator.test.ts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Step STYLE-3: remove compatibility fields only after there is an explicit stored
project migration or the owner accepts breaking old project manifests.

Before this step can start, define the compatibility story explicitly:

- a reader/coercion path that still accepts old manifests, or a one-time stored
  project migration with tests and rollback notes;
- fixtures for old manifests containing `stylePackId` / `clean-luxury-tech`;
- updated docs explaining whether old projects remain supported.

Required targeted checks:

```bash
npm.cmd test -- packages/schema/src/schema.test.ts
npm.cmd test -- packages/theme/src/theme.test.ts
npm.cmd test -- packages/pipeline/src/authoring/manifest.test.ts
npm.cmd test -- packages/pipeline/src/safety/static-grid.test.ts
npm.cmd test -- packages/pipeline/src/safety/render-grid.test.ts
npm.cmd test -- packages/pipeline/src/orchestrator.test.ts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

## Out Of Scope Note - Runtime Cache Duplication Policy

The prior cleanup found that `.video-tool/cache/tts/*.wav` may duplicate project
scene audio by hash. This is expected runtime cache behavior, not source-file
trash.

This is intentionally not a deferred source-cleanup surface and does not need a
step-by-step plan in this note.

Do not delete `.video-tool/projects`, successful renders, project manifests, or
runtime cache as part of source cleanup unless the owner explicitly asks for a
runtime cleanup command.

Possible future feature:

- add a user-invoked cache cleanup action;
- add age/size pruning for `.video-tool/cache`;
- keep project-owned audio/renders intact.

This belongs to a product/runtime maintenance task, not repo-source cleanup.

## Guardrails

- Do not delete `.env`.
- Do not delete `.video-tool/projects`, successful renders, project manifests,
  or user project state.
- Do not reintroduce a product dependency on the removed MCP stdio package or a
  package-local owner for the internal tool facade.
- Do not rename packages outside a dedicated namespace slice.
- Do not remove `stylePackId` or `clean-luxury-tech` compatibility in the same
  slice as namespace or MCP cleanup.
- Do not touch `packages/pipeline/src/orchestrator.ts`,
  `packages/pipeline/src/safety/render-grid.ts`, or desktop workspace flow
  unless the slice explicitly requires it, names the risk, and has targeted
  tests.
- This conditional wording is intentional for this broader cleanup note. Narrow
  desktop-main notes may forbid touching those files entirely because they have
  no valid reason to edit them; this note only allows a future style-compat
  slice to open them with explicit owner approval and targeted tests.
- Commit each source/docs slice separately.
- Before every commit:

```bash
git status --short
git diff --stat
```

## Recommended Next Step

Start with STYLE-0: classify style compatibility references.

Reason:

- MCP cleanup is complete;
- workspace namespace cleanup is complete;
- the remaining deferred cleanup surface is style compatibility;
- style cleanup must start with classification before touching schema,
  orchestrator, render-grid, or desktop workspace behavior.
