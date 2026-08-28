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
- MotionReal-native chat/tool UI with the embedded Harness client retained as
  a debug fallback;
- working 9router model, terminal, web access, and local file writes;
- Agent video creation/deletion and project linking metadata;
- schema-validated asset, brief, and authoring submissions through three narrow
  Harness tools;
- a split creation owner: Classic keeps the existing API authoring path, while
  Harness-created projects let their Session write scene code and reuse the
  existing still/review/TTS/final-render infrastructure.

The embedded Harness client remains the rollback/debug point through Phase 7.

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
- Keep the Harness iframe as a developer fallback until the replacement UI has
  passed real-session resume and tool-timeline tests.

## Phase 0 — Freeze and Observe the Baseline

Status: accepted on 2026-08-27 against DeepSeek Harness
`00aba2f848f7fe5828da13ee382fd42d81028b31`
(`dsh-v0.1.1-rc.2-1-g00aba2f848`) and the MotionReal integration baseline ending
at `0e7e226`. Later workflow commits keep the same sibling Harness checkout and
public RPC surface.

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

Status: completed and gated on 2026-08-27.

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

Implemented V1 details:

- MotionReal writes `handoff/brief-request.json`; Harness atomically submits
  `handoff/brief.json` with matching job/request revisions.
- Existing Agent videos already at `brief_review` can explicitly retry brief
  generation without repeating asset collection.
- The review edits title, final prompt, duration tier, language, and voice.
- Approval writes a frozen create request and moves to `queued_create`; it does
  not create a project. The separate create action invokes the existing
  `CreateController`, promotes only selected local assets, renames the created
  project to the approved title, links its id, and moves to Harness `authoring`.
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

See `docs/providers/vieneu.md` for the pinned development runtime and commands.

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

Implemented V1 details:

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

## Phase 5 — MotionReal-Native Chat UI

Status: implemented and accepted against the real native-Windows Harness/9router
session on 2026-08-27.

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

Implemented V1 details:

- Main loads canonical paged history through `session.history`, sends through
  `session.prompt`, and aborts through `session.cancel`.
- The pinned network runtime requires WebSocket upgrade at
  `/api/events.mux`; HTTP/SSE returns 426. The adapter therefore uses that
  actual WebSocket carrier and reconnects after an unexpected close.
- Typed IPC carries only final human/assistant text, text deltas, generic
  thinking state, and tool name/description/outcome. Context injections,
  reasoning text, command/output, absolute tool paths, provider bodies, and raw
  frames stay inside Harness/Main.
- Relative `file_path` values may render as `Hiện tệp`. Main resolves the target
  again, checks lexical and real-path containment, and asks Explorer to reveal
  the file; the renderer never receives an absolute path or executes the file.
- The renderer re-baselines from canonical history after lifecycle events,
  guards async loads by draft id, and keeps the iframe behind `Debug Harness`.
- No Harness UI package, markdown dependency, alternate session store, or new
  production/render path was added.

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

Acceptance evidence:

- Focused fake-runtime tests cover history, filtering, WebSocket text/tool/error
  projection, malformed frames, child exit, prompt, abort, and IPC allow-list.
- A real existing Gemini session restored after app restart with its human,
  assistant, and terminal/file/web tool outcomes; switching to the ChatGPT
  session showed only that session and switching back restored Gemini.
- A real 9router turn returned `MR-PHASE5-OK` in both native chat and Debug
  Harness. A second turn was cancelled and a following retry returned
  `MR-PHASE5-RETRY-OK`, proving the Session remained usable.

## Phase 6 — Submission Tools and Hardening

Status: implemented and accepted against the real native-Windows Harness/9router
runtime on 2026-08-28.

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

Acceptance evidence:

- MotionReal loads one standalone Harness plugin through `--patch`; no Harness
  fork patch, second service, downloader, or render path was added.
- A real `ag/gemini-3.7-flash-high` session called
  `motionreal_submit_assets`, received its tool result, and reached asset review
  from the validated durable manifest.
- After asset approval and an app/sidecar restart, the same Session resumed,
  called `motionreal_submit_brief`, received a successful tool result, and
  produced the current validated brief artifact.
- Focused tests cover valid, duplicate, conflicting, stale, external-workspace,
  and aborted submissions. The executor fixes title to the user-owned value in
  `brief-request.json`, so it cannot drift through model arguments.

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
  presence, and use of every approved asset before MotionReal renders stills.
  Every occurrence must preserve its approved media role; unapproved refs are
  rejected. Actual on-screen use is checked during still review, not inferred
  from a manifest ref or a regex over source.
- MotionReal renders PNG stills, requires Harness to open/review every scene and
  resubmit concrete notes, renders the revised stills, then reuses the existing
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
- Harness submits initial scenes, visibly performs image-backed self-review, and
  MotionReal opens the existing per-scene cards without encoding a review MP4.
