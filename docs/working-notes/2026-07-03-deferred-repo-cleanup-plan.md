# Temporary Task - Deferred Repo Cleanup Plan

Status: planning note created; no deferred cleanup source migration started yet.

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
rg -n "V:/video_tool|@news/mcp|packages/mcp|createTools|ToolDeps|stylePackId|clean-luxury-tech|@news/design|@news/" .mcp.json package.json package-lock.json tsconfig.json vitest.config.ts apps packages docs/current README.md
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

## Session Summary Before This Note

The prior repo-noise cleanup completed and was committed in small slices:

- `d244d2f` `docs: consolidate ai agent entrypoints`
  - Removed tracked Claude-specific entrypoints.
  - `AI_CONTRACT.md` is canonical; `AGENTS.md` is only a thin pointer.
- `ad5e3b0` `refactor: use virtual built-in default bgm`
  - Moved bundled default BGM to `apps/desktop/assets/bgm/default.mp3`.
  - Default BGM is virtual/built-in and resolves directly to that source asset.
  - It is not copied into `.video-tool/bgm`.
- `728d247` `refactor(desktop): canonicalize brand assets`
  - Canonical logo is `apps/desktop/assets/brand/logo.png`.
  - Duplicate main/renderer logo files were removed.
- `5a73158` `chore(desktop): move renderer audit fixtures`
  - Renderer audit-only files moved to `apps/desktop/src/renderer/dev-audit/`.
- `cabbbe7` `fix(desktop): allow bundled bgm media previews`
  - Fixed BGM preview for bundled default media through the media allow-list.
- `d6030ca` `chore: move script templates under templates`
  - Script template moved to `scripts/templates/video-template.txt`.
- `d06830a` `chore: remove empty workspace settings`
  - Removed empty tracked `.vscode/settings.json`.
- `c54594f` `docs: sync repo cleanup notes`
  - Current docs now name `.mcp.json` machine-specific MCP wiring as deferred
    legacy compatibility.
- `2ba8af7` `chore: remove repo noise cleanup note`
  - Deleted the completed temporary repo-noise cleanup note.

Final checks from that cleanup passed:

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

The final full test lane reported 92 files / 889 tests plus the heavy lane with
1 file / 13 tests. The worktree was clean after commit `2ba8af7`.

## Why Deferred Items Remain

The remaining matches are not small loose files. They are compatibility or
migration surfaces that can break product behavior, saved projects, authored
scene admission, package resolution, or assistant/tool workflows if removed in
one sweep.

Current docs already record this policy:

- `docs/current/maintenance.md` says the external MCP stdio entrypoint is
  product-optional, but `packages/mcp` must not be deleted while product code
  still imports `createTools` or MCP-owned types through `@news/mcp`.
- `docs/current/maintenance.md` also says `.mcp.json` may still contain local
  machine-specific wiring until the MCP de-scope work is approved.
- `docs/current/maintenance.md` lists `stylePackId`, `clean-luxury-tech`, and
  `@news/design` as legacy terms that may appear only for compatibility or ADR
  history.

## Deferred Surface 1 - MCP Config And `@news/mcp`

### Current Evidence

Known files from the latest scan:

- `.mcp.json`
  - contains the `news` MCP server command:
    `packages/mcp/src/bin.ts`;
  - contains a machine-specific filesystem path:
    `V:/video_tool`.
- `packages/mcp/src/bin.ts`
  - stdio entrypoint.
- `packages/mcp/src/server.ts`
  - MCP server construction.
- `packages/mcp/src/tools.ts`
  - internal tool facade currently used by desktop/product code.
- `packages/mcp/src/tools.test.ts`
  - direct tests for the tool facade; should move with the facade in MCP-1.
- `packages/mcp/src/index.ts`, `packages/mcp/package.json`
  - package surface and dependency metadata.
- `apps/desktop/src/main/index.ts`
  - imports `createTools` from `@news/mcp`.
- `apps/desktop/src/main/authoring/ninerouter-backend.ts`
  - imports the `createTools` type from `@news/mcp`.
