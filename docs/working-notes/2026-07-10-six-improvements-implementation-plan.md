# Plan — Six bounded MotionReal improvements

**Status:** implemented (six phase commits on `codex/gpt-5-6-feature-review`)  
**Prepared:** 2026-07-10  
**Branch:** `codex/gpt-5-6-feature-review`  
**Baseline commit:** `7cd2f1e` (`chore: add Codex MCP configuration`)  
**Executor:** Grok 4.5 (or another fresh agent)  
**Owner workflow:** `Kiểm tra -> Duyệt -> Làm -> kiểm tra -> Duyệt -> Commit` per phase

This is a temporary execution note. It is deliberately specific enough for a
fresh executor to implement one phase at a time without rediscovering product
intent or silently widening scope. Accepted behavior must be synchronized to
`docs/current/architecture.md` and/or `docs/current/maintenance.md` when the
corresponding phase lands.

---

## 1. Purpose and order

Implement these six product/reliability improvements as six independent,
commit-sized phases:

| Phase | Improvement | Why it is first-class |
| --- | --- | --- |
| 1 | Persist the selected AI model | A deliberate GPT-5.6 selection must not silently change after restart or model-list reorder. |
| 2 | Make visual-QA coverage truthful | A skipped/failed QA pass must never count as a clean pass for early stop. |
| 3 | Add desktop readiness report | Users need a safe, no-cost explanation of gateway/TTS/render readiness before spending authoring/render quota. |
| 4 | Synchronize draft player with scenes | Review should move between scene rail and draft MP4 using the locked timeline, not estimated timestamps. |
| 5 | Add safe per-project diagnostic and repair trace | Users/support need a historical, redacted explanation of what happened without reading raw logs. |
| 6 | Persist claim/source provenance for script review | A fact grounded in a URL should be inspectable before draft render; a URL that could not be read must not look like evidence. |

### Dependency order

1. Phase 1 establishes an explicit selected-model state.
2. Phase 2 fixes a correctness bug without changing any hard safety gate.
3. Phase 3 can then report the persisted model state accurately.
4. Phase 4 only reads an already-written locked spec; it must not alter render
   timing or the pipeline.
5. Phase 5 consumes existing events and safe user-facing repairs; it must not
   expose raw logs.
6. Phase 6 is the largest authoring/data change and should be last, after the
   earlier desktop surfaces are stable.

Do not combine phases in one commit. A failed phase must be fixed or reverted
before the next phase starts.

---

## 2. Required reading and baseline procedure

Every fresh executor must read, in this order:

1. `AGENTS.md`
2. `AI_CONTRACT.md`
3. `docs/current/architecture.md`
4. `docs/current/authoring-contract.md`
5. `docs/current/maintenance.md`
6. `docs/working-notes/2026-07-09-plan-g-godfile-seams.md`
7. This file

Before every phase, run and report:

```powershell
git status --short --untracked-files=all
git branch --show-current
git log -1 --oneline
git diff --check
```

Expected start state for the first phase:

```text
branch: codex/gpt-5-6-feature-review
HEAD:   7cd2f1e chore: add Codex MCP configuration
status: clean
```

If the worktree is not clean, do not stage/revert/delete somebody else's work.
Report the exact dirty paths and ask the owner how to proceed.

### Per-phase control loop

For each phase:

1. **Kiểm tra:** re-read the listed files and confirm every target test path
   exists with `Test-Path` or `rg --files`.
2. **Duyệt:** show the phase's exact proposed file list and wait for approval
   before editing.
3. **Làm:** implement only that phase. Do not opportunistically refactor
   `orchestrator.ts`, `render-grid.ts`, `workspace-controller.ts`,
   `ninerouter-backend.ts`, or `main/index.ts` beyond the explicit seams below.
4. **Kiểm tra:** run the focused tests, `git diff --check`, and the required
   wider gate for the touched layer.
5. **Duyệt:** report behavior, tests, docs, and diff summary; wait for commit
   approval.
6. **Commit:** stage only the approved phase, commit once, re-run
   `git status --short`, and update this status board.

### Global non-negotiables

- Keep pure AUTHOR mode. Authored scene imports remain limited to `react`,
  `remotion`, `zod`, and `@motionreal/compositions`.
- Do not add a template catalog, authored layout blocks, themes, or style
  selection.
- Do not change draft-before-full, TTS provider/voice selection, or add any
  hidden `mock`/`none`/provider fallback.
- Visual QA remains advisory. It may influence an existing bounded refine pass,
  but it must not become a new hard render gate.
- Renderer code crosses IPC only through the typed allow-list. It receives no
  Node APIs, filesystem paths, raw pipeline errors, raw AI replies, prompts, or
  credentials.
- Do not expose model API keys, encrypted values, raw Pino logs, source bodies,
  authored TSX, N-codes, stack traces, hash values, or absolute paths.
- Do not implement YouTube long-form, cross-project parallel rendering, true
  LRU, a queue, or new authoring retries in this plan.

---

## 3. Phase 0 — informational preflight only

This is not an implementation phase and does not get a feature commit.

```powershell
npm.cmd run typecheck
```

Do not run a real provider flow merely to begin this plan. The local machine may
be missing provider credentials or a reachable 9router gateway; code health and
live-provider readiness are separate facts.

If a later full test run flakes at
`packages/pipeline/src/safety/typecheck-authored.test.ts`, first run that file
directly, then repeat the broad suite with one worker before treating it as a
product regression:

```powershell
npm.cmd test -- --run packages/pipeline/src/safety/typecheck-authored.test.ts
npm.cmd test -- --maxWorkers=1
```

---

# Phase 1 — Persist explicit AI model selection

## Outcome

The model selected by the user is persisted as a preference. On restart:

- if that exact model is still returned by 9router, it is restored;
- if it is unavailable, the UI says so and does **not** silently select a
  different model;
- only a first-use installation with no saved preference may select the first
  available model, and that choice is immediately persisted;
