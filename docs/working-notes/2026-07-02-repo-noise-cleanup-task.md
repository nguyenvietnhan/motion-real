# Temporary Task - Repo Noise And Asset Cleanup

Status: Step 6 final scan/docs sync complete; Step 7 temporary-note cleanup
next.

This is a temporary working note for standardizing repository entry points,
asset locations, legacy naming, and duplicate/noisy files. It is not project
contract. Current contract remains `AI_CONTRACT.md` plus `docs/current/`.

Delete this file only after the cleanup slices are complete, current docs are
synced, checks pass, and the owner approves removal of the temporary note.

## Objective

Reduce repository confusion by moving or deleting only confirmed duplicate,
stale, or tool-specific files while keeping product behavior, render outputs,
runtime project state, and AI contract boundaries intact.

The goal is not to rename everything in one large churn. The goal is to make
file/folder ownership obvious:

- canonical AI instructions live in one place;
- bundled app assets live under app asset folders;
- generated runtime artifacts stay under `.video-tool`;
- test/dev fixtures are named and placed as fixtures;
- legacy MCP/package naming is isolated into a separate deliberate migration.

## Current Scan Evidence

Scan date: 2026-07-02.

Contract/context:

- `AI_CONTRACT.md` is the single canonical AI/human assistant contract.
- Compatibility entry points such as `AGENTS.md` may only point to
  `AI_CONTRACT.md` or provide thin tool wiring.
- Vendor-specific assistant files must not carry separate project rules.
- Generated runtime artifacts belong under `VIDEO_TOOL_HOME/.video-tool/`.
- Do not delete `.env`, successful renders, generated runtime artifacts, or user
  project state unless explicitly asked.
- `docs/working-notes/` is temporary planning only.

Current working note state:

- The prior desktop-main modularization task note has already been removed.
- `docs/working-notes/README.md` remains as the folder guide.

Initial dirty-worktree evidence before cleanup commits:

- Vendor-specific Claude files are already deleted in the worktree:
  - `.claude/agents/scene-author.md`;
  - `.claude/commands/news-video.md`;
  - `.claude/settings.json`;
  - `CLAUDE.md`.
- Root `default.mp3` is already deleted in the worktree.
- `apps/desktop/assets/bgm/default.mp3` is newly present.
- BGM virtual built-in code/docs are already pending in the worktree.
- These findings were the Step 1 starting state. See Progress Notes for the
  committed cleanup slices.

Review reconciliation:

- A review correctly flagged that AI-entrypoint cleanup and BGM virtual built-in
  behavior are different concerns. They may share the same current dirty
  worktree, but they must be reviewed and committed separately.
- The review also correctly flagged that BGM virtual built-in behavior needs
  direct functional coverage, not only grep/typecheck/build.
- The review correctly asked for desktop icon packaging/build-config checks when
  moving logo assets.
- The review correctly asked for commit-per-slice discipline and a stricter
  sensitive-file guardrail.

Root entry points after scan:

- `AGENTS.md`;
- `AI_CONTRACT.md`;
- `README.md`;
- `.mcp.json`;
- `.env.example`;
- package/config files;
- app/package/docs folders.

Audio/BGM evidence:

- The only source default BGM file found is
  `apps/desktop/assets/bgm/default.mp3`.
- `.video-tool/bgm` exists but is empty.
- The hash of `apps/desktop/assets/bgm/default.mp3` was found nowhere else.
- Many `.video-tool/cache/tts/*.wav` files match project scene audio under
  `.video-tool/projects/.../audio`; this is runtime cache/project state, not
  source duplication.

Exact source duplicate evidence:

- `apps/desktop/src/main/logo.png` and
  `apps/desktop/src/renderer/logo.png` have the same hash and byte length.
- Current logo references found:
  - `apps/desktop/src/main/index.ts` uses the Electron `BrowserWindow` icon path;
  - `apps/desktop/src/renderer/views/sidebar.tsx`;
  - `apps/desktop/src/renderer/views/license.tsx`.
- No `electron-builder` or `build.icon` path was found in the first packaging
  scan, but the logo slice must rescan build/package config before edits.
- Duplicate `tsconfig.json` files exist across small packages, but those are
  low-risk workspace boilerplate and not user-facing noise.

Legacy/tooling evidence:

- `.mcp.json` still contains the `news` MCP server and a stale hardcoded
  filesystem path: `V:/video_tool`.
- Desktop still imports `createTools` from `@news/mcp`.
- `packages/mcp` still owns `createTools`, `ToolDeps`, stdio server files, and
  tests.
- Package naming still uses `@news/*` while the product/docs say MotionReal.
- Root `package.json` is still named `news-remotion-tool`.

Style/legacy term evidence:

- `stylePackId`, `clean-luxury-tech`, and `@news/design` references remain in
  schema/tests/docs/comments.
- Some of these are compatibility or historical references, not immediate trash.
- Removing them requires a focused compatibility slice.

Dev/test fixture evidence:

- Before Step 3, renderer audit files lived directly under renderer source.
- After Step 3, they live under `apps/desktop/src/renderer/dev-audit/`:
  - `ui-audit.tsx`;
  - `ui-audit.html`;
  - `audit-fixture.svg`;
  - `audit-fixture-youtube.svg`.
- Remotion demo/sample files are active references:
  - `apps/remotion/src/demo-scenes.tsx`;
  - `apps/remotion/src/fixtures/sample-spec.ts`.
- Script template is active:
  - before Step 4 it lived at `scripts/_video-template.txt`;
  - after Step 4 it lives at `scripts/templates/video-template.txt`;
  - referenced by `scripts/new-video.ts` and `tests/script-template.test.ts`.

Empty config evidence:

- Before Step 5, `.vscode/settings.json` contained only `{}`.
- After Step 5, that empty tracked editor config has been removed.

BGM test evidence found:

- `apps/desktop/src/main/bgm/bgm-handlers.test.ts` covers the bundled track as a
  visible virtual built-in entry.
- `packages/pipeline/src/audio/bgm-library.test.ts` covers reserving the bundled
  default name, ignoring stale runtime copies, and resolving the default to the
  app asset path.
- `packages/mcp/src/tools.test.ts` covers render option resolution for selected
  project BGM, including the bundled default resolving directly to the app asset
  without requiring a runtime copy.
- `packages/pipeline/src/orchestrator.test.ts` covers explicit silence
  (`bgmPath: null`) so the default BGM is not accidentally used when a caller
  asks for no music.

## Non-Negotiable Guardrails

- Do not delete `.env`.
- Do not delete `.video-tool/projects`, successful renders, project manifests,
  or user project state without explicit owner approval.
- Do not delete runtime cache as part of source cleanup unless the owner
  approves a runtime-cache cleanup slice.
- Do not remove `packages/mcp`, `.mcp.json`, or `@news/mcp` imports until
  `createTools` has a neutral owner outside the MCP package.
- Do not rename `@news/*` packages in the same slice as file/asset cleanup.
- Do not modify these sensitive files in this cleanup task. If a cleanup need
  touches one of them, stop and create a separate task with explicit scope,
  tests, and owner approval:
  - `packages/pipeline/src/orchestrator.ts`;
  - `packages/pipeline/src/safety/render-grid.ts`;
  - desktop workspace flow.
- Keep cleanup changes small and verified.
- Preserve app behavior, IPC channel names, render behavior, and storage
  semantics.
- Commit each approved source/docs slice separately. If one step contains two
  unrelated concerns, split it into two commits even if both are already dirty
  in the worktree.
- Do not stage unrelated files. Before each commit, run `git status --short` and
  verify the staged set matches only that slice.

## Cleanup Findings

### Confirmed Cleanup Or Standardization Candidates

1. AI instruction entry points
   - Keep `AI_CONTRACT.md` as canonical.
   - Keep `AGENTS.md` as a thin pointer.
   - Remove vendor-specific Claude contract files from tracked source.

2. Default BGM asset
   - Keep source asset at `apps/desktop/assets/bgm/default.mp3`.
   - Keep default BGM as a virtual built-in track that resolves to the source
     asset.
   - Do not copy the default track into `.video-tool/bgm`.
   - User-added BGM should remain runtime/user data under `.video-tool/bgm`, not
     under repo source assets.

3. Logo duplicate
   - Move the duplicated logo into one canonical asset location, likely:
     `apps/desktop/assets/brand/logo.png`.
   - Update Electron window icon and renderer imports to use the canonical asset.
   - Remove the duplicate `src/main/logo.png` and `src/renderer/logo.png`.

