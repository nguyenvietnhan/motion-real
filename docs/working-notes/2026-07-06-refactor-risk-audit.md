# MotionReal Long-Term Refactor And Stabilization Plan - 2026-07-06

## Muc Dich

File nay la ke hoach sua chua/refactor dai han cho MotionReal, duoc lap tu dot
audit da kiem chung ngay 2026-07-06. Muc tieu khong phai big-bang rewrite, ma la
giam dan cac diem kho kiem soat bang nhung phase nho, moi phase co output ro,
co dieu kien dat chuan, va co lenh kiem dinh cu the.

Ket luan nen giu lam nguyen tac: du an hien khong "vo kien truc". Rui ro chinh
nam o cac file dieu phoi lon, noi AI authoring, render, safety oracle, TTS, va UI
state gap nhau. Vi vay moi buoc sua phai nho, co test canh, co rollback tinh than:
neu mot buoc khong chung minh duoc an toan thi dung lai, khong tiep tuc mo rong.

## Nguyen Tac Thuc Hien

Moi step trong ke hoach nay phai thoa cac nguyen tac sau:

1. Mot step chi sua mot boundary chinh.
2. Khong doi prompt/output contract trong cung step voi tach file, tru khi step
   do chi ro la contract step.
3. Khong refactor `orchestrator.ts`, `render-grid.ts`, hoac workspace flow theo
   line count. Chi sua khi co workflow/bug/boundary ro.
4. Moi step phai co test focused truoc khi full gate.
5. Sau moi step hoan tat: cap nhat docs/plan neu co drift, chay gate, commit
   rieng.
6. Khong xoa legacy compatibility hit neu no da duoc phan loai la migration/alias.
7. Neu gap fail moi, phai phan loai: fail do test flaky, fail do behavior bi doi,
   hay fail do ke hoach sai. Khong tiep tuc phase khi chua phan loai.

## Baseline Da Kiem Chung

Ngay kiem chung gan nhat: 2026-07-06.

Scope metric loai tru: `node_modules`, `dist`, `.video-tool`,
`apps/desktop/dist-electron`, `vendor-fonts.generated.ts`.

Lenh metric:

```powershell
$files = rg --files --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!**/.video-tool/**' --glob '!apps/desktop/dist-electron/**' --glob '!**/vendor-fonts.generated.ts'
# Count lines with `(Get-Content <file>).Count`, including blank lines.
```

Snapshot:

| Loai | So file | So dong |
| --- | ---: | ---: |
| Source `.ts/.tsx/.css`, khong tinh test | 175 | 30,662 |
| Test `.test.ts/.test.tsx` | 95 | 17,155 |

Top file can kiem soat:

| Dong | File | Vai tro |
| ---: | --- | --- |
| 2,311 | `apps/desktop/src/renderer/theme.css` | Global renderer CSS |
| 1,292 | `apps/desktop/src/main/workspace/workspace-controller.test.ts` | Workspace regression coverage |
| 1,232 | `apps/desktop/src/main/authoring/ninerouter-backend.ts` | Authoring backend facade/godfile |
| 1,145 | `apps/desktop/src/main/authoring/ninerouter-backend.test.ts` | Authoring backend coverage |
| 1,061 | `packages/pipeline/src/safety/render-grid.ts` | Render oracle registry/implementations |
| 1,044 | `apps/desktop/src/main/workspace/workspace-controller.ts` | Workspace state machine |
| 1,013 | `packages/pipeline/src/orchestrator.ts` | Render pipeline orchestrator |
| 898 | `packages/tts/src/index.ts` | TTS provider/audio utility hub |
| 828 | `packages/pipeline/src/render/renderer.ts` | Remotion render primitive/cache hub |
| 519 | `apps/desktop/src/main/index.ts` | Electron composition root |

Contract/doc facts that must stay true:

- Pure AUTHOR mode only; authored scenes import only `react`, `remotion`,
  `@motionreal/compositions`, and `zod`.
- No authored-facing template catalog, layout-block toolkit, or theme-token leash.
- Draft before full.
- Layout/aesthetic checks remain advisory unless live code explicitly makes them
  hard gates and owner approves.
