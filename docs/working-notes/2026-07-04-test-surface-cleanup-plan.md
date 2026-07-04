# Temporary Task - Test And Surface Cleanup Plan

Status: CLEANUP-0 baseline, CLEANUP-1 stale S0 baseline deletion, CLEANUP-2
authored composition surface sealing, and CLEANUP-3 authored-theme fixture
removal completed; CLEANUP-4 pending.

This is a temporary working note for pruning stale tests, stale authored-facing
surfaces, and compatibility paths that no longer serve MotionReal's current
contract. It is not project contract. Current contract remains `AI_CONTRACT.md`
plus `docs/current/`.

Delete this file after the cleanup slices below are implemented, focused and
broad checks pass, and the cleanup commit is made.

## Goal

Make the test suite and public authored surface smaller, sharper, and more
truthful:

- remove tests that only preserve refactor history or local replicas;
- remove tests that bless authored-scene access to deleted theme surfaces;
- close the `@motionreal/compositions/*` subpath escape before removing public
  theme re-exports;
- keep tests that protect current contract, even when they mention old names as
  negative regression guards;
- retire old create/manifest compatibility only as a deliberate slice;
- remove this temporary note at the end.

## Verification On 2026-07-04

Commands/checks used during verification:

```bash
git status --short
Test-Path docs/working-notes/2026-07-03-prompt-improvement-plan.md
Test-Path docs/working-notes/2026-07-04-test-surface-cleanup-plan.md
Select-String -Path apps/desktop/src/main/characterization-baseline.test.ts -Pattern "CHARACTERIZATION BASELINE|function activateBaseline|function loadBaseline|function updateBaseline|function stageRecoveryBaseline|computeScriptEdits"
Select-String -Path packages/pipeline/src/safety/typecheck-authored.test.ts,packages/pipeline/src/safety/__fixtures__/typecheck-missing-color.tsx,packages/pipeline/src/safety/__fixtures__/typecheck-flat-theme.tsx -Pattern "typecheck-missing-color|typecheck-flat-theme|useTheme|A scene MAY|FLAT theme|ThemeColors|Theme"
Select-String -Path packages/compositions/src/index.ts,packages/compositions/src/theme-context.tsx,packages/compositions/src/video.tsx -Pattern "ThemeProvider|useTheme|theme-context|back-compat"
Select-String -Path packages/pipeline/src/authoring/admission.ts,packages/pipeline/src/authoring/admission.test.ts -Pattern "startsWith|allowedImports|subpath|@motionreal/compositions/"
Select-String -Path apps/desktop/src/main/authoring/prompt.test.ts -Pattern "records current message counts|chars:|authorTextOnly|imageFilter"
Select-String -Path apps/desktop/src/main/create/create-ipc.test.ts,apps/desktop/src/main/create/create-flow.test.ts,packages/pipeline/src/authoring/manifest.test.ts,apps/desktop/src/shared/types.ts,packages/schema/src/index.ts,apps/desktop/src/main/create/create-ipc.ts,apps/desktop/src/main/create/create-controller.ts,packages/pipeline/src/authoring/manifest.ts -Pattern "titleLanguage|LegacyTitleLanguage|retired legacy mix|mix"
Select-String -Path tests/script-template.test.ts,scripts/new-video.ts,scripts/templates/video-template.txt,README.md,docs/current/*.md,package.json -Pattern "scripts/new-video|new-video|video-template|script-template|build-<project-id>|vt-statement"
Get-ChildItem -Force docs/working-notes
rg -n "Deferred Repo Cleanup|Desktop Main Modularization|Prompt Improvement|stylePackId|stylePack" docs AI_CONTRACT.md README.md
rg -n "computeScriptEdits|CHARACTERIZATION BASELINE|function activateBaseline|function loadBaseline|function updateBaseline|function stageRecoveryBaseline" apps/desktop/src/main/characterization-baseline.test.ts apps/desktop/src/main/script apps/desktop/src/main/workspace apps/desktop/src/main/license apps/desktop/src/main/settings
rg -n --hidden --no-ignore -g "*.ts" -g "*.tsx" -g "*.json" -g "*.md" "useTheme|ThemeProvider|@motionreal/compositions/theme-context|@motionreal/compositions/" .video-tool
```

