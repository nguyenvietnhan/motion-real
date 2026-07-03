# Temporary Task - Deferred Repo Cleanup Plan

Status: MCP cleanup completed; `@news/*` namespace removal decision made;
namespace source migration and style compatibility cleanup still pending.

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
rg -n "@news/|news-remotion-tool|Vietnamese short-form news|packages/mcp|mcpServers|server-filesystem|stylePackId|clean-luxury-tech|@news/design" .mcp.example.json package.json package-lock.json tsconfig.json vitest.config.ts apps packages docs/current README.md AI_CONTRACT.md
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

The remaining matches are not small loose files. They are migration surfaces
that can break product behavior, authored scene admission, package resolution,
or assistant/tool workflows if removed in one sweep. The namespace decision is
now explicit: `@news/*` is not kept for compatibility. The caution is about
engineering blast radius, not preserving old generated projects.

Current docs already record this policy:

- `docs/current/maintenance.md` says `createTools` is pipeline-owned and the
  external `@news/mcp` stdio package has been removed.
- `docs/current/maintenance.md` also says `.mcp.json` is local-only and ignored,
  while `.mcp.example.json` is the tracked template without absolute machine
  paths.
- `docs/current/maintenance.md` lists `stylePackId`, `clean-luxury-tech`, and
  `@news/design` as legacy terms that may appear only for compatibility or ADR
  history.

## Deferred Surface 1 - MCP Config And `@news/mcp`

### Current Evidence

Known files from the latest scan:

- `.mcp.json`
  - local-only and ignored after MCP-3.
- `.mcp.example.json`
  - tracked template for optional local MCP/dev-tool config;
  - does not contain a filesystem server or absolute machine path.
- `packages/mcp/src/bin.ts`
  - deleted in MCP-2.
- `packages/mcp/src/server.ts`
  - deleted in MCP-2.
- `packages/mcp/src/tools.ts`
  - moved to `packages/pipeline/src/tools/create-tools.ts` in MCP-1.
- `packages/mcp/src/tools.test.ts`
  - moved to `packages/pipeline/src/tools/create-tools.test.ts` in MCP-1.
- `packages/mcp/src/types.ts`
  - moved to `packages/pipeline/src/tools/tool-result.ts` in MCP-1.
- `packages/mcp/src/index.ts`, `packages/mcp/package.json`
  - deleted in MCP-2.
- `apps/desktop/src/main/index.ts`
  - now imports `createTools` from `@news/pipeline`.
- `apps/desktop/src/main/authoring/ninerouter-backend.ts`
  - now imports the `createTools` type from `@news/pipeline`.
- `apps/desktop/src/main/preserved-invariants.test.ts`
  - now imports `createTools` and `ToolDeps` from `@news/pipeline`.
- `apps/desktop/build-electron.mjs`
  - no longer aliases `@news/mcp` into the desktop bundle.
- `apps/desktop/package.json`
  - no longer depends on `@news/mcp`.
- `tsconfig.json`, `vitest.config.ts`, `package-lock.json`
  - no longer contain `@news/mcp` aliases or desktop dependency metadata;
    package-lock no longer contains the `@news/mcp` workspace package.
- `packages/pipeline/src/cli/cli.ts`
  - no longer has the legacy `mcp` command or MCP-wiring doctor check.
- `README.md`, `docs/current/architecture.md`, `docs/current/maintenance.md`
  - document the current/deferred state.

### Why It Was Not Removed

`packages/mcp` used to own an internal `tools.ts` facade used in-process by the
desktop app and tests. MCP-1 moved that facade to `@news/pipeline`; MCP-2 then
removed the remaining stdio package and `news` entry from `.mcp.json`.

MCP ownership is now clarified: product code uses the pipeline-owned
`createTools` facade, the legacy stdio package is removed, and `.mcp.json` is
local-only.

### Proposed MCP De-Scope Plan

Step MCP-0: baseline and inventory. Completed.

```bash
git status --short
rg -n "createTools|ToolDeps|@news/mcp|packages/mcp|mcpServers|server-filesystem" .mcp.example.json package.json package-lock.json tsconfig.json vitest.config.ts apps packages docs/current README.md
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Step MCP-1: move the internal tool facade to a neutral owner. Completed in
commit `06d9291`.

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
product code imports `@news/mcp`. Completed.

Completed changes:

- deleted `packages/mcp`;
- removed the `news` entry from `.mcp.json`;
- removed MCP SDK/package-lock references;
- removed the CLI `mcp` command and MCP-wiring doctor check;
- updated docs.

Required checks:

```bash
rg -n "@news/mcp|packages/mcp|mcpServers|server-filesystem" .mcp.example.json package.json package-lock.json tsconfig.json vitest.config.ts apps packages docs/current README.md
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Commit suggestion:

```text
chore: de-scope legacy mcp stdio server
```

Step MCP-3: decide tracked `.mcp.json` policy. Completed.

Chosen policy:

- `.mcp.json` is ignored local-only config;
- `.mcp.example.json` is the tracked template;
- the template does not contain a filesystem MCP server or absolute machine
  path.

