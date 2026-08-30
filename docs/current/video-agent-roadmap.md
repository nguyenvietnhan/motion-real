# Video Agent Roadmap

## Purpose

This roadmap turns the agreed [Video Agent workflow](video-agent-workflow.md)
into small, independently verifiable delivery phases.

The ordering is deliberate:

1. prove workflow state and handoff with the native Harness conversation;
2. reuse the existing MotionReal creation/review pipeline;
3. keep chat protocol/UI ownership in Harness while MotionReal owns video gates.

Do not start a later phase until the acceptance gate for the current phase
passes with the real native-Windows Harness and 9router setup.

## Current Baseline

Already available:

- one shared DeepSeek Harness process per MotionReal app run;
- one filesystem Workspace and one Harness Session per Agent video;
- native Harness chat/tool/question/approval UI embedded below MotionReal's
  workflow bar;
- working 9router model, terminal, web access, and local file writes;
- Agent video creation/deletion and project linking metadata;
- schema-validated asset, brief, and authoring submissions through three narrow
  Harness tools;
- a split creation owner: Classic keeps the existing API authoring path, while
  Harness-created projects let their Session write scene code and reuse the
  existing still/review/TTS/final-render infrastructure.

The standalone Harness client remains the comparison point for conversation
behavior; Git history is the rollback path for the removed chat projection.

## Non-Negotiable Boundaries

- Harness is the Agent engine; MotionReal owns production state and approvals.
- Agent prose, tool inactivity, and process completion never advance a product
  stage.
- Every Agent video remains isolated by Workspace, Session, and job id.
- Rendering continues through the existing MotionReal controllers. Harness is
  never given a render tool.
- Both modes produce the same manifest and authored TSX contract. Harness scene
  edits return to the owning Session; Classic scene edits remain unchanged.
- No second render engine, TSX format, or project-management path is introduced.
- User approval remains mandatory for assets and the final brief. Final render
  follows Settings: approval in `full`/`stills_edit`, automatic in `skip_edit`.
- Existing Home, Create, Workspace, crawler, Queue, and project behavior must not
  regress.
- Do not reimplement Harness conversation components or protocol projection in
  MotionReal.

## Phase 0 — Freeze and Observe the Baseline

Status: historical baseline superseded. The current supported DeepSeek Harness
checkout is `466404c927e2209ba7f242038b6922f10c0405cd`, source-verified on
2026-08-31. This records source compatibility only; a native Harness/9router
acceptance video is still required before declaring runtime acceptance.

### Goal

Make the current integration an explicit test baseline before workflow work
begins.

### Work

- Record the supported Harness fork revision and MotionReal integration commit.
- Add one manual smoke checklist covering:
  - app starts 9router and then one shared Harness;
  - two Agent videos open different Sessions on the same Harness port;
  - chat, a terminal file write, and web research work;
  - switching back restores the correct conversation;
  - deleting an Agent video removes its local Workspace.
- Keep the native Harness iframe available as a comparison/debug view during
  later phases. (Historical Phase 0 decision; Phase 5 made it the default.)
- Capture current failure messages for missing Harness, missing gateway key, and
  Harness startup/RPC failure so later UI work does not make them less useful.

### Acceptance gate

- The smoke checklist passes twice without restarting Harness between videos.
- MotionReal typecheck, tests, and build pass.
- No unrelated project or Create Flow changes.

## Phase 1 — Production State Kernel

Status: superseded by workflow version 2 (2026-08-30).

### Goal

Give each Agent video a durable, validated production state before adding new
review UI.

### State model

```text
discovery
collecting_assets
asset_review
preparing_brief
brief_review
queued_create
authoring
visual_refine
scene_review
paused
error
```

Persist the current state and its revision in the Agent video's
`motionreal-agent.json`. Keep Harness activity separate from production state.

Minimum production metadata:

```json
{
  "workflowVersion": 2,
  "workflowRevision": 3,
  "productionState": "asset_review",
  "activeJobId": "job-uuid",
  "projectId": null,
  "lastError": null
}
```

### Work