- runtime `AiAccountState` remains non-persistent exactly as today.

This is essential for a reproducible GPT-5.6 experiment: a selected model must
not change merely because gateway ordering changes.

## Current evidence

- `apps/desktop/src/renderer/App.tsx` selects `ms[0]` when the gateway reports
  an account with no selected model.
- `apps/desktop/src/main/gateway/model-gateway-manager.ts` stores `selected`
  only in process memory.
- `SettingsModel` and `SettingsStore` already provide the correct persistent,
  secret-safe settings boundary, but have no AI-model preference field.

## Exact implementation slices

### 1.1 Add a safe persisted field and pure decision helper

Create `apps/desktop/src/shared/model-selection.ts` with no Electron/Node
imports. It owns:

```ts
export type PreferredModelDecision =
  | { kind: "select-and-persist"; modelId: string }
  | { kind: "select-runtime"; modelId: string }
  | { kind: "unavailable"; modelId: string }
  | { kind: "wait" };

export function normalizePreferredAiModelId(value: unknown): string | undefined;
export function preferredModelDecision(input: {
  preferredModelId?: string;
  runtimeModelId?: string;
  availableModelIds: readonly string[];
}): PreferredModelDecision;
```

Rules for `normalizePreferredAiModelId`:

- accept only a string;
- trim it;
- return `undefined` for empty/non-string input;
- cap the persisted value at a modest, documented maximum (for example 256
  characters) rather than persisting arbitrary IPC input.

Rules for `preferredModelDecision`:

| Condition | Decision |
| --- | --- |
| no available models | `wait` |
| saved preference is available and differs from runtime selection | `select-runtime` saved id |
| saved preference is available and already selected | `wait` |
| saved preference is absent from available models | `unavailable` saved id |
| no saved preference and runtime selection is available | `select-and-persist` runtime id |
| no saved preference and no runtime selection | `select-and-persist` first available id |

Do not choose a first model in the `unavailable` branch.

### 1.2 Persist it through SettingsStore

Modify:

- `apps/desktop/src/shared/types.ts`
- `apps/desktop/src/main/settings/settings-store.ts`
- `apps/desktop/src/shared/settings-model.ts` only if a default/comment needs to
  state the first-use behavior

Add this optional field to `SettingsModel`:

```ts
/** User's explicit generation-model preference; runtime account state remains transient. */
preferredAiModelId?: string;
```

In `SettingsStore`:

- normalize the field both when merging disk data and when applying a patch;
- let older settings files omit it without migration work;
- keep it in normal public settings persistence;
- continue excluding `aiAccount`, `voiceCredentials`, and secrets from disk;
- do not persist an unavailable model as a different fallback value.

### 1.3 Restore and select from the renderer, only after settings load

Modify `apps/desktop/src/renderer/App.tsx` and
`apps/desktop/src/renderer/views/settings.tsx`.

Required behavior:

1. Add a `settingsLoaded`/equivalent guard so the gateway polling path cannot
   auto-select a first model before `settings:get` resolves.
2. Use `preferredModelDecision` after the model list and account state are
   available.
3. Deduplicate in-flight selection by model id (a `useRef` is sufficient) so
   the 1.5-second poll cannot issue duplicate `ai:selectModel` calls.
4. For `select-and-persist`, call `ai.selectModel`, then persist
   `preferredAiModelId` through `settings.update`; update both local states.
5. For `select-runtime`, restore the saved id through `ai.selectModel` but do
   not rewrite settings.
6. For `unavailable`, leave no selected model, keep `aiReady` false, and show a
   clear Settings notice with the saved id. A manual user choice replaces the
   preference.
7. When the user manually changes the selector in Settings, select at the
   gateway first and persist the same id. If persistence fails, keep the
   runtime selection but show a save error; never falsely claim the selection
   will survive restart.

Do not change gateway login, OAuth, provider discovery, or the main-process
gateway manager's ownership of the current selection.

## Tests

Create:

- `apps/desktop/src/shared/model-selection.test.ts`

Extend:

- `apps/desktop/src/shared/settings-model.test.ts`
- `apps/desktop/src/main/settings/settings-store.test.ts`
- `apps/desktop/src/main/gateway/gateway-handlers.test.ts` only if handler
  behavior changes (it should not need a new channel).

Required cases:

1. first use chooses and persists the first available model;
2. a saved model wins even when the list is reordered;
3. a saved missing model returns `unavailable` and never selects index zero;
4. an already matching runtime selection causes no duplicate selection;
5. missing/blank/non-string persisted values normalize to `undefined`;
6. settings round-trip preserves the preference while still omitting
   `aiAccount` and credentials;
7. a manual replacement persists the replacement.

Focused gate:

```powershell
npm.cmd test -- --run apps/desktop/src/shared/model-selection.test.ts apps/desktop/src/shared/settings-model.test.ts apps/desktop/src/main/settings/settings-store.test.ts apps/desktop/src/main/gateway/gateway-handlers.test.ts
npm.cmd run typecheck
git diff --check
```

Manual check (only when desktop is locally launchable): select GPT-5.6, restart
the app/gateway with a reordered model list, confirm GPT-5.6 remains selected;
then remove it from the gateway list and confirm the UI asks for a replacement.

## Acceptance, docs, rollback, commit

- No first-model fallback occurs when an explicit saved model is absent.
- A fresh installation still becomes usable without an extra manual click.
- No credentials, account identities, or gateway key are persisted by this work.
- Add one concise architecture note about persisted model preference after tests
  pass.
- Rollback: revert this one commit; old clients ignore the extra JSON key.
- Suggested commit: `feat(desktop): persist selected AI model preference`

---

# Phase 2 — Truthful visual-QA outcomes

## Outcome

Visual QA has three distinct facts:

1. it ran and found defects;
2. it ran and found no high-severity defects;
3. it did not run or could not produce a valid answer.

Only case 2 counts toward the existing two-consecutive-clean early-stop rule.
The feature remains advisory and bounded by the existing `refinePasses` budget.