Verified facts:

- Working tree was clean before writing this note.
- `docs/working-notes/2026-07-03-prompt-improvement-plan.md` is absent on disk;
  the open IDE tab is stale.
- This temporary cleanup note did not exist before this planning step; it now
  lives at `docs/working-notes/2026-07-04-test-surface-cleanup-plan.md`.
- The only working note currently present on disk is this file. The older plan
  names referenced by the attachment review are not present under
  `docs/working-notes/`; treat them as coordination risks if recreated, not as
  active repo files.
- Before CLEANUP-1, `apps/desktop/src/main/characterization-baseline.test.ts`
  contained the old S0 characterization baseline and local replica functions:
  `activateBaseline`, `loadBaseline`, `updateBaseline`,
  `stageRecoveryBaseline`.
- That S0 file also imported production `computeScriptEdits` and tested three
  cases: reject empty narration, apply valid edits without mutating input, and
  ignore edits for unknown scenes.
- Current production behavior covered by that S0 file is now covered directly by
  more focused tests:
  `license/lifecycle`, `license/manager`, `settings/settings-store`,
  `workspace/workspace-controller`, and `script/script-gate-apply`.
- Current `script-gate-apply.test.ts` covers empty-narration behavior and write
  failure via property tests. CLEANUP-1 added explicit unknown-scene no-op
  coverage before deleting S0.
- Before CLEANUP-3,
  `packages/pipeline/src/safety/typecheck-authored.test.ts` still had two N10
  tests for authored scenes reading `useTheme` from
  `@motionreal/compositions`.
- Before CLEANUP-3, the corresponding fixtures
  `typecheck-missing-color.tsx` and `typecheck-flat-theme.tsx` explicitly said
  an authored scene may still read theme via `useTheme`.
- Before CLEANUP-2, `packages/compositions/src/index.ts` still publicly
  re-exported `ThemeProvider` and `useTheme`.
- `packages/compositions/src/theme-context.tsx` exists as an internal
  composition-runtime re-export used by `video.tsx`.
- Before CLEANUP-2, `packages/pipeline/src/authoring/admission.ts` allowed exact
  allowed imports and any subpath under them via `spec.startsWith(...)`.
- No non-test production source currently needs an authored import from
  `@motionreal/compositions/*`.
- A local scan of `.video-tool` found no saved project source or metadata using
  `useTheme`, `ThemeProvider`, `@motionreal/compositions/theme-context`, or an
  `@motionreal/compositions/*` subpath. Re-run that scan immediately before
  CLEANUP-2; local absence is not proof that every owner/user project is safe.
- `apps/desktop/src/main/authoring/prompt.test.ts` still snapshots exact prompt
  text character counts.
- Legacy `titleLanguage` / `mix` support is still present in schema, desktop
  shared types, IPC payload conversion, create controller normalization, manifest
  conversion, and tests.
- `scripts/new-video.ts` plus `scripts/templates/video-template.txt` are tested
  by `tests/script-template.test.ts`, but this helper is not referenced by
  README, `docs/current`, or package scripts.

## Coordination Guard

The attachment review referenced older/out-of-band working notes. They are not
present on disk during this verification, but future work should still avoid
parallel assumptions.

Before starting any slice:

- list `docs/working-notes/` and check for newly created plans that touch the
  same files;
- if a prompt-improvement plan is recreated and still needs exact prompt length
  baselines, finish or intentionally supersede that baseline before CLEANUP-4;
- if a repo-cleanup/style cleanup plan exists, coordinate changes to
  `packages/pipeline/src/authoring/manifest.ts`,
  `packages/theme/src/theme.ts`, and `packages/compositions/src/video.tsx`
  before CLEANUP-2 or CLEANUP-5;
- do not run two compatibility cuts in the same file without one clear owner
  and one final broad check lane.