- Add one pure transition function with an allow-list of valid transitions.
- Make transition writes atomic.
- Reject stale job ids and stale workflow revisions.
- Expose the state through the existing typed Agent IPC/view model.
- Preserve compatibility for Agent records created before workflow version 1;
  they open in `discovery` without deleting their Workspace or Session.
- Add renderer-safe Vietnamese labels for the new Agent-only states. Reuse the
  existing Workspace stage labels once a MotionReal project exists.

### Tests

- Every valid transition passes.
- Invalid, skipped, duplicate, stale-revision, and wrong-job transitions fail.
- Restart restores the latest committed state.
- Legacy Agent records load without data loss.
- Harness tool events cannot mutate production state.

### Acceptance gate

- A developer can move a fixture job through the state machine and restart the
  app at every step without losing or inventing progress.
- No new visual workflow is started yet.

## Phase 2 — Asset Collection Vertical Slice

Status: implemented and accepted manually with a real Harness/9router job on 2026-08-27.

### Goal

Prove the first complete Agent-controlled production step:

```text
Harness chat
-> user starts preparation
-> Agent downloads assets
-> structured handoff
-> MotionReal validation
-> human asset review
```

### UI

- Add a persistent `Chuẩn bị tạo video` action outside the Harness iframe.
- Add a compact production-status rail beside or above the embedded chat.
- While collecting, show the Harness tool timeline normally and show
  `Đang thu thập asset` as product state.
- Build the asset review from existing MotionReal image-review components and
  media URL helpers; do not create a second gallery framework.
- Asset review supports:
  - thumbnail/open;
  - keep/reject;
  - `Tìm thêm ảnh` with a user note;
  - `Chấp nhận và tiếp tục`.

### Handoff V1

For this phase, use a durable file handoff before adding a Harness plugin:

```text
handoff/assets.draft.json
-> atomic rename
handoff/assets.json
```

The preparation action writes the job id, target path, and schema to
`handoff/assets-request.json`, then sends a short automatic instruction through
the public `session.prompt` RPC. Harness logs model-visible input by design, so
the short instruction appears in history; the machine schema does not flood the
chat and the user's preceding message is left intact.

MotionReal accepts the final file only when:

- `version` and `job_id` match;
- ids are unique;
- paths are relative and contained by the video Workspace;
- files exist, are regular supported images, and can be decoded;
- item count and file-size limits pass.

The validator returns structured errors. Invalid handoff remains in
`collecting_assets`; it never opens an empty review screen.

Use one bounded status check while this phase is active. Do not build a generic
filesystem event service.

The implemented manifest is:

```json
{
  "version": 1,
  "job_id": "job-uuid",
  "request_revision": 1,
  "items": [
    {
      "id": "asset-01",
      "path": "assets/example.png",
      "source_url": "https://example.com/image",
      "label": "Mô tả ngắn"
    }
  ]
}
```

### Review outcomes

- `Tìm thêm ảnh` records the current selection and returns to
  `collecting_assets` with the user's concrete request.
- Approval stores selected asset ids and moves to `brief_review`.
- Abort stops the active Agent turn but retains downloaded files and state.

### Tests

- Valid manifest with real local image files reaches review.
- Partial JSON, missing file, traversal, absolute path, duplicate id, stale job,
  unsupported media, and oversized input remain in collection with a safe error.
- Duplicate identical submission is idempotent.
- Review selection survives app restart.
- A real 9router Agent downloads at least two assets, submits them, and they are
  visible through MotionReal's media boundary.

### Acceptance gate

- Starting from a normal chat, the user reaches a working MotionReal asset
  review without typing a magic command or manually editing JSON.
- Reject/request-more/approve all work in one real Agent video.
- No Create Flow or render starts during this phase.

## Phase 3 — Brief Review and Create Handoff

Status: implemented on 2026-08-27. Real native acceptance has covered asset
approval, brief generation, retry, and review restoration. Creating the linked
project and reaching normal draft review remains part of the combined Phase
3/3.5 end-to-end gate.

### Goal