## Current evidence

- `visual-qa-runner.ts::runVisualQa()` currently returns `[]` for no model, no
  manifest/stills, provider error, and malformed reply.
- `workspace-refine-flow.ts::runVisionPasses()` treats any empty array as a
  clean pass and can early-stop after two such arrays.
- `AgentWorker.visualQa` and `CustomLoopAgentWorker` currently expose only
  `VisualDefect[]`, so the lost state crosses the worker boundary.

## Exact implementation slices

### 2.1 Replace ambiguous arrays with a discriminated outcome

In `apps/desktop/src/main/agent/agent-worker.ts`, add:

```ts
export type VisualQaSkipReason =
  | "no-model"
  | "manifest-unavailable"
  | "no-stills"
  | "provider-error"
  | "invalid-response"
  | "unsupported";

export type VisualQaResult =
  | { kind: "checked"; defects: VisualDefect[]; checkedSceneIds: string[] }
  | { kind: "skipped"; reason: VisualQaSkipReason; requestedSceneIds: string[] };
```

Change the optional `AgentWorker.visualQa` signature and the matching
`AuthoringBackend` signature in `custom-loop-worker.ts` to return
`Promise<VisualQaResult>`.

### 2.2 Make parser/runner truth-preserving

Modify `apps/desktop/src/main/authoring/visual-qa-runner.ts`:

- make the visual reply parser return a `checked` outcome only after valid JSON
  with an `issues` array has been parsed;
- a valid `{"issues": []}` is a checked, clean pass;
- invalid JSON, no JSON object, or a wrong `issues` shape is
  `skipped: "invalid-response"`, not a clean result;
- no selected model, unreadable manifest, no renderable stills, and provider
  failure each return their explicit skip reason;
- retain the existing warning logs, but add only structured, non-secret context
  such as project id, reason, and scene count;
- never add a text-only vision fallback.

`ninerouter-backend.ts` should pass the new result through. Its contract comment
must say that skipped is advisory and non-blocking.

`custom-loop-worker.ts` must return `{ kind: "skipped", reason: "unsupported",
requestedSceneIds: ... }` if its backend does not implement visual QA.

### 2.3 Correct the refine-loop state machine

Modify `apps/desktop/src/main/workspace/workspace-refine-flow.ts`:

```text
checked + zero defects  -> cleanStreak += 1
checked + defects       -> cleanStreak = 0; reauthor targeted scenes
skipped                 -> cleanStreak = 0; consume this configured pass
```

For a skipped pass, do not invent an extra retry or expand the pass budget. It
may continue to the next configured pass, but it must not cause early-stop.
Cancellation behavior, targeted reauthoring, snapshot/restore, and return
types remain unchanged.

Keep `runVisionPasses()` returning its existing `changedAny` boolean. Do not
turn a skipped advisory QA pass into an error stage or a hard render block.

## Tests

Extend:

- `apps/desktop/src/main/authoring/visual-qa-runner.test.ts`
- `apps/desktop/src/main/workspace/workspace-refine-flow.test.ts`
- `apps/desktop/src/main/agent/custom-loop-worker.test.ts`
- `apps/desktop/src/main/authoring/ninerouter-backend.test.ts` only where type
  stubs require the new result.

Required cases:

1. no model -> `skipped/no-model` and no chat call;
2. no stills -> `skipped/no-stills` and no chat call;
3. provider throw -> `skipped/provider-error` with existing failure log;
4. malformed reply -> `skipped/invalid-response`;
5. valid empty issue list -> `checked` with no defects;
6. valid high-severity defect -> `checked` with only permitted known defects;
7. two checked-clean passes early-stop exactly after the second;
8. skipped, checked-clean, checked-clean requires three passes before early
   stop; skipped never increments the streak;
9. a checked defect still reauthors only flagged scenes and preserves the
   snapshot/restore accept gate;
10. absent backend QA returns `unsupported`, not a fake clean pass.

Focused gate:

```powershell
npm.cmd test -- --run apps/desktop/src/main/authoring/visual-qa-runner.test.ts apps/desktop/src/main/workspace/workspace-refine-flow.test.ts apps/desktop/src/main/agent/custom-loop-worker.test.ts apps/desktop/src/main/authoring/ninerouter-backend.test.ts
npm.cmd run typecheck
git diff --check
```

## Acceptance, docs, rollback, commit

- No skipped pass can be represented or logged as "clean".
- The number of real model calls remains bounded by `refinePasses`.
- No new N-code or render hard gate is introduced.
- Update the visual-QA wording in `docs/current/maintenance.md` to state that
  skipped QA is not a clean QA result.
- Rollback: revert the phase commit; no persisted data migration is involved.
- Suggested commit: `fix(authoring): distinguish skipped visual QA from clean passes`

---

# Phase 3 — Desktop readiness report

## Outcome

The Settings screen has an explicit **Kiểm tra sẵn sàng** action that performs
only local/gateway checks and returns a Vietnamese report for:

- selected voice credential and voice id;
- gateway reachability, account connection, selected model, and preferred-model
  availability;
- ffmpeg, Chromium, authored-typecheck layout, theme, and font readiness.

It never calls an LLM, synthesizes TTS, reveals a secret, or automatically
changes any setting/model.

## Current evidence

- `packages/pipeline/src/cli/cli.ts::runDoctor()` already runs all doctor
  checks and supports injection, but its default TTS check reads only `process.env`.
- Desktop may hold encrypted credentials in `SettingsStore`; applying generic
  doctor output directly would report a false missing-key failure.
- `SettingsView` already owns the relevant Settings UI, while
  `settings-handlers.ts` is the contained IPC owner for settings/TTS.

## Exact implementation slices

### 3.1 Define a renderer-safe report shape

Add these view-model types to `apps/desktop/src/shared/types.ts`:

```ts
export type DesktopReadinessCheck = {
  id: "gateway" | "account" | "model" | "voice" | "ffmpeg" | "browser" | "n10" | "theme" | "fonts";
  state: "ready" | "warning" | "blocked";
  label: string;
  detail: string;
  remediation?: string;
};

export type DesktopReadinessReport = {
  ok: boolean;
  checks: DesktopReadinessCheck[];
};
```

These are translated UI models, not raw `DoctorCheck` values. Do not expose a
doctor error object or arbitrary command output across IPC.

### 3.2 Create a pure/injectable desktop adapter

Create `apps/desktop/src/main/settings/desktop-readiness.ts`.

Its injected dependencies should include:

- `runDoctor` (called with an overridden environment/voice check);
- a resolved desktop voice config from `SettingsStore.voiceConfig()`;
- gateway state, refreshed account state, listed model ids, and current selected
  model id;
- the persisted `preferredAiModelId`.

Implementation rules:

1. Override `runDoctor`'s env slot with a desktop voice check that reads the
   resolved SettingsStore configuration. It may inspect only whether the key and
   voice id are present; it must never return their values.
2. Call local gateway discovery only. Do not make a provider completion,
   speech synthesis, image, or render request.
3. Do not select a model from this report. It reports the current state only.
4. Convert each doctor/gateway result through a fixed allow-list of Vietnamese
   labels and remediation strings. Never pass arbitrary `DoctorCheck.detail`,
   caught error text, local paths, or environment values to the renderer.
5. A doctor warning remains a warning. Missing voice, unavailable gateway,
   missing account, or no usable selected model block readiness.
6. If the preferred model is no longer listed, report that specific condition
   as blocked and tell the user to select a replacement in Settings.

### 3.3 Expose it through the existing Settings IPC owner

Modify:

- `apps/desktop/src/shared/channels.ts` — add `settings:readiness`.
- `apps/desktop/src/shared/ipc-contract.ts` — add
  `settings.readiness(): Promise<DesktopReadinessReport>`.
- `apps/desktop/src/preload/client.ts` — map the new typed method.
- `apps/desktop/src/main/settings/settings-handlers.ts` — add a `readiness`
  dependency and handler; keep it in this contained settings factory.
- `apps/desktop/src/main/index.ts` — inject the real SettingsStore, gateway,
  `runDoctor`, and model-list adapters. This is ordinary composition-root
  wiring, not a new handler mega-builder.

### 3.4 Add Settings UI without automatic probes

Modify `apps/desktop/src/renderer/views/settings.tsx` and the `SettingsView`
call in `App.tsx`:

- add a button labeled `Kiểm tra sẵn sàng` in the build/about settings area;
- run only on explicit click, show loading state, then a compact check list;
- show safe remediation below blocked rows;
- reuse the existing settings notification pattern for IPC failure but do not
  render raw exception text;
- do not run it automatically when Settings opens because browser probing can be
  slow and the report is deliberately user-invoked.

## Tests

Create:

- `apps/desktop/src/main/settings/desktop-readiness.test.ts`

Extend:

- `apps/desktop/src/main/settings/settings-handlers.test.ts`
- `apps/desktop/src/preload/client.test.ts`

Required cases:

1. encrypted/saved desktop key plus voice id is ready even if `.env` is empty;
2. missing key or voice id blocks only the voice check and reveals no value;
3. gateway unavailable blocks gateway/account/model without attempting model
   selection;
4. ready gateway with no account blocks account/model;
5. selected model missing from current list blocks model with a replacement
   remediation;
6. all critical checks ready plus a doctor warning yields report `ok: true`;
7. arbitrary doctor error detail/path never appears in the returned report;
8. the preload test calls the new channel exactly once so its exhaustive
   allow-list assertion remains meaningful.

Focused gate:

```powershell
npm.cmd test -- --run apps/desktop/src/main/settings/desktop-readiness.test.ts apps/desktop/src/main/settings/settings-handlers.test.ts apps/desktop/src/preload/client.test.ts packages/pipeline/src/cli/doctor.test.ts
npm.cmd run typecheck
git diff --check
```

## Acceptance, docs, rollback, commit

- The report is useful without a live LLM/TTS call.
- A configured encrypted desktop key is not falsely reported as absent.
- No secret, raw error, API response, or machine path crosses IPC.
- Add a concise user-facing launch/readiness note to `docs/current/maintenance.md`.
- Rollback: revert the phase commit; no settings migration is needed.
- Suggested commit: `feat(desktop): add readiness diagnostics in settings`

---

# Phase 4 — Scene-synchronized draft review

## Outcome

The ready-stage storyboard uses timing from the exact locked draft timeline:

- clicking a scene rail item switches to video preview and seeks to that scene;
- while the draft video plays, the rail highlights the active scene;
- the user can still explicitly switch to the selected scene still for editing;
- projects without a readable lock keep the current still-review behavior.

No estimated timing, re-render, TTS, or pipeline timing change is allowed.

## Current evidence

- `StoryboardView` has a draft video player, but scene cards have only order and
  still paths; clicking a rail item currently switches to a still.
- `video-spec.lock.json` already stores exact `fps`, `startFrame`, and
  `durationInFrames` for every scene.
- `WorkspaceController.storyboardScenesOf()` is already an asynchronous
  view-model boundary, so it can enrich cards without changing the synchronous
  `readyStage()` helper or render orchestration.

## Exact implementation slices

### 4.1 Add a minimal timeline projection, not a raw locked spec

Modify `apps/desktop/src/shared/types.ts`:

```ts
export type SceneTimeline = { startSeconds: number; endSeconds: number };

export type SceneCard = {
  // existing fields
  timeline?: SceneTimeline;
};
```

Do not send the full locked spec, source paths, audio paths, or safety data to
the renderer.

In `apps/desktop/src/main/workspace/workspace-view-model.ts`, add a pure
projection helper accepting only `{ fps, scenes: [{ id, startFrame,
durationInFrames }] }` and returning `Record<string, SceneTimeline>`. It must:

- reject non-positive/non-finite fps;
- clamp start/end to finite non-negative seconds;
- make `endSeconds > startSeconds` for valid scenes;
- preserve no timing rather than inventing values when input is invalid.

Extend `storyboardScenesFromScenes()` to accept an optional timing map and
attach timing by final engine scene id.

### 4.2 Load validated timing only in the main process

Extend `WorkspaceDeps` with an optional `loadSceneTimelines(projectId)` seam.
In `WorkspaceController.storyboardScenesOf()`:

- load manifest and timing concurrently;
- tolerate a missing/torn/old lock by using no timing;
- keep the existing render-version cache busting behavior unchanged.

In `apps/desktop/src/main/index.ts`, provide the seam by reading
`projectPaths(projectId).lock`, validating it with `LockedVideoSpecSchema`, and
then using the pure projection helper. Log the main-process read failure at
debug/warn level only; never send the parse error to the renderer.

Do not make `readyStage()` async and do not modify `renderProject`, `lockSpec`,
or any Render/Remotion primitive.

### 4.3 Make StoryboardView seek and follow playback

Create `apps/desktop/src/renderer/storyboard-timing.ts` for pure helpers:

```ts
export function seekSecondsForScene(scene: SceneCard | undefined): number | undefined;
export function sceneIndexAtSeconds(scenes: readonly SceneCard[], seconds: number): number | undefined;
```

Rules:

- intervals are `[start, end)` except the final scene may include its endpoint;
- invalid/missing timing returns `undefined`;
- overlapping/bad intervals resolve deterministically to the earliest matching
  scene and must not throw.

Modify `apps/desktop/src/renderer/views/storyboard.tsx`:

1. Add a `videoRef` and a pending seek ref for metadata-not-yet-loaded video.
2. On a rail click with draft + valid timing: set the scene selected, switch to
   video mode, and seek to its `startSeconds`. If timing is missing, preserve
   the old still-selection behavior.
3. On `loadedmetadata`, flush a pending seek. Avoid a seek if current time is
   already within a small tolerance (for example 0.05s) of the target.
4. On `timeupdate`, derive the active scene with `sceneIndexAtSeconds` and only
   update React state when the index actually changes.
5. Keep the existing `Video nháp` / `Ảnh cảnh` controls. Switching to the still
   unmounts/pauses the video as it does today.
6. Add accessible active state (`aria-current` or equivalent) and a compact
   current-scene label; do not add a second timeline library.

Only edit `apps/desktop/src/renderer/theme/workspace.css` if the small active
state/label needs styling. Preserve the CSS partial/import contract.

## Tests

Create:

- `apps/desktop/src/renderer/storyboard-timing.test.ts`

Extend:

- `apps/desktop/src/main/workspace/workspace-view-model.test.ts`
- `apps/desktop/src/main/review/storyboard.test.ts` only if its public card
  shape changes
- `apps/desktop/src/main/workspace/workspace-controller.test.ts` for the
  injected valid/missing timing seam.

Required cases:

1. frame/fps values map to exact start/end seconds;
2. time at a scene boundary resolves to the next scene;
3. final endpoint resolves to the final scene;
4. no timeline returns no seek/no active scene;
5. invalid fps or duration is omitted instead of yielding `NaN`/Infinity;
6. storyboard cards preserve their existing still URL/render-version behavior;
7. controller degrades safely when the lock cannot be read.

Focused gate:

```powershell
npm.cmd test -- --run apps/desktop/src/renderer/storyboard-timing.test.ts apps/desktop/src/main/workspace/workspace-view-model.test.ts apps/desktop/src/main/review/storyboard.test.ts apps/desktop/src/main/workspace/workspace-controller.test.ts
npm.cmd run typecheck
git diff --check
```

Manual desktop check: open an existing draft, click scene 1/2/last, verify each
seek lands at the locked scene start, then play across boundaries and confirm
the rail follows playback. Repeat after a successful scene edit/re-render to
prove timing is reloaded rather than cached from the old draft.

## Acceptance, docs, rollback, commit

- The UI never estimates timing from scene order, narration length, or MP4
  duration.
- A corrupt/missing lock retains review stills rather than breaking the player.
- The change does not call TTS, render an MP4, or mutate project artifacts.
- Add one architecture sentence about locked-timeline review synchronization.
- Rollback: revert the phase commit; `timeline` is optional and old renderers
  ignore it.
- Suggested commit: `feat(desktop): sync draft player with storyboard scenes`

---

# Phase 5 — Sanitized per-project diagnostic and repair trace

## Outcome

Users can open a bounded, historical **Chi tiết xử lý** panel for a project and
copy a safe summary. It shows fixed-language lifecycle facts, safe authoring
failure classes, and repair outcome states. It never reads or sends raw Pino
logs, prompts, AI replies, generated TSX, paths, stack traces, N-codes, hashes,
or credentials.

## Current evidence

- Pipeline already writes bounded `events.ndjson` with cross-process append
  locking, but there is no reader or desktop IPC surface.
- Render/lock/review events exist, but `project.scaffolded` contains the raw
  prompt and `error` can contain raw engine text, so raw event forwarding is
  unsafe.
- Authoring `failureClass` exists in structured logs, but is not project-visible.
- Repair loop emits redacted `FriendlyFix` through `AgentHooks`, while
  `WorkspaceController` currently discards `onRepair`.

## Exact implementation slices

### 5.1 Define a safe, typed diagnostic projection in pipeline

Add safe public types to `packages/pipeline/src/types.ts`, for example:

```ts
export type ProjectDiagnosticEntry = {
  at: string;
  kind: "lifecycle" | "authoring" | "repair" | "warning" | "error";
  state: "info" | "warning" | "error" | "resolved" | "reverted";
  message: string;
  sceneId?: string;
};

export type ProjectDiagnostics = {
  projectId: string;
  entries: ProjectDiagnosticEntry[];
  truncated: boolean;
};
```

Create `packages/pipeline/src/store/project-diagnostics.ts` and re-export it
from `packages/pipeline/src/index.ts`.