Do not silently replace it with another machine-specific absolute path.

## Deferred Surface 2 - Remove `@news/*` Package Namespace

### Current Evidence

Owner decision after MCP cleanup:

- do not keep `@news/*` as the long-term namespace;
- do not add a compatibility bridge for old authored scenes/projects;
- old generated projects/scenes are not a preservation requirement for this
  cleanup;
- target namespace is `@motionreal/*`;
- current source, current docs, prompts, fixtures, tests, package metadata, and
  lockfile should end NS-1 with no active `@news/*` workspace-package
  references;
- the broader deferred-cleanup target is zero `@news/` references repo-wide, but
  `@news/design` is still classified under the separate style cleanup surface so
  namespace migration does not mix with style compatibility.

The product is MotionReal, but workspace packages, imports, authored scene
contracts, tests, scripts, and package metadata still use `@news/*`.

Latest audit found `@news/` matches across 100+ files. Main surfaces:

Examples:

- root `package.json`
  - package name is still `news-remotion-tool`;
  - description still says Vietnamese short-form news video generator;
  - scripts target `npm --workspace @news/remotion`.
- workspace package names and dependencies
  - `apps/desktop` is `@news/desktop` and depends on `@news/pipeline`;
  - `apps/remotion` is `@news/remotion` and depends on `@news/blocks`,
    `@news/compositions`, `@news/schema`, and `@news/theme`;
  - `packages/schema`, `packages/pipeline`, `packages/compositions`,
    `packages/blocks`, `packages/theme`, and `packages/tts` are all named
    `@news/*`;
  - `package-lock.json` contains the matching workspace package names and links.
- resolver/bundler config
  - `tsconfig.json`, `vitest.config.ts`, `apps/desktop/build-electron.mjs`,
    `apps/remotion/remotion.config.ts`, and
    `packages/pipeline/src/render/renderer.ts` alias `@news/*` to source
    packages;
  - `packages/pipeline/src/safety/typecheck-authored.ts` mirrors those paths for
    authored-scene typechecking.
- authored-scene contract and prompt surface
  - `AI_CONTRACT.md`, `docs/current/authoring-contract.md`,
    `apps/desktop/src/main/authoring/contract-text.ts`,
    `apps/desktop/src/main/authoring/prompt.ts`,
    `apps/desktop/src/main/authoring/ninerouter-backend.ts`, and related tests
    tell new scenes to import `@news/compositions`;
  - `packages/pipeline/src/authoring/admission.ts` whitelists
    `@news/compositions`;
  - authored fixtures under `packages/pipeline/src/authoring/__fixtures__/` and
    `packages/pipeline/src/safety/__fixtures__/` import `@news/compositions`.
- source imports/comments/tests
  - desktop, Remotion, compositions, blocks, theme, schema, pipeline, render,
    safety, audio, CLI, and test files import `@news/*`;
  - many comments mention the old names as current architecture, not only
    history.
- adjacent product-name noise
  - root `package.json` still uses the old root package name and "news" wording;
  - some source comments refer to `news_video_tool` as a reference design. Those
    are not package namespace imports, but final branding hygiene should classify
    them deliberately.

### Why It Was Deferred

This is a broad package and authored-contract migration, not a string cleanup.
Renaming only one layer will break package resolution or generated scene
admission.

- package names and workspace dependency metadata;
- TS/Vitest/webpack aliases;
- Electron and Remotion bundling;
- authored-scene admission whitelist;
- generated prompt and repair guidance;
- authored-scene fixtures and safety typecheck path maps;
- package lockfile and workspace scripts.

Old project/scene compatibility is explicitly not a reason to keep `@news/*`.
The remaining reason to move carefully is engineering blast radius: every layer
must agree on the same namespace in the same source slice.

### Proposed Namespace Plan

Step NS-0: owner decision. Completed.

Decision:

- `@news/*` is not acceptable as the current namespace.
- Do not keep `@news/*` aliases.
- Do not preserve `@news/compositions` in the authored import whitelist.
- Do not write prompt/docs that instruct new authored scenes to import
  `@news/compositions`.
- Use `@motionreal/*` everywhere current source/config/docs need a scoped
  package name.
- Final NS-1 target for current source/docs/package metadata is zero active
  `@news/*` workspace-package references.
- Final deferred-cleanup target is zero `@news/` references repo-wide. Any
  remaining `@news/design` matches must be handled in the style slice, not hidden
  as namespace compatibility.

Step NS-1: migrate the current source namespace to `@motionreal/*`.

This should be one focused source migration, because partial namespace changes
leave the repo in a broken package-resolution state.

Expected changes:

- root package metadata:
  - rename root package from `news-remotion-tool` to a MotionReal name;
  - remove "news video generator" product wording from the root description;
  - update root scripts to target `@motionreal/remotion`.