Turn the approved conversation and assets into an explicit, editable creation
request and reuse the existing project scaffold/asset-promotion path.

### Work

- Ask Harness to submit a versioned brief after asset approval.
- Persist the accepted brief as `handoff/brief.json`.
- Validate title, prompt length, 9:16 format, supported duration tier, selected
  asset ids, and matching job/revision.
- Show a MotionReal brief-review card with:
  - title;
  - final prompt;
  - duration tier and existing creation settings;
  - selected asset thumbnails;
  - edit, return-to-assets, continue-chat, and create actions.
- Freeze a brief revision when the user approves. Later chat must not mutate the
  queued or running creation request.
- Convert the accepted brief to the existing CreateController scaffold input.
- Promote only approved local asset files through the existing image staging /
  project promotion path.
- Store the resulting `projectId` on the Agent record.

Implemented current details:

- MotionReal writes `handoff/brief-request.json`; Harness atomically submits
  `handoff/brief.generated.json` with matching job/request revisions.
- Existing Agent videos already at `brief_review` can explicitly retry brief
  generation without repeating asset collection.
- The review edits title, final prompt, duration tier, language, and voice.
- Approval writes the accepted `handoff/brief.json`, moves to `queued_create`,
  and immediately starts the scaffold transaction. If that transaction fails,
  the accepted brief remains retryable with `Thử bắt đầu dựng`.
- `creationMode: harness` prevents CreateController from starting the Classic
  one-shot authoring worker after the scaffold has been created.
- Agent ownership is persisted after image promotion and immediately before the
  Harness authoring handoff. A retry returns the already-linked project;
  failure to persist ownership deletes the unused scaffold instead of leaving a
  duplicate project for the next retry.

### Tests

- Invalid/stale briefs do not leave `brief_review`.
- Editing the review card produces a new revision and preserves source assets.
- Clicking create calls the existing CreateController path exactly once.
- A proposal/handoff does not create or alter a MotionReal project before user
  approval.
- Failure before project creation remains retryable without a duplicate project.
- Once `projectId` exists, retry/restart resumes that project instead of creating
  another one.

### Acceptance gate

- A real Agent conversation and approved asset set can create a normal
  MotionReal project.
- The same project appears in the existing Projects/Workspace UI.
- Home/Create behavior remains unchanged.

## Phase 3.5 — VieNeu Local Narration

Status: implemented on 2026-08-27. The real provider smoke passed on 2026-08-28;
native Agent-created project-to-draft acceptance remains outstanding.

### Goal

Remove the cloud-TTS cost blocker from a real Agent-created Vietnamese video
without creating another timing or render pipeline.

### Implemented boundary

- `vieneu` is an explicit Vietnamese-only provider in Settings, Home, Queue,
  Agent brief review, persisted jobs, and the production TTS manifest.
- A persistent JSONL Python worker loads pinned VieNeu `3.3.0` once per
  narration job and emits 48 kHz PCM16 WAV clips.
- The TypeScript client owns validation, timeout, worker shutdown, safe provider
  errors, and cache identity. Missing or mismatched runtime blocks the job; it
  never falls back to a cloud, mock, or silent provider.
- Existing measured-duration lock, captions, TTS cache, concatenation, BGM mix,
  CreateController, WorkspaceController, and render flow remain unchanged.
- Development launcher uses the tested sibling `motion-china` Python environment
  when present. Installer packaging remains out of scope.

### Verification gate

- Worker lifecycle tests cover repeated synthesis, bad input, missing runtime,
  startup timeout, and disposal after Settings voice test.
- `npm run smoke:vieneu` must synthesize and FFprobe a real WAV through the same
  TypeScript client used by production.
- `npm run calibrate:voice -- --provider=vieneu` records a preset-specific
  narration rate; uncalibrated VieNeu uses `3.5` words/second.
- Manual acceptance: choose VieNeu Local, test the preset, finish one Vietnamese
  Agent brief, create the linked project, and reach its normal draft review.

