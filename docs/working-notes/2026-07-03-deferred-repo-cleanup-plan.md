# Temporary Task - Deferred Repo Cleanup Plan

Status: MCP cleanup and workspace namespace cleanup completed; style-pack
removal decision and inventory completed; style source migration still pending.

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
- `0eb8599` `docs: finish namespace text sweep`

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

## Deferred Surface 3 - Remove Style-Pack Identity

Owner decision after namespace cleanup:

- style packs are not a current product concept;
- `stylePackId`, `stylePack`, and the literal `clean-luxury-tech` should not
  remain in current source, schemas, prompts, docs, tests, package APIs, or
  runtime defaults;
- do not keep old generated projects/manifests as a reason to preserve style
  identity;
- do not delete runtime project state, renders, manifests, or cache as part of
  this cleanup;
- the remaining valid visual concept is a single neutral runtime theme, driven
  by an optional per-project dominant color.

### Why It Can Be Removed

Current contract and architecture have already made the product model simpler:

- `AI_CONTRACT.md` says pure AUTHOR mode is the only visual model. Every scene
  is fresh raw JSX/SVG/CSS, with no authored-facing theme system, template
  catalog, layout-block toolkit, or style-token leash.
- Authored scenes may import only `react`, `remotion`,
  `@motionreal/compositions`, and `zod`; they cannot import theme or blocks.
- `@motionreal/theme` is documented as one neutral runtime theme used by render
  internals, not as a user-selectable style system.
- The real product axes are delivery format, duration tier, video language,
  prompt/content, images, audio, and BGM. Style pack is not a user decision,
  renderer decision, or authoring decision anymore.

Keep these concepts:

- `theme.dominant`: a project-level dominant color used to derive a coherent
  palette. It is not a style pack.
- `makeTheme(dominant)`: a pure runtime palette/token derivation for render
  internals.
- theme token fallback/proxy behavior: a render-safety defense so unknown token
  reads do not crash the render. It should be named as neutral theme safety, not
  style-pack compatibility.
- vendored font coverage: render-safety infrastructure. It should be described
  as neutral-theme/render font readiness, not style-pack font readiness.

Remove these concepts:

- `VideoSpec.styleId`;
- `ProjectBrief.styleId`;
- `ThemeSpec.stylePackId`;
- `Theme.stylePackId`;
- `DEFAULT_STYLE_PACK_ID`;
- `StylePack`, `StylePackVM`, `StylePreview`;
- `getStylePack`, `listStylePackIds`, `registerStylePack`;
- CLI `checkStylePacks` / `defaultCheckStylePacks`;
- text/test fixtures that assert `clean-luxury-tech` or style-pack wording.

### Current Inventory

Schema/spec layer:

- `packages/schema/src/index.ts`
  - `ThemeSpecSchema` accepts `stylePackId`;
  - `VideoSpecSchema` requires `styleId: "clean-luxury-tech"`;
  - `LockedVideoSpecSchema` inherits `styleId` from `VideoSpecSchema`.

Theme layer:

- `packages/theme/src/theme.ts`
  - `Theme` includes `stylePackId`;
  - `makeTheme(dominant, _stylePackId)` accepts and ignores a style id;
  - neutral theme output sets `stylePackId: "neutral"`;
  - `DEFAULT_STYLE_PACK_ID`, `StylePack`, `getStylePack`,
    `listStylePackIds`, and `registerStylePack` are compatibility shims.
- `packages/theme/src/theme.test.ts`
  - asserts `t.stylePackId`.

Composition/render layer:

- `packages/compositions/src/video.tsx`
  - passes `spec.theme?.stylePackId` into `makeTheme(...)`.
- `apps/remotion/src/fixtures/sample-spec.ts`
  - uses `styleId: "clean-luxury-tech"`.

Pipeline state and conversion:

- `packages/pipeline/src/types.ts`
  - `ProjectBrief` carries `styleId: "clean-luxury-tech"`.
- `packages/pipeline/src/authoring/manifest.ts`
  - writes `styleId: "clean-luxury-tech"` during manifest-to-spec conversion.