Implement `readProjectDiagnostics(projectId, { limit?: number })` with these
rules:

- validate the project id through the existing project-path boundary;
- tail, rather than unboundedly read, `events.ndjson` (and the single rotated
  `.1` file if needed); use a fixed byte and entry cap such as 256 KiB/80
  entries total;
- tolerate a partial first line, malformed JSON, unknown events, invalid
  timestamps, and missing files without throwing;
- newest entries appear first;
- map only a strict event allow-list to fixed Vietnamese messages;
- never pass arbitrary event fields through.

Safe mappings may include `authored.admitted`, `tts.done`, `lock.written`,
`build.ok`, `scene.runtime_probe`, `determinism.ok`, `render.cached`,
`render.done`, `review`, `render.oracles`, `project.done`, `review.pending`,
`render.cancelled`, and a generic fixed message for `error`. Do **not** return
the `prompt` from `project.scaffolded`, `outPath`, hashes, or raw error message.

### 5.2 Mirror only safe authoring failure metadata

Modify `apps/desktop/src/main/authoring/authoring-failure.ts` to define a
minimal safe authoring diagnostic payload containing only:

- `type: "authoring.failure"`;
- enum `failureClass`;
- level (`warning`/`error`);
- `projectId` when it is present.

It must deliberately omit `detail`, `err`, `rawReply`, `parseSummary`,
violations, file paths, and any dynamic error message.

Give the authoring logger an optional non-blocking diagnostic observer. In
`ninerouter-backend.ts`:

- add an injected `appendProjectEvent` seam;
- fan out only the safe payload to that seam with `void ...catch(...)`, so
  observability can never block authoring;
- use the same wrapped logger for `callLogger` and regular runner logging so
  provider/parse failures follow one safe path;
- keep original Pino messages and `failureClass` behavior intact for developers.

In `apps/desktop/src/main/index.ts`, inject pipeline `appendEvent` into this
seam. The appended event is `authoring.failure` and has only the allow-listed
fields above.

### 5.3 Record repair state honestly

Add a small tested helper (for example
`apps/desktop/src/main/workspace/workspace-repair-trace.ts`) that collects the
already-redacted `FriendlyFix` callbacks for one render/edit attempt.

Do not record a repair as "applied" merely because `onRepair` fired. Required
state policy:

| Final result | Event/result wording |
| --- | --- |
| repair hook fires | `repair.attempted` / "Đã thử chỉnh" |
| final draft outcome is `passed` | `repair.resolved` / "Đã áp dụng trong bản nháp hiện tại" |
| edit/refine rolls back to prior draft | `repair.reverted` / "Đã hoàn nguyên bản nháp trước" |
| exhausted/infra/cancelled | `repair.unresolved` or `repair.cancelled`; never say applied |

Modify `WorkspaceController` only at its existing `editHooks`/`renderHooks` and
outcome boundaries. Inject `appendProjectEvent` from `index.ts`; append events
best-effort and never await them on the render critical path. Event fields must
be limited to a validated `sceneId` and fixed `type`/`state`; do not persist the
free-form `FriendlyFix.message`.

### 5.4 Expose a bounded diagnostics endpoint and UI

Modify:

- `apps/desktop/src/shared/channels.ts` — add `projects:diagnostics`.
- `apps/desktop/src/shared/ipc-contract.ts` — add
  `projects.diagnostics(projectId): Promise<ProjectDiagnostics>`.
- `apps/desktop/src/preload/client.ts` — map it.
- `apps/desktop/src/main/index.ts` — add one thin project handler that calls
  `readProjectDiagnostics(String(projectId))`.

In the renderer:

- add a small `ProjectDiagnosticsPanel`/drawer component under
  `apps/desktop/src/renderer/views/`;
- fetch on explicit open/refresh, not every stage-poll tick;
- show newest-first entries, a bounded/truncated indicator, and a copy button
  using the same safe clipboard pattern as the publish-copy UI;
- place an entry point in both the ready storyboard and error screen;
- copy only the displayed fixed-language summary, never a raw event file.

Keep the `ProjectWorkspaceView` and `StoryboardView` props narrow. If a pure
formatting helper is needed, put it beside the panel and test it; do not create
a broad workspace state refactor.

## Tests

Create:

- `packages/pipeline/src/store/project-diagnostics.test.ts`
- `apps/desktop/src/main/workspace/workspace-repair-trace.test.ts`

Extend:

- `apps/desktop/src/main/authoring/authoring-failure.test.ts` (create it if no
  focused unit test exists)
- `apps/desktop/src/main/authoring/ninerouter-backend.test.ts`
- `apps/desktop/src/main/workspace/workspace-controller.test.ts`
- `apps/desktop/src/preload/client.test.ts`

Required cases:

1. reader handles missing, malformed, unknown, partial, and rotated event lines;
2. reader caps bytes/entries and reports truncation;
3. raw prompt, `rawReply`, `detail`, `error.message`, out path, hash, and
   absolute path cannot occur in any returned entry;
4. known safe lifecycle events map to fixed user-facing text;
5. safe authoring failure writes only enum class/level/project id;
6. repair attempt is not labeled resolved until the final draft passes;
7. rollback records reverted, not applied;
8. append failures never change authoring/render return values;
9. IPC endpoint maps through the allow-list and rejects no unregistered channel.

Focused gate:

```powershell
npm.cmd test -- --run packages/pipeline/src/store/project-diagnostics.test.ts apps/desktop/src/main/authoring/authoring-failure.test.ts apps/desktop/src/main/authoring/ninerouter-backend.test.ts apps/desktop/src/main/workspace/workspace-repair-trace.test.ts apps/desktop/src/main/workspace/workspace-controller.test.ts apps/desktop/src/preload/client.test.ts
npm.cmd run typecheck
git diff --check
```

## Acceptance, docs, rollback, commit

- The renderer never receives raw Pino data or arbitrary NDJSON fields.
- Diagnostics remain useful after an app restart because they derive from the
  project event stream.