- `apps/desktop/src/main/preserved-invariants.test.ts`
  - imports `createTools` and `ToolDeps` from `@news/mcp`.
- `apps/desktop/build-electron.mjs`
  - aliases `@news/mcp` to `packages/mcp/src/tools.ts`.
- `apps/desktop/package.json`
  - depends on `@news/mcp`.
- `tsconfig.json`, `vitest.config.ts`, `package-lock.json`
  - contain workspace/alias/dependency references.
- `packages/pipeline/src/cli/cli.ts`
  - has MCP doctor/remediation text.
- `README.md`, `docs/current/architecture.md`, `docs/current/maintenance.md`
  - document the current/deferred state.

### Why It Was Not Removed

`packages/mcp` is not only an external server. Its `tools.ts` facade is still
used in-process by the desktop app and tests. Deleting MCP first would break
desktop create/scaffold flows, authoring backend typing, build aliases, and
tests.

The confusing boundary is ownership and naming: the internal tool facade likely
belongs outside `packages/mcp`, while the stdio MCP server can become optional
or removable after product code no longer imports it.

### Proposed MCP De-Scope Plan

Step MCP-0: baseline and inventory.

```bash
git status --short
rg -n "createTools|ToolDeps|@news/mcp|packages/mcp|mcpServers|V:/video_tool" .mcp.json package.json package-lock.json tsconfig.json vitest.config.ts apps packages docs/current README.md
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Step MCP-1: move the internal tool facade to a neutral owner.

Preferred starting hypothesis:

- move `packages/mcp/src/tools.ts` to a neutral pipeline-owned module, for
  example `packages/pipeline/src/tools/create-tools.ts`, if the audit confirms
  it is pipeline-domain logic and does not create cycles.
- move or re-home `ToolDeps` with it.
- keep `packages/mcp` as a thin stdio adapter importing the moved facade.

Update product imports and adapter wiring:

- new neutral source/test owner, for example
  `packages/pipeline/src/tools/create-tools.ts` and
  `packages/pipeline/src/tools/create-tools.test.ts`;
- `packages/mcp/src/server.ts`;
- `packages/mcp/src/index.ts`;
- `packages/mcp/package.json` if dependency metadata changes;
- `apps/desktop/src/main/index.ts`;
- `apps/desktop/src/main/authoring/ninerouter-backend.ts`;
- `apps/desktop/src/main/preserved-invariants.test.ts`;
- `apps/desktop/build-electron.mjs`;
- `apps/desktop/package.json`;
- `tsconfig.json`;
- `vitest.config.ts`;
- root `package.json` / `package-lock.json` if workspace dependencies change.

Required checks:

```bash
npm.cmd run typecheck
npm.cmd test -- packages/pipeline/src/tools/create-tools.test.ts
npm.cmd test -- apps/desktop/src/main/preserved-invariants.test.ts
npm.cmd test
npm.cmd run build
```

Commit suggestion:

```text
refactor: move internal tool facade out of mcp package
```

Step MCP-2: remove or shrink the external MCP stdio surface only after no
product code imports `@news/mcp`.

Possible changes, subject to audit:

- delete or archive `packages/mcp/src/bin.ts` and `packages/mcp/src/server.ts`;
- remove the `news` entry from `.mcp.json`;
- remove MCP SDK dependency if nothing else imports it;
- update CLI doctor/remediation text in `packages/pipeline/src/cli/cli.ts`;
- update docs.

Required checks:

```bash
rg -n "@news/mcp|packages/mcp|mcpServers|V:/video_tool" .mcp.json package.json package-lock.json tsconfig.json vitest.config.ts apps packages docs/current README.md
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Commit suggestion:

```text
chore: de-scope legacy mcp stdio server
```

Step MCP-3: decide tracked `.mcp.json` policy.

Do not leave the stale `V:/video_tool` path as if it were a canonical path.
Choose one owner-approved policy:

- remove the filesystem MCP server from tracked config;
- replace tracked config with a documented template;
- or keep a local-only config out of source control.