- YouTube 16:9 plumbing exists, but true long-form YouTube author-by-segment mode
  is deferred.

## Evidence Map

Use this map before starting a phase. Re-check line numbers if code changed since
the last commit.

| Id | Area | Current evidence | Planning meaning |
| --- | --- | --- | --- |
| F1 | Authoring backend | `ninerouter-backend.ts:250-404`, `425-684`, `705-830`, `919-990`, `1003-1075+` | Highest payoff split target, but keep public facade stable. |
| F2 | Orchestrator | `orchestrator.ts:92-95`, `368-452`, `462-598`, `670-833`, `953-966` | Header/comment drift first, stage extraction later. |
| F3 | Workspace controller | `workspace-controller.ts:114-151`, `266-325`, `372-534`, `619-836`, `917-1017` | State machine remains; do not extract by size alone. |
| F4 | Render-grid posture | `render-grid.ts:39-51`, `491-548`, `810-850`, `951-974`; `orchestrator.ts:704-785` | Clarify auto/manual/external pass posture before changing severity. |
| F5 | N10 degrade | `typecheck-authored.ts:46-49`, `117-129`, `145-149`; `typecheck-authored.test.ts:142-144` | Behavior is tested; missing piece is app/report observability. |
| F6 | Desktop main root | `index.ts:1-47`, `76-148`, `154-250+`, `350-427`, `468-519` | Keep lifecycle root; extract only focused handler groups/adapters. |
| F7 | Renderer CSS | `theme.css:9+`, `151+`, `300+`, `449+`, `667+`, `762+`, `1058+` | Split move-only by view/layer after riskier backend work. |
| F8 | Renderer/TTS hubs | `renderer.ts:183-229`, `260-336`, `360-413`, `451-523`, `591-749`; `tts/index.ts:442-778` | Split later, especially before speech-sync feature work. |
| F9 | Repair budget clamp | `settings-store.ts:185-199`, `settings-store.test.ts:158-171`, `repair-loop.ts:15-23` | Settings display/effective value can drift; not a crash bug. |
| F10 | Thumbnail lock pattern | `render-thumbnail.ts:14-18`, `30-33`, `52-64`; `render-thumbnail.test.ts:85-95` | Guard exists; avoid bypassing private unlocked path. |

## Standard Step Template

Every step below uses this definition unless a stricter one is stated.

Start condition:

- Working tree is clean or unrelated dirty files are explicitly ignored.
- `AI_CONTRACT.md` and this plan were read.
- The step target files were opened fresh.
- The step has a focused test lane chosen before edits.

Output:

- One small behavior-preserving refactor, diagnostic, or doc sync.
- Tests or fixtures updated when behavior/contract changes.
- This plan or `docs/current/*` updated if the real boundary changes.

Acceptance:

- No unrelated refactor.
- No prompt/contract drift.
- No regression in focused tests.
- Full gate passes before phase close.

Minimum verification:

```powershell
git diff --check
npm.cmd run typecheck
```

Phase close verification:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

If the default parallel test lane flakes in `packages/pipeline/src/safety/typecheck-authored.test.ts`,
rerun the focused file and then rerun full suite with a stable worker lane before
calling the repo green.

## Phase 0 - Plan Control And Baseline

Goal: make the refactor program measurable before touching code.

### Step 0.1 - Keep The Plan As Source Of Truth

Scope:

- This file only.
- No runtime code.

Output:

- Phase list, step list, and gate policy are committed.
- Each step has status: `pending`, `active`, `done`, or `blocked`.

Acceptance:

- A future session can identify the next step without reading chat history.
- The plan distinguishes bug, debt, and already-tested guard.

Verification:

```powershell
git diff --check
```

Status: done by this document rewrite.

### Step 0.2 - Reconfirm Baseline Before Each Phase

Scope:

- Contract/docs and target files only.

Output:

- A short phase-start note in commit message or plan section.
- Updated evidence lines if code moved.

Acceptance:

- No phase starts from stale line numbers or stale assumptions.

Verification:

```powershell
git status --short
rg -n "Pure AUTHOR|Sensitive Files|Cleanup Order|still owns orchestration" AI_CONTRACT.md docs/current/maintenance.md docs/current/architecture.md
```

Status: done for Phase 1 start on 2026-07-06. Baseline reconfirmed from
commit `d6d7860`; working tree was clean, contract/docs anchors were present,
and Phase 1 target evidence still matched the code:

- `orchestrator.ts` header still drifted from the real render flow and needs
  Step 1.1.
- `typecheck-authored.ts` still degraded N10 to a no-op with console-only
  visibility, matching the Step 1.2/1.3 problem statement.

## Phase 1 - Low-Risk Truth And Observability

Goal: fix documented drift and make existing safety degradation visible before
moving code around.

### Step 1.1 - Sync Orchestrator Header With Real Flow

Scope:

- `packages/pipeline/src/orchestrator.ts` comment/header only.
- No behavior change.

Output:

- Header describes current sequence including static grid, N10, TTS/lock, build
  gate, authored entry, N31 runtime probe, determinism, render, review,
  render-grid, layout N15/N17, late safe-area, report, cleanup.

Acceptance:

- The header no longer implies N10/N31 are absent.
- No import/code diff except comments.

Focused verification:

```powershell
git diff --check
npm.cmd run typecheck
```

Phase gate contribution:

- Full gate at end of Phase 1.

### Step 1.2 - Surface N10 Degraded-To-No-Op As A Diagnostic

Scope:

- `packages/pipeline/src/safety/typecheck-authored.ts`
- The narrow caller/reporting seam that can carry a non-blocking diagnostic.
- Tests for the degraded path.

Output:

- When N10 skips because sources/setup are unavailable, the app/report path can
  show a structured non-blocking diagnostic.
- The diagnostic must not hard-fail render unless owner explicitly changes
  safety posture.

Acceptance:

- Existing test "degrades to a no-op" still passes or is updated to assert the
  new diagnostic.
- A renderable project is not blocked only because N10 cannot resolve workspace
  sources.
- Logs alone are not the only signal in app/report/doctor context.

Focused verification:

```powershell
npm.cmd test -- --run packages/pipeline/src/safety/typecheck-authored.test.ts packages/pipeline/src/orchestrator.test.ts
npm.cmd run typecheck
```

### Step 1.3 - Add A Packaged-Layout N10 Doctor Check

Scope:

- A doctor/startup diagnostic seam, if one exists; otherwise a small tested helper
  near safety/typecheck.
- No render behavior change.

Output:

- A command/test/helper can answer: "Can authored N10 resolve the required
  MotionReal source or type map in this runtime layout?"

Acceptance:

- The check can fail as warning/diagnostic without blocking normal app startup.
- The check has a test for missing source path and valid source path.

Focused verification:

```powershell
npm.cmd test -- --run packages/pipeline/src/safety/typecheck-authored.test.ts packages/pipeline/src/cli/doctor.test.ts
npm.cmd run typecheck
```

Phase 1 exit criteria:

- Orchestrator comments are true.
- N10 degraded state is observable outside raw console logs.
- No render gate became stricter accidentally.
- Full gate passes.

## Phase 2 - Authoring Backend Seam Split

Goal: reduce the biggest active godfile without changing authoring behavior.
This phase is the highest payoff and should be done as several commits, not one.

### Step 2.1 - Extract Content-Plan Runner

Scope:

- Move content-plan call/parse/quality/repair flow out of
  `ninerouter-backend.ts`.
- Keep `NineRouterAuthoringBackend.authorScenes(...)` public behavior unchanged.

Output:

- New focused module, for example `content-plan-runner.ts`.
- Inputs: job input, research/images, model/chat function, pacing/wordsPerSecond.
- Output: planned authoring content, advisories, user-facing failure message.

Acceptance:

- No prompt text changes except imports if unavoidable.
- Existing content-plan quality behavior preserved.
- Error messages remain the same unless tests explicitly approve wording.

Focused verification:

```powershell
npm.cmd test -- --run apps/desktop/src/main/authoring/content-plan.test.ts apps/desktop/src/main/authoring/ninerouter-backend.test.ts
npm.cmd run typecheck
```

### Step 2.2 - Extract Author Reply Runner

Scope:

- Single-reply authoring, batched authoring, and missing-TSX recovery.
- Do not change content-plan logic in this step.

Output:

- New module, for example `author-reply-runner.ts`.
- `ninerouter-backend.ts` delegates author reply generation/parsing/recovery.

Acceptance:

- Batch budget behavior unchanged.
- Recovery for missing TSX remains covered.
- File writing/admission can stay in backend if that keeps the slice smaller.

Focused verification:

```powershell
npm.cmd test -- --run apps/desktop/src/main/authoring/ninerouter-backend.test.ts apps/desktop/src/main/authoring/reply-parser.test.ts
npm.cmd run typecheck
```

### Step 2.3 - Extract Reauthor Runner

Scope:

- Reauthor loop: resolve file, read current code, call AI, parse, admit, retry,
  fake-fix guard, rollback.

Output:

- New module, for example `reauthor-runner.ts`.
- Backend supplies dependencies: chat, admitOne, manifest loader, project paths,
  logger.

Acceptance:

- Failed reauthor still restores original code.
- Image-preservation hints still thread into prompts.
- Cancel behavior still stops before the next scene AI call.

Focused verification:

```powershell
npm.cmd test -- --run apps/desktop/src/main/authoring/ninerouter-backend.test.ts apps/desktop/src/main/agent/repair-loop.test.ts
npm.cmd run typecheck
```

### Step 2.4 - Extract Image Filter And Crawl Helpers

Scope:

- `filterCrawledImages`
- `crawlImages`
- ImageUnsupported model fallback/cache can remain in backend if moving it would
  enlarge the step.

Output:

- New module(s), for example `image-filter-runner.ts` and
  `article-image-crawler-runner.ts`.

Acceptance:

- Best-effort behavior remains: no model, no readable images, vision failure, or
  unparseable reply yields no preselection instead of blocking authoring.
- SSRF-safe fetch path remains intact.

Focused verification:

```powershell
npm.cmd test -- --run apps/desktop/src/main/authoring/ninerouter-backend.test.ts
npm.cmd run typecheck
```

### Step 2.5 - Slim Backend Facade And Update Docs

Scope:

- `ninerouter-backend.ts`
- `docs/current/architecture.md`
- `docs/current/maintenance.md`
- This plan.

Output:

- Backend class reads as a coordinator over extracted runners.
- Maintenance docs no longer describe outdated backend shape.

Acceptance:

- Public `AuthoringBackend` behavior unchanged.
- No runner owns Electron/global state.
- Docs identify new modules and their responsibility.

Phase 2 exit criteria:

- `ninerouter-backend.ts` is materially smaller and has narrower local
  responsibility.
- Existing tests pass.
- Full gate passes.

## Phase 3 - Render Oracle Posture Clarity

Goal: make safety oracle behavior obvious before changing any severity or adding
new visual checks.

### Step 3.1 - Add Oracle Posture Table

Scope:

- `packages/pipeline/src/safety/render-grid.ts` header or nearby doc block.
- No behavior change.

Output:

- A table/list classifying each oracle:
  - auto-run inside `runRenderGrid`
  - external orchestrator pass
  - exported/manual only
  - effective severity
  - reason for warning/error posture

Acceptance:

- N14/N15/N17/N23 posture can be understood without reading both files end to
  end.
- Existing registry drift-guard tests remain valid.

Focused verification:

```powershell
npm.cmd test -- --run packages/pipeline/src/safety/render-grid.test.ts
npm.cmd run typecheck
```

### Step 3.2 - Extract External Render Pass Helpers

Scope:

- Helpers for layout measure N15/N17 and late safe-area inside orchestrator.
- No severity change.

Output:

- Small helper module or local functions with explicit names, for example:
  `runLayoutWarningPass`, `runLateSafeAreaWarningPass`.

Acceptance:

- `orchestrator.ts` still owns stage ordering.
- Helpers receive all inputs explicitly; no hidden global state.
- Warnings remain warnings.

