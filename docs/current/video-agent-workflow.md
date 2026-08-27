# Video Agent Workflow

## Status

This document records the current product and integration design for Video Agent.

Implementation order and acceptance gates are tracked in the
[Video Agent roadmap](video-agent-roadmap.md).

Implemented today:

- MotionReal starts one shared DeepSeek Harness process after the 9router gateway
  is ready.
- Each Agent video has a separate filesystem Workspace and Harness Session.
- MotionReal owns the default chat, tool activity, composer, abort, asset/brief
  review, and production-progress UI.
- The native Harness web client remains available behind `Debug Harness` for
  one stabilization phase.
- Each Agent video persists a versioned production state/revision, with strict
  transition validation and legacy records defaulting to `discovery`.
- Validated asset and brief handoffs advance only through explicit user review.
- Harness submits asset, brief, and authored-scene completion through the narrow
  `motionreal_submit_assets`, `motionreal_submit_brief`, and
  `motionreal_submit_authoring` tools. MotionReal validates and atomically
  persists the durable artifacts.
- An approved brief uses the existing project scaffold and asset-promotion path,
  then the same Harness Session writes that project's fresh Remotion scene code.
  The Agent tab projects authoritative Workspace progress throughout.

The native chat adapter uses Harness `session.history`, `session.prompt`, and
`session.cancel` RPCs plus the network WebSocket at `/api/events.mux`. Main
projects only human/final assistant text, generic thinking activity, and tool
lifecycle into typed IPC. Context injections, raw reasoning, tool output,
credentials, ports, absolute tool paths, and raw provider errors do not cross to
the renderer.

## Product Boundary

DeepSeek Harness is the Agent engine. It owns model turns, context, tool
execution, terminal/web activity, and Agent session history.

MotionReal is the product orchestrator. It owns video lifecycle state, review
gates, project creation, the authoring contract and admission checks, still and
final rendering, recovery, and user-visible progress. Harness owns the model
turns that write and revise scene code only for Harness-created projects.

The Agent must never advance production merely by saying that work is complete.
A transition requires one of:

1. a schema-validated handoff accepted by MotionReal;
2. an explicit user approval;
3. a real CreateController or WorkspaceController event.

System prompts guide the Agent, but they are not workflow enforcement.

```text
MotionReal Agent UI
        |
        v
Harness adapter
        |
        v
Harness session + model + web/terminal/file tools
        |
        v
Video-scoped Workspace and durable handoff artifacts
        |
        v
MotionReal validation + human review
        |
        v
Existing CreateController / WorkspaceController pipeline
```

## Video Ownership Model

Each Agent video owns:

- one directory under `VIDEO_TOOL_HOME/.video-tool/agent-drafts/<agent-id>/`;
- one Harness Workspace pointing at that directory;
- one Harness Session for its conversation;
- one persisted Agent production state;
- zero or one linked MotionReal `projectId` after creation begins.

All videos share one long-lived Harness process and one Harness home. Switching
videos selects the matching Session; it does not restart Harness.

Deleting an Agent video removes its Agent Workspace directory and unregisters
the Harness Workspace. For now its Harness Sessions are archived/hidden rather
than physically erasing their shared-home log data.

## Workspace Contract

Target layout:

```text
agent-drafts/<agent-id>/
  motionreal-agent.json
  AGENTS.md
  assets/
    chatgpt-logo.svg
    news-01.jpg
  research/
    notes.md
    sources.json
  handoff/
    assets.json
    brief.json
    authoring-contract.md
    authoring-request.json
    authoring.json
  project/ -> linked MotionReal project (junction after brief approval)
```

`motionreal-agent.json` is MotionReal-owned metadata. It records the Agent id,
title, creation time, Harness Workspace id, Harness Session id, production
state, and optional linked MotionReal project id.

The Agent may write research notes and download files inside its Workspace. It
may edit only the linked `project/` while a current authoring request explicitly
allows it. It never invokes the renderer; MotionReal owns validation and still
capture after each submission.

For the first implementation, downloaded assets are prioritized for usefulness.
Source URLs should still be retained for traceability, but license evaluation is
not a production gate in this phase.

MotionReal starts new video-scoped Harness sessions with the
`danger-full-access` permission preset. This removes per-tool approval prompts
when the Agent writes through the linked `project/` junction; sessions created
before this change can still contain older permission events. This preset does
not remove MotionReal's product approvals for assets, brief, still review, or
final render.

Chat and search use separate providers. Chat uses the internal 9router key.
Harness `web_search` uses DeepSeek's native search endpoint and therefore needs
a separate `DEEPSEEK_API_KEY`. The Agent tab stores that value directly through
Harness's write-only credential RPC; MotionReal does not persist it in project
metadata or renderer state.

## Two Independent Status Channels

### Agent activity

Agent activity answers “what is Harness doing now?” Examples:

- thinking;
- searching the web;
- running PowerShell;
- downloading an image;
- reading or writing a file;
- a tool succeeded or failed.

These events feed the chat/tool timeline only. Tool inactivity, a final message,
or prose such as “done” does not change video production state.

### Video production state

Video production state answers “which product gate is the video at?” The target
states are:

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

MotionReal is the sole authority for this state.

## End-to-End Workflow

### 1. Discovery

The user discusses topic, audience, duration, tone, visual direction, sources,
and desired assets with the Agent. The conversation remains free-form.

The Agent tab always exposes a `Chuẩn bị tạo video` action. The user should not
need to know a magic phrase or manually request a JSON file.

Clicking the action snapshots the current intent and starts a production job in
`collecting_assets`.

### 2. Asset collection

MotionReal asks the current Harness Session to finalize research and collect the
needed media. The Agent downloads files into `assets/` and then submits an asset
manifest.

Target manifest shape:

```json
{
  "version": 1,
  "job_id": "agent-123",
  "assets": [
    {
      "id": "asset-01",
      "path": "assets/chatgpt-logo.svg",
      "label": "Logo ChatGPT",
      "source_url": "https://example.com/logo"
    }
  ]
}
```

MotionReal validates that:

- the schema version and job id match;
- asset ids are unique;
- every path is relative and remains inside the video Workspace;
- every listed file exists, is a regular supported media file, and is readable;
- configured item and size limits are respected.

Invalid submission leaves the job in `collecting_assets` and returns actionable
validation errors to the Agent. Only an accepted manifest moves the job to
`asset_review`.

### 3. Asset review

MotionReal displays thumbnails, labels, local file status, and source URLs. The
user can keep or reject each asset, request more assets, or approve the selected
set.

Requesting changes returns the job to `collecting_assets` with a concrete note,
for example: keep `asset-01`, reject `asset-02`, and find two newer interface
screenshots.

Returning from brief review without changing the approved asset-id set reuses
the existing valid brief. MotionReal requests a new Agent brief only when the
selection changed or the previous brief is missing/invalid.

Approval persists the selected asset ids and advances to `brief_review`.

### 4. Brief review

Harness summarizes the approved conversation and asset selection into a
structured brief:

```json
{
  "version": 1,
  "job_id": "job-123",
  "request_revision": 1,
  "brief_revision": 1,
  "title": "ChatGPT đang thay đổi như thế nào?",
  "prompt": "Tạo video dọc giải thích các thay đổi mới của ChatGPT...",
  "format": "tiktok",
  "duration_tier": 2,
  "video_language": "vi",
  "voice_provider": "vivibe",
  "selected_asset_ids": ["asset-01"]
}
```

The review card lets the user edit the title/brief, return to asset review,
continue the conversation, or approve creation. Approval freezes a brief
snapshot for that run; later chat messages must not silently mutate an active
creation job.

MotionReal writes the exact request/schema to `handoff/brief-request.json` and
accepts only the final `handoff/brief.json` with the current job, request
revision, 9:16 format, supported duration/language/voice combination, and the
exact approved asset-id set. Invalid or stale files remain in `brief_review`.

### 5. Project scaffold and Harness authoring

Approval moves the job to `queued_create`. MotionReal reuses CreateController
only to scaffold the normal project, promote approved local assets, persist the
brief/settings, and link ownership. `creationMode: harness` deliberately skips
the Classic `beginCreate` authoring call.

MotionReal then writes `handoff/authoring-request.json`, exposes the linked
project as `project/`, and asks the same Harness Session to inspect the approved
assets and write fresh `manifest.json` plus `authored/*.tsx`. The submission tool
checks the project mapping and asset references before MotionReal renders PNG
stills.

The first valid scene submission is not shown to the user immediately. MotionReal
renders one still per scene and asks Harness to open every PNG, revise weak scene
code, and submit concrete review notes. MotionReal renders the revised scenes
again, then opens the existing human per-scene review UI. No MP4 is encoded for
this self-review loop.

Classic Home/Create/Queue authoring remains unchanged. Harness projects reuse the
same authoring contract, admission/render tools, Workspace stages, human review,
TTS, captions, full render, export, and project recovery; they do not use the old
one-shot authoring API for scene generation or scene edits.

When project creation succeeds, the Agent record stores its `projectId`.

### 6. Authoring and render progress

The Agent tab projects actual WorkspaceController stages into a product progress
panel. It does not derive them from Harness text.

Example presentation:

```text
completed  Brief approved
completed  5 assets approved
completed  Script prepared
active     Authoring scene 4 of 8
pending    Visual still/refine
pending    Draft render
pending    User review
```

Renderer-safe labels should reuse the existing shared stage-label surface. The
Agent chat may remain usable, but it cannot independently alter the running
project state.

### 7. Scene review and edits