- One user scene edit returns to the same Session, changes only the requested
  scene(s), repeats the still/self-review loop, and never calls Classic
  authoring.
- After the user approves the scenes, the existing TTS/caption/full-render path
  produces a healthy video.

Stabilization audit (2026-08-28): submission regressions now cover repeated
asset-role mismatch, unapproved refs, corrected retries, and directories named
`.tsx`. The full suite passed 138 files / 1,380 tests; typecheck, Remotion build,
desktop Main/plugin build, and loading the built three-tool plugin exited 0.
These are automated structural checks, not a new native video acceptance. The
existing Ox job predates the pacing/asset-role/V2 changes and is not evidence
that those changes have passed an end-to-end run.

Creative-rewrite follow-up (2026-08-28): a missing or unreadable V2 module now
fails the source comparison instead of being counted as changed. Regression
cases cover a deleted module and a directory in place of a module, preserving
the V1 archive in both cases. Archive/comparison also reuse admission's actual
component-ID-to-file mapping: valid modules whose filenames differ from their
IDs no longer fail archive, while rename-only V2 still fails. The manager test
uses those nonmatching filenames through the V1/V2/review flow. The latest full
suite passed 138 files / 1,383 tests; typecheck, Remotion build, and desktop
Main/plugin build exited 0. This is source-integrity evidence, not proof of
image review or better visual quality.

Native policy evidence (2026-08-28): an isolated profile launched through the
production `HarnessManager` against sibling Harness revision
`00aba2f848f7fe5828da13ee382fd42d81028b31` and the built submission plugin.
`session.history` confirmed `permission/preset=danger-full-access`,
`sandbox/mode=danger-full-access`, and `approval/policy=never`; after disposing
and restarting the runtime, the same session id retained all three facts.
No prompt/model turn or video render was started. Local report:
`.video-tool/verification/harness-policy-RfXnAT/report.json`.

Keep the contrary startup evidence too: the first fresh-profile attempt hit the
existing 60-second startup timeout before a session was created
(`.video-tool/verification/harness-policy-N8WdVY/report.json`). A subsequent
fresh profile passed, including restart/resume, without a code or timeout
change. That proves the policy integration, not consistent cold-start latency;
the first timeout's cause is not established. Native search success and a new
video's visual/duration acceptance remain outstanding.

Search-provider diagnosis (2026-08-28): a native provider-level probe loaded the
installed Harness credential provider against MotionReal's search credential
store with watching disabled and no credential writes. It reported
`configured: false`; the installed DeepSeek search provider returned
`WEB_PROVIDER_CREDENTIAL_MISSING`. Chat's 9router credential does not authorize
this separate DeepSeek request. No user session or video was changed.

The same probe mounted the installed `dsh-mcp-client` with
`transport: streamable-http` and
`url: https://mcp.exa.ai/mcp?tools=web_search_exa`. With no API key/header, it
registered exactly `mcp__exa__web_search_exa` and executed a fixed public query
through Harness's tool runtime. The call succeeded with nonempty text containing
source URLs. Report: `.video-tool/verification/harness-search-Ubn0aC/report.json`.
This proves the native MCP bridge/provider path, not model tool selection,
MotionReal chat rendering, or production availability. The temporary probe is
`.video-tool/verification/check-harness-search.mts`; it is not a product launcher.

Exa's [official MCP documentation](https://exa.ai/docs/reference/exa-mcp)
offers a rate-limited free plan; a successful call is not a promise of unlimited
or keyless production service. Its remote tool name differs from the built-in
`web_search`. Using it would be an explicit search-provider change, reusing the
existing MCP plugin and adapting the chat label; no new crawler is needed.
The later search-integration batch below adds this explicit opt-in; DeepSeek
remains the default until the user selects Exa and restarts MotionReal. Supplying
a DeepSeek search credential remains the other option. This provider-only probe
is not a completed search-in-chat acceptance.

Image-route diagnosis (2026-08-28): the custom 9router model previously omitted
`input`, so the installed Harness resolved it to text-only and `read_image`
refused before reading a PNG. The generated config now declares `[text, image]`
on the exact model entry, not as a default for all models. Initial asset review,
V1-to-V2 review and self-review repair instructions name the existing
`read_image` tool rather than relying on text-file reads.

Two regression assertions failed before the fix and the focused manager/rewrite
suite passed all 25 tests afterwards. An isolated native probe generated config
through production `HarnessManager`, loaded the installed filesystem,
attachment and LLM plugins, read a PNG, and passed the tool-result image through
the actual adapter to a local mock provider. The captured request contained one
PNG data URL and the pinned model ID; the adapter received a normal completion.
Report: `.video-tool/verification/harness-vision-wire-G0RiU0/report.json`;
probe: `.video-tool/verification/check-harness-vision-wire.mts`.
The earlier negative/positive capability probe is retained at
`.video-tool/verification/harness-vision-spZcl3/report.json`.
Final verification for this change: `npm.cmd run typecheck`, `npm.cmd test`
(138 files / 1,383 tests, including the isolated authored-typecheck group),
`npm.cmd run build`, and `npm.cmd --prefix apps/desktop run build:main` all
completed with exit code 0.