- workspace package metadata:
  - rename `@news/desktop` -> `@motionreal/desktop`;
  - rename `@news/remotion` -> `@motionreal/remotion`;
  - rename `@news/schema` -> `@motionreal/schema`;
  - rename `@news/pipeline` -> `@motionreal/pipeline`;
  - rename `@news/compositions` -> `@motionreal/compositions`;
  - rename `@news/blocks` -> `@motionreal/blocks`;
  - rename `@news/theme` -> `@motionreal/theme`;
  - rename `@news/tts` -> `@motionreal/tts`;
  - update all workspace dependencies and `package-lock.json`.
- source imports and aliases:
  - update imports across `apps`, `packages`, `tests`, and scripts from
    `@news/*` to `@motionreal/*`;
  - update `tsconfig.json`, `vitest.config.ts`,
    `apps/desktop/build-electron.mjs`, `apps/remotion/remotion.config.ts`, and
    `packages/pipeline/src/render/renderer.ts`;
  - update `packages/pipeline/src/safety/typecheck-authored.ts` path mappings,
    degradation warnings, and cache comments.
- authored scene contract:
  - change admission whitelist from `@news/compositions` to
    `@motionreal/compositions`;
  - update `AI_CONTRACT.md`, `docs/current/authoring-contract.md`,
    desktop `AUTHORING_CONTRACT`, prompt examples, retry guidance, and tests;
  - update authored fixtures to import `@motionreal/compositions`.
- authored import normalizer:
  - stop rescuing old `@news/*` authored imports;
  - keep any useful stale-symbol normalization only for the current
    `@motionreal/*` namespace, for example re-homing `SceneImage` from
    `@motionreal/blocks` or `@motionreal/theme` to
    `@motionreal/compositions` if tests prove it is still useful;
  - `@news/*` authored imports must fail N4 and force a rewrite to the current
    contract.
- comments/docs/tests:
  - update current comments that describe active architecture;
  - update tests whose names/assertions mention `@news/*`;
  - do not mix this with style compatibility cleanup.

Pre-edit audit for NS-1:

```bash
git status --short
rg -n "@news/|news-remotion-tool|Vietnamese short-form news" package.json package-lock.json tsconfig.json vitest.config.ts apps packages docs/current README.md AI_CONTRACT.md
rg -n "@news/compositions|@news/blocks|@news/theme|allowedImports|AUTHORING_CONTRACT|typecheck-authored|build-electron|remotion.config" apps packages docs/current AI_CONTRACT.md
```

Required checks for NS-1:

```bash
npm.cmd install --package-lock-only --ignore-scripts
npm.cmd run typecheck
npm.cmd test -- packages/pipeline/src/authoring/admission.test.ts
npm.cmd test -- packages/pipeline/src/safety/typecheck-authored.test.ts
npm.cmd test -- apps/desktop/src/main/authoring/contract-text.test.ts
npm.cmd test -- apps/desktop/src/main/authoring/agent-guidance.test.ts
npm.cmd test -- apps/desktop/src/main/authoring/normalize-imports.test.ts
npm.cmd test -- apps/desktop/src/main/authoring/prompt.test.ts
npm.cmd test -- apps/desktop/src/main/authoring/ninerouter-backend.test.ts
npm.cmd test -- packages/pipeline/src/tools/create-tools.test.ts
npm.cmd test -- apps/desktop/src/main/preserved-invariants.test.ts
npm.cmd test
npm.cmd run build
```

Post-edit audit for NS-1:

```bash
rg -n "@news/(schema|theme|blocks|tts|compositions|pipeline|desktop|remotion)" package.json package-lock.json tsconfig.json vitest.config.ts apps packages docs/current README.md AI_CONTRACT.md
rg -n "news-remotion-tool|Vietnamese short-form news" package.json package-lock.json README.md docs/current apps packages
git status --short
git diff --stat
```

Commit suggestion:

```text
refactor: rename workspace namespace to motionreal
```

Step NS-2: final namespace text sweep.

Only after NS-1 passes and is committed:

- audit all remaining `@news/` matches in the entire repo;
- remove or rewrite current-source/current-doc references;
- classify `@news/design` matches as the style surface and leave them for
  STYLE-1/STYLE-2 unless the owner explicitly allows folding that docs-only
  cleanup into NS-2;
- ADR/history/reference-design mentions should be rewritten or removed unless
  the owner explicitly asks to preserve historical wording.

Required checks for NS-2:

```bash
rg -n "@news/" .
git status --short
git diff --stat
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
- Do not reintroduce a product dependency on `@news/mcp` or a `packages/mcp`
  owner for the internal tool facade.
- Rename `@news/*` only in the dedicated namespace slice. Do not mix it with
  MCP cleanup or style compatibility cleanup.
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

Start with NS-1: migrate the current source namespace from `@news/*` to
`@motionreal/*` without keeping a compatibility bridge.

Reason:

- MCP-1 through MCP-3 have removed the product dependency on `@news/mcp`, the
  legacy stdio server, and tracked machine-specific `.mcp.json` config;
- NS-0 is complete: owner decision is not to keep `@news/*`;
- the remaining deferred cleanup surfaces are namespace migration and style
  compatibility;
- namespace migration should happen before style cleanup so package/import noise
  does not obscure style compatibility risk.

Do not combine namespace cleanup with style compatibility cleanup.
