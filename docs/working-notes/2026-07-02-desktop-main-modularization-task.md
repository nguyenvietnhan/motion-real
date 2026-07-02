# Temporary Task - Desktop Main Modularization

Status: planning scan complete; external review reconciled; Step 0 baseline
next.

This is a temporary working task for thinning
`apps/desktop/src/main/index.ts`. It is not project contract. Current contract
remains `AI_CONTRACT.md` plus `docs/current/`.

Delete this file only after the desktop-main slice is complete, final docs sync
is done, and the owner approves cleanup of the temporary note.

## Objective

Reduce `apps/desktop/src/main/index.ts` pressure by extracting small, tested
main-process modules without changing desktop behavior, IPC channels, render
semantics, settings semantics, voice/TTS fallback behavior, or project storage.

The goal is not to hide all startup wiring behind one large dependency object.
`index.ts` may remain the top-level composition root. The goal is to move
testable native-IO helpers and handler groups into local modules where the
boundary is clear.

## Current Scan Evidence

Scan date: 2026-07-02.

Repo/documentation context:

- `AI_CONTRACT.md` says `docs/working-notes/` is temporary planning only.
- `docs/current/maintenance.md` lists `apps/desktop/src/main/index.ts` as a
  sensitive file and names "thin desktop main wiring" as the next cleanup order.
- The first `workspace-controller.ts` pass is complete; do not reopen desktop
  workspace orchestration as part of this task.
- Dirty worktree contains only the pre-existing `packages/mcp/src/bin.ts`
  change. Do not touch it in this task.

External review reconciliation:

- An outside review correctly flagged an internal line-count inconsistency. The
  initial `697 lines` value came from a PowerShell `Measure-Object -Line`
  undercount. Rechecking with `(Get-Content index.ts).Count` shows 735 physical
  lines, and the app lifecycle block really ends at line 735. The line range
  `647-735` is therefore correct; the file-size statement was wrong and is
  corrected below.
- The review also correctly asked for clearer Step 0/Step 1 sequencing,
  explicit 9router/Vivibe alias definitions, an image-promotion deferral
  decision, and native-runtime smoke guidance. Those corrections are now part of
  this note.
- The suggestion to change `647-735` to `647-697` is rejected because the source
  file has 735 physical lines.

`index.ts` current shape:

- 735 physical lines.
- Imports Electron, Node fs/path/url, `@news/mcp`, a wide set of
  `@news/pipeline` APIs, and many local desktop modules.
- Existing extracted seams already present:
  - `SettingsStore`;
  - `CreateController`;
  - `WorkspaceController`;
  - `runStartupSequence`;
  - `registerIpcRouter`;
  - `media-protocol`;
  - `runtime-security`;
  - gateway and license managers.
- `INVOKE_CHANNELS` and `handlers` currently match exactly:
  41 invoke channels, 41 handlers, no missing or extra handler key.
- In this repo, "9router" means the local model gateway transport used by
  `NineRouterClient`, `ModelGatewayManager`, and `NineRouterAuthoringBackend`.
  It is documented in `docs/current/desktop-flow.md`, `docs/current/overview.md`,
  and ADR-005, and is not a typo.

Major responsibility ranges in `index.ts`:

| Lines | Responsibility | Current risk |
| --- | --- | --- |
| 36-89 | `.env` read, boot voice env, non-sensitive apply, secret scrubbing | security-sensitive boot order |
| 91-118 | BGM view-model and built-in BGM exposure | contained, testable |
| 128-146 | settings store construction | already uses tested `SettingsStore` |
| 148-198 | MCP tools, TTS config, 9router gateway, authoring backend, worker | central composition, keep mostly in root for now |
| 203-258 | `WorkspaceController` deps | wide but mostly wiring; avoid moving whole object early |
| 261-312 | `CreateController` deps, scaffold/preflight/promote images | partly tested by create-flow tests; keep promotion root-owned for now |
| 316-431 | native picked/dropped image staging, unstage, stale sweep | strong extraction candidate after the env slice |
| 437-638 | 41 IPC invoke handlers | split only after helper groups are smaller |
| 647-735 | gateway start, Electron window, app-ready startup lifecycle | side-effect-heavy; keep root-owned until late audit |

Test evidence found:

- `apps/desktop/src/main/security/runtime-security.test.ts` covers secret
  scrubbing, non-sensitive env application, child env sanitizing, and privilege
  gate behavior.