- A repair status is never overstated after a cancel, exhausted run, or rollback.
- Add the UI diagnostic flow and safe event-reading rule to
  `docs/current/maintenance.md`.
- Rollback: revert the phase commit. Old/new readers safely ignore unknown
  event types, so existing event files are forward-compatible.
- Suggested commit: `feat(desktop): add sanitized project diagnostic trace`

---

# Phase 6 — Project evidence provenance in script review

## Outcome

For a successful URL-grounded authoring run, script review can show a compact,
inspectable evidence panel:

- source metadata (title, URL, site/date when available);
- supported source-material claims used by each scene;
- a short, validated source excerpt;
- no claim provenance for unreadable URLs, user-brief claims, or common
  knowledge claims.

The feature does not burn citations into the video, does not add a network fetch
at review time, and does not make an unreadable URL look verified.

## Current evidence

- `ingestUrl()` already writes an extracted research file with `ArticleMetadata`
  provenance, under a safe planning directory.
- `ninerouter-backend.ts` currently concatenates research into one string,
  losing source identity before content planning.
- `ContentPlanClaim` has a self-declared `support` field but no source id or
  excerpt, and the accepted content plan is not persisted per project.
- The script gate already has a review stage and is the correct user-controlled
  point before the first draft render.

## Exact implementation slices

### 6.1 Create bounded source/evidence domain helpers

Create `apps/desktop/src/main/authoring/content-evidence.ts` with main-process
only types/helpers:

```ts
export type ResearchSource = {
  id: string;              // generated source-01, source-02, never a file path
  metadata: ArticleMetadata;
  body: string;            // transient only; never written into evidence.json
};

export type SourceReference = { sourceId: string; excerpt: string };

export function normalizedEvidenceText(value: string): string;
export function excerptMatchesSource(excerpt: string, sourceBody: string): boolean;
export function buildProjectEvidence(...): ProjectEvidence;
```

Rules:

- ids are deterministic, sequential `source-01`, `source-02`, etc. in URL
  input order; never derive ids from title/path and never persist a research file
  path;
- normalize only Unicode/whitespace/case for exact containment; do not use a
  fuzzy or semantic matcher that can accept hallucinated quotes;
- source excerpts must be non-empty and capped (for example 20–320 characters);
- `body` is transient and must never be copied to a project evidence artifact;
- source metadata may be persisted only as user-visible provenance fields
  (`sourceUrl`, title, site/author/published date/fetched time).

### 6.2 Extend the content-plan contract minimally

Modify:

- `apps/desktop/src/main/authoring/content-plan-schema.ts`
- `apps/desktop/src/main/authoring/content-plan-prompt.ts`
- `apps/desktop/src/main/authoring/content-plan-quality.ts`
- `apps/desktop/src/main/authoring/content-plan-runner.ts`
- `apps/desktop/src/main/authoring/content-plan.ts`

Add an optional strict field to each claim:

```json
"sourceRef": {
  "sourceId": "source-01",
  "excerpt": "short exact excerpt from the readable source"
}
```

Schema rules alone cannot validate a source id against a specific authoring run,
so use a two-step validation strategy:

1. Zod validates shape, bounded lengths, and `source-XX` form.
2. `evaluateContentPlanQuality(plan, pacing, sources)` validates context.

Add a blocking `claim-provenance` quality check with these rules:

| Claim shape | Required result |
| --- | --- |
| `support: "source_material"`, `confidence: "supported"`, `action: "use"` | requires a valid source id and an exact normalized excerpt in that source body |
| `support: "source_material"` but no readable sources exist | cannot be a usable claim |
| `support: "user_brief"` or `"common_knowledge"` | must not carry a sourceRef |
| `action: "omit"` or `confidence: "uncertain"` | never becomes usable merely to satisfy provenance |

Treat `claim-provenance` as a factual-safety blocker alongside existing
`claim-ledger`; it is not advisory visual guidance. Extend the existing one-shot
content-plan repair eligibility to allow a repair only when all blocking issues
are `claim-ledger` and/or `claim-provenance`. Do not add another repair budget.

Update both initial and repair prompts:

- label every readable source with its stable source id;
- require a source-material usable claim to quote a short exact excerpt and
  identify its source id;
- tell the model to omit/soften a fact when it cannot produce valid provenance;
- pass the same source context into the one allowed repair request.

`contentPlanForAuthoring()` must continue excluding omitted/uncertain claims.
It may preserve validated source refs for usable claims, but it must never carry
an omitted claim or its excerpt into the authoring prompt.

### 6.3 Persist a safe project evidence artifact only after successful admission

Add `evidence` to `projectPaths(projectId)` in
`packages/pipeline/src/store/store.ts`, pointing to `evidence.json`.

Create `packages/pipeline/src/store/project-evidence.ts`, re-exported from the
pipeline barrel. It owns typed, atomic `writeProjectEvidence` and tolerant
`readProjectEvidence` helpers.

Suggested artifact shape:

```ts
type ProjectEvidence = {
  version: 1;
  sources: Array<{ id: string; sourceUrl: string; title: string; site?: string; author?: string; publishedDate?: string; fetchedAt: string }>;
  claims: Array<{ id: string; text: string; support: "user_brief" | "source_material" | "common_knowledge"; sourceRef?: SourceReference }>;
  scenes: Array<{ sceneId: string; evidenceClaimIds: string[] }>;
};
```

`ninerouter-backend.ts` must:

1. collect `ResearchSource[]` while ingesting URLs;
2. retain the existing unreadable-URL behavior;
3. pass sources to the content-plan runner;
4. write `evidence.json` only after final manifest write **and** admission
   succeeds;
5. create scene associations only when final engine scene order/ids can be
   matched safely. If they cannot, keep claims/sources but omit ambiguous scene
   associations and log a non-user-facing warning.

Do not make evidence write failure relax admission or affect video safety. A
write failure after successful admission should be surfaced as a normal
authoring/storage failure rather than claiming a provenance panel exists.