- `packages/pipeline/src/orchestrator.ts`
  - writes `styleId: "clean-luxury-tech"` when scaffolding a project brief.

CLI and readiness checks:

- `packages/pipeline/src/cli/cli.ts`
  - imports `getStylePack` / `listStylePackIds`;
  - exposes `checkStylePacks` and `defaultCheckStylePacks`;
  - font check loops over style packs to inspect fonts;
  - usage text still says doctor checks style packs.
- `packages/pipeline/src/cli/doctor.test.ts` and
  `packages/pipeline/src/cli/cli.test.ts`
  - test/inject style-pack doctor slots.

Blocks/font readiness:

- `packages/blocks/src/fonts.ts`
  - comments describe font readiness as style-pack font coverage;
  - `LOADED_FONT_FAMILIES` itself is still useful.
- `packages/blocks/src/fonts.test.ts`
  - imports style-pack registry shims to check fonts.
- `packages/blocks/src/vendor-fonts.generated.ts`
  - generated comment says style-pack fonts.

Desktop/source text:

- `apps/desktop/src/shared/types.ts`
  - defines `StylePackVM`; current audit found no active use outside the type
    itself.
- `apps/desktop/src/main/agent/agent-worker.ts`
  - comment mentions removed `stylePackId`.
- `apps/desktop/src/main/index.ts`
  - retry rehydration comment says `stylePackId/images`.
- `apps/desktop/src/main/workspace/workspace-controller.ts`
  - compatibility comment mentions `stylePackId`.
- `docs/current/authoring-contract.md`
  - lists style packs as a deleted authored surface. This is conceptually true,
    but after source cleanup the wording can be reduced to "theme/style-token
    leash" to avoid preserving the old term.

Tests/fixtures with `clean-luxury-tech`:

- pipeline audio, render, safety, review, store, orchestrator, and desktop
  gallery tests use `styleId: "clean-luxury-tech"` only because schemas/types
  currently require it.

Sensitive behavior areas:

- `packages/pipeline/src/orchestrator.ts`;
- `packages/pipeline/src/safety/render-grid.ts`;
- `apps/desktop/src/main/workspace/workspace-controller.ts`.

`render-grid.ts` may not show a direct legacy-string match, but its tests cover
render/layout behavior that can regress if theme defaults change. Those files
must only be opened in a focused style slice with targeted tests.

### Proposed Style Removal Plan

Step STYLE-0: decision and inventory. Completed by this plan update.

Pre-edit audit used:

```bash
git status --short
rg -n "stylePackId|clean-luxury-tech|stylePack|deleted design-registry|design registry" packages apps docs/current README.md
rg -n "styleId|theme\\?|makeTheme|getStylePack|listStylePackIds|StylePack|StylePackVM|NEUTRAL_THEME_ID" packages apps docs/current README.md
rg -n "clean-luxury-tech|stylePackId|stylePack|StylePack|style packs|style-pack|design registry" package.json package-lock.json tsconfig.json vitest.config.ts apps packages docs/current README.md AI_CONTRACT.md docs/adr docs/working-notes
```

Step STYLE-1: remove docs/comment/test-name noise only.

Allowed changes:

- rename comments in docs/current, ADRs, blocks font comments, generated-font
  generator comment, authoring tests, and desktop comments away from style-pack
  vocabulary;
- do not change schema, manifest conversion, theme APIs, CLI behavior, or
  orchestrator defaults in this slice;
- if touching generated file comments, update the generator script too.

Required checks:

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Commit suggestion:

```text
docs: remove style-pack wording noise
```

Step STYLE-2: remove style identity from schemas and new runtime outputs.

Expected changes:

- remove `VideoSpec.styleId` from `packages/schema/src/index.ts`;
- remove `ThemeSpec.stylePackId`;
- stop `manifestToVideoSpec(...)` writing `styleId`;
- stop `scaffoldVideoProject(...)` writing `ProjectBrief.styleId`;
- remove `styleId` from `ProjectBrief`;
- update tests/fixtures that only supplied `styleId` to satisfy the old schema;
- confirm old specs/manifests with extra `styleId` / `theme.stylePackId` do not
  need special compatibility. If a Zod parse path receives those extra fields,
  default object parsing strips unknown keys; this is enough for the current
  no-old-project-preservation direction unless a direct reader proves otherwise.