This proves image transport with the installed adapter, not live model vision
or visual quality. The real gateway's `/v1/models` check timed out after ten
seconds while a listener still existed on port 20128; no gateway restart,
credential mint, provider switch or existing video mutation was performed.
Live model-image acceptance remains outstanding. The audit also found that V2
submission rendered new stills and immediately accepted notes made before those
new stills existed. The follow-up below addresses that ordering defect.

Post-render image review (2026-08-28): V2 and user-edit submissions now render
stills and issue a separate `image_review` request/revision. A later submission
must acknowledge every scene and include notes for those new PNGs before human
review is opened. The existing submission tool handles both review phases; no
new tool, render engine or workflow service was added. A fingerprint ties the
acknowledgement to manifest/module/asset/still bytes. If those bytes change or an
image is missing, MotionReal re-renders and requests another review instead of
accepting old notes. Inputs changing during render invalidate the attempt.
Unchanged acknowledgements perform no extra render. Stale or incomplete reviews
retain the image-review phase, and restart restores the same durable request.
Stopped runtimes no longer enqueue authoring polls or repair prompts; a failed
in-flight prompt retains its durable request for the next activation instead
of issuing another revision against a disposed sidecar. The broader test run
also caught an unlogged fallback and test waits shorter than the real polling
plus file/admission work under load. The fallback now records its error, and
the affected tests use bounded five-second waits and dispose test managers
before removing their temporary directories. Production timeouts are unchanged.

Regression coverage includes the V1-to-V2 ordering defect, new-image review
after user edits, source/manifest/asset changes, missing/replaced stills,
mid-render source changes, incomplete/stale acknowledgements and manager
restart. These are automated flow/integrity checks, not proof of actual model
image reading, attractive design, or continuous-motion quality. Native visual
acceptance remains outstanding.
Final verification: `npm.cmd test` completed with 138 files / 1,394 tests
passing, including the separately run 14 authored-typecheck tests.
`npm.cmd run typecheck`, `npm.cmd run build`, and
`npm.cmd --prefix apps/desktop run build:main` all exited 0. Loading the built
submission plugin confirmed the same three tools and the image-review schema.

Image-read evidence follow-up (2026-08-28): Main now checks native
`session.history` instead of accepting `reviewed_scene_ids`/notes as proof that
images were opened. A per-request sequence marker excludes older reads;
successful direct `read_image` results must carry an image attachment and occur
before a later assistant message. Relative paths, absolute paths and the project
junction resolve to the requested files. Missing/failed/text-only/wrong-file reads
and same-step submissions cannot advance. The check covers direct JSON handoffs
as well as submission tools, and the existing fingerprint is checked again after
the asynchronous history inspection. Older requests without a marker receive a
fresh review revision. No new Harness tool, dependency, provider or render path
was introduced.

The full suite exposed a graceful-restart race: the review request could be on
disk while its metadata revision was still being written. `dispose()` now drains
only tracked local authoring-request/metadata commits, not the model or render.
A deterministic test holds the metadata write, closes the manager, then releases
the write and resumes the same session/revision. This does not claim atomic
two-file recovery after an abrupt OS/process crash. The first suite also rejected
two unnamed catch handlers under the existing error-handling policy; those were
corrected. Earlier failed runs are not counted as passing verification.
The changed-during-history regression edits the manifest itself and verifies that
retry preserves that edit: the controller must not fall through and write its
pre-RPC manifest over a concurrent update.

The installed native agent loop, session, filesystem, attachments and real
OpenAI-compatible adapter were exercised against a local mock provider. The loop
called `read_image`, sent the resulting PNG in the next provider request and
produced native events accepted by the new checker. Previous-request and same-step
evidence was rejected. Report:
`.video-tool/verification/harness-review-evidence-utLEn7/report.json`;
probe: `.video-tool/verification/check-harness-review-evidence.mts`.
The probe uses native events serialized in the documented history envelope; it
does not claim a live 9router vision test or visual-quality acceptance. Only direct
image reads count: a nested Code Mode dispatch alone does not prove its attachment
reached model context. Full/skip-edit review-mode parity also remains separate work;
the user's local `stills_edit` correctly omits draft MP4.