Recorded runtime evidence (2026-08-28): Python `3.11.15`, `vieneu==3.3.0`,
runtime id `vieneu-3.3.0-v3turbo-onnx-int8-48k-t08-v1`, preset `Trúc Ly`;
`npm run smoke:vieneu` produced a 437,804-byte WAV measured by FFprobe at 4.56
seconds. An isolated `npm run calibrate:voice -- --provider=vieneu` run then
measured all five samples and persisted `3.44` words/second for the same runtime
and preset. This proves the production TypeScript client, persistent worker,
audio measurement and calibration write path; it does not by itself satisfy the
project-to-draft gate.

See `docs/current/tts-providers.md` for the pinned development runtime and commands.

## Phase 4 — Production Progress in Agent

Status: implemented on 2026-08-27. Unit coverage is complete; the combined
project-to-draft scenario below remains the native acceptance gate for linked
project progress.

### Goal

Make the Agent tab useful after project creation without reimplementing pipeline
orchestration.

### Work

- Subscribe the Agent view to the linked project's existing Workspace view
  model and stage events.
- Map real project stages to the Agent production rail:
  - author/script;
  - scene/still/refine;
  - draft render;
  - ready/draft review;
  - full render;
  - completed/error/cancelled.
- Reuse shared stage labels, progress values, media URLs, and existing project
  actions.
- Add `Mở dự án` and `Xem draft` actions rather than duplicating the complete
  Workspace editor inside Agent.
- Scene/global edits for Harness projects return to their owning Harness Session;
  Classic projects continue through `WorkspaceController.submitEdits`.
- User approval continues through the existing publish/full-render handler.

Implemented current details:

- Once a draft links a project, `projects.stage()` becomes the authoritative
  progress source; persisted Agent workflow metadata is no longer presented as
  live render state.
- Existing project status/progress events trigger an immediate refresh, with a
  bounded 1.5-second poll covering restart and missed events.
- The Agent rail reuses shared writing/render labels and exposes only the
  existing project cancel/open actions. `Xem draft` opens the normal Workspace
  review instead of embedding a second editor or player.
- `published` is accepted only from WorkspaceController's artifact-validated
  stage recovery, so Harness prose can never mark a video complete.
- A Harness still-only ready stage is labeled `Duyệt từng cảnh`, not `Xem draft`.

### Tests

- Agent progress follows a fake linked Workspace through every major stage.
- Refresh/restart derives progress from the project, not stale Agent metadata.
- Project errors and cancellation display the existing safe recovery actions.
- Agent never reports `completed` without the expected healthy project artifact.

### Acceptance gate

- The user can remain in Agent while creation runs, see trustworthy progress,
  open the existing review surface, request an edit, and approve final render.
- No stage is inferred from Harness messages.

## Phase 5 — Native Harness Conversation Surface

Status: implemented on the feature branches; automated regression complete,
native-Windows product acceptance remains required.

### Goal

Use the complete native Harness conversation UI instead of maintaining a lossy
MotionReal projection of its protocol.

### Implementation

- The Harness fork supports `?session=<id>&embedded=motionreal`.
- Embedded mode mounts only the native conversation surface: it removes sidebar,
  session chrome, hero, workspace picker, and composer model/access controls
  while preserving every native conversation plugin and MotionReal theme tokens.
- MotionReal places that native page below its existing workflow bar and review
  surfaces.
- The renderer opens chat only through `AgentDraftVM.harnessUrl`; there is no
  chat-history, prompt, abort, Markdown, or tool-event projection IPC.
- Internal Harness RPCs remain available to Main for automatic asset, brief,
  authoring, and review handoffs.
- Standalone Harness without the embedded query keeps its original layout.

### Acceptance gate

- Correct Session resumes after video switching and app reload.
- Native reasoning, Markdown, tool rows, questions, approvals, attachments,
  composer, stop, and retry work inside MotionReal exactly as in standalone
  Harness for the current provider/runtime.
- Asset, brief, still, and production review state remains MotionReal-owned and
  updates while the iframe is mounted.

## Phase 6 — Submission Tools and Hardening