- `apps/desktop/src/main/settings/settings-store.test.ts` covers settings load,
  update, encrypted credentials, refine-pass migration, and calibrated WPS.
- `apps/desktop/src/main/create/create-flow.test.ts` covers
  `CreateController.create(...)` scaffold handoff, preflight,
  voice-provider/language choices, and staged image promotion through the
  controller seam.
- `apps/desktop/src/main/create/create-controller.test.ts` covers
  `validateCreateInput(...)` re-export behavior.
- `apps/desktop/src/main/workspace/workspace-controller.test.ts` covers project
  stage/list/open/render/refine/publish/workspace behavior. Do not duplicate
  workspace orchestration in this task.
- `apps/desktop/src/main/startup-sequence.test.ts` covers reconcile before
  gateway/window startup.
- `apps/desktop/src/main/gateway/*.test.ts` covers gateway lifecycle and model
  readiness.
- `packages/pipeline/src/audio/bgm-library.test.ts` covers low-level BGM library
  storage, but desktop BGM view-model/handler behavior is not isolated.
- `packages/pipeline/src/assets/import-image.test.ts` covers low-level image
  import, but desktop staging/unstage/sweep behavior is not isolated.

Gaps this task should close before or during extraction:

- direct tests for desktop `.env` parsing/boot voice precedence;
- direct tests for desktop image staging wrappers;
- direct tests for desktop BGM view-model and handler behavior;
- direct tests for native save/export helper behavior;
- optional direct test that every `INVOKE_CHANNELS` entry has a handler when
  handler construction is extracted.

Explicit deferrals from the scan:

- `promoteImages` stays inside the `CreateController` dependency construction in
  `index.ts` during Step 2. It reads staged files, imports bytes into a project's
  `assetsDir`, logs per-image failures, and is already protected through
  `create-flow.test.ts`. Step 2 only extracts the pre-project staging/delete/
  sweep helpers. Revisit `promoteImages` only during Step 6 if the remaining
  create dependency object is still a clear pressure point.
- App lifecycle hooks stay root-owned until Step 7 because their ordering around
  `registerMediaScheme()`, `handleMediaProtocol()`, stale-state reconciliation,
  gateway start, and window creation is more important than raw line count.

## Non-Negotiable Guardrails

- Do not change IPC channel names or payload shapes.
- Do not change draft-first, render, refine, publish, or workspace stage logic.
- Do not change TTS provider fallback or silently downgrade voice provider.
- Do not change `SettingsStore` persistence semantics.
- Do not touch `packages/mcp/src/bin.ts`.
- Do not touch `packages/pipeline/src/orchestrator.ts` or
  `packages/pipeline/src/safety/render-grid.ts`.
- Do not create a new package or public barrel for this task.
- Keep extractions local to `apps/desktop/src/main` unless a later owner-approved
  slice proves a shared module is needed.
- Prefer exact dependency functions over passing Electron globals or the whole
  controller into helpers.
- Keep `index.ts` as the composition root unless a later close audit shows a
  smaller, tested handler builder is genuinely clearer.

## Approval Model

Every source slice needs:

- a narrow diff;
- no unrelated files staged;
- no behavior change unless explicitly approved;
- direct helper tests for newly extracted behavior or named existing coverage;
- `npm.cmd run typecheck`;
- targeted test(s) for the touched module;
- `npm.cmd test`;
- `npm.cmd run build`.

For source slices that move native dialog, IPC-handler, startup, or runtime-IO
behavior, add a desktop runtime smoke when feasible:

```bash
npm.cmd --workspace @news/desktop run app
```

Smoke checklist depends on the touched slice:

- image staging: open the app and exercise pick/import/remove image if a GUI
  session is available;
- BGM: list/add/remove/select a BGM track if a GUI session is available;
- native save/export: generate or use an existing artifact and cancel/save from
  the native dialog if a GUI session is available;
- startup/window: verify the app opens normally.

If a GUI/runtime smoke cannot run in the current environment, record that
explicitly before continuing.

For docs-only planning slices:

```bash
git diff --stat
git diff -- docs/working-notes/2026-07-02-desktop-main-modularization-task.md
rg -n "Status:|Step|desktop main|index.ts|BGM|image staging|IPC" docs/working-notes/2026-07-02-desktop-main-modularization-task.md
```

If any check fails:

1. stop the next slice;
2. fix or document the blocker;
3. rerun the relevant checks;
4. only then continue.

