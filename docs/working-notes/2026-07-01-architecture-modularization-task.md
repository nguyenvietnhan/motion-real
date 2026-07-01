# Temporary Task — Architecture Modularization

Status: Step 7A implementation complete; waiting for owner approval before Step 7B design.

This is a temporary working task for the next large cleanup after the docs
contract consolidation. Keep it updated as work progresses. Delete this file
only after the final step, final sync sweep, and final commit are complete.

## Objective

Improve long-term maintainability by clarifying module boundaries and reducing
god-file pressure without changing product behavior.

The correct high-level direction is:

- keep the current npm workspace monorepo;
- keep the `apps/` + `packages/` root shape;
- refactor inside existing apps/packages first;
- do not introduce Nx/Turbo, Clean Architecture boilerplate, or many new
  packages before the current internal boundaries are cleaner;
- treat compatibility leftovers as explicit legacy boundaries, not scattered
  accidental rules.

## External Review Applied

An external AI review of this task plan was used as a verification checklist,
not as an authority. The following suggestions were accepted because they reduce
real process risk:

- Step 0 must not rely on stale "last known green" checks before source edits.
- Test coverage must be described as evidence, not assumed from confidence.
- Dependency and boundary shape must be audited, not inferred only from line
  counts.
- Render/refine work needs an extra render-smoke gate because unit tests can miss
  visual/timing regressions.
- If a later step reveals a prior slice was wrong, the plan needs an explicit
  stop/fix/revert protocol.
- This temporary task file must stay compact while work progresses; do not paste
  huge logs or diffs into it.
- PowerShell audit commands are acceptable for this Windows workspace, but
  permanent docs and CI instructions should stay cross-platform where practical.

## Current Structure Assessment

The repo is not organized badly at the root. The foundation is good:

- `apps/desktop` is the Electron product surface.
- `apps/remotion` is the Remotion runtime entry.
- `packages/schema` is the lowest shared contract layer.
- `packages/theme`, `packages/blocks`, and `packages/compositions` are render
  runtime layers.
- `packages/tts` owns voice/audio implementation.
- `packages/pipeline` owns orchestration, store, render, safety, ingest, and
  authoring support.
- `packages/mcp` exposes tools over the pipeline.
- `docs/current` plus `AI_CONTRACT.md` are the active documentation contract.

The main maintainability problem is not the top-level folder layout. The main
problem is that several large files and barrels hide too many responsibilities:

- `apps/desktop/src/main/workspace/workspace-controller.ts`
- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/main/authoring/ninerouter-backend.ts`
- `packages/pipeline/src/orchestrator.ts`
- `packages/pipeline/src/safety/render-grid.ts`
- `packages/pipeline/src/render/renderer.ts`
- `packages/tts/src/index.ts`
- `packages/pipeline/src/index.ts` as an overly broad public barrel

Step 1 inventory confirmed this assessment rather than changing it:

- tracked root areas are concentrated in `packages/` (146 files), `apps/` (116
  files), `docs/` (18 files), and `scripts/` (8 files);
- the workspace has one private root package, two private app packages
  (`@news/desktop`, `@news/remotion`), and seven shared packages
  (`@news/blocks`, `@news/compositions`, `@news/mcp`, `@news/pipeline`,
  `@news/schema`, `@news/theme`, `@news/tts`);
- the required runtime-artifact scan found only `default.mp3`;
- an extra media scan found only `default.mp3` plus the two desktop logo PNGs;
- no tracked `node_modules`, `dist-electron`, `.video-tool`, video outputs,
  coverage folders, logs, or temp files were found.

Tracked asset classification:

- `default.mp3` is an intentional source asset, not accidental output. It is
  referenced by the desktop startup path and the pipeline BGM fallback.
- `apps/desktop/src/main/logo.png` and
  `apps/desktop/src/renderer/logo.png` are intentional app branding assets.

Large-file pressure points from the Step 1 audit:

- `apps/desktop/src/main/workspace/workspace-controller.test.ts` — 1184 lines.
- `apps/desktop/src/main/workspace/workspace-controller.ts` — 1157 lines.
- `packages/pipeline/src/safety/render-grid.ts` — 967 lines.
- `packages/pipeline/src/orchestrator.ts` — 864 lines.
- `packages/tts/src/index.ts` — 809 lines.
- `apps/desktop/src/main/authoring/ninerouter-backend.ts` — 754 lines.
- `apps/desktop/src/main/index.ts` — 697 lines.
- `packages/pipeline/src/render/renderer.ts` — 662 lines.
- `packages/pipeline/src/cli/cli.ts` — 559 lines.
- `packages/pipeline/src/safety/render-grid.test.ts` — 549 lines.
- `apps/desktop/src/renderer/views/home.tsx` — 540 lines.
- `packages/theme/src/theme.ts` — 521 lines.
- `packages/pipeline/src/review.ts` — 477 lines.
- `packages/pipeline/src/orchestrator.test.ts` — 476 lines.
- `packages/pipeline/src/store/store.ts` — 472 lines.
- `apps/desktop/src/main/authoring/ninerouter-backend.test.ts` — 470
  lines.

Files and assets that must not be refactored casually:

- source-of-truth contracts: `AI_CONTRACT.md`, `packages/schema/src/index.ts`,
  and `packages/pipeline/src/index.ts`;
- desktop orchestration and its broad tests:
  `apps/desktop/src/main/workspace/workspace-controller.ts` and
  `apps/desktop/src/main/workspace/workspace-controller.test.ts`;
- app startup and IPC wiring: `apps/desktop/src/main/index.ts`;
- AI authoring backend and parser-sensitive tests:
  `apps/desktop/src/main/authoring/ninerouter-backend.ts` and
  `apps/desktop/src/main/authoring/ninerouter-backend.test.ts`;
- core pipeline orchestration and render safety:
  `packages/pipeline/src/orchestrator.ts`,
  `packages/pipeline/src/safety/render-grid.ts`,
  `packages/pipeline/src/render/renderer.ts`, and their related tests;
- audio/TTS and BGM behavior: `packages/tts/src/index.ts`,
  `packages/pipeline/src/audio/bgm-library.ts`, and `default.mp3`;
- MCP command/tool surface: `packages/mcp/src/tools.ts` and the pre-existing
  dirty `packages/mcp/src/bin.ts`;
- desktop branding assets:
  `apps/desktop/src/main/logo.png` and
  `apps/desktop/src/renderer/logo.png`.

Step 2 dependency and boundary audit:

- package-manifest dependency direction is coherent and acyclic at the workspace
  package level:
  - `@news/schema` has no workspace dependency and remains the lowest layer;
  - `@news/theme` depends on `@news/schema`;
  - `@news/blocks` depends on `@news/schema` and `@news/theme`;
  - `@news/compositions` depends on `@news/blocks`, `@news/schema`, and
    `@news/theme`;
  - `@news/tts` has no workspace dependency;
  - `@news/pipeline` depends on `@news/blocks`, `@news/compositions`,
    `@news/schema`, `@news/theme`, and `@news/tts`;
  - `@news/mcp` depends on `@news/pipeline`;
  - `@news/desktop` depends on `@news/mcp` and `@news/pipeline`;
  - `@news/remotion` depends on `@news/blocks`, `@news/compositions`,
    `@news/schema`, and `@news/theme`.
- true import scan found the same broad direction:
  - `packages/pipeline -> @news/schema` (33 imports);
  - `packages/pipeline -> @news/compositions` (30 imports);
  - `apps/desktop -> @news/pipeline` (26 imports);
  - `packages/blocks -> @news/theme` (6 imports);
  - `packages/compositions -> @news/schema` (4 imports);
  - `packages/compositions -> @news/theme` (3 imports);
  - `packages/compositions -> @news/blocks` (2 imports);
  - `packages/mcp -> @news/pipeline` (3 imports).
- `madge` and `dependency-cruiser` are not installed in `node_modules/.bin`, so
  no graph/cycle tool was run. Do not install one inside this refactor without a
  separate owner-approved tooling slice.
- no package-level cycle was found from package manifests or the strict import
  scan. The highest coupling is intentional orchestration coupling:
  `@news/pipeline` imports the render/runtime packages, and desktop imports the
  pipeline/MCP public surfaces.
- broad public barrels exist and constrain extraction:
  - `packages/pipeline/src/index.ts` is the widest barrel and re-exports store,
    ingest, safety, audio, render, authoring, CLI, and orchestrator surfaces;
  - `packages/mcp/src/index.ts` re-exports types, tools, and server as a thin
    adapter;
  - `packages/theme/src/index.ts` and `packages/schema/src/index.ts` are simple
    low-level barrels;
  - `packages/compositions/src/index.ts` and `packages/blocks/src/index.ts`
    are curated render-runtime barrels with compatibility-sensitive re-exports.
- `apps/desktop/src/main` has 120 relative imports. The biggest local coupling
  is `apps/desktop/src/main/index.ts` (20 relative imports), then
  `apps/desktop/src/main/authoring/ninerouter-backend.ts` (12), then
  `apps/desktop/src/main/workspace/workspace-controller.ts` (6).
- `workspace-controller.ts` currently imports local helpers from:
  `../script/script-gate-apply.js`, `../review/storyboard.js`,
  `../agent/error-classifier.js`, `../redact/friendly.js`,
  `../agent/agent-worker.js`, and `../../shared/types.js`, plus
  `@news/pipeline`.

First extraction boundary justified by dependency evidence:

- keep the first code slice inside `apps/desktop/src/main/workspace`;
- create only a local helper module such as `workspace-helpers.ts` for pure
  helpers;
- make `workspace-controller.ts` import the helper module, never the reverse;
- do not introduce a new package, barrel, or package-level dependency for the
  first slice;
- do not move anything that imports `@news/pipeline`, MCP, filesystem,
  renderer/UI, or controller instance state in the first slice.

## Preferred Organization Model

Use a conservative hybrid:

- monorepo by product/runtime package;
- feature folders in `apps/desktop/src/main`;
- domain folders in `packages/pipeline/src`;
- colocated tests beside source;
- small extracted modules inside the current packages before adding new
  packages;
- explicit compatibility inventory for legacy fields and shims.

Avoid these for now:

- a big-bang folder rewrite;
- moving every test into a separate test tree;
- creating many small packages just to make files shorter;
- introducing framework/build tooling whose main benefit is repo-scale caching;
- enforcing a strict Clean Architecture layer system that the current code does
  not naturally follow.

Step 3 locked decision:

- choose model 1 plus model 5:
  - keep the current npm workspace monorepo;
  - keep the top-level `apps/` + `packages/` shape unchanged;
  - split oversized files into small internal modules inside their current
    app/package before creating new packages;
  - use feature folders inside `apps/desktop/src/main`;
  - use domain folders inside `packages/pipeline/src`;
  - keep colocated tests unless a later focused step proves a specific test move
    is safer.
- reject/defer model 2, strict Clean Architecture layers: it would add
  repository/use-case/entity ceremony that the current render/auth pipeline does
  not naturally follow, increasing churn before boundaries are clearer.
- reject/defer model 3, more npm packages for every domain: Step 2 found a
  coherent package graph already; new packages would add public API and
  dependency-management cost before the large internal files are smaller.
- reject/defer model 4, Nx/Turbo-style repo tooling: the current pain is module
  ownership and file size, not repo-scale build orchestration.
- keep compatibility behavior explicit instead of hiding it during refactors;
  Step 4 must inventory legacy-looking fields before any cleanup decision.

First target area:

- the first code-design target remains
  `apps/desktop/src/main/workspace/workspace-controller.ts`;
- the first likely extraction is a local pure-helper module under
  `apps/desktop/src/main/workspace`;
- the exact function-move list is not approved yet and belongs to Step 5;
- Step 4 compatibility inventory must run before any source-code extraction.

Step 4 legacy compatibility inventory:

| Item | Location(s) | Classification | Keep/Move/Delete Later | Approval Needed? |
| --- | --- | --- | --- | --- |
| `StylePackVM` | `apps/desktop/src/shared/types.ts` | stale/dead type plus stale comment; scan found no active reference outside this inventory | delete later in a focused source cleanup after confirming no renderer/API consumer | yes |
| `@news/design` references | `packages/theme/src/theme.ts`, `packages/theme/src/index.ts`, `packages/theme/src/theme.test.ts`, `packages/schema/src/zones.ts`, `apps/desktop/src/shared/types.ts`, `apps/desktop/src/main/authoring/ninerouter-backend.ts`, ADR/maintenance/working notes | mixed: history/negative guard is intentional; `StylePackVM` and some source comments are stale | keep history and negative authoring guard; later clean stale source comments that imply an active design package | yes for source cleanup |
| `stylePackId` in schema/theme/render path | `packages/schema/src/index.ts`, `packages/theme/src/theme.ts`, `packages/theme/src/theme.test.ts`, `packages/compositions/src/video.tsx`, `packages/pipeline/src/safety/static-grid.test.ts` | intentional compatibility; old specs parse, `makeTheme` accepts and ignores it, tests lock that behavior | keep until a separate de-style migration removes schema field, theme shims, and render call sites together | yes |
| `stylePackId` in guard tests/templates | `tests/script-template.test.ts`, `apps/desktop/src/main/authoring/agent-guidance.test.ts` | current guard against reintroducing old authored API | keep | yes before removal |
| `stylePackId` in comments | `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/workspace/workspace-controller.ts`, `apps/desktop/src/main/agent/agent-worker.ts` | mostly stale explanatory comments about old create input/persistence | clean comments later only when touching nearby code; no behavior change | low-risk yes |
| `styleId: "clean-luxury-tech"` | `packages/schema/src/index.ts`, `packages/pipeline/src/types.ts`, `packages/pipeline/src/authoring/manifest.ts`, `packages/pipeline/src/orchestrator.ts`, tests/fixtures | current persisted discriminator and compatibility constant | keep; removing requires schema/project migration and broad fixture updates | yes, high-risk |
| `ProjectBrief.ratio` | `packages/pipeline/src/types.ts`, `apps/desktop/src/shared/gallery-controller.ts` | active mismatch: pipeline type is TikTok-only, gallery defensively reads possible `16:9` | keep defensive read; future cleanup should align `ProjectBrief` with `format`/YouTube support | yes |
| `default.mp3` and legacy BGM fallback | repo root, `apps/desktop/src/main/index.ts`, `packages/pipeline/src/orchestrator.ts`, `packages/pipeline/src/audio/bgm-library.ts`, `packages/mcp/src/tools.ts`, tests | intentional source asset and compatibility fallback; MCP/Desktop can explicitly pass `null` for silence | keep; future BGM-only-library migration must preserve silence semantics and cache key behavior | yes |
| broad `@news/pipeline` barrel | `packages/pipeline/src/index.ts`, desktop/MCP imports | current public surface but overly broad; constrains extraction because many callers import from the barrel | keep public imports stable during workspace-controller slices; narrow later only with caller/test updates | yes |
| `SceneImage` re-export | `packages/compositions/src/index.ts`, `packages/blocks/src/scene-image.tsx`, authoring docs/tests | current authored-facing image contract and intentional compatibility escape from old block imports | keep; do not remove during modularization | yes, high-risk |
| `ThemeProvider`/`useTheme` re-export | `packages/compositions/src/theme-context.tsx`, `packages/compositions/src/index.ts`, typecheck fixtures | intentional back-compat for existing imports and shared context instance | keep unless authoring/import contract changes separately | yes |
| settings/create/API migrations | `apps/desktop/src/main/settings/settings-store.ts`, `apps/desktop/src/shared/settings-model.ts`, `apps/desktop/src/main/create/create-controller.ts`, gateway/render-cache tests | intentional migrations/back-compat for older settings, `titleLanguage: "mix"`, gateway replies, and cache behavior | keep; only prune after explicit migration-window decision | yes |

Recommended future cleanup candidates from Step 4:

1. Remove `StylePackVM` and rewrite its stale `@news/design` comment if no UI
   consumer exists.
2. Clean stale comments in `workspace-controller.ts`, `index.ts`, and
   `schema/zones.ts` so they describe the current neutral-theme/source-of-truth
   reality without mentioning old design as current.
3. Plan a separate de-style migration for `styleId`, `stylePackId`, theme
   registry shims, and related fixtures. Do not mix it with workspace-controller
   extraction.
4. Align `ProjectBrief.ratio` with current format support, likely by widening or
   replacing it with an explicit format field in a future persistence slice.
5. Narrow `@news/pipeline` exports only after the desktop workspace slices are
   stable.

Step 4 doc status:

- active docs are acceptable: `docs/current/maintenance.md` lists legacy terms as
  legacy-only, and ADR/working notes mention them in history/planning contexts;
- no active project doc was found instructing new authored scenes to use
  `stylePackId` or `@news/design`;
- source comments/types still contain cleanup candidates, but no source behavior
  changed in this step.

Step 5 first extraction design:

Controller responsibility map:

| Group | Current members | Notes |
| --- | --- | --- |
| pure helpers | `stageToFriendlyStatus`, `combineIntent`, `linkWarningOf` | no controller state, no IO, no logger, safest first move |
| stage lifecycle/concurrency | `guarded`, `signalOf`, `cancel`, `recoverAfterCancel`, `setStage`, `bumpRenderVersion` | keep in controller for now because they own maps/events |
| view-model/recovery | `readyStage`, `publishedStage`, `scriptLinesOf`, `storyboardScenesOf`, `list`, `rename`, `stage`, `recoverStage`, `open`, `generateThumbnail` | later Step 7 candidate after pure helpers |
| create/crawl/image-review | `beginCreate`, `runCrawlThenAuthor`, `submitImageReview`, `withImages`, `reviewVmOf` | later Step 8; depends on pending review map, worker crawl/filter, and settings |
| script gate/authoring | `beginScript`, `retry`, `runScript`, `scriptGate`, `applyEdits` | later Step 9; manifest read/write and link-warning behavior must stay exact |
| edit/refine/render draft | `submitEdits`, `runSceneEdits`, `editHooks`, `BOOTSTRAP_INTENT`, `snapshotFresh`, `creativeBootstrapPass`, `runVisionPasses`, `refineBeforeDraft`, `refineEditedScenes`, `restoreToPriorDraft`, `renderHooks`, `reportRenderProgress`, `runRender` | high-risk Step 10 area; needs targeted tests plus render smoke if behavior changes |
| publish/filesystem actions | `publish`, `runPublish`, `delete`, `reveal` | keep in controller until smaller flows are stable |

Proposed destination files before any code movement:

- Step 6 exact file: `apps/desktop/src/main/workspace/workspace-helpers.ts`.
- Step 6 likely test file:
  `apps/desktop/src/main/workspace/workspace-helpers.test.ts`.
- Later possible files, not approved for Step 6:
  - `workspace-view-model.ts`;
  - `workspace-create-flow.ts`;
  - `workspace-script-flow.ts`;
  - `workspace-render-flow.ts` only if Step 10 proves a safe slice exists.

Exact first slice for Step 6:

- move only `stageToFriendlyStatus`, `combineIntent`, and `linkWarningOf`;
- export only those helpers from `workspace-helpers.ts`;
- make `workspace-controller.ts` import the helpers from
  `./workspace-helpers.js`;
- move the `FriendlyStatus` type import to the helper file if no longer needed
  by the controller;
- keep `ProjectStage` in `workspace-controller.ts` because controller methods
  still use it throughout;
- do not move `log`, `TITLE_MAX_CHARS`, interfaces/types, class fields, any
  async method, or any function that reads controller state/deps.

Test evidence map for Step 6:

| Behavior touched | Existing test(s) | Gap? | New test or reason no new test |
| --- | --- | --- | --- |
| friendly status mapping from workspace stage kind | `projects:list status recovery` covers live error overlay and disk-based done/draft-ready status; many tests exercise `setStage` indirectly | direct mapping of ready/published/writing to helper outputs is not isolated | add `workspace-helpers.test.ts` direct cases for `ready`, `published`, `error`, and default building |
| edit intent composition | `submitEdits` tests: `from ready`, `global-note-only`, `folds a global note INTO each per-scene intent` | no behavior gap for controller path | direct helper test optional; controller tests already assert produced `perSceneIntent` |
| unreadable link warning text/count | `runScript link warning` tests for gate on `1/1`, all-read undefined, and gate off ready-stage notice `2/2` | no behavior gap for controller path | direct helper test optional; controller tests already cover both return branches |

Step 6 required targeted checks:

```bash
npm.cmd run typecheck
npm.cmd test -- apps/desktop/src/main/workspace/workspace-helpers.test.ts
npm.cmd test -- apps/desktop/src/main/workspace/workspace-controller.test.ts
npm.cmd test
npm.cmd run build
```

Dependency impact:

- no new package dependency;
- no new barrel;
- no import from helper back into the controller;
- helper imports only shared types from `../../shared/types.js`;
- public API remains unchanged.

Step 7A small-slice design, no source movement yet:

Chosen first Step 7 implementation slice:

- create `apps/desktop/src/main/workspace/workspace-view-model.ts`;
- create `apps/desktop/src/main/workspace/workspace-view-model.test.ts`;
- extract only a pure ready-stage builder, tentatively named `readyStageOf`;
- keep the existing controller method `readyStage(projectId, scenes, notice?)`
  as the single wrapper used by current call sites;
- keep `WorkspaceController` responsible for checking `hasDraft(projectId)` and
  producing `draftMedia(projectId)`;
- pass only plain data into the helper: `scenes`, optional `draftPath`, and
  optional `notice`;
- do not move `publishedStage`, `scriptLinesOf`, `storyboardScenesOf`, `list`,
  `stage`, `recoverStage`, `open`, or `generateThumbnail` in this slice.

Reason for this smaller slice:

- Step 7 as originally written is correct directionally but too broad for the
  first source edit after Step 6;
- `readyStage` is the lowest-risk view-model shaping point because the helper
  can be pure and has no async, manifest, filesystem, event, or controller-map
  dependency;
- keeping draft existence checks in the controller avoids hiding IO behind a
  misleading view-model helper;
- preserving the `readyStage(...)` wrapper means all existing ready-stage call
  sites stay unchanged.

Exact expected implementation for Step 7A:

```ts
export function readyStageOf(
  scenes: SceneCard[],
  options?: { draftPath?: string; notice?: string },
): ProjectStage
```

Controller wrapper should remain conceptually equivalent to:

```ts
private readyStage(projectId: string, scenes: SceneCard[], notice?: string): ProjectStage {
  const draftPath = this.deps.hasDraft(projectId) ? this.deps.draftMedia(projectId) : undefined;
  return readyStageOf(scenes, { draftPath, notice });
}
```

Step 7A test evidence map:

| Behavior touched | Existing test(s) | Gap? | New test or reason no new test |
| --- | --- | --- | --- |
| `ready` stage without draft or notice | many controller tests assert `ready` kind indirectly | direct helper output is not isolated | add direct `workspace-view-model.test.ts` case |
| `ready` stage with draft player path | `cancel during a render reports back to ready (a draft existed)` and `projects:list status recovery` cover controller behavior | direct helper output is not isolated | add direct helper test for `draftPath` |
| `ready` stage with notice | link-warning and failed-edit tests check notices through controller flows | direct helper output is not isolated | add direct helper test for `notice` |

Step 7A required checks after implementation:

```bash
npm.cmd run typecheck
npm.cmd test -- apps/desktop/src/main/workspace/workspace-view-model.test.ts
npm.cmd test -- apps/desktop/src/main/workspace/workspace-controller.test.ts
npm.cmd test
npm.cmd run build
```

Step 7A approval gate:

- `readyStageOf` imports only shared types and does not import the controller;
- no async, filesystem, event, stage-map, render-version, or worker dependency
  enters `workspace-view-model.ts`;
- all existing controller call sites still route through `readyStage(...)`;
- no public API or package barrel changes;
- no unrelated formatting churn;
- full required checks pass before commit.

## Approval Model

Every step below has an approval gate. A step is not approved until all of its
gate checks pass and its expected output exists.

If any gate fails:

1. stop the next step;
2. fix or document the blocker;
3. rerun the relevant checks;
4. only then continue.

If a later step reveals that an earlier committed slice introduced a regression:

1. stop all new refactor work;
2. identify the first bad slice/commit;
3. choose the smallest repair:
   - fix-forward only when the cause is obvious, narrow, and testable;
   - otherwise revert the slice commit, then re-plan;
4. rerun targeted and full checks;
5. record the outcome in the progress log before continuing.

For code slices, approval requires:

- narrow diff;
- no unrelated files staged;
- behavior unchanged unless explicitly approved;
- targeted tests pass;
- test evidence for the touched behavior is named;
- full `typecheck`, `test`, and `build` pass before commit.

For planning/docs-only slices, approval requires:

- clear written output in this file or the relevant doc;
- `git diff` reviewed for scope;
- `rg` checks for stale or contradictory references when applicable.

## Progress Log Hygiene

Use this file for decisions and status, not raw command dumps.

For each completed step, add at most:

- status;
- date/time if useful;
- commit hash if committed;
- checks run;
- blocker or next decision.

Do not paste long `git diff`, test logs, generated output, or full grep output
into this file. Link or summarize instead. This keeps future AI sessions from
spending context on stale detail.

## Progress Notes

- 2026-07-01 Step 0 complete. Dirty worktree contains only the pre-existing
  `packages/mcp/src/bin.ts` change; no unrelated files are staged; no source
  code was moved. Baseline checks passed: `npm.cmd run typecheck`,
  `npm.cmd test` (82 files, 828 tests), and `npm.cmd run build`. Next gate:
  owner approval before Step 1.
- 2026-07-01 Step 1 complete. Repo organization audit recorded root layout,
  package/app boundaries, tracked asset classification, large-file pressure
  points, and files that must not be refactored casually. No code was moved.
  Next gate: owner approval before Step 2.
- 2026-07-01 Step 2 complete. Dependency/boundary audit recorded workspace
  package direction, strict `@news/*` import edges, broad barrels, unavailable
  cycle tooling, desktop relative-import pressure, and the first extraction
  boundary. No code was moved. Next gate: owner approval before Step 3.
- 2026-07-01 Step 3 complete. Organization model locked: keep npm workspace
  monorepo with `apps/` + `packages/`, combine internal module splitting with
  feature-sliced desktop/domain-sliced pipeline, and defer Clean Architecture
  ceremony, extra packages, and Nx/Turbo tooling. First target remains
  `workspace-controller.ts`, but no source code was moved. Next gate: owner
  approval before Step 4.
- 2026-07-01 Step 4 complete. Legacy/compatibility inventory recorded
  `StylePackVM`, `stylePackId`, `styleId`, `ProjectBrief.ratio`, `default.mp3`,
  broad `@news/pipeline` exports, `SceneImage`/theme re-exports, and settings/API
  migrations. No code was moved or deleted. Next gate: owner approval before
  Step 5.
- 2026-07-01 Step 5 complete. First extraction design recorded method groups,
  destination files, exact pure-helper move list, import impact, and test
  evidence map for Step 6. No source code was moved. Next gate: owner approval
  before Step 6.
- 2026-07-01 Step 6 complete. Extracted `stageToFriendlyStatus`,
  `combineIntent`, and `linkWarningOf` into `workspace-helpers.ts`; added direct
  helper tests; updated `workspace-controller.ts` to import the helpers. Checks
  passed: pre-edit `typecheck`/`test`/`build`; post-edit `typecheck`, helper
  test, controller test, full `test` (83 files, 831 tests), and `build`. No
  public API changed. Next gate: owner approval before Step 7.
- 2026-07-01 Step 7A design complete. Re-checked `readyStage`,
  `publishedStage`, `scriptLinesOf`, `storyboardScenesOf`, recovery/open methods,
  and related controller tests. Narrowed the first Step 7 source slice to a pure
  `readyStageOf` helper plus direct tests only; no source code was moved. Next
  gate: owner approval before Step 7A implementation.
- 2026-07-01 Step 7A implementation complete. Added
  `workspace-view-model.ts` and direct view-model tests, then routed the existing
  `readyStage(...)` wrapper through `readyStageOf`. Checks passed: pre-edit
  `typecheck`/`test` (83 files, 831 tests)/`build`; post-edit `typecheck`,
  view-model test (3 tests), controller test (62 tests), full `test` (84 files,
  834 tests), and `build`. No public API or package barrel changed. Step 7
  remains open; next gate: owner approval before Step 7B design.

## Non-Negotiable Guardrails

- Do not do a rewrite.
- Do not change user-facing behavior unless a later task explicitly asks for it.
- Do not change the AI authoring contract.
- Do not touch `packages/mcp/src/bin.ts`; it is a pre-existing dirty file unless
  the owner explicitly asks to handle it.
- Do not move to the next extraction slice until the current slice is tested and
  committed.
- Do not introduce a new architecture style if the existing code already has a
  smaller local pattern that works.
- Keep public imports stable unless all callers and tests are updated in the
  same small slice.
- Each behavior-affecting slice needs focused test evidence or a clear note that
  names the existing tests protecting the moved behavior.
- Keep temporary planning in `docs/working-notes/`; active contract changes
  belong in `AI_CONTRACT.md` or `docs/current/`.

## Required Checks

Before the first source-code edit of this task, always rerun:

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

No source-code slice may start from a stale baseline. If a baseline check cannot
run because of an external blocker, stop and ask the owner. Do not substitute an
older green result for current verification.

After every meaningful code change:

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

For a narrow desktop workspace change, also run the targeted test first:

```bash
npm.cmd test -- apps/desktop/src/main/workspace/workspace-controller.test.ts
```

For a docs-only/task-note-only change:

```bash
git diff --stat
git diff -- docs/working-notes/2026-07-01-architecture-modularization-task.md
```

If docs, scripts, or generated guidance changed, also run a relevant `rg` scan.

For render/refine/publish changes, add the real-render smoke check when Chromium
is available:

```bash
npm.cmd run smoke
```

If the smoke check cannot run because Chromium/runtime dependencies are
unavailable, record that explicitly and get owner approval before continuing
with any deeper render/refine extraction.

## Test Evidence Rule

Do not write "covered by existing tests" as a guess.

For each code slice, maintain a small test evidence map:

```text
Behavior touched | Existing test(s) | Gap? | New test or reason no new test
```

If coverage tooling is available without adding new dependencies, it may be used
as supporting evidence. If it is not available, do not install new coverage
tooling inside this refactor unless the owner approves it as a separate tooling
slice.

## Commit Discipline

Use one commit per approved slice.

Do not commit:

- unrelated dirty files;
- broad formatting churn;
- generated cache/runtime artifacts;
- this temporary task file deletion before the final step.

Suggested commit names:

- `docs: plan architecture modularization`
- `chore: inventory legacy compatibility fields`
- `refactor(desktop): extract workspace pure helpers`
- `refactor(desktop): isolate workspace view models`
- `refactor(desktop): isolate workspace create flow`
- `refactor(desktop): isolate workspace script flow`
- `refactor(desktop): isolate workspace render flow`
- `docs: sync architecture notes after modularization`
- `chore: remove completed modularization task note`

## Progress Checklist

- [x] Step 0: Baseline and dirty-worktree ownership.
- [x] Step 1: Repo organization audit record.
- [x] Step 2: Dependency and boundary audit.
- [x] Step 3: Compare organization models and lock the chosen approach.
- [x] Step 4: Legacy compatibility inventory.
- [x] Step 5: First extraction design, no code movement.
- [x] Step 6: Extract pure workspace helpers.
- [ ] Step 7: Extract workspace view-model and recovery helpers.
- [ ] Step 8: Extract create/crawl/image-review flow.
- [ ] Step 9: Extract script-gate flow.
- [ ] Step 10: Extract render/refine/publish helpers or stop deliberately.
- [ ] Step 11: Decide next target after workspace controller.
- [ ] Step 12: Final docs/code sync sweep.
- [ ] Step 13: Delete this temporary task file and commit deletion.

## Step 0 — Baseline And Dirty-Worktree Ownership

Goal: know the exact starting point before editing source code.

Inputs:

- current git status;
- current baseline check results;
- current working-notes state.

Actions:

1. Run:

```bash
git status --short
```

2. Confirm `packages/mcp/src/bin.ts` is unrelated pre-existing dirty work.
3. Confirm this task file is the only planned working-note addition.
4. Run the current baseline checks:

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

5. If any check fails, stop. Do not begin source-code refactor work.
6. Record the exact baseline result in the progress log.

Approval gate:

- dirty files are understood;
- no unrelated file is staged;
- current baseline checks have passed;
- no source code has been moved.

Expected output:

- a short baseline note added to this file or reported before the first code
  slice, including command names and pass/fail status;
- no commit required unless this planning file is being committed separately.

## Step 1 — Repo Organization Audit Record

Goal: document what exists before deciding what to change.

Actions:

1. Inventory root folders and tracked source areas:

```bash
git ls-files | ForEach-Object { ($_ -split '/')[0] } | Group-Object | Sort-Object Count -Descending
```

2. Inventory package/app boundaries:

```bash
rg --files -g "package.json" -g "!**/node_modules/**" -g "!**/dist*/**"
```

3. Inventory large files:

```bash
git ls-files "*.ts" "*.tsx" | ForEach-Object {
  $lines=(Get-Content $_ | Measure-Object -Line).Lines
  [PSCustomObject]@{Lines=$lines; Path=$_}
} | Sort-Object Lines -Descending | Select-Object -First 25
```

4. Inventory tracked binary/runtime-looking files:

```bash
git ls-files | Where-Object { $_ -match '(^\.video-tool/|dist-electron|node_modules|default\.mp3|\.mp4$|\.wav$)' }
```

5. Record findings in this file under "Current Structure Assessment" if they
   materially change.

Note: the inventory commands in this temporary task are allowed to be
PowerShell-specific because this workspace is Windows. Do not copy them into
permanent docs or CI docs unless a cross-platform equivalent is also provided.

Approval gate:

- root layout is understood;
- tracked artifacts are classified as source asset vs accidental artifact;
- large-file pressure points are listed;
- no code moved.

Expected output:

- a written audit summary;
- a clear list of files that must not be refactored casually;
- optional planning commit only.

## Step 2 — Dependency And Boundary Audit

Goal: understand real module coupling before choosing extraction boundaries.

This step prevents a common refactor mistake: splitting files by size while
preserving the same hidden dependency tangle.

Actions:

1. Inventory workspace package dependencies:

```bash
rg --files -g "package.json" -g "!**/node_modules/**" -g "!**/dist*/**"
```

2. Inventory `@news/*` imports:

```bash
rg -n "@news/" apps packages scripts tests -g "*.ts" -g "*.tsx"
```

3. Inventory broad barrels:

```powershell
rg -n 'export \*|export \{' packages -g 'index.ts'
```

4. For the first target area, inventory relative imports:

```powershell
rg -n 'from "\.' apps/desktop/src/main -g '*.ts' -g '*.tsx'
rg -n "from '\." apps/desktop/src/main -g '*.ts' -g '*.tsx'
```

5. If a dependency graph/cycle tool is already installed, run it against the
   first target and record the result. Do not install a new graph tool inside
   this refactor without owner approval.

Useful tools if already present:

- `madge`
- `dependency-cruiser`
- a repo-local script that reports TypeScript import cycles

6. If no graph tool is available, record that explicitly and use the import/barrel
   scan as the minimum evidence.

Approval gate:

- package dependency direction is summarized;
- broad barrels are identified;
- no obvious cycle risk is ignored;
- lack of a cycle tool is recorded if applicable;
- first extraction boundary is justified by dependency evidence, not only line
  count.

Expected output:

- a short boundary audit note;
- a list of imports/barrels that may constrain extraction;
- optional planning commit only.

## Step 3 — Compare Organization Models And Lock The Approach

Goal: choose the architecture path before touching code.

Models to compare:

1. Keep current monorepo and split internal modules.
2. Strict Clean Architecture layers.
3. More npm packages for every domain.
4. Nx/Turbo-style repo tooling.
5. Feature-sliced desktop plus domain-sliced pipeline.

Decision criteria:

- preserves current working render path;
- minimizes moved files;
- keeps tests easy to run;
- scales to more desktop/workflow features;
- does not make AI agents read many duplicate contracts;
- does not create unnecessary package dependency cycles.

Current expected decision:

- choose model 1 plus model 5;
- defer model 2, 3, and 4.

Architecture-style examples:

- Acceptable: extracting `workspace-helpers.ts` for pure functions already in
  the controller.
- Acceptable: creating `workspace-create-flow.ts` when the create/crawl flow has
  a clear dependency object and tests.
- Not acceptable: introducing repositories/use-cases/entities folders only to
  imitate Clean Architecture.
- Not acceptable: passing the whole controller into a new module and calling the
  result "decoupled."
- Not acceptable: adding Nx/Turbo or a dependency graph package inside a behavior
  refactor slice.

Approval gate:

- chosen approach is written in this file;
- rejected approaches have a one-line reason;
- first target area is named;
- no source code moved.

Expected output:

- "Preferred Organization Model" section is accurate;
- a clear statement that top-level `apps/` + `packages/` stays;
- planning commit recommended.

## Step 4 — Legacy Compatibility Inventory

Goal: identify legacy fields/shims before they are mistaken for current design.

Scope:

- `StylePackVM`
- `@news/design` references;
- `stylePack`, `stylePackId`;
- `styleId: "clean-luxury-tech"`;
- `ProjectBrief.ratio`;
- `default.mp3` root asset and BGM fallback;
- broad `@news/pipeline` barrel exports;
- compatibility re-exports such as `SceneImage` and theme context.

Actions:

1. Run:

```bash
rg -n "StylePackVM|stylePack|stylePackId|styleId|clean-luxury-tech|@news/design|ProjectBrief\.ratio|default\.mp3|back-compat|legacy" apps packages scripts tests docs README.md AI_CONTRACT.md
```

2. Classify each finding:

- current contract;
- intentional compatibility;
- stale/dead type;
- stale comment;
- future cleanup candidate.

Use this format:

```text
Item | Location(s) | Classification | Keep/Move/Delete Later | Approval Needed?
```

3. Do not remove compatibility fields in this step unless the owner explicitly
   approves. This is inventory, not cleanup.

Approval gate:

- every legacy-looking item has a classification;
- dangerous/stale active-code items are listed as future slices;
- no source behavior changed;
- docs do not claim a legacy field is current unless it really is.

Expected output:

- a compatibility inventory section added to this file or a separate temporary
  working note;
- recommended next cleanup candidates;
- optional commit: `chore: inventory legacy compatibility fields`.

## Step 5 — First Extraction Design, No Code Movement

Goal: design the first code slice so it is too small to be dangerous.

First target:

- `apps/desktop/src/main/workspace/workspace-controller.ts`

Reason:

- it is large;
- it has substantial tests;
- it is an outer orchestration layer, so extracting pure helpers first is low
  risk;
- improving it makes later desktop cleanup easier.

Actions:

1. Map methods into groups:

- pure helpers;
- stage lifecycle;
- view-model/recovery;
- create/crawl/image-review;
- script gate;
- render/refine;
- publish/filesystem actions.

2. Write the proposed destination file names before moving code.
3. Identify imports that will move.
4. Identify tests that cover each group.
5. Decide the exact first slice.
6. Create the test evidence map for the first slice:

```text
Behavior touched | Existing test(s) | Gap? | New test or reason no new test
```

7. If dependency graph tooling was unavailable in Step 2, re-check imports
   manually for the exact functions being moved.

Approval gate:

- there is a concrete file-move/function-move list;
- first slice touches only low-risk helpers;
- test command is named;
- test evidence map exists;
- dependency impact is understood;
- no source code has moved.

Expected output:

- a short extraction design note in this file;
- a test evidence map for the first slice;
- no commit required unless committing planning changes.

## Step 6 — Extract Pure Workspace Helpers

Goal: reduce controller size with the smallest behavior-preserving move.

Scope:

- move only pure helpers with no class-state dependency.

Likely functions:

- `stageToFriendlyStatus`
- `combineIntent`
- `linkWarningOf`

Expected destination:

- `apps/desktop/src/main/workspace/workspace-helpers.ts`

Procedure:

1. Create the helper module.
2. Move one helper at a time.
3. Export only what the controller needs.
4. Update imports.
5. Add direct tests only if existing tests do not clearly cover the behavior.
6. Run targeted checks before full checks.

Approval gate:

- controller behavior unchanged;
- no new dependency from helper module back into controller;
- no unrelated formatting churn;
- test evidence map updated for the moved helpers;
- targeted workspace test passes;
- full checks pass.

Expected output:

- smaller controller;
- new helper module;
- maybe helper tests;
- commit: `refactor(desktop): extract workspace pure helpers`.

Required checks:

```bash
npm.cmd run typecheck
npm.cmd test -- apps/desktop/src/main/workspace/workspace-controller.test.ts
npm.cmd test
npm.cmd run build
```

## Step 7 — Extract Workspace View-Model And Recovery Helpers

Goal: separate UI model shaping from orchestration.

Scope candidates:

- ready-stage shaping;
- published-stage shaping;
- script line conversion;
- storyboard scene conversion;
- project list/status recovery helpers where practical.

Expected destination:

- `apps/desktop/src/main/workspace/workspace-view-model.ts`

Procedure:

1. Move only pure or mostly pure formatting/recovery helpers.
2. If a helper needs dependencies, pass exact functions rather than the whole
   controller.
3. Keep `WorkspaceController` responsible for state changes.
4. Add tests for extracted helpers if they are not already covered directly.

Approval gate:

- view-model outputs are unchanged;
- gallery/project stage tests pass;
- no controller instance is passed into the helper module;
- no filesystem operation is hidden in a misleading "view-model" helper unless
  explicitly named.
- test evidence map updated for the moved view-model/recovery behavior.

Expected output:

- controller reads more like orchestration;
- view-model formatting has a coherent home;
- commit: `refactor(desktop): isolate workspace view models`.

Required checks:

```bash
npm.cmd run typecheck
npm.cmd test -- apps/desktop/src/main/workspace/workspace-controller.test.ts
npm.cmd test
npm.cmd run build
```

## Step 8 — Extract Create/Crawl/Image-Review Flow

Goal: isolate the first async workflow while preserving every toggle behavior.

Scope candidates:

- `beginCreate`
- `runCrawlThenAuthor`
- `submitImageReview`
- image selection shaping;
- crawl failure handling.

Expected destination:

- `apps/desktop/src/main/workspace/workspace-create-flow.ts`

Procedure:

1. Identify the minimum state/deps required by the flow.
2. Preserve explicit stage updates.
3. Preserve event emission.
4. Preserve the AI-filter/human-review toggle matrix.
5. Preserve "crawl failures never block authoring."
6. Keep the controller as the owner of maps such as pending reviews unless the
   extraction design explicitly moves that state.

Approval gate:

- all "Block B: crawl -> filter -> review -> author" tests pass;
- no create flow user behavior changes;
- no hidden dependency on renderer/UI;
- no broad changes outside workspace files.
- test evidence map updated for create/crawl/image-review behavior.

Expected output:

- create/crawl/image-review orchestration has a separate module boundary;
- controller delegates without losing state clarity;
- commit: `refactor(desktop): isolate workspace create flow`.

Required checks:

```bash
npm.cmd run typecheck
npm.cmd test -- apps/desktop/src/main/workspace/workspace-controller.test.ts
npm.cmd test
npm.cmd run build
```

## Step 9 — Extract Script-Gate Flow

Goal: separate script review/edit behavior from render/refine behavior.

Scope candidates:

- `beginScript`
- `runScript`
- `scriptGate`
- `applyEdits`
- script edit validation and write handling.

Expected destination:

- `apps/desktop/src/main/workspace/workspace-script-flow.ts`

Procedure:

1. Keep manifest read/write behavior unchanged.
2. Preserve empty-narration guard.
3. Preserve write-failed typed result.
4. Keep authoring retry behavior unchanged.
5. Add focused tests if any extracted helper is now independently testable.

Approval gate:

- script-gate tests pass;
- empty narration still rejects before write;
- valid edits still write exactly once;
- no render/refine behavior moved in this step.
- test evidence map updated for script-gate behavior.

Expected output:

- script review path has a clear module;
- render/refine path is still untouched;
- commit: `refactor(desktop): isolate workspace script flow`.

Required checks:

```bash
npm.cmd run typecheck
npm.cmd test -- apps/desktop/src/main/workspace/workspace-controller.test.ts
npm.cmd test
npm.cmd run build
```

## Step 10 — Extract Render/Refine/Publish Helpers Or Stop

Goal: improve the heaviest workflow only after safer slices are stable.

Scope candidates:

- approve/fix/edit entry points;
- intent building;
- render hooks;
- progress reporting;
- snapshot/restore helpers;
- vision pass orchestration;
- publish handling.

Important:

- Do not move all render/refine methods at once.
- It is acceptable to stop after extracting helpers if a full workflow object
  would be too risky.

Procedure:

1. First extract pure helper strings/options/hooks if any.
2. Keep draft-first behavior unchanged.
3. Keep hidden still/refine behavior unchanged.
4. Keep restore-on-regression behavior unchanged.
5. Keep cancellation behavior unchanged.
6. Keep redacted friendly errors unchanged.
7. Only after helper extraction is stable, consider a workflow module.
8. If any change touches render/refine/publish behavior rather than only pure
   string/helper extraction, run the real-render smoke check when available.

Approval gate:

- refine/render/cancel/publish tests pass;
- first draft still renders only after hidden refine/bootstrap;
- cancellation recovers prior stage;
- full publish still requires draft-first;
- no pipeline behavior changed.
- `npm.cmd run smoke` passes for render/refine/publish behavior changes, or its
  inability to run is recorded and owner-approved before continuing.
- test evidence map updated for render/refine/publish behavior.

Expected output:

- either a small helper extraction commit, or a deliberate note that this step is
  too risky for the current slice;
- commit only if code changed:
  `refactor(desktop): isolate workspace render helpers`.

Required checks:

```bash
npm.cmd run typecheck
npm.cmd test -- apps/desktop/src/main/workspace/workspace-controller.test.ts
npm.cmd test
npm.cmd run build
# plus, for behavior-affecting render/refine/publish changes:
npm.cmd run smoke
```

## Step 11 — Decide Next Target After Workspace Controller

Goal: avoid drifting into endless cleanup.

Decision point:

- continue with `workspace-controller.ts`;
- switch to `apps/desktop/src/main/index.ts`;
- switch to `packages/pipeline/src/orchestrator.ts`;
- switch to `packages/pipeline/src/safety/render-grid.ts`;
- pause and create a new temporary task.

Decision criteria:

- next slice is obvious;
- next slice is small;
- next slice is testable;
- current code is greener and easier to read than before;
- docs do not need major correction.

Approval gate:

- a next-target decision is written;
- if continuing, the next exact slice is named;
- if stopping, the reason is written;
- no accidental broad refactor is in progress.

Expected output:

- a written continue/stop decision;
- optional new task note if switching target.

## Step 12 — Final Docs And Code Sync Sweep

Goal: ensure refactor did not leave stale docs, comments, imports, or file
references behind.

Actions:

1. Scan active docs:

```bash
rg -n "workspace-controller|workspace-helpers|workspace-view-model|workspace-create-flow|workspace-script-flow|workspace-render-flow|orchestrator|render-grid|ninerouter-backend|AI_CONTRACT|docs/current|CLAUDE|AGENTS" README.md AGENTS.md CLAUDE.md AI_CONTRACT.md docs/current docs/working-notes
```

2. Scan moved symbols and old responsibility descriptions:

```bash
rg -n "beginCreate|runCrawlThenAuthor|runVisionPasses|refineBeforeDraft|runRender|stageToFriendlyStatus|combineIntent|linkWarningOf|StylePackVM|stylePackId|@news/design|default\\.mp3" README.md docs apps packages scripts tests
```

3. Scan deleted-doc references:

```bash
rg -n "docs/(vision|architecture|authoring-contract|ai-content-guide|design-language|visualization-playbook|freeform-vision-loop|refactor-backlog)|docs/specs/freeform-engine" README.md AGENTS.md CLAUDE.md AI_CONTRACT.md docs apps packages scripts tests
```

4. Re-read active source-of-truth docs:

- `AI_CONTRACT.md`
- `README.md`
- `docs/current/overview.md`
- `docs/current/architecture.md`
- `docs/current/maintenance.md`

5. Update docs only when future agents need to know changed module boundaries.
6. Confirm `.claude/` files remain thin adapters and do not accumulate duplicate
   rules.
7. Compact this task file's progress notes if they have grown into raw logs.
8. Run full checks.

Approval gate:

- no active docs point to deleted files;
- no docs describe old module responsibilities as current;
- no duplicate AI agent contract appears;
- compatibility terms appear only in explicit compatibility/history contexts;
- this task file contains decisions/status only, not long command dumps;
- full checks pass.

Expected output:

- docs synced or explicitly confirmed unchanged;
- final docs sync commit if needed:
  `docs: sync architecture notes after modularization`.

Required checks:

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

## Step 13 — Delete This Temporary Task File

Goal: leave the repo clean after the modularization task is truly complete.

Only delete this file after:

- selected refactor slices are done;
- final docs/code sync sweep is done;
- checks pass;
- all intended commits are created.

Actions:

1. Remove:

```text
docs/working-notes/2026-07-01-architecture-modularization-task.md
```

2. Run:

```bash
git status --short
```

3. Confirm only expected files are staged.
4. Commit deletion:

```text
chore: remove completed modularization task note
```

Approval gate:

- this file no longer exists;
- deletion commit contains only intended cleanup;
- `packages/mcp/src/bin.ts` remains untouched unless explicitly approved by the
  owner;
- final report lists all commits and checks.

Expected output:

- no temporary task file remains;
- repo documentation and code are synced;
- owner receives a short final report with commit hashes and verification.