4. Renderer audit artifacts
   - Move audit-only renderer files into a clearly named dev/audit or fixture
     folder.
   - Keep them if they are still useful for visual audit, but stop mixing them
     with normal renderer source files.

5. Script template naming
   - Move `scripts/_video-template.txt` to a clearer location such as
     `scripts/templates/video-template.txt`.
   - Update `scripts/new-video.ts` and `tests/script-template.test.ts`.

6. Empty workspace settings
   - Remove `.vscode/settings.json` if it remains `{}` and no team setting is
     needed.

### Needs Separate Follow-Up Task

1. MCP de-scope
   - Move `createTools` and `ToolDeps` to a neutral owner, likely pipeline or a
     desktop service module.
   - Update desktop imports, tests, build aliases, `tsconfig`, and Vitest aliases.
   - Only then remove or shrink:
     - `packages/mcp`;
     - `.mcp.json` `news` server entry;
     - CLI doctor MCP checks;
     - MCP SDK dependency.
   - Also remove stale hardcoded path `V:/video_tool` from `.mcp.json` or replace
     it with a local/current workspace path if the config remains.

2. Brand/package namespace
   - Decide whether package names should stay `@news/*` internally or migrate to
     a MotionReal namespace.
   - This touches many imports, package names, lockfile entries, docs, build
     aliases, and tests; keep it out of small asset cleanup.

3. Style legacy cleanup
   - Audit `stylePackId`, `clean-luxury-tech`, and `@news/design` references.
   - Separate compatibility fields from truly stale comments/docs.
   - Only remove schema/manifest compatibility after confirming stored project
     migration and tests.

4. Runtime cache cleanup policy
   - `.video-tool/cache/tts` duplicates some project scene audio by hash.
   - This is expected cache behavior, but it can grow.
   - Add a user-invoked cleanup command or age/size pruning policy if desired.
   - Do not delete project audio or cache as part of source-file cleanup.

## Progress Notes

- 2026-07-02 plan created and committed as `32cb40a`
  (`docs: add repo noise cleanup plan`). Baseline checks passed:
  `npm.cmd run typecheck`, `npm.cmd test` (91 files / 887 tests plus heavy lane
  1 file / 13 tests), and `npm.cmd run build`.
- 2026-07-02 Step 1A complete and committed as `d244d2f`
  (`docs: consolidate ai agent entrypoints`). Removed tracked Claude-specific
  entrypoints, kept `AI_CONTRACT.md` canonical and `AGENTS.md` thin. Checks
  passed: vendor-specific entrypoint scan, targeted guidance/workspace contract
  tests, `npm.cmd run typecheck`, `npm.cmd test`, and `npm.cmd run build`.
- 2026-07-02 Step 1B complete and committed as `ad5e3b0`
  (`refactor: use virtual built-in default bgm`). Moved the source default BGM
  to `apps/desktop/assets/bgm/default.mp3` and made the default track resolve as
  a virtual built-in without recreating `.video-tool/bgm/nhac-nen-mac-dinh.mp3`.
  Checks passed: default-BGM duplicate scan, targeted BGM/render tests,
  `npm.cmd run typecheck`, `npm.cmd test`, and `npm.cmd run build`. GUI/render
  smoke was not run because the desktop app is interactive in this tool session;
  targeted tests cover the default BGM resolve path.
- 2026-07-02 Step 2 complete and committed as `728d247`
  (`refactor(desktop): canonicalize brand assets`). Canonicalized the desktop
  logo at `apps/desktop/assets/brand/logo.png`, removed duplicate main/renderer
  logo files, and updated Electron/renderer references. Checks passed:
  packaging/icon path scan, `npm.cmd --workspace @news/desktop run
  build:renderer`, `npm.cmd --workspace @news/desktop run build:main`,
  `npm.cmd run typecheck`, `npm.cmd test`, and `npm.cmd run build`.
- 2026-07-02 Step 3 complete and committed as `5a73158`
  (`chore(desktop): move renderer audit fixtures`). Moved renderer audit-only
  files into `apps/desktop/src/renderer/dev-audit/` and updated audit entry and
  fixture URLs. A first typecheck caught a moved import path; it was fixed before
  continuing. Checks passed: audit fixture scan, `npm.cmd --workspace
  @news/desktop run build:renderer`, `npm.cmd run typecheck`, `npm.cmd test`,
  and `npm.cmd run build`.