## Progress Log Hygiene

Use this file for decisions, slice scope, and final check summaries. Do not
paste long command logs or full diffs here.

For each completed step, add at most:

- status;
- commit hash if committed;
- checks run;
- blocker or next decision.

## Progress Notes

- 2026-07-02 planning scan complete. Read `AI_CONTRACT.md`,
  `docs/current/maintenance.md`, `docs/current/architecture.md`, and
  `docs/working-notes/README.md`; audited `index.ts`, IPC channels, current
  tests, and related desktop modules. No source code moved. Next gate: Step 0.
- 2026-07-02 external review reconciled. Corrected the `index.ts` line count to
  735 physical lines, kept the verified `647-735` lifecycle range, clarified
  Step 0-before-Step 1 sequencing, documented 9router and Vivibe env aliases,
  deferred `promoteImages`, added native runtime-smoke guidance, and tightened
  Step 2 targeted checks. No source code moved. Next gate: Step 0.

## Progress Checklist

- [x] Planning scan: read contract/docs and audit `index.ts` responsibility map.
- [ ] Step 0: Baseline and dirty-worktree ownership.
- [ ] Step 1: Extract runtime env parsing/boot voice helpers.
- [ ] Step 2: Extract create-time image staging helpers.
- [ ] Step 3: Extract BGM view-model and handlers.
- [ ] Step 4: Extract native save/export helpers.
- [ ] Step 5: Extract small create/project IPC payload helpers.
- [ ] Step 6: Decide whether to extract a handler builder or stop.
- [ ] Step 7: Window/startup close audit.
- [ ] Step 8: Final docs/code sync.
- [ ] Step 9: Delete this temporary task file.

## Step 0 - Baseline And Dirty-Worktree Ownership

Goal: establish a fresh green baseline before source edits.

Actions:

```bash
git status --short
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Expected findings:

- `packages/mcp/src/bin.ts` may remain dirty and unrelated.
- No unrelated file is staged.
- Default `npm.cmd test` should use the stabilized heavy-lane split from the
  prior test-stability slice.

Approval gate:

- current baseline checks pass;
- dirty files are understood;
- no source code has moved.

Expected output:

- progress note with pass/fail status;
- no commit required unless the owner wants to commit this plan first.
- only after Step 0 passes may Step 1 source work begin.

## Step 1 - Extract Runtime Env Parsing/Boot Voice Helpers

Goal: move testable env parsing and boot voice precedence out of `index.ts`
without moving the security-sensitive side effects.

Destination:

- `apps/desktop/src/main/security/runtime-env.ts`
- `apps/desktop/src/main/security/runtime-env.test.ts`

Scope:

- move `.env` text parsing out of `index.ts`;
- add a pure helper for resolving boot voice env from `process.env`-like values
  plus file env values;
- preserve the current env-name precedence exactly:
  - Vivibe API key: `VIVIBE_API_KEY`, then `VIETNAMESE_API_KEY`, then the same
    names from the `.env` file;
  - Vivibe voice id: `VIVIBE_VOICE_ID`, then `VIETNAMESE_VOICEID`, then the same
    names from the `.env` file;
  - ElevenLabs API key: `ELEVENLABS_API_KEY`, then the same name from `.env`;
  - ElevenLabs voice id: `ELEVENLABS_VOICE_ID`, then the same name from `.env`;
- keep these side effects in `index.ts`:
  - `applyNonSensitiveEnvironment(fileEnv)`;
  - `scrubSensitiveEnvironment(fileEnv)`;
  - `scrubSensitiveEnvironment(process.env)`.

Do not move:

- `SettingsStore` construction;
- safeStorage encryption;
- privilege detection;
- app startup.

Expected helper shape:

```ts
export function parseEnvText(text: string): Record<string, string>
export function readEnvFile(path: string, deps?: { exists(path: string): boolean; readText(path: string): string; warn(error: unknown): void }): Record<string, string>
export function resolveBootVoiceEnv(processEnv: Record<string, string | undefined>, fileEnv: Record<string, string | undefined>): BootVoiceEnv
```

Test evidence map:

| Behavior touched | Existing test(s) | Gap? | New test |
| --- | --- | --- | --- |
| secret scrubbing remains in security layer | `runtime-security.test.ts` | side effects not moved | rerun existing test |
| `.env` parsing comments, quotes, whitespace | none direct | yes | add `runtime-env.test.ts` |
| process env wins over file env | only implicit in `index.ts` | yes | add direct precedence test |
| legacy Vivibe env aliases `VIETNAMESE_API_KEY` and `VIETNAMESE_VOICEID` still work | only implicit in `index.ts` | yes | add direct alias test |

Required checks:

```bash
npm.cmd run typecheck
npm.cmd test -- apps/desktop/src/main/security/runtime-env.test.ts
npm.cmd test -- apps/desktop/src/main/security/runtime-security.test.ts
npm.cmd test
npm.cmd run build
```

Expected output:

- `index.ts` keeps the same boot side-effect order but imports env helpers.
- No Electron app lifecycle code moves.
- No public API changes.
- Commit suggestion: `refactor(desktop): extract runtime env helpers`.

## Step 2 - Extract Create-Time Image Staging Helpers

Goal: move native create-image staging behavior into a tested create-domain
module while preserving picker/import/unstage/sweep semantics.

Destination:

- `apps/desktop/src/main/create/image-staging.ts`
- `apps/desktop/src/main/create/image-staging.test.ts`

Step 2A scope:

- extract `stageImported`;
- extract dropped-image import loop;
- keep the Electron native picker wrapper in `index.ts` until 2A is green;
- pass exact dependencies for staging dir, image importer, media URL builder,
  and logger.

Step 2B scope:

- extract `unstageImage`;
- extract `sweepStagingDir`;
- pass exact filesystem dependencies (`readdir`, `stat`, `rm`, `now`) for tests.

Step 2C optional scope:

- extract the native picker adapter only after 2A/2B are green;
- pass exact dialog/read-file dependencies;
- keep the real `BrowserWindow.getFocusedWindow()` call in `index.ts` if moving
  it makes the helper harder to test.

Do not move:

- `CreateController`;
- `WorkspaceController.beginCreate`;
- crawl/image-review workflow;
- pipeline `importImageBytes` implementation.
- `promoteImages` from the `CreateController` deps; it is a project-asset
  promotion seam, not pre-project staging.

Test evidence map:

| Behavior touched | Existing test(s) | Gap? | New test |
| --- | --- | --- | --- |
| successful import returns staged preview URL/ref/size/name | pipeline import tests cover low-level import only | yes | add direct staging helper test |
| importer rejection becomes per-file rejection | pipeline import tests cover reason, not desktop shape | yes | add direct staging helper test |
| dropped base64 decode failure logs and continues | none direct | yes | add direct dropped-image test |
| `unstageImage` refuses non-staging refs and collapses traversal to basename | only comment in `index.ts` | yes | add path-safety test |
| stale sweep deletes only old entries and never blocks startup | none direct | yes | add sweep test |

Required checks:

```bash
npm.cmd run typecheck
npm.cmd test -- apps/desktop/src/main/create/image-staging.test.ts
npm.cmd test -- apps/desktop/src/main/create/create-flow.test.ts
npm.cmd test -- apps/desktop/src/main/create/create-controller.test.ts
npm.cmd test
npm.cmd run build
```

Expected output:

- `index.ts` delegates staged image import/delete/sweep to `create/image-staging`.
- Desktop create/image behavior is unchanged.
- No IPC channel changes.
- Commit suggestion: `refactor(desktop): extract image staging helpers`.

## Step 3 - Extract BGM View-Model And Handlers

Goal: move BGM library view-model shaping and contained BGM IPC behavior out of
`index.ts`.

Destination:

- `apps/desktop/src/main/bgm/bgm-handlers.ts`
- `apps/desktop/src/main/bgm/bgm-handlers.test.ts`

Step 3A scope:

- move `BUNDLED_BGM_NAME`;
- move `toBgmVM` as `bgmTrackViewModel`;
- move built-in track exposure/listing as `listBgmViewModels` with exact deps.

Step 3B scope:

- create `createBgmHandlers(...)` returning only:
  - `bgm:list`;
  - `bgm:add`;
  - `bgm:remove`;
  - `bgm:getForProject`;
  - `bgm:setForProject`.
- pass exact deps for picker, BGM library functions, manifest load/write, media
  URL, and logging.

Do not move:

- pipeline BGM library implementation;
- manifest schema;
- workspace render/publish behavior;
- project-level silence semantics.

Test evidence map:

| Behavior touched | Existing test(s) | Gap? | New test |
| --- | --- | --- | --- |
| built-in track gets Vietnamese label and `builtIn: true` | none direct | yes | add direct VM test |
| KB/MB size labels stay stable | none direct | yes | add direct VM test |
| list exposes bundled default when file exists and swallows exposure failure | none direct | yes | add handler/list test |
| add skips bad tracks and returns updated list | pipeline BGM tests cover library, not desktop handler | yes | add handler test |
| remove refuses bundled default | none direct | yes | add handler test |
| get/set project BGM reads and patches manifest without throwing on failures | none direct | yes | add handler test |

Required checks:

```bash
npm.cmd run typecheck
npm.cmd test -- apps/desktop/src/main/bgm/bgm-handlers.test.ts
npm.cmd test -- packages/pipeline/src/audio/bgm-library.test.ts
npm.cmd test
npm.cmd run build
```

Expected output:

- `index.ts` imports BGM handlers/helpers instead of owning BGM flow.
- BGM IPC channel behavior is unchanged.
- No pipeline behavior changes.
- Commit suggestion: `refactor(desktop): extract bgm handlers`.

## Step 4 - Extract Native Save/Export Helpers

Goal: remove duplicated native save/export logic for full MP4 and thumbnail PNG
while keeping user-initiated writes and redacted error surfaces unchanged.

Destination:

- `apps/desktop/src/main/export/native-save.ts`
- `apps/desktop/src/main/export/native-save.test.ts`

Scope:

- extract safe filename/stem helper;
- extract project-title lookup helper if it can be kept dependency-injected;
- extract `saveProjectVideo`;
- extract `saveProjectThumbnail`;
- pass exact deps for:
  - `exists`;
  - `copyFile`;
  - `showSaveDialog`;
  - current output dir;
  - downloads dir;
  - project title lookup;
  - source path builders;
  - logging.

Do not move:

- `workspace.generateThumbnail`;
- pipeline `renderThumbnail`;
- Electron app lifecycle;
- media protocol.

Test evidence map:

| Behavior touched | Existing test(s) | Gap? | New test |
| --- | --- | --- | --- |
| missing source resolves `{ saved:false }` | none direct | yes | add direct test |
| cancel resolves `{ saved:false }` and does not copy | none direct | yes | add direct test |
| invalid filename chars are replaced | none direct | yes | add direct test |
| copy failure returns Vietnamese redacted reason | none direct | yes | add direct test |
| video and thumbnail default paths use outputDir or downloads | none direct | yes | add direct test |

Required checks:

```bash
npm.cmd run typecheck
npm.cmd test -- apps/desktop/src/main/export/native-save.test.ts
npm.cmd test
npm.cmd run build
```

Expected output:

- `projects:save` and `thumbnail:save` delegate to `export/native-save`.
- User-initiated export remains the only write outside `.video-tool`.
- Error messages remain generic and Vietnamese.
- Commit suggestion: `refactor(desktop): extract native save helpers`.

## Step 5 - Extract Small Create/Project IPC Payload Helpers

Goal: reduce inline IPC coercion without moving controller ownership.

Destination:

- `apps/desktop/src/main/create/create-ipc.ts`
- `apps/desktop/src/main/create/create-ipc.test.ts`

Scope:

- move `parseVoiceProvider`;
- extract a pure helper for converting raw `projects:create` payload into
  `CreateController.create(...)` arguments;
- preserve stale `titleLanguage: "mix"` handling through `CreateController`;
- keep `create.create(...)` call in `index.ts`.

Do not move:

- `CreateController`;
- scaffold/tool wiring;
- preflight behavior;
- image promotion.

Test evidence map:

| Behavior touched | Existing test(s) | Gap? | New test |
| --- | --- | --- | --- |
| valid voice providers pass through | create-flow tests cover controller, not IPC coercion | yes | add direct helper test |
| invalid voice provider throws Vietnamese message | none direct | yes | add direct helper test |
| format/tier/language/images are preserved | create-flow tests cover downstream effects | direct IPC shape not isolated | add direct helper test |
| legacy titleLanguage only applies when videoLanguage absent | create-flow tests cover normalization | direct IPC shape not isolated | add direct helper test |

Required checks:

```bash
npm.cmd run typecheck
npm.cmd test -- apps/desktop/src/main/create/create-ipc.test.ts
npm.cmd test -- apps/desktop/src/main/create/create-flow.test.ts
npm.cmd test
npm.cmd run build
```

Expected output:

- `projects:create` handler reads as a small adapter.
- Voice provider validation is directly testable.
- No IPC or create behavior changes.
- Commit suggestion: `refactor(desktop): extract create ipc helpers`.

## Step 6 - Handler Builder Decision

Goal: decide deliberately whether to extract the remaining `handlers` map.

Audit after Steps 1-5:

- count remaining `index.ts` lines;
- list remaining inline handler groups;
- compare handler deps needed for a potential builder.

Expected decision unless evidence changes:

- do not create a single giant `buildDesktopHandlers(deps)` if it requires
  passing nearly every service and Electron primitive;
- consider tiny group builders only if their deps are already contained:
  - license/AI gateway handlers;
  - script/review/workspace delegation handlers;
  - settings/TTS handlers.

Possible destination only if justified:

- `apps/desktop/src/main/desktop-handlers.ts`
- `apps/desktop/src/main/desktop-handlers.test.ts`

Handler-builder test evidence if extracted:

| Behavior touched | Existing test(s) | Gap? | New test |
| --- | --- | --- | --- |
| every invoke channel has a handler | `ipc-router` registers all channels, but no handler-map completeness test | yes | add direct completeness test |
| simple delegation handlers coerce args exactly | broad controller tests are indirect | yes for moved groups | add direct delegation tests |

Required checks if source moves:

```bash
npm.cmd run typecheck
npm.cmd test -- apps/desktop/src/main/desktop-handlers.test.ts
npm.cmd test
npm.cmd run build
```

Expected output:

- either a small handler builder with direct tests, or a written stop decision
  explaining why `index.ts` should keep root handler composition.
- Commit suggestion if code changed:
  `refactor(desktop): group desktop ipc handlers`.

## Step 7 - Window/Startup Close Audit

Goal: avoid moving Electron lifecycle side effects just to reduce line count.

Audit scope:

- `registerMediaScheme()`;
- `handleMediaProtocol()`;
- `startGateway()`;
- `createWindow()`;
- `app.whenReady()`;
- `app.on("window-all-closed")`;
- `app.on("activate")`.

Expected decision unless new evidence appears:

- keep `registerMediaScheme()` in `index.ts` because it must run before app
  ready;
- keep app lifecycle hooks in `index.ts`;
- keep `runStartupSequence` as the tested ordering seam;
- consider a tiny `desktop-window.ts` only if it extracts options without making
  Electron lifecycle harder to inspect.

Required checks if no source moves:

```bash
npm.cmd run typecheck
npm.cmd test -- apps/desktop/src/main/startup-sequence.test.ts
npm.cmd test
npm.cmd run build
```

Expected output:

- close note explaining which Electron lifecycle code remains root-owned.
- No source move unless a tiny, directly testable window-options helper is
  proven useful.

## Step 8 - Final Docs/Code Sync

Goal: update current docs only if the desktop-main structure materially changes.

Possible docs:

- `docs/current/architecture.md`;
- `docs/current/maintenance.md`.

Actions:

- record any new local modules and what remains in `index.ts`;
- do not turn this working note into contract text;
- scan for stale references to moved helpers.

Required checks:

```bash
git diff --stat
rg -n "desktop main|index.ts|image-staging|bgm-handlers|native-save|runtime-env" docs apps/desktop/src/main
```

Expected output:

- docs are truthful;
- no stale file references;
- commit suggestion:
  `docs: sync desktop main modularization notes`.

## Step 9 - Delete Temporary Task File

Goal: remove this working note when the task is complete.

Actions:

```bash
rg -n "2026-07-02-desktop-main-modularization-task|desktop main modularization" .
git diff --stat
```

Approval gate:

- all source/doc slices are committed;
- no remaining reference requires this temporary note;
- owner approves deletion.

Expected output:

- this file deleted;
- commit suggestion:
  `chore: remove desktop main modularization task note`.

## Current First Source Slice Recommendation

After Step 0 passes, start with Step 1.

Reason:

- it is narrow and testable;
- it reduces top-of-file boot logic without moving side effects;
- it improves coverage for `.env` parsing and voice-env precedence;
- it does not touch IPC, workspace, create, render, publish, or Electron app
  lifecycle.
- Step 2 remains a strong extraction candidate, but it touches native image
  dialog/staging filesystem behavior and therefore comes after the smaller
  env-helper slice proves the process.

If Step 1 reveals boot/security ambiguity, stop and fix that before any BGM or
image staging extraction.
