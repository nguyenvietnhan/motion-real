# Video Agent Roadmap

## Purpose

This roadmap turns the agreed [Video Agent workflow](video-agent-workflow.md)
into small, independently verifiable delivery phases.

The ordering is deliberate:

1. prove workflow state and handoff while the working Harness iframe remains;
2. reuse the existing MotionReal creation/review pipeline;
3. replace the iframe with a MotionReal-owned chat UI only after the product
   workflow is reliable.

Do not start a later phase until the acceptance gate for the current phase
passes with the real native-Windows Harness and 9router setup.

## Current Baseline

Already available:

- one shared DeepSeek Harness process per MotionReal app run;
- one filesystem Workspace and one Harness Session per Agent video;
- embedded native Harness chat/tool UI;
- working 9router model, terminal, web access, and local file writes;
- Agent video creation/deletion and project linking metadata;
- a basic `motionreal.create.json` handoff into the existing Create Flow;
- the existing CreateController and WorkspaceController authoring, still,
  refine, draft, edit, rollback, final-render, and recovery paths.

The baseline is the rollback point. Do not remove the embedded Harness client
until the native MotionReal chat reaches parity.

## Non-Negotiable Boundaries

- Harness is the Agent engine; MotionReal owns production state and approvals.
- Agent prose, tool inactivity, and process completion never advance a product
  stage.
- Every Agent video remains isolated by Workspace, Session, and job id.
- Rendering and scene edits continue through the existing controllers.
- No second TSX, authoring, render, or project-management path is introduced.
- User approval remains mandatory for assets, the final brief, and final render.
- Existing Home, Create, Workspace, crawler, Queue, and project behavior must not
  regress.
- Keep the Harness iframe as a developer fallback until the replacement UI has
  passed real-session resume and tool-timeline tests.

## Phase 0 — Freeze and Observe the Baseline

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
- Keep the current iframe available as `Harness debug view` during later phases.
- Capture current failure messages for missing Harness, missing gateway key, and
  Harness startup/RPC failure so later UI work does not make them less useful.

### Acceptance gate

- The smoke checklist passes twice without restarting Harness between videos.
- MotionReal typecheck, tests, and build pass.
- No existing project, Create Flow, or `skill-test` artifact changes.

## Phase 1 — Production State Kernel

Status: completed and gated on 2026-08-27. Phase 2 is next.

### Goal

Give each Agent video a durable, validated production state before adding new
review UI.

### State model

```text
discovery
collecting_assets
asset_review
brief_review
queued_create
authoring
still_review
draft_render
draft_review
final_render
completed
error
```

Persist the current state and its revision in the Agent video's
`motionreal-agent.json`. Keep Harness activity separate from production state.

Minimum production metadata:

```json
{
  "workflowVersion": 1,
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

The preparation action sends a fixed hidden instruction to the current Harness
Session containing the job id, required target path, and schema. The user's chat
message is not replaced by that instruction in the visible timeline.

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

### Goal

Turn the approved conversation and assets into an explicit, editable creation
request and then reuse the existing Create Flow.

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
- Convert the accepted brief to the existing CreateController input.
- Promote only approved local asset files through the existing image staging /
  project promotion path.
- Store the resulting `projectId` on the Agent record.

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

## Phase 4 — Production Progress in Agent

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
- Scene/global edits continue through `WorkspaceController.submitEdits`.
- User approval continues through the existing publish/full-render handler.

### Tests

- Agent progress follows a fake linked Workspace through every major stage.
- Refresh/restart derives progress from the project, not stale Agent metadata.
- Project errors and cancellation display the existing safe recovery actions.
- Agent never reports `completed` without the expected healthy project artifact.

### Acceptance gate

- The user can remain in Agent while creation runs, see trustworthy progress,
  open the existing review surface, request an edit, and approve final render.
- No stage is inferred from Harness messages.

## Phase 5 — MotionReal-Native Chat UI

### Goal

Replace the embedded Harness frontend only after the video workflow is proven.

### Required parity

- open the correct video Session;
- load and resume message history;
- send a prompt and stream the response;
- show compact thinking/activity status exposed by Harness;
- show tool name, short description, running/success/failure state, and safe file
  links where applicable;
- abort the active turn;
- survive app restart and video switching;
- retain the existing production panel and review gates.

Do not expose hidden chain-of-thought. Render only model-visible messages,
Harness-provided summaries, and tool lifecycle data already represented by the
Harness protocol.

### Implementation sequence

1. Audit the pinned Harness client protocol and reuse its public schemas/types
   where practical.
2. Add the smallest adapter for open/resume, prompt, event subscription, and
   abort.
3. Map only renderer-safe events over typed IPC; do not expose local ports,
   credentials, raw stderr, or arbitrary RPC.
4. Build MotionReal components for message, tool activity, composer, and session
   loading.
5. Run both native UI and iframe debug view against the same test Session and
   compare history/tool outcomes.
6. Make native UI the default only after parity; keep iframe behind a developer
   switch for one stabilization phase.

### Tests

- Fake Harness: history, streamed message, tool start/result/error, abort,
  reconnect, malformed event, and child exit.
- Real Harness/9router: multi-turn chat, web research, terminal download, file
  creation, Session switch, restart/resume, and abort/retry.
- Renderer: long history scrolling, disabled/busy composer, tool disclosure,
  focus/accessibility, and video switch without cross-session messages.

### Acceptance gate

- The native UI completes the same real research/download/handoff scenario as
  the iframe with no missing messages or tool results.
- The iframe can be disabled without affecting workflow or recovery.

## Phase 6 — Submission Tools and Hardening

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

## Manual End-to-End Acceptance Scenario

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
10. Watch authoring/still/refine/draft progress from the Agent tab.
11. Open the normal draft review, request one scene edit, and receive a new
    draft through the existing edit path.
12. Approve final render and verify the healthy final artifact.
13. Restart the app at least once during collection and once after project
    creation; verify recovery.
14. Switch between two Agent videos and verify Workspace, Session, assets,
    handoffs, and project progress never cross.

## Deliberately Deferred

- Agent-controlled Remotion/TSX authoring outside the existing backend.
- Direct Harness render tools.
- Automatic motion/temporal review.
- Automatic publication.
- Strict asset-rights enforcement.
- A generic workflow engine or plugin framework.
- Multiple concurrent Harness processes.
- Hard deletion of shared-home Harness logs.
- Packaging/updating the Harness fork in the installer.

Add these only after the V1 end-to-end scenario passes and a concrete product
need demonstrates that the existing boundary is insufficient.

## Delivery Discipline

- One phase per reviewable commit series.
- Run focused tests before full MotionReal `typecheck`, `test`, and `build`.
- Use real Harness/9router only after fake/local boundary tests pass.
- Preserve the last passing phase as a runnable rollback point.
- Update this roadmap when a gate changes; do not silently change workflow in
  implementation prompts or code comments.