When WorkspaceController reaches the existing ready/review state, the Agent tab
opens the normal scene-review surface. For a Harness-owned project, scene/global
edit requests return to its same Harness Session through a new versioned
authoring request; MotionReal reruns still capture and Harness self-review before
showing the updated cards. A Classic project continues through
`WorkspaceController.submitEdits` unchanged.

### 8. Final render

Only explicit user approval starts the existing final render path. Completion
is based on the project artifact and WorkspaceController state, not an Agent
message.

## Handoff Mechanism

### Durable artifact

The accepted manifest/brief is persisted as JSON so app restart and debugging
do not depend on ephemeral chat events.

Direct Agent file writes are retained only for recovery/debug compatibility. If
that fallback is used, the Agent must write a temporary name and rename only
after completion:

```text
handoff/assets.draft.json
-> handoff/assets.json
```

MotionReal never treats a partially written draft file as completion.
Final JSON handoffs accept an optional UTF-8 BOM because PowerShell commonly
writes one even when the resulting JSON document is otherwise valid.
The current V1 request is written by MotionReal to
`handoff/assets-request.json`. It carries `job_id`, `request_revision`, the
selection to keep, and the exact manifest example. MotionReal advances only
when the final manifest matches both ids and every referenced local raster file
passes containment, size, dimension, format, and media-protocol validation.

### Preferred submission path

The target integration uses narrow custom tools:

```text
motionreal_submit_assets
motionreal_submit_brief
motionreal_submit_authoring
```

Each tool validates its schema and local files, writes the durable handoff, and
notifies the MotionReal controller. The Agent cannot supply arbitrary output
paths to these tools.

The brief title is not a model-controlled tool argument. MotionReal freezes it
in `brief-request.json`, and the submission tool copies that value into the
accepted brief while the model supplies the narrative/visual prompt and other
bounded choices.

Do not add render tools to Harness. Rendering stays in the existing MotionReal
controllers.

## Transition Rules

| From | Trigger | To |
| --- | --- | --- |
| `discovery` | User clicks prepare | `collecting_assets` |
| `collecting_assets` | Valid asset submission | `asset_review` |
| `asset_review` | User requests more | `collecting_assets` |
| `asset_review` | User approves selection | `brief_review` |
| `brief_review` | User approves frozen brief | `queued_create` |
| `queued_create` | CreateController scaffolds and links the project | `authoring` |
| `authoring` | Valid Harness submission, still render, and self-review | `still_review` |
| `draft_render` | Healthy draft artifact and ready stage | `draft_review` |
| `still_review` | User requests an edit | same Harness Session → `authoring` |
| `still_review` | User approves scenes | existing full-render controller |
| `draft_review` | User approves full render | `final_render` |
| `final_render` | Healthy full artifact | `completed` |
| any running state | Structured failure | `error` |

Duplicate submissions must be idempotent. A manifest for another job, a stale
revision, or an invalid transition is rejected rather than silently applied.

## UI Ownership

The target MotionReal UI owns:

- video/session selection;
- chat messages;
- a compact Harness tool-activity timeline;
- composer and abort controls;
- `Chuẩn bị tạo video`;
- asset and brief review cards;
- product progress;
- draft/project navigation and review actions.

The embedded native Harness page remains a temporary debug/development surface.
Do not copy the complete Harness frontend or couple MotionReal to its DOM. The
long-term renderer consumes a narrow adapter/event contract while Harness keeps
the Agent implementation.

## Failure, Cancellation, and Recovery

- A stopped or silent Agent leaves the current production state unchanged.
- Validation failures return concrete corrections and do not advance a gate.
- Aborting an Agent turn does not delete downloaded files or the video Workspace.
- Restart reads persisted Agent metadata and handoff artifacts, reconnects the
  matching Harness Session, and resumes the last valid production state.
- Once a `projectId` exists, MotionReal project recovery remains authoritative.
- Deleting a video aborts in-flight Agent work before removing its Workspace;
  project deletion continues to use the existing project lifecycle.

## V1 Scope

Build only:

1. MotionReal-owned chat/tool timeline backed by Harness;
2. persistent video Workspace/Session selection;
3. production state persistence;
4. prepare-video action;
5. asset collection submission and review;
6. brief submission and review;
7. handoff to existing CreateController for project scaffold and asset promotion;
8. Harness-authored scene code with MotionReal still validation/self-review;
9. existing WorkspaceController progress and human scene review;
10. existing TTS/final-render flow after approval.

Defer:

- Harness-controlled rendering;
- a second render engine or TSX format;
- automatic temporal QA;
- physical deletion of archived shared-home Session logs;
- strict media-license gating;
- completion inference from chat prose or filesystem inactivity.

This boundary preserves the proven video pipeline while adding the capabilities
that motivated Harness: interactive research, web/terminal work, asset
collection, persistent context, and structured preparation before creation.