## Keep, Do Not Prune

These are not cleanup targets in this plan:

- YouTube tests that cover format plumbing, geometry, thumbnail behavior, and
  caption-off rendering. The contract says YouTube long-form workflow is not
  stable, but shared 16:9 plumbing is real.
- Tests that mention old block/theme names as negative guards. Those prevent
  reintroducing deleted authored-facing surfaces.
- Runtime `@motionreal/theme` and `@motionreal/blocks` tests. Theme and blocks
  are still render internals, just not authored-facing.
- Vivibe legacy environment aliases (`VIETNAMESE_API_KEY`,
  `VIETNAMESE_VOICEID`). They are still documented in `.env.example` and
  provider docs.
- `preserved-invariants.test.ts`. It tests draft-first, voice guard, and no
  provider downgrade against current `createTools` behavior.

## Slice Plan

### CLEANUP-0: Baseline Before Deletion

Status: completed on 2026-07-04.

Purpose: establish a clean baseline before removing tests or public surfaces.

Touch:

- no source files.

Actions:

- confirmed the working tree had only this temporary working note untracked;
- ran focused tests for the areas that will replace stale baseline coverage;
- ran the authored admission and N10 tests before changing their coverage;
- ran the broad contract lane, so failures found in CLEANUP-7 can be assigned
  to the cleanup instead of to pre-existing repo state.

Checks:

```bash
git status --short
npm.cmd test -- apps/desktop/src/main/license/license-lifecycle.test.ts
npm.cmd test -- apps/desktop/src/main/license/license-manager.test.ts
npm.cmd test -- apps/desktop/src/main/settings/settings-store.test.ts
npm.cmd test -- apps/desktop/src/main/workspace/workspace-controller.test.ts
npm.cmd test -- apps/desktop/src/main/script/script-gate-apply.test.ts
npm.cmd test -- packages/pipeline/src/authoring/admission.test.ts
npm.cmd test -- packages/pipeline/src/safety/typecheck-authored.test.ts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Result:

- all focused baseline tests passed;
- `npm.cmd run typecheck` passed;
- `npm.cmd test` passed with 94 test files and 926 tests;
- `npm.cmd run build` passed.

Stop point:

- If any focused or broad baseline check is red before cleanup, stop and fix or
  re-scope before deleting anything.

### CLEANUP-1: Delete The Old S0 Characterization Baseline

Status: completed on 2026-07-04.

Purpose: remove tests that preserve refactor history and local replicas instead
of current production behavior.

Touch:

- delete `apps/desktop/src/main/characterization-baseline.test.ts`.
- `apps/desktop/src/main/script/script-gate-apply.test.ts` only if the
  unknown-scene no-op case is not already covered outside S0.

Actions:

- confirmed focused production tests cover the behavior S0 still uniquely
  named;
- added a focused `computeScriptEdits` test for edits to unknown scene ids;
- deleted `apps/desktop/src/main/characterization-baseline.test.ts`.

Rationale:

- The file's local replica functions can pass while production behavior changes.
- Direct current tests already cover the relevant behavior.

Checks:

```bash
npm.cmd test -- apps/desktop/src/main/license/license-lifecycle.test.ts
npm.cmd test -- apps/desktop/src/main/license/license-manager.test.ts
npm.cmd test -- apps/desktop/src/main/settings/settings-store.test.ts
npm.cmd test -- apps/desktop/src/main/workspace/workspace-controller.test.ts
npm.cmd test -- apps/desktop/src/main/script/script-gate-apply.test.ts
npm.cmd run typecheck
npm.cmd test
```

Result:

- focused replacement tests passed;
- `apps/desktop/src/main/script/script-gate-apply.test.ts` now has 3 tests,
  including unknown-scene no-op coverage;
- `npm.cmd run typecheck` passed;
- `npm.cmd test` passed with 93 test files and 909 tests.

Stop point:

- If S0 still has any behavior not covered by a focused production test, add the
  focused test first. Do not keep the local-replica characterization file as the
  source of truth.

Commit suggestion:

```text
test: remove stale controller characterization baseline
```

### CLEANUP-2: Seal The Authored Composition Surface

Status: completed on 2026-07-04.

Purpose: make the code match the contract that authored scenes may import only
the public package entry points, and may not read theme via `useTheme`.

Touch:

- `packages/pipeline/src/authoring/admission.ts`
- `packages/pipeline/src/authoring/admission.test.ts`
- `packages/compositions/src/index.ts`
- `packages/compositions/src/theme-context.tsx` only if comments need updating
- `packages/compositions/src/video.tsx` only if imports need to stay explicitly
  internal
- possibly comments in `packages/theme/src/index.ts`,
  `packages/theme/src/theme.ts`, and `packages/blocks/src/index.ts`

Actions:

- re-ran the local saved-project scan before changing admission:
  `rg -n --hidden --no-ignore -g "*.ts" -g "*.tsx" -g "*.json" -g "*.md" "useTheme|ThemeProvider|@motionreal/compositions/theme-context|@motionreal/compositions/" .video-tool`;
- found no local `.video-tool` saved-project source or metadata using the old
  authored theme/subpath surface;
- changed admission import matching from "exact or any subpath" to exact package
  specifiers only for the default authored policy;
- added admission tests proving
  `@motionreal/compositions/theme-context` and any other
  `@motionreal/compositions/*` authored import are rejected;
- kept exact `@motionreal/compositions` import admitted so
  `registerComponent`, `SceneComponentProps`, and `SceneImage` still work;
- removed `ThemeProvider` and `useTheme` from the public
  `@motionreal/compositions` package index;
- kept `theme-context.tsx` as an internal composition-runtime bridge used by
  `video.tsx` through a relative import;
- updated stale composition/blocks/theme comments and theme fallback log text
  that said authored scenes could read theme tokens.

Checks:

```bash
npm.cmd test -- packages/pipeline/src/authoring/admission.test.ts
npm.cmd test -- packages/compositions/src/video.test.ts
npm.cmd test -- packages/compositions/src/registry.test.ts
npm.cmd test -- packages/pipeline/src/safety/typecheck-authored.test.ts
npm.cmd test -- packages/theme/src/theme.test.ts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Result:

- local saved-project scan had no hits;
- admission focused test passed with 19 tests;
- composition video and registry focused tests passed;
- N10 focused test passed with 11 tests after removing stale theme fixtures;
- theme focused test passed with 15 tests;
- `npm.cmd run typecheck` passed;
- `npm.cmd test` passed with 92 test files and 897 tests;
- `npm.cmd run build` passed.

Stop point:

- If current runtime composition code depends on package-index
  `ThemeProvider/useTheme`, rewire it to a relative/internal import. Do not keep
  the public authored-facing re-export just for convenience.
- If saved project source depends on `useTheme` or a
  `@motionreal/compositions/*` subpath, do not break those projects silently.
  Either add a stored-project migration/repair step or get explicit owner
  approval to cut compatibility.

Commit suggestion:

```text
fix: close authored theme import surface
```

### CLEANUP-3: Remove Theme-Based N10 Fixtures

Status: completed on 2026-07-04.

Purpose: remove N10 tests that bless authored-scene `useTheme` access after
that access is no longer part of the authored contract.

Touch:

- `packages/pipeline/src/safety/typecheck-authored.test.ts`
- delete `packages/pipeline/src/safety/__fixtures__/typecheck-missing-color.tsx`
- delete `packages/pipeline/src/safety/__fixtures__/typecheck-flat-theme.tsx`
- `packages/pipeline/src/safety/typecheck-authored.ts` if warning special cases
  become unreachable or misleading

Actions:

- removed the "ThemeColors warning" and "flat Theme warning" N10 tests in the
  same green slice as CLEANUP-2, because removing the public theme re-export
  would otherwise make the full suite red between commits;
- deleted the two fixtures;
- kept N10 tests for current authored-surface errors:
  `SceneImage` wrong prop, excess prop, local union tone, undefined identifier,
  implicit any, cache, empty list, degraded setup;
- left `severityFor(...)` unchanged for now; it still classifies runtime-safe
  diagnostics from any current or future allowed type surface, and no remaining
  test blesses authored theme access.

Checks:

```bash
npm.cmd test -- packages/pipeline/src/safety/typecheck-authored.test.ts
npm.cmd test -- packages/pipeline/src/authoring/admission.test.ts
npm.cmd run typecheck
npm.cmd test
```

Result:

- `packages/pipeline/src/safety/typecheck-authored.test.ts` passed with 11
  tests;
- `npm.cmd run typecheck` passed;
- `npm.cmd test` passed with 92 test files and 897 tests.

Stop point:

- If removing the fixture uncovers a current allowed authored path to theme
  tokens, go back to CLEANUP-2 and close the import path before continuing.

Commit suggestion:

```text
test: remove authored theme typecheck fixtures
```

### CLEANUP-4: Loosen Prompt Shape Baseline From Exact Character Counts

Status: pending.

Purpose: keep prompt builder shape coverage without making every wording edit
pay a brittle character-count tax.

Touch:

- `apps/desktop/src/main/authoring/prompt.test.ts`

Actions:

- replace exact `chars` snapshot with stable shape assertions:
  message count, role order, text-vs-parts shape, text part count, image part
  count, and important semantic tokens;
- keep all existing semantic prompt tests for authoring, reauthor, image filter,
  visual QA, format, language, duration, claim filtering, and image refs.

Checks:

```bash
npm.cmd test -- apps/desktop/src/main/authoring/prompt.test.ts
npm.cmd test -- apps/desktop/src/main/authoring/content-plan.test.ts
npm.cmd run typecheck
```

Stop point:

- Do not remove semantic prompt checks. Only remove exact character-count
  snapshotting.

Commit suggestion:

```text
test: remove brittle prompt length snapshots
```

### CLEANUP-5: Retire Legacy `titleLanguage` / `mix`

Status: pending.

Purpose: remove stale create/manifest compatibility after the UI and contract
have settled on `videoLanguage`.

Touch:

- `packages/schema/src/index.ts`
- `apps/desktop/src/shared/types.ts`
- `apps/desktop/src/main/create/create-ipc.ts`
- `apps/desktop/src/main/create/create-ipc.test.ts`
- `apps/desktop/src/main/create/create-controller.ts`
- `apps/desktop/src/main/create/create-flow.test.ts`
- `packages/pipeline/src/authoring/manifest.ts`
- `packages/pipeline/src/authoring/manifest.test.ts`
- any compile errors surfaced by removed types.

Actions:

- remove `LegacyTitleLanguageSchema`, `LegacyTitleLanguage`, and legacy
  normalization that accepts `mix`;
- remove `titleLanguage` from desktop shared create payload types;
- remove IPC forwarding of legacy `titleLanguage`;
- remove create-controller `titleLanguage` choice handling;
- remove manifest `titleLanguage` input support;
- remove tests that assert `mix` maps to Vietnamese;
- keep tests proving current `videoLanguage` defaults and English/Vivibe
  blocking still work.

Checks:

```bash
npm.cmd test -- apps/desktop/src/main/create/create-ipc.test.ts
npm.cmd test -- apps/desktop/src/main/create/create-flow.test.ts
npm.cmd test -- apps/desktop/src/renderer/views/home-language.test.ts
npm.cmd test -- packages/pipeline/src/authoring/manifest.test.ts
npm.cmd test -- packages/schema/src/schema.test.ts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Stop point:

- This deliberately stops reading old `titleLanguage` project/payload data. If
  the owner wants old saved project compatibility, do not run this slice; keep
  the code and tests.

Commit suggestion:

```text
refactor: retire legacy title language payloads
```

### CLEANUP-6: Remove The Unadvertised `scripts/new-video` Helper

Status: pending.

Purpose: reduce unsupported script/template surface that is not documented in
current docs, README, or package scripts.

Touch:

- delete `scripts/new-video.ts`
- delete `scripts/templates/video-template.txt`
- delete `tests/script-template.test.ts`
- delete `scripts/templates/` if empty.

Actions:

- remove the helper and its template test together;
- keep the supported pipeline CLI tests under `packages/pipeline/src/cli`.

Checks:

```bash
npm.cmd test -- packages/pipeline/src/cli/cli.test.ts
npm.cmd test -- packages/pipeline/src/cli/doctor.test.ts
npm.cmd run typecheck
npm.cmd test
```

Stop point:

- If the owner still uses `scripts/new-video.ts` as a personal/manual workflow,
  keep it and instead either document it or remove only the unsupported wording
  that calls it the "reliable authoring path".

Commit suggestion:

```text
chore: remove unsupported new-video script template
```

### CLEANUP-7: Final Audit And Delete This Note

Status: pending.

Purpose: prove cleanup is complete and remove this temporary plan.

Touch:

- delete `docs/working-notes/2026-07-04-test-surface-cleanup-plan.md`.

Actions:

- audit for stale references after all selected slices:
  `useTheme` in authored fixtures, `titleLanguage`, `LegacyTitleLanguage`,
  `scripts/new-video`, `video-template`, exact prompt `chars` snapshots,
  `CHARACTERIZATION BASELINE`, authored-facing `ThemeProvider/useTheme`
  re-exports, and the old `spec.startsWith` subpath admission rule;
- confirm remaining `useTheme`/`ThemeProvider` references are runtime internals
  or negative prompt/admission guards, not authored-facing public exports;
- run broad checks;
- delete this temporary note;
- run status/diff check and commit.

Checks:

```bash
Get-ChildItem -Recurse -File -Include *.ts,*.tsx,*.md -Exclude node_modules | Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.FullName -notmatch '\\.video-tool\\' } | Select-String -Pattern 'CHARACTERIZATION BASELINE|typecheck-missing-color|typecheck-flat-theme|titleLanguage|LegacyTitleLanguage|scripts/new-video|video-template|records current message counts|chars:'
rg -n "A scene MAY still read|re-exported from @motionreal/compositions|@motionreal/compositions/theme-context|@motionreal/compositions/|ThemeProvider|useTheme" packages/pipeline/src/safety packages/compositions/src apps/desktop/src/main/authoring docs/current
rg -n "spec\\.startsWith|allowed\\.some" packages/pipeline/src/authoring/admission.ts packages/pipeline/src/authoring/admission.test.ts
git status --short
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Stop point:

- Do not delete this note until all selected cleanup slices are implemented and
  broad checks pass.

Commit suggestion:

```text
chore: finish test surface cleanup
```

## Recommended Order

1. CLEANUP-0 baseline.
2. CLEANUP-1 delete S0 characterization baseline.
3. CLEANUP-2 close authored import surface.
4. CLEANUP-3 remove N10 authored-theme fixtures.
5. CLEANUP-4 remove exact prompt char-count snapshots.
6. CLEANUP-5 retire `titleLanguage` / `mix` if old project/payload
   compatibility is intentionally dropped.
7. CLEANUP-6 remove `scripts/new-video` if it is not an owner-supported manual
   helper.
8. CLEANUP-7 audit, broad checks, delete this note.

## Risk Notes

- CLEANUP-1 and CLEANUP-4 are test-only and low risk.
- CLEANUP-2 changes admission behavior and public package exports; it must run
  before CLEANUP-3 so no allowed authored route to `useTheme` remains.
- CLEANUP-2 is also a stored-project compatibility risk. The local `.video-tool`
  scan found no saved `useTheme` or `@motionreal/compositions/*` usage during
  verification, but the scan must be re-run immediately before the slice and any
  positive hit needs migration/repair/owner approval.
- CLEANUP-5 is a compatibility cut. It is clean, but it intentionally stops
  accepting older `titleLanguage` / `mix` inputs.
- CLEANUP-6 is a support-surface decision. The helper is outside current docs
  and package scripts, but removing it affects anyone using it manually.