Required targeted checks:

```bash
npm.cmd test -- packages/pipeline/src/authoring/manifest.test.ts
npm.cmd test -- packages/pipeline/src/orchestrator.test.ts
npm.cmd test -- packages/pipeline/src/store/store.test.ts
npm.cmd test -- packages/pipeline/src/audio/lock.test.ts
npm.cmd test -- packages/pipeline/src/audio/tts-config.test.ts
npm.cmd test -- packages/pipeline/src/audio/captions.test.ts
npm.cmd test -- packages/pipeline/src/render/cache.test.ts
npm.cmd test -- packages/pipeline/src/render/renderer.test.ts
npm.cmd test -- packages/pipeline/src/render/render-stills.test.ts
npm.cmd test -- packages/pipeline/src/review.test.ts
npm.cmd test -- packages/pipeline/src/safety/build-grid.test.ts
npm.cmd test -- packages/pipeline/src/safety/static-grid.test.ts
npm.cmd test -- packages/pipeline/src/safety/render-grid.test.ts
npm.cmd test -- apps/desktop/src/shared/gallery-controller.test.ts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Commit suggestion:

```text
refactor: remove style identity from specs
```

Step STYLE-3: remove style-pack registry shims and rename readiness checks.

Expected changes:

- change `makeTheme(dominant, _stylePackId)` to `makeTheme(dominant)`;
- remove `Theme.stylePackId`;
- remove `DEFAULT_STYLE_PACK_ID`, `StylePack`, `StylePreview`,
  `getStylePack`, `listStylePackIds`, and `registerStylePack`;
- replace CLI `checkStylePacks` with a neutral `checkTheme` or fold it into the
  font/theme readiness checks;
- update `defaultCheckFonts` to check the known neutral-theme font families
  directly, not by iterating style packs;
- update blocks font tests to assert render-safe neutral-theme fonts directly;
- remove `StylePackVM` if it remains unused;
- update generated-font comment via the generator script if that comment is
  generated.

Required targeted checks:

```bash
npm.cmd test -- packages/theme/src/theme.test.ts
npm.cmd test -- packages/blocks/src/fonts.test.ts
npm.cmd test -- packages/pipeline/src/cli/doctor.test.ts
npm.cmd test -- packages/pipeline/src/cli/cli.test.ts
npm.cmd test -- packages/compositions/src/video.test.ts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Commit suggestion:

```text
refactor: remove style-pack theme shims
```

Step STYLE-4: final style identity audit.

Target:

- zero `stylePackId`;
- zero `clean-luxury-tech`;
- zero `StylePack` / `StylePackVM`;
- zero style-pack registry function names;
- no current docs/prompts/tests imply user-selectable styles.

Audit:

```bash
rg -n "stylePackId|clean-luxury-tech|StylePack|StylePackVM|getStylePack|listStylePackIds|registerStylePack|DEFAULT_STYLE_PACK_ID|style packs|style-pack" package.json package-lock.json tsconfig.json vitest.config.ts apps packages docs/current README.md AI_CONTRACT.md docs/adr docs/working-notes
git status --short
git diff --stat
```

Required checks:

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Commit suggestion:

```text
chore: finish style identity cleanup
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
- Remove style identity only inside the dedicated style-removal slices above.
  Do not mix it with namespace, MCP, runtime cache, or unrelated refactors.
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

Start with STYLE-1: remove style-pack wording noise only.

Reason:

- MCP cleanup is complete;
- workspace namespace cleanup is complete;
- STYLE-0 is complete: owner decision, theory, and inventory now say style-pack
  identity should be removed rather than preserved as compatibility;
- the first source/doc slice should be wording-only so behavioral style removal
  starts from a cleaner audit surface;
- schema, orchestrator, render-grid, and desktop workspace behavior stay for
  later dedicated style slices with targeted tests.