Final verification for this batch: `npm.cmd test` exited 0 with 139 files /
1,412 tests passing (138 files / 1,398 tests, then the separately run 14
authored-typecheck tests). `npm.cmd run typecheck`, `npm.cmd run build`, and
`npm.cmd --prefix apps/desktop run build:main` also exited 0 on the final code.
The new image-evidence unit cases, direct-handoff/restart integration and manifest
edit-preservation regression are included. Native model vision, aesthetics,
continuous motion, and a new end-to-end video remain unaccepted.

## Search Integration Follow-up — 2026-08-28

The Agent tab now offers explicit DeepSeek/Exa selection. It persists only the
provider choice and applies it on restart, preserving live conversations and the
stored DeepSeek credential. No provider is silently switched and no new key is
created. Exa uses the installed Harness MCP client, loaded by the existing
MotionReal extension, not a new search service or downloader.

Native verification caught two integration errors that configuration-string unit
tests did not: `tool-web.search` in settings.yaml does not configure the tool
inside Standard's preset, and the host HTTP route becomes ready before MCP
discovery. The ineffective setting was removed. Native per-agent restrictions
now remove DeepSeek search from the actual scope (including resumed sessions),
and a one-time, cancellable prompt-assembly barrier reassembles the catalog after
MCP initialization. The extension declares its `systemPrompt` dependency; native
testing also caught that missing injection. No startup timeout was increased.
The pinned Standard preset disables `web_fetch`; it remains disabled.

Evidence from isolated profiles, with no user project/session changed:

- `harness-search-chat-VA4ztx/report.json`: production `HarnessManager`, built
  extension, pinned native Harness process, real Exa search, and a local mock
  model. The first request contained Exa but not `web_search`; the tool succeeded,
  source URLs reached the next model request, assistant completion reached the
  safe chat projection, and restart resumed the same session and search catalog.
- `harness-search-chat-riC9Hx/report.json`: an injected Exa network outage did not
  block host/session creation; unavailable Exa was absent from the catalog,
  DeepSeek was not used as an implicit fallback, a forced unavailable-tool call
  appeared as an error, and the mock-model conversation could finish.
- The earlier failed native attempts remain under `.video-tool/verification/`.
  They are not counted as successful acceptance. Probe source:
  `.video-tool/verification/check-harness-search-chat.mts`; it is diagnostic, not
  an app startup requirement. The normal probe makes a fixed public Exa query;
  `--offline` injects failure only into its own child/profile.

Reports above live below `.video-tool/verification/`. These prove the native
integration and real search service, NOT live Gemini model selection, rendered
UI behavior, or video quality. The local 9router `/v1/models` request timed out;
later listener inspection found none. No gateway restart, credential mint, or
user settings mutation was performed. Live 9router chat and the new video
acceptance below remain required.

Final search-batch verification: `npm.cmd test` exited 0 with 141 files /
1,452 tests (140 files / 1,438 tests plus the separately run 14 authored-typecheck
tests). `npm.cmd run typecheck`, `npm.cmd run build`,
`npm.cmd --prefix apps/desktop run build:main`, and
`npm.cmd --prefix apps/desktop run build:renderer` all exited 0 on the final source.
The sibling Harness checkout remained clean at the recorded revision.

At the final recheck, a 9router listener had reappeared on `0.0.0.0:20128`, but
both PowerShell and direct no-proxy curl requests to `/v1/models` timed out.
Curl established TCP in about 3 ms but received no HTTP response within 10 s.
This is an unavailable acceptance dependency, not evidence of a model failure
or a reason to loosen configuration checks. No listener/firewall change or
gateway restart was made. Real-model/UI search and new-video acceptance remain
unverified; the native mock-model reports above do not replace them.

## Manual End-to-End Acceptance Scenario

Review-mode stabilization (2026-08-28): the Harness bridge now branches on the
existing Settings policy after accepted image review. `full` uses one existing
draft render + safety check (maxAttempts=1; no Classic re-author/refine),
`stills_edit` exposes current stills without a draft, and `skip_edit` uses existing
full publish automatically. Rejected edits restore the prior Workspace stage,
not the acceptance bridge. IPC recovery routes recognized Harness projects back
to their Session or a render-only retry; Classic remains on its existing worker.
Agent labels now distinguish an actual draft from still-only review, and accepted
edits refresh still URL revisions. Duplicate acceptance is refused; cancellation
also recovers a Harness render that was still queued behind another project.

Final automated verification for this batch: `npm.cmd test` exited 0 with
140 files / 1,441 tests (139 files / 1,427 tests plus the isolated 14 authored
typecheck tests). `npm.cmd run typecheck`, `npm.cmd run build`,
`npm.cmd --prefix apps/desktop run build:main`, and
`npm.cmd --prefix apps/desktop run build:renderer` all exited 0. The renderer
build reported a non-fatal CSS-plugin timing warning. Local Settings were checked
again and remain `stills_edit` with `vieneu`; no user project was rendered/edited.

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