Do not silently replace it with another machine-specific absolute path.

## Deferred Surface 2 - `@news/*` Package Namespace

### Current Evidence

The product is now MotionReal, but workspace packages, imports, authored scene
contracts, tests, and scripts still use `@news/*`.

Examples:

- root `package.json` scripts use `@news/remotion`;
- packages are named `@news/schema`, `@news/pipeline`, `@news/compositions`,
  `@news/blocks`, `@news/theme`, `@news/tts`, `@news/mcp`;
- authored scene import whitelist allows `@news/compositions`;
- prompts and current docs tell authored scenes to import `@news/compositions`;
- saved/generated authored scenes may already contain `@news/compositions`;
- `tsconfig.json`, `vitest.config.ts`, Remotion config, Electron build config,
  tests, and source imports all depend on these aliases.

### Why It Was Not Renamed

This is a broad compatibility migration, not a simple cleanup. Renaming package
namespace can break:

- old authored scenes stored in projects;
- the import admission whitelist;
- generated prompt instructions;
- TS/Vitest/webpack aliases;
- package lockfile and workspace scripts;
- Remotion/Electron bundling.

### Proposed Namespace Plan

Step NS-0: decide whether internal `@news/*` is acceptable compatibility or must
be changed for product clarity.

If changing:

1. Add `@motionreal/*` aliases first while keeping `@news/*` compatibility.
2. Update docs/prompts only after both aliases work.
3. Update generated authored import guidance carefully.
4. Keep admission compatibility for old `@news/compositions` scenes unless a
   stored-project migration exists.
5. Only later consider package name changes and lockfile churn.

Required checks for any namespace slice:

```bash
npm.cmd run typecheck
npm.cmd test -- packages/pipeline/src/authoring/admission.test.ts
npm.cmd test -- packages/pipeline/src/safety/typecheck-authored.test.ts
npm.cmd test -- apps/desktop/src/main/authoring/contract-text.test.ts
npm.cmd test
npm.cmd run build
```

Do not combine namespace migration with MCP or style cleanup.

## Deferred Surface 3 - `stylePackId`, `clean-luxury-tech`, `@news/design`

### Current Evidence

Known files from the latest scan include:

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
- `apps/desktop/src/shared/types.ts`
  - contains an old `@news/design` comment.

### Why It Was Not Removed

These strings are tied to stored manifest compatibility and render defaults.
Removing them without migration may break old projects or tests that assert the
current compatibility behavior.

Also, some direct matches or downstream behavior dependencies touch sensitive
areas:

- `packages/pipeline/src/orchestrator.ts`;
- `packages/pipeline/src/safety/render-grid.ts`;
- `apps/desktop/src/main/workspace/workspace-controller.ts`.

The latest scan shows a direct legacy default in `orchestrator.ts` and a
compatibility comment in `workspace-controller.ts`. `render-grid.ts` is listed
as downstream-sensitive rather than as a direct legacy-string match: its tests
cover render/layout behavior that can regress if style/theme defaults change.
Those files must not be casually edited as part of cleanup.

### Proposed Style Compatibility Plan

Step STYLE-0: classify every match.

```bash
rg -n "stylePackId|clean-luxury-tech|@news/design|stylePack" packages apps docs/current README.md
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
- Do not remove `packages/mcp` until product code no longer imports `createTools`
  or MCP-owned types through `@news/mcp`.
- Do not rename `@news/*` packages in the same slice as MCP de-scope.
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

Start with MCP-0 and MCP-1.

Reason:

- `.mcp.json` contains the most visibly stale path (`V:/video_tool`);
- MCP-1 is the first prerequisite because product code must stop importing the
  internal `createTools` facade through `@news/mcp` before the MCP package can
  become only an external adapter;
- MCP-2 and MCP-3, not MCP-1 alone, are the steps that decide whether the
  external stdio server remains and how the tracked `.mcp.json` path should be
  removed or templated.

Do not start package namespace or style compatibility cleanup until MCP ownership
is clarified.