Status: implemented in code; native-Windows re-acceptance remains required
after the current workflow and embedded-surface changes.

### Goal

Replace prompt-dependent final file writes with narrow first-class submission
tools after the workflow shape is stable.

### Work

- Add only:
  - `motionreal_submit_assets`;
  - `motionreal_submit_brief`.
- The tools accept structured values, not arbitrary paths.
- MotionReal validates and writes the same durable handoff artifacts used by
  Phases 2–3, so UI/state code does not change.
- Add revision/idempotency handling and safe tool-result messages.
- Audit shutdown, child crash, retry, deletion, restart, and legacy-session
  behavior across the complete workflow.
- Decide separately whether physically deleting shared Harness logs is required.

### Acceptance gate

- The real Agent reaches both review gates through submission tools.
- Repeated, stale, invalid, and aborted submissions cannot corrupt workflow
  state.
- File-handoff compatibility can remain for recovery/debug but is no longer the
  normal Agent completion mechanism.

Implementation evidence is limited to focused tests and local build gates.
Native acceptance must re-run the current Harness/9router flow before claiming
that a provider has submitted assets or briefs successfully.

## Phase 7 — Harness Scene Authoring and Still Review

Status: implemented in code on 2026-08-28; native user acceptance is pending.

### Goal

Remove the old one-shot authoring API from Harness-created videos without
creating another render engine or review UI.

### Implemented boundary

- CreateController still scaffolds the project and promotes approved assets, but
  `creationMode: harness` skips Classic `beginCreate` authoring.
- MotionReal links that project into the existing video Workspace and writes a
  versioned `authoring-request.json` plus the current authoring contract.
- The owning Harness Session inspects local assets and writes the normal
  `manifest.json` and fresh `authored/*.tsx` scene modules.
- `motionreal_submit_authoring` validates job/revision, scene order, module
  presence, and approved-asset references before MotionReal renders stills.
  Approved assets are a pool, not a checklist; each declared use must preserve
  its media role, while unapproved refs are rejected.
- MotionReal renders PNG stills through the shared FIFO. It asks Harness to
  inspect them only when visual refine is enabled, then reuses the existing
  human per-scene review UI.
- Human scene/global feedback is routed only to the same Harness Session. Classic
  projects continue through the old edit worker without behavior changes.

### Automated evidence

- Focused tests cover Harness-vs-Classic routing, stale submission removal,
  invalid scene ids, full still coverage, review notes, two still renders, and
  the existing Workspace ready-card bridge.
- TypeScript typecheck passes after the split.

### Native acceptance gate

- A new Agent video uses its approved local assets in the actual scene manifest
  and TSX output.
- Harness submits final-quality scenes, then performs only the configured
  image-backed visual-refine passes before MotionReal opens per-scene cards.
- One user scene edit returns to the same Session, re-renders only the requested
  scene scope, and never calls Classic
  authoring.
- After the user approves the scenes, the existing TTS/caption/full-render path
  produces a healthy video.

## Native Vision, Search Integration & Review Stabilization — 2026-08-28

1. **Submission & Final-quality Hardening:** Submission regressions cover asset-role matching, unapproved ref rejection, corrected retries, and component ID-to-file mapping. Initial authoring must be final quality; no forced archive/rewrite stage exists.
2. **Search Integration (DeepSeek & Exa MCP):** Added explicit selection between DeepSeek and Exa search providers. Exa integrates via native `dsh-mcp-client` over streamable-http, registering `mcp__exa__web_search_exa` with proper catalog assembly barriers.
3. **Image Route & Capability Declarations:** Pinned model entries explicitly declare `[text, image]` capabilities, routing PNGs through `read_image` directly to model vision context.
4. **Visual Refine & History Evidence:** final-quality authoring and user scene edits generate scoped still images for at most the configured visual-refine passes. Main verifies actual `session.history` for successful `read_image` events with image attachments matching byte fingerprints before human review opens.
5. **Review-Mode Parity:** Harness bridge branches cleanly based on the project's Settings policy: `full` (draft render + single review pass), `stills_edit` (direct still cards without draft render), and `skip_edit` (automatic full publish). IPC recovery routes recognized Harness projects to their Session or a render retry.