Focused verification:

```powershell
npm.cmd test -- --run packages/pipeline/src/orchestrator.test.ts packages/pipeline/src/safety/render-grid.test.ts
npm.cmd run typecheck
```

### Step 3.3 - Assert Effective Severity At Caller Level

Scope:

- Tests only unless helper extraction needs tiny test hooks.

Output:

- Tests prove overlap/truncation/late-safe-area warnings remain non-blocking at
  orchestrator level.

Acceptance:

- A future change that accidentally hard-blocks advisory layout passes fails a
  test.

Focused verification:

```powershell
npm.cmd test -- --run packages/pipeline/src/orchestrator.test.ts packages/pipeline/src/safety/render-grid.test.ts
```

Phase 3 exit criteria:

- Oracle posture is documented where code lives.
- External passes are easier to find.
- No advisory check became hard gate.
- Full gate passes.

## Phase 4 - Workspace State Machine Hardening

Goal: make workspace flow easier to change without moving orchestration too
early.

### Step 4.1 - Add A State Transition Matrix

Scope:

- Tests and/or docs.
- Prefer a test fixture/table before code extraction.

Output:

- A table showing major transitions: create, image review, script gate, draft,
  ready, edit, cancel, publish, recover, delete, thumbnail.

Acceptance:

- The table matches current behavior.
- It names which transitions are persisted on disk and which are in-memory only.

Focused verification:

```powershell
npm.cmd test -- --run apps/desktop/src/main/workspace/workspace-controller.test.ts apps/desktop/src/main/workspace/workspace-view-model.test.ts
npm.cmd run typecheck
```

### Step 4.2 - Extract Pure Workspace Policies Only

Scope:

- Pure helpers such as retry eligibility, delete cleanup key list, thumbnail
  eligibility, or stage label mapping.
- Do not move async render/refine/publish orchestration.

Output:

- One small helper module or additions to existing workspace helper modules.
- Helper-level tests.

Acceptance:

- No helper reaches into mutable maps directly unless passed data explicitly.
- Controller remains owner of live maps, aborters, and stage mutation.

Focused verification:

```powershell
npm.cmd test -- --run apps/desktop/src/main/workspace/workspace-controller.test.ts apps/desktop/src/main/workspace/workspace-view-model.test.ts
npm.cmd run typecheck
```

### Step 4.3 - Strengthen Edit/Refine/Cancel Regression Tests

Scope:

- Tests around `submitEdits`, `refineEditedScenes`, restore to prior draft,
  cancel during edit/refine/draft.

Output:

- Tests describe expected rollback and no-TTS/no-MP4 stills path.

Acceptance:

- A failed edit/refine cannot silently leave half-applied broken scenes.
- Cancel still recovers to prior reviewable stage.

Focused verification:

```powershell
npm.cmd test -- --run apps/desktop/src/main/workspace/workspace-controller.test.ts apps/desktop/src/main/agent/repair-loop.test.ts
```

### Step 4.4 - Consider One Workflow Extraction Only After Tests

Scope:

- Only if Steps 4.1-4.3 show a clear seam.
- Candidate: thumbnail flow or script-gate flow, not full render/refine loop.

Output:

- A narrow workflow helper with injected effects.

Acceptance:

- Controller line count is not the justification; behavior boundary is.
- No change to cancel/recover semantics.

Phase 4 exit criteria:

- Workspace behavior is easier to reason about from tests.
- No broad stateful helper extraction.
- Full gate passes.

## Phase 5 - Desktop Main Root Containment

Goal: keep `apps/desktop/src/main/index.ts` as a composition root, but stop it
from absorbing every new feature directly.

### Step 5.1 - Inventory IPC Handler Ownership

Scope:

- Docs/test note only, or a local comment/table near handler registration.

Output:

- Handler groups are classified: license, gateway, projects, thumbnail, script,
  review, settings/TTS, BGM, export.

Acceptance:

- It is clear which groups already have factories and which are still inline.

Verification:

```powershell
git diff --check
npm.cmd run typecheck
```