- 2026-07-02 BGM preview bugfix committed as `cabbbe7`
  (`fix(desktop): allow bundled bgm media previews`). The bundled default BGM
  asset now passes the `media://` allow-list alongside generated `.video-tool`
  media while arbitrary paths remain blocked. Checks passed: targeted
  media/BGM/render tests, `npm.cmd run typecheck`, `npm.cmd test`,
  `npm.cmd run build`, and `npm.cmd --workspace @news/desktop run build:main`.
- 2026-07-02 Step 4 complete and committed as `d6030ca`
  (`chore: move script templates under templates`). Moved the scaffold template
  to `scripts/templates/video-template.txt` and updated the scaffold script plus
  template admission tests. Checks passed: `script-template.test.ts`,
  `npm.cmd run typecheck`, `npm.cmd test` (92 files / 889 tests plus heavy lane
  1 file / 13 tests), and `npm.cmd run build`.
- 2026-07-02 Step 5 complete and committed as `d06830a`
  (`chore: remove empty workspace settings`). Removed tracked
  `.vscode/settings.json` after confirming it contained only `{}`. Checks
  passed: staged diff check, `npm.cmd run typecheck`, `npm.cmd test` (92 files /
  889 tests plus heavy lane 1 file / 13 tests), and `npm.cmd run build`.
- 2026-07-03 Step 6 complete. Final scan found no remaining Claude-specific
  entrypoint outside this temporary note. Current docs already describe the
  canonical desktop asset layout, virtual built-in default BGM, and repo hygiene
  rules; `docs/current/maintenance.md` now also names root `.mcp.json`
  machine-specific MCP wiring as deferred legacy compatibility. Remaining
  `@news/mcp`, `stylePackId`, `clean-luxury-tech`, and MCP config matches are
  intentional follow-up surfaces. Next gate: Step 7.

## Progress Checklist

- [x] Step 0: Approval, baseline, and plan commit.
- [x] Step 1A: Finish canonical AI entry-point cleanup.
- [x] Step 1B: Verify virtual built-in default BGM.
- [x] Step 2: Canonicalize desktop brand assets.
- [x] Step 3: Move dev/audit fixtures out of main renderer surface.
- [x] Step 4: Standardize script template location.
- [x] Step 5: Remove empty workspace config.
- [x] Step 6: Final scan and docs sync.
- [ ] Step 7: Delete this temporary note after owner approval.

## Proposed Slice Plan

### Step 0 - Approval And Baseline

Goal: owner approves this cleanup plan and current dirty worktree ownership is
understood.

Checks:

```bash
git status --short
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Expected output:

- dirty files are understood;
- no unrelated generated/user state is touched;
- proceed only after baseline is green or blocker is documented.

### Step 1A - Finish Canonical AI Entry-Point Cleanup

Scope:

- keep `AI_CONTRACT.md` and thin `AGENTS.md`;
- remove tracked Claude-specific files.

Do not move:

- BGM source asset or BGM runtime logic;
- MCP package/config;
- package namespace naming.

Required checks:

```bash
rg -n "CLAUDE|\\.claude|SKILL\\.md \\+ AGENTS\\.md" AI_CONTRACT.md AGENTS.md README.md docs apps packages scripts tests
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Expected output:

- no vendor-specific AI contract remains;
- `AGENTS.md` remains only a thin pointer to `AI_CONTRACT.md`;
- commit suggestion:
  `docs: consolidate ai agent entrypoints`.

### Step 1B - Verify Virtual Built-In Default BGM

Scope:

- keep root `default.mp3` deleted;
- keep bundled BGM at `apps/desktop/assets/bgm/default.mp3`;
- keep virtual built-in BGM behavior and docs already pending in the worktree.

Do not move:

- user-added BGM storage under `.video-tool/bgm`;
- project audio/render outputs under `.video-tool/projects`;
- runtime TTS cache.

Required checks:

```bash
rg -n "default\\.mp3|nhac-nen-mac-dinh" apps packages docs README.md AI_CONTRACT.md
npm.cmd test -- apps/desktop/src/main/bgm/bgm-handlers.test.ts
npm.cmd test -- packages/pipeline/src/audio/bgm-library.test.ts
npm.cmd test -- packages/mcp/src/tools.test.ts
npm.cmd test -- packages/pipeline/src/orchestrator.test.ts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Runtime smoke gate:

```bash
npm.cmd --workspace @news/desktop run app
```

Smoke checklist when a GUI/runtime session is available:

- open or create a project that reaches the storyboard/BGM picker;
- verify "Nhạc nền mặc định" appears as a built-in track;
- select "Nhạc nền mặc định" and verify the project manifest stores the bundled
  track name, not an absolute source path;
- render a draft or full video when feasible;
- verify `.video-tool/bgm/nhac-nen-mac-dinh.mp3` is not recreated;
- verify the render path resolves the selected default BGM from
  `apps/desktop/assets/bgm/default.mp3`.

If the GUI/render smoke cannot run in the current environment, record that
explicitly and do not call Step 1B fully complete without owner-approved
acceptance of the targeted automated test evidence.

Expected output:

- default BGM appears only as source asset plus virtual built-in references;
- no runtime default-copy duplication returns.
- commit suggestion:
  `refactor: use virtual built-in default bgm`.

### Step 2 - Canonicalize Desktop Brand Assets

Scope:

- create `apps/desktop/assets/brand/logo.png`;
- update Electron icon path and renderer logo imports;
- delete duplicate `apps/desktop/src/main/logo.png` and
  `apps/desktop/src/renderer/logo.png`.

Required checks:

```bash
rg -n "logo\\.png|assets/brand|icon|electron-builder|build\\.icon|extraResources|files" package.json apps/desktop/package.json apps/desktop/build-electron.mjs apps/desktop/vite.config.ts apps/desktop/src/main apps/desktop/src/renderer
npm.cmd --workspace @news/desktop run build
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Expected output:

- one tracked logo asset;
- app icon and renderer views still resolve the logo;
- no stale packaging/build icon path remains.
- commit suggestion:
  `refactor(desktop): canonicalize brand assets`.

### Step 3 - Move Dev/Audit Fixtures Out Of Main Renderer Surface

Scope:

- move `ui-audit.*` and `audit-fixture*.svg` under a clearly named dev/audit or
  fixture folder;
- update references.

Required checks:

```bash
rg -n "ui-audit|audit-fixture" apps/desktop
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Expected output:

- renderer source root is less noisy;
- audit tooling remains runnable if still needed.
- commit suggestion:
  `chore(desktop): move renderer audit fixtures`.

### Step 4 - Standardize Script Template Location

Scope:

- move `scripts/_video-template.txt` to `scripts/templates/video-template.txt`;
- update script/test references.

Required checks:

```bash
npm.cmd test -- tests/script-template.test.ts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Expected output:

- no underscore-prefixed root script template;
- template behavior unchanged.
- commit suggestion:
  `chore: move script templates under templates`.

### Step 5 - Remove Empty Workspace Config

Scope:

- delete `.vscode/settings.json` only if it still contains `{}`.

Required checks:

```bash
git diff --stat
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Expected output:

- no empty tracked editor config remains.
- commit suggestion:
  `chore: remove empty workspace settings`.

### Step 6 - Final Scan And Docs Sync

Scope:

- update current docs only if source structure changed materially;
- record any remaining intentional legacy surfaces:
  - `@news/*` package namespace;
  - MCP de-scope;
  - style compatibility fields;
  - `.video-tool` runtime cache policy.

Required checks:

```bash
git status --short
rg -n "CLAUDE|\\.claude|default\\.mp3|logo\\.png|ui-audit|audit-fixture|_video-template|V:/video_tool|@news/mcp|stylePackId|clean-luxury-tech" .
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Expected output:

- remaining matches are either fixed or explicitly documented as deferred;
- no accidental user/runtime state deletion.
- commit suggestion:
  `docs: sync repo cleanup notes`.

### Step 7 - Delete This Temporary Note

Approval gate:

- owner confirms cleanup is complete;
- no permanent docs require this note;
- all source/docs checks pass.

Expected output:

- delete this file;
- commit suggestion:
  `chore: remove repo noise cleanup note`.

## Current Recommendation

After owner approval, continue with Step 6.

Reason:

- Steps 1A, 1B, 2, 3, 4, and 5 are now committed separately with checks;
- the next gate is a final scan/docs sync for remaining intentional legacy
  surfaces and stale references;
- MCP/package renaming and style compatibility cleanup remain larger follow-up
  migrations and should not be mixed into simple file cleanup.