Automated verification is reported by fresh command exit codes, not a hard-coded
test count. Native re-acceptance remains required.

## Workflow Control and Surface Isolation — 2026-08-29

The Video Agent tab now provides durable workflow control and exclusive UI surfaces:
1. **Durable Pause & Resume:** `agent:pauseWorkflow` atomically cancels active Harness session turns via `session.cancel`, halts authoring polling, cancels any linked Workspace rendering, and writes `productionState: "paused"` along with `pausedFrom`. Late prompts and callbacks are rejected by revision check, eliminating duplicate repair prompts.
2. **Intermediate Brief Preparation:** Added `preparing_brief` between `asset_review` and `brief_review` to ensure the brief review UI is displayed only when a valid, schema-checked brief artifact is available.
3. **Three Exclusive Primary Surfaces:** Chat iframe is displayed exclusively during discovery or explicit chat open; automated work displays `AgentWorkflowProgress` with sanitized `session.history` activity only while it is needed (scrubbed of raw paths, credentials, and output); review steps display dedicated MotionReal review cards.
4. **Design System & Studio Theme Alignment:**
   - `AgentLibrary` list format with kebab options menu (`useDismissable`) and unboxed trigger.
   - Minimalist, monochrome/subtle status styling (`var(--muted-foreground)`) replacing loud colored pills.
   - Workspace header with an icon-only back button (`ns-btn-icon-only`).
   - `AgentWorkflowProgress` with a top-anchored layout (`padding-top: 64px`) ensuring the title and spinner maintain fixed vertical positioning without layout shifting when activity items expand.
   - Brief review featuring `KnobButton` chips and clean scene dividers, alongside flat settings dialog cards with secret visibility toggle.

Verification uses fresh successful exit codes from `npm.cmd run typecheck`,
`npm.cmd test`, and `npm.cmd run build`; test totals are intentionally not
recorded because they change with coverage.

Native acceptance still needs a new video: verify all three Settings modes,
one edit, one render failure/retry and cancel, actual narration duration, and the
quality of the final video. Automated routing tests do not prove visual quality,
live provider image input, or successful search in the Agent chat.

Use one new factual video topic and perform the following on native Windows:

1. Start MotionReal and confirm one Harness process becomes ready.
2. Create a new Agent video and discuss the topic over multiple turns.
3. Ask the Agent to research and download several relevant images.
4. Click `Chuẩn bị tạo video`.
5. Observe real Harness web/terminal activity.
6. Review assets in MotionReal; reject one and request a replacement.
7. Approve the final asset set.
8. Review and edit the generated brief.
9. Approve creation and verify exactly one MotionReal project is created.
10. Watch Harness authoring and two still-review passes from the Agent tab.
11. Open the normal scene review, request one scene edit, and receive revised
    stills through the same Harness Session.
12. Approve the scenes and verify the existing TTS/final-render path produces a
    healthy artifact.
13. Restart the app at least once during collection and once after project
    creation; verify recovery.
14. Switch between two Agent videos and verify Workspace, Session, assets,
    handoffs, and project progress never cross.

## Deliberately Deferred

- Direct Harness render tools.
- Automatic motion/temporal review.
- Automatic publication.
- Strict asset-rights enforcement.
- A generic workflow engine or plugin framework.
- Multiple concurrent Harness processes.
- Deleting exact pinned Harness session data; this is now implemented through a
  validated, recoverable main-process deletion journal.
- Packaging/updating the Harness fork in the installer.

Add these only after the current end-to-end scenario passes and a concrete product
need demonstrates that the existing boundary is insufficient.

## Delivery Discipline

- One phase per reviewable commit series.
- Run focused tests before full MotionReal `typecheck`, `test`, and `build`.
- Use real Harness/9router only after fake/local boundary tests pass.
- Preserve the last passing phase as a runnable rollback point.
- Update this roadmap when a gate changes; do not silently change workflow in
  implementation prompts or code comments.