### Step 5.2 - Extract One Inline Handler Group

Scope:

- Pick one low-risk group, for example thumbnail or settings/TTS handlers.
- Do not move Electron lifecycle.

Output:

- New handler factory with typed dependencies.
- `index.ts` spreads handler group like existing BGM handlers.

Acceptance:

- Handler behavior unchanged.
- Dependency wiring remains explicit in `index.ts`.

Focused verification:

```powershell
npm.cmd test -- --run apps/desktop/src/main/create/create-ipc.test.ts apps/desktop/src/main/settings/settings-store.test.ts apps/desktop/src/preload/client.test.ts
npm.cmd run typecheck
```

### Step 5.3 - Repeat Only For Proven Handler Groups

Scope:

- One handler group per commit.

Output:

- A sequence of small handler factories, not a broad handler builder.

Acceptance:

- `index.ts` remains understandable as app composition root.
- No lifecycle/window/media protocol code moved for cosmetic reasons.

Phase 5 exit criteria:

- New features have a clear pattern: domain handler factory plus explicit root
  wiring.
- Full gate passes.

## Phase 6 - Renderer And TTS Domain Split

Goal: prepare the media pipeline for future speech-synced visuals and SFX without
stuffing more behavior into `tts/index.ts` or `renderer.ts`.

### Step 6.1 - Extract SRT/Caption Timing Helpers From TTS

Scope:

- `packages/tts/src/index.ts`
- New `srt` or `caption-timing` helper module.

Output:

- `alignmentToSrt`, timestamp formatting, and related parsing helpers live in a
  focused module.

Acceptance:

- Public exports remain compatible.
- ElevenLabs/Vivibe behavior unchanged.

Focused verification:

```powershell
npm.cmd test -- --run packages/tts/src/elevenlabs.test.ts packages/pipeline/src/audio/captions.test.ts
npm.cmd run typecheck
```

### Step 6.2 - Extract Provider Clients

Scope:

- Vivibe client logic.
- ElevenLabs client logic.
- No audio ops move in same step.

Output:

- Provider modules such as `vivibe-client.ts` and `elevenlabs-client.ts`.

Acceptance:

- Retry behavior and error wording preserved.
- TTS cache identity is unchanged.
- If Vivibe extraction lacks direct existing coverage, add a focused provider
  test in the same step before moving behavior.

Focused verification:

```powershell
npm.cmd test -- --run packages/tts/src/elevenlabs.test.ts packages/pipeline/src/audio/tts-config.test.ts packages/pipeline/src/tools/create-tools.test.ts
npm.cmd run typecheck
```

### Step 6.3 - Extract Audio Ops

Scope:

- `measureAudioDuration`, concat, gap concat, normalize duration, BGM mix,
  ffmpeg/ffprobe process runner.

Output:

- `audio-ops.ts` or equivalent.

Acceptance:

- ffmpeg/ffprobe fallbacks unchanged.
- Output audio paths and durations stay compatible with lock/caption code.
- Add or keep focused tests for any audio operation moved out of
  `packages/tts/src/index.ts`.

Focused verification:

```powershell
npm.cmd test -- --run packages/tts/src/elevenlabs.test.ts packages/pipeline/src/audio/lock.test.ts packages/pipeline/src/audio/captions.test.ts
npm.cmd run typecheck
```

### Step 6.4 - Extract Renderer Cache/Preparation Helpers

Scope:

- `packages/pipeline/src/render/renderer.ts`
- Bundle/composition cache and `prepareComposition` support code.

Output:

- Smaller renderer file with render primitives still easy to inspect.

Acceptance:

- Cache key behavior unchanged.
- Serial-render assumption remains documented.
- No change to Remotion render options.

Focused verification:

```powershell
npm.cmd test -- --run packages/pipeline/src/render/cache.test.ts packages/pipeline/src/render/renderer.test.ts packages/pipeline/src/orchestrator.test.ts
npm.cmd run typecheck
```

### Step 6.5 - Design Speech-Timing Scene API Before Feature Work

Scope:

- Design doc or typed schema only.
- No UI feature yet.

Output:

- A proposal for how locked caption/word timing can be exposed to authored scene
  components without overloading prompts or leaking TTS internals.

Acceptance:

- It answers what data is available, frame units, scene-relative vs absolute
  timing, and fallback when provider has approximate SRT.
- It includes performance and AI-prompt complexity risks.

Verification:

```powershell
git diff --check
npm.cmd run typecheck
```

Phase 6 exit criteria:

- TTS and renderer hubs are narrower.
- Future speech-sync/SFX features have a clean target surface.
- Full gate passes.

## Phase 7 - Renderer CSS Maintainability

Goal: reduce UI regression risk from the largest global file, using move-only
splits before style changes.

### Step 7.1 - Add CSS Section Inventory

Scope:

- `apps/desktop/src/renderer/theme.css`
- No style behavior change.

Output:

- Clear section map for base tokens, shell, buttons/components, home/create,
  settings, project cards, workspace/storyboard, publish/review, responsive.

Acceptance:

- A future move-only split has unambiguous cut points.

Verification:

```powershell
git diff --check
npm.cmd run typecheck
npm.cmd run build
```

### Step 7.2 - Move-Only CSS Split

Scope:

- Split one section group per commit.
- Keep same selectors and declaration order unless tested otherwise.

Output:

- CSS files such as `base.css`, `components.css`, `home.css`, `workspace.css`,
  `settings.css`, imported by one stable entry.

Acceptance:

- No selector rename.
- No visual redesign.
- Build output succeeds.

Focused verification:

```powershell
npm.cmd run typecheck
npm.cmd run build
```

Manual verification:

- Launch desktop app.
- Check Home create flow, Settings, Workspace storyboard/review, Publish view.
- Specifically inspect long Vietnamese text, buttons, and thumbnail aspect modes.

### Step 7.3 - Add UI Regression Checklist

Scope:

- Docs or developer checklist.

Output:

- Repeatable manual UI checklist for CSS-only edits.

Acceptance:

- Future CSS changes know which screens to inspect.

Phase 7 exit criteria:

- CSS is split by domain/layer.
- Visual behavior is unchanged.
- Full gate passes.

## Phase 8 - Small Operational Debt

Goal: clean low/medium debt that is real but not urgent enough to block higher
payoff phases.

### Step 8.1 - Repair Budget Effective Value

Scope:

- Settings model/store/UI or a shared helper.

Output:

- User/dev can see the effective repair budget after engine clamp, or settings
  store clamps it intentionally with updated tests.

Acceptance:

- No mismatch like UI/persisted value `99` while engine silently uses `10`,
  unless UI clearly labels effective cap.
- `settings-store.test.ts` and `repair-loop.test.ts` agree.

Focused verification:

```powershell
npm.cmd test -- --run apps/desktop/src/main/settings/settings-store.test.ts apps/desktop/src/main/agent/repair-loop.test.ts apps/desktop/src/preload/client.test.ts
npm.cmd run typecheck
```

### Step 8.2 - Thumbnail Lock Pattern Hardening

Scope:

- `packages/pipeline/src/render/render-thumbnail.ts`
- `packages/pipeline/src/render/render-stills.ts` only if needed.

Output:

- Either keep current lock snapshot/restore with clear private seam, or move
  stills thumbnail path to a separate temporary lock artifact.

Acceptance:

- Existing tests for successful restore, failed restore, and no prior lock still
  pass.
- `renderThumbnailUnlocked` remains private.

Focused verification:

```powershell
npm.cmd test -- --run packages/pipeline/src/render/render-thumbnail.test.ts packages/pipeline/src/render/render-stills.test.ts
npm.cmd run typecheck
```

### Step 8.3 - Parallel Render Assumption Audit

Scope:

- Renderer cache comments/docs.
- No code unless a concrete future parallel render path is planned.

Output:

- A documented answer: what must change before parallel project rendering is
  allowed?

Acceptance:

- The answer covers bundle cache, composition cache, project render lock, and
  thumbnail/stills lock behavior.

Verification:

```powershell
git diff --check
```

Phase 8 exit criteria:

- Known small debt is either fixed or explicitly deferred with rationale.
- Full gate passes if code changed.

## Phase 9 - Feature Readiness For SFX And Speech-Synced Visuals

Goal: only start new video features after the supporting surfaces are clear.

### Step 9.1 - SFX Architecture Decision

Scope:

- Design doc and type sketch only.
- No production feature yet.

Output:

- Decision on SFX toggle location: main Settings.
- Decision on SFX behavior: on/off only, no multi-level complexity.
- Candidate data model: scene transition/animation event, SFX asset identity,
  mix timing, volume default, cache behavior.

Acceptance:

- The design states how SFX avoids overuse.
- The design states which layer owns mixing: TTS/audio ops vs render lock vs
  composition.
- No prompt-only control for core safety behavior.

Verification:

```powershell
git diff --check
npm.cmd run typecheck
```

### Step 9.2 - Speech-Synced Visual API Decision

Scope:

- Design doc and typed schema only.
- No prompt overhaul yet.

Output:

- Decision on whether scenes receive:
  - scene-local `speechProgress`
  - phrase/word timing windows
  - active caption cue data
  - or a simpler beat map derived from captions.

Acceptance:

- Uses existing caption/TTS timing where available.
- Has fallback for approximate SRT.
- Does not force AI to author a large prompt/output schema in one jump.

Verification:

```powershell
git diff --check
npm.cmd run typecheck
```

### Step 9.3 - Prototype Behind Internal Flag

Scope:

- One feature surface at a time: either SFX or speech progress, not both.
- Internal/dev flag only.

Output:

- Minimal prototype with focused tests.

Acceptance:

- Default user behavior unchanged.
- Toggle off means no output/audio/timing change.
- Prototype has a rollback path.

Focused verification:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Phase 9 exit criteria:

- Feature implementation can proceed without adding more weight to existing
  godfiles.

## Suggested Execution Order

1. Phase 1: low-risk truth/diagnostic fixes.
2. Phase 2: authoring backend split.
3. Phase 3: render oracle posture clarity.
4. Phase 4: workspace state-machine hardening.
5. Phase 5: desktop main root containment.
6. Phase 6: renderer/TTS split.
7. Phase 7: CSS split.
8. Phase 8: operational debt.
9. Phase 9: feature readiness for SFX/speech-sync.

Do not run phases in parallel. If a later phase becomes urgent because of a real
feature, do only its design step first, then return to the earlier safety/order
work.

## Phase Status

| Phase | Status | Next step |
| --- | --- | --- |
| Phase 0 - Plan Control And Baseline | done | Reconfirm Step 0.2 again before any later phase. |
| Phase 1 - Low-Risk Truth And Observability | active | Step 1.1 orchestrator header sync. |
| Phase 2 - Authoring Backend Seam Split | pending | Step 2.1 content-plan runner. |
| Phase 3 - Render Oracle Posture Clarity | pending | Step 3.1 posture table. |
| Phase 4 - Workspace State Machine Hardening | pending | Step 4.1 state transition matrix. |
| Phase 5 - Desktop Main Root Containment | pending | Step 5.1 IPC ownership inventory. |
| Phase 6 - Renderer And TTS Domain Split | pending | Step 6.1 SRT helper split. |
| Phase 7 - Renderer CSS Maintainability | pending | Step 7.1 CSS section inventory. |
| Phase 8 - Small Operational Debt | pending | Step 8.1 repair budget effective value. |
| Phase 9 - Feature Readiness | pending | Step 9.1 SFX architecture decision. |

## Global Exit Criteria

The long-term repair program is considered complete when:

- `ninerouter-backend.ts`, `orchestrator.ts`, `workspace-controller.ts`,
  `render-grid.ts`, `renderer.ts`, and `tts/index.ts` each have clear local
  ownership boundaries.
- New features have obvious entry points and do not require touching every
  godfile.
- Docs/current remain accurate and do not duplicate `AI_CONTRACT.md`.
- Full gate passes:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
git diff --check
```

- Manual app validation has been run for at least one real provider-connected
  draft/full workflow before calling user-facing feature work ready.