### 6.4 Surface evidence in the existing script gate

Add renderer-safe evidence view-models to
`apps/desktop/src/shared/types.ts`, for example:

```ts
export type ScriptEvidenceModel = {
  sources: Array<{ id: string; sourceUrl: string; title: string; site?: string; publishedDate?: string }>;
  claims: Array<{ id: string; text: string; sourceId?: string; excerpt?: string; sceneIds: string[] }>;
};
```

Then modify:

- `WorkspaceDeps` and `WorkspaceController` to load evidence tolerantly;
- `workspace-script-flow.ts` to include optional evidence when it constructs the
  script stage;
- `ScriptGateModel` and `ProjectStage.kind === "script"` to carry optional
  evidence;
- `apps/desktop/src/renderer/views/workspace.tsx::ScriptReview` to render a
  collapsed `Căn cứ nội dung` panel.

UI rules:

- old projects with no `evidence.json` render exactly as before;
- group source-material claims by scene when a safe association exists;
- show title/site/date, claim text, and capped excerpt;
- show user-brief/common-knowledge claims only as their declared category, not
  as external evidence;
- do not automatically open/fetch URLs or navigate Electron to an external
  page; a later owner-approved slice may add a safe external-open action;
- no raw research body, planning path, authored code, or provider response is
  sent to the renderer.

## Tests

Create:

- `apps/desktop/src/main/authoring/content-evidence.test.ts`
- `packages/pipeline/src/store/project-evidence.test.ts`

Extend:

- `apps/desktop/src/main/authoring/content-plan.test.ts`
- `apps/desktop/src/main/authoring/ninerouter-backend.test.ts`
- `packages/pipeline/src/ingest/url-ingest.test.ts` only if metadata/export
  behavior changes
- `apps/desktop/src/main/workspace/workspace-script-flow.test.ts`
- `apps/desktop/src/main/workspace/workspace-controller.test.ts`

Required cases:

1. valid source-material usable claim with matching source id/excerpt passes;
2. unknown source id, missing ref, too-short/too-long ref, and non-matching
   excerpt block the plan as `claim-provenance`;
3. `user_brief`/`common_knowledge` claim with a source ref blocks or is stripped
   according to the chosen strict schema rule; do not silently present it as a
   citation;
4. no readable sources means a usable `source_material` claim cannot pass;
5. one allowed repair can remove/soften invalid fact claims but cannot promote
   uncertain claims without valid provenance;
6. omitted/uncertain claims and excerpts never reach authoring input or
   `evidence.json` as usable evidence;
7. artifact contains metadata/capped excerpts but never research body, absolute
   path, raw URL-ingest response, prompt, or API key;
8. evidence writes atomically and a missing/corrupt artifact degrades to no
   script evidence panel;
9. final-manifest scene mismatch cannot attach a claim to the wrong scene;
10. older projects and text-only projects keep the existing script flow.

Focused gate:

```powershell
npm.cmd test -- --run apps/desktop/src/main/authoring/content-evidence.test.ts apps/desktop/src/main/authoring/content-plan.test.ts apps/desktop/src/main/authoring/ninerouter-backend.test.ts packages/pipeline/src/store/project-evidence.test.ts packages/pipeline/src/ingest/url-ingest.test.ts apps/desktop/src/main/workspace/workspace-script-flow.test.ts apps/desktop/src/main/workspace/workspace-controller.test.ts
npm.cmd run typecheck
git diff --check
```

## Acceptance, docs, rollback, commit

- A visible source-material claim has a validated source id and excerpt, not a
  model-self-declared label.
- Unreadable links remain non-fatal but never manufacture provenance.
- Evidence is review metadata only; it does not create captions/citations inside
  authored scenes or weaken the claim ledger/admission/render gates.
- Add the `evidence.json` artifact and script-review behavior to
  `docs/current/architecture.md`; update `content-guide.md`/`maintenance.md`
  only where their evidence wording changes.
- Rollback: revert the phase commit. Old clients ignore `evidence.json`; new
  clients tolerate it missing.
- Suggested commit: `feat(authoring): preserve claim provenance for script review`

---

## 4. Final integration gate after all six phases

Run only after every phase has passed its focused tests and been approved:

```powershell
git diff --check
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

If the broad suite hits the known `typecheck-authored` concurrency pressure,
use the Phase 0 fallback lane before making any conclusion.

Manual desktop checks, when local gateway/provider configuration is available:

```powershell
npm.cmd --workspace @motionreal/desktop run app
```

Validate at minimum:

1. selected model survives restart/reorder and missing model never silently
   falls back;
2. readiness report is safe and actionable with no secret display;
3. QA skip is not presented as clean;
4. a draft player follows scene rail timing and survives a re-render;
5. diagnostics panel is safe after success, failure, cancel, and rollback;
6. URL-backed script review shows correct provenance while unreadable/text-only
   projects remain graceful.

After all gates pass:

1. inspect every changed doc against live code;
2. remove any temporary fixture/log/debug artifact not required by tests;
3. update this note's status board or archive it only with owner approval;
4. make a final integration commit only if the owner explicitly wants the six
   already-approved phase commits squashed/combined. Otherwise preserve the six
   auditable commits.

## 5. Phase status board

| Phase | Status | Commit | Notes |
| --- | --- | --- | --- |
| 0 — baseline | done (preflight) | n/a | typecheck clean at start. |
| 1 — persisted model | done | `211ad27` | preferredAiModelId + pure decision helper. |
| 2 — QA truthfulness | done | `0969434` | VisualQaResult checked vs skipped. |
| 3 — readiness | done | `6fd71de` | settings:readiness + Vietnamese report. |
| 4 — synced draft review | done | `04fa151` | locked timeline seek/highlight. |
| 5 — diagnostics trace | done | `d9fb2d4` | Chi tiết xử lý + repair honesty. |
| 6 — evidence provenance | done | `2e1049d` | evidence.json + Căn cứ nội dung. |

