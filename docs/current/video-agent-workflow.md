# Video Agent Workflow

## Status

This document records the current product and integration design for Video Agent.

Implementation order and acceptance gates are tracked in the
[Video Agent roadmap](video-agent-roadmap.md).

Implemented today:

- MotionReal starts one shared DeepSeek Harness process after the 9router gateway
  is ready.
- Each Agent video has a separate filesystem Workspace and Harness Session.
- The native Harness conversation is the default chat surface inside a scoped
  iframe. Harness owns messages, reasoning, tools, questions, approvals,
  attachments, composer, stop/retry, and chat history.
- MotionReal keeps only the video workflow bar, asset/brief/still review, and
  production-progress UI around that conversation.
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

The embedded page opens the exact Harness Session with
`?session=<id>&embedded=motionreal`. MotionReal does not project chat history,
tool activity, question/approval state, Markdown, or composer behavior through
IPC. The fork's embedded mode does not mount Harness sidebar/session chrome,
hero, workspace picker, or
composer model/access controls. It applies MotionReal color tokens while
standalone Harness behavior remains intact.
MotionReal still uses internal Harness RPCs for automatic workflow handoffs.

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
    brief.generated.json
    brief.json
    content-plan.json
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

Every new Harness asset is classified as `hero`, `support`, `logo`, or `icon`.
That role follows the asset through review, project promotion, and
`scene.image.role`. `SceneImage` keeps logo/icon media compact and chrome-free;
hero/support media can occupy the visual field. Asset count does not determine
scene count. External SVG remains outside the render boundary because it is
scriptable; the Agent should obtain a raster logo or rasterize it to a local
transparent PNG before submission.

Submission checks every selected asset's manifest reference, preserves its role
in every occurrence (not just one) and rejects unapproved image refs. Pipeline
admission resolves each scene's registered component to its module file. This is
structural evidence, not proof of on-screen visibility: the still review must
verify actual image placement and size.

MotionReal starts new video-scoped Harness sessions with the
`danger-full-access` permission preset. This removes per-tool approval prompts
when the Agent writes through the linked `project/` junction; sessions created
before this change can still contain older permission events. This preset does
not remove MotionReal's product approvals for assets, brief, still review, or
final render. MotionReal marks those older sessions as `legacy-approval` and
shows any live approval request instead of silently leaving the chat busy; a new
video session receives Full access automatically.

Chat and search use separate providers. Chat uses the internal 9router key.
The custom `ag/gemini-3.7-flash-high` entry explicitly declares `input: [text,
image]`. It cannot inherit image capability from the upstream model catalog
under the custom 9router ID. Harness's existing `read_image` tool needs this
declaration to turn a local PNG into an image attachment; ordinary `read` only
returns text. Asset inspection and still-review requests name `read_image`
explicitly. The declaration enables the route, but does not by itself prove a
live provider accepted an image or that a reviewer actually inspected every
scene. Restart Harness through MotionReal to regenerate the managed settings
after upgrading; do not edit a project's scenes to work around model metadata.

Search has an explicit provider choice in the Agent tab:

- DeepSeek remains the default. Its `web_search` needs a separate
  `DEEPSEEK_API_KEY`, stored through Harness's credential RPC rather than project
  metadata. A 9router chat credential does not authorize this search endpoint.
- `Dùng Exa hosted` opts into Exa's remote MCP search, with a rate-limited free
  tier. Queries leave the machine and results may enter local Harness history.
  No Exa key is minted and the existing DeepSeek credential is retained.
- The choice is global to Agent videos, persisted as
  `.video-tool/harness/motionreal-search.json`, and applied on the next Harness
  start. Restart MotionReal after selecting it. Selection never interrupts a
  current chat; the provider label describes the running configuration, not a
  successful search-health test. Switching back uses the same button.

Exa reuses the installed Harness MCP client with
`https://mcp.exa.ai/mcp?tools=web_search_exa`. The existing MotionReal extension
loads it and uses native per-agent restrictions to remove `web_search`, including
on resumed Standard sessions. Its prompt guidance names the replacement tool,
`mcp__exa__web_search_exa`; other tools and the pinned preset's disabled
`web_fetch` remain unchanged. This is not a downloader or another agent loop.

HTTP readiness is earlier than MCP discovery. The first prompt assembly waits
for native initialization, honors turn cancellation, and then reassembles the
current catalog through Harness. Later turns do not repeat that wait. Native
MCP connection failures remain nonfatal (`failOnStartupError: false`): unavailable
tools are not advertised and chat can continue, without silently reverting to
DeepSeek search. A slow initial connection can delay the first turn up to the
native client's timeout; this does not add another app startup/verifier gate.

## Two Independent Status Channels

### Agent activity

Agent activity answers “what is Harness doing now?” Examples:

- thinking;
- searching the web;
- running PowerShell;
- downloading an image;
- reading or writing a file;
- a tool succeeded or failed.

MotionReal projects a bounded safe summary while automated work is active. It
contains only an allow-listed tool family, title, sequence and status; command
arguments, output, paths, credentials and provider error bodies remain inside
Harness. Tool inactivity, a final message, or prose such as “done” does not
change video production state.

### Video production state

Video production state answers “which product gate is the video at?” The target
states are:

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
      "path": "assets/chatgpt-logo.png",
      "label": "Logo ChatGPT",
      "source_url": "https://example.com/logo",
      "role": "logo"
    }
  ]
}
```

MotionReal validates that:

- the schema version and job id match;
- asset ids are unique;
- every asset has one supported presentation role (`hero`, `support`, `logo`, or
  `icon`);
- every path is relative and remains inside the video Workspace;
- every listed file exists, is a regular supported media file, and is readable;
- configured item and size limits are respected.

The approved manifest is a curated pool, not a requirement that every file
occupy a scene. During authoring, Harness may use a purposeful subset; it must
declare that subset, retain each used asset's approved role, and cannot use an
asset outside the approved pool. Logos and icons are supporting elements unless
the story gives them a clear visual reason to lead a scene.

Invalid submission leaves the job in `collecting_assets` and returns actionable
validation errors to the Agent. Only an accepted manifest moves the job to
`asset_review`.

If the exact native turn requested by MotionReal ends without a valid manifest
or brief, MotionReal records a retryable workflow error instead of leaving the
progress screen running forever. Downloaded assets and the current handoff stay
in place; “Thử lại bước này” sends one new request and never retries the model
silently.

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

Approval persists the selected asset ids and enters `preparing_brief`. Only a
new valid `brief.generated.json` advances to `brief_review`; no review screen is shown
while the Agent is still writing the brief.

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
  "video_language": "vi",
  "selected_asset_ids": ["asset-01"]
}
```

The review card lets the user edit the title/brief, request a regenerated brief
with specific feedback, return to asset review, continue the conversation, or
approve creation. The generated brief never fixes duration, scene count, target
seconds, or voice. Those are user choices made at approval; the selected
duration defaults to the most recently used application choice (a fresh install
starts at tier 2 / about 90 seconds).

MotionReal writes the exact request/schema to `handoff/brief-request.json` and
accepts generated output only in `handoff/brief.generated.json`. On approval it
writes the sole creation source, `handoff/brief.json`, with the chosen duration,
target seconds, language, voice and the snapshot workflow policy. Invalid or
stale files remain pending rather than surfacing as a false error.

### 5. Project scaffold and Harness authoring

Approval moves the job to `queued_create`. MotionReal reuses CreateController
only to scaffold the normal project, promote approved local assets, persist the
brief/settings, and link ownership. `creationMode: harness` deliberately skips
the Classic `beginCreate` authoring call.

Before Harness writes TSX, MotionReal runs the existing production content
planner once from the accepted brief, duration tier and language. The validated
plan is stored atomically in `handoff/content-plan.json`; retry and restart reuse
the same artifact for the current job/revision instead of spending another model
call. This planning call uses the accepted brief as user-approved content and
does not pretend it has raw-article provenance.

MotionReal then writes the plan and its ordered `expected_scene_ids` into
`handoff/authoring-request.json`, exposes the linked project as `project/`, and
asks the same Harness Session to inspect the approved assets and write fresh
`manifest.json` plus `authored/*.tsx`. The submission tool checks the project
mapping, exact planned scene order and asset references before MotionReal renders
PNG stills. Legacy in-flight requests without a content plan remain resumable.

Semantic plan scenes carry 2–4 narration-anchored `motionBeats`. MotionReal
strips beat metadata authored by Harness and injects the validated plan copy;
admission then requires every `motionCueFrames` id with a relative fallback.
Preview timing is deterministic and full render prefers provider SRT. A stale
anchor after narration editing removes cues only for that scene, whose authored
relative fallbacks keep it renderable.

The request also carries a machine-readable pacing contract derived from the
approved duration tier and the configured/calibrated voice: target seconds,
narration-word budget, and min/target/max scene counts. This contract overrides
duration phrases left inside the free-form brief. Approved assets are a media
pool, not a scene-count instruction. Before rendering any still, MotionReal
checks that the submitted scene order matches the manifest and that scene count
and narration meet the pacing contract; an under-budget manifest returns to the
same Harness Session for repair. MotionReal also stamps the approved duration
tier, language, and 9:16 format onto the manifest instead of trusting model
metadata.

The first valid scene submission is final-quality authoring, not a disposable
V1. Every non-final scene must explicitly choose a supported
`transitionToNext`; MotionReal does not silently accept the runtime's default
transition. The authoring request requires a distinct visual anchor, purposeful
motion and a non-repetitive layout for each scene; an approved logo or icon is a
supporting asset, not a full-screen background by default.

MotionReal renders human-review midpoint stills through the shared Workspace
FIFO. If visual refine is enabled, it separately builds deterministic evidence:
overview sheets cover every scoped scene, `stepped` scenes receive cue-aware
filmstrips, `continuous` scenes receive denser filmstrips, and `fine` scenes add
one full-resolution detail frame. Only wipe, clock-wipe and zoom boundaries next
to the review scope receive transition sheets. The model reads each composite
artifact once with `read_image`; it does not read every raw midpoint/cue PNG.

`temporalMode` describes whether a scene is `static`, `stepped`, or
`continuous`; `detailMode` independently selects normal or fine-resolution
inspection. Both come from the validated content plan. Legacy semantic plans
without structured cues retain the f18/mid/f82 fallback. Filmstrip panels follow
cue order and expose early future-state reveal, simultaneous steps, glow-only
changes, or an excessively long final hold without adding a frame-by-frame
motion oracle.

MotionReal then runs at most the persisted `refinePasses` visual-refine turns. A
turn must cite concrete observations and change only scenes with a visual
problem. A clean pass leaves source unchanged. With early stop enabled, two
consecutive clean passes end the loop; otherwise it stops at the configured pass
budget. `refinePasses: 0` sends no image to the model and opens human scene
review directly.

Still, source and approved-asset fingerprints protect against stale review. A
visual edit re-renders only the changed scene scope; a global manifest change
falls back safely to all scenes. The request records a native history sequence,
and MotionReal accepts the refine result only after successful direct
`read_image` tool evidence for every scoped composite artifact. A missing-read
retry reuses the same evidence and asks only for the missing paths. Raw history,
image content and provider errors never leave Harness.

Failure repair is phase-local and bounded by the project policy. Schema,
admission, pacing and TSX problems may request another Agent submission only up
to `maxRepairAttempts`; provider or local-render failures are reported as such,
not misrepresented as code defects. A durable error exposes “Thử lại bước này”
and resets only that phase's repair counter.

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
keeps its own shell and opens the shared normal scene-review surface. For a
Harness-owned project, scene/global edit requests return to the same Harness
Session through a new versioned authoring request. MotionReal re-renders only
the affected scene scope and, when enabled, runs the remaining bounded visual
refine pass before showing updated cards. A Classic project continues through
`WorkspaceController.submitEdits` unchanged.

### 8. Final render

Explicit user approval starts the existing final render path in `full` and
`stills_edit`; `skip_edit` is the user's opt-in to automatic final export. Completion
is based on the project artifact and WorkspaceController state, not an Agent
message. The Agent progress bar also displays the current Settings review mode.
The policy is: `full` renders a draft MP4 before final, `stills_edit` reviews stills
without a draft MP4, and `skip_edit` proceeds to final without a human review stop.
After Harness image review, `acceptHarnessStills` now applies that policy:

- `full`: enqueue one existing draft-render/safety-report attempt, with no Classic
  author/refine/re-author call. A successful report and a healthy draft artifact
  are required before the ready stage exposes the draft. Content failure returns
  to Harness through the existing edit request when the user asks to fix it.
- `stills_edit`: show fresh per-scene stills without rendering or displaying an
  old draft from a previous mode. The local setting correctly explains the
  reported absence of a draft; do not force MP4 preview for this mode.
- `skip_edit`: enqueue the existing full-publish path without a human scene-review
  stop or a draft encode. This does not skip the configured Harness visual refine.

Workspace owns the asynchronous MP4 work and its cancellation/serialization.
Harness persists the accepted image review without waiting for that encode.
Rejected edit requests restore the prior Workspace stage; they do not call the
acceptance bridge or accidentally start a render. Retry/fix/script-approve IPC
checks persisted Harness ownership before choosing a path, including after app
restart. Infrastructure errors rerun rendering, content fixes return to the
owning Session, and unaccepted Harness image review cannot enter Classic recovery.
Still URLs receive a new revision after accepted edits. Agent review labels use
the actual presence of a draft path, not stale Agent production metadata.

These paths have automated coverage; native video acceptance of all three modes
is still required. Existing artifact-health checks mean a nonempty regular media
file plus successful pipeline validation, not an independent new decoder test.

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
The current asset request is written by MotionReal to
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

The model proposes the generated brief title together with its narrative and
visual prompt. The user can edit that title before approval; MotionReal stores
the edited value only in the accepted brief. Generated briefs do not fix
duration, voice, or scene count.

Do not add render tools to Harness. Rendering stays in the existing MotionReal
controllers.

## Transition Rules

After project linking, the persisted Agent `scene_review` state records the
completed author/refine gate; live draft/full/review/completion is projected
from Workspace. The review-mode branch runs immediately after that acceptance,
not after an extra Agent-owned review state.

| From | Trigger | To |
| --- | --- | --- |
| `discovery` | User clicks prepare | `collecting_assets` |
| `collecting_assets` | Valid asset submission | `asset_review` |
| `asset_review` | User requests more | `collecting_assets` |
| `asset_review` | User approves selection | `preparing_brief` |
| `preparing_brief` | Valid brief submission | `brief_review` |
| `brief_review` | User approves frozen brief | `queued_create` |
| `queued_create` | CreateController scaffolds and links the project | `authoring` |
| `authoring` | Valid Harness submission and still render | `visual_refine` or `scene_review` |
| `visual_refine` | Configured pass budget or early-stop reached | `scene_review` |
| `scene_review` | User requests an edit | same Harness Session → `authoring` |
| `scene_review` | User approves scenes | Workspace render/publish stage |
| running Harness state | User stops | `paused` (stores its prior state) |
| `paused` | User continues | prior running state |
| any running state | Structured failure | `error` |

Duplicate submissions must be idempotent. A manifest for another job, a stale
revision, or an invalid transition is rejected rather than silently applied.

## UI Ownership and Workspace Presentations

The Agent workspace has exactly three mutually exclusive primary surfaces:

| Workflow condition | Surface | Presentation |
| --- | --- | --- |
| Conversation (`discovery`) or explicit `Mở chat` | Native embedded Harness chat | Embedded iframe with session-scoped URL |
| Automated work (`collecting_assets`, `preparing_brief`, `queued_create`, `authoring`, `visual_refine`, render, `paused`) | MotionReal workflow progress | `AgentWorkflowProgress`: safe activity list and native-chat affordance for a pending question/approval |
| Human decision required (`asset_review`, `brief_review`, `scene_review`) | MotionReal review | Asset gallery, brief editor/feedback and shared storyboard cards |

The embedded native Harness page owns the complete conversation surface,
including chat messages, reasoning, tool activity, questions, approvals,
attachments, composer, stop/retry, and history. MotionReal does not couple to
its DOM or recreate those features. The only renderer-facing chat interface is
the Session-scoped `harnessUrl`.

### UI Design and Aesthetic Alignment

The Video Agent tab follows MotionReal's minimalist, dark studio design system:
- **Table / List Format:** `AgentLibrary` presents video drafts in a structured, scannable table with unboxed overflow actions (`useDismissable`), stable row targets, and clean date stamps.
- **Minimalist Status Affordances:** Production states are displayed as clean, monochrome/subtle text (`var(--muted-foreground)` / subtle green for completed), avoiding loud or colorful pill badges.
- **Workflow Header & Back Affordance:** The workspace top bar uses an icon-only back button (`ns-btn-icon-only` with `Icon.chevronLeft`) and renders progress state as a subtle subtitle next to the title.
- **Progress Stability:** `AgentWorkflowProgress` uses a top-fixed card layout so that as new activity items appear or update, the progress title and spinner remain perfectly anchored and never shift vertically.
- **Configuration Knobs & Settings:** Brief review uses compact `KnobButton` chips matching `HomeView` (duration tier, language, voice provider), and Agent Settings uses structured flat cards with radio selection and password toggle affordances.

## Failure, Cancellation, and Recovery

- Stopping an Agent first persists `paused`, cancels the native Harness Session
  turn, stops authoring polling, and cancels any linked Workspace render. Late
  authoring callbacks cannot request a repair or advance the paused workflow.
- Validation failures return concrete corrections and do not advance a gate.
- Aborting an Agent turn does not delete downloaded files or the video Workspace.
- Restart reads persisted Agent metadata and handoff artifacts, reconnects the
  matching Harness Session, and preserves a paused workflow until the user
  explicitly continues it.
- Once a `projectId` exists, MotionReal project recovery remains authoritative.
- Deleting a video aborts in-flight Agent work before removing its Workspace;
  project deletion continues to use the existing project lifecycle.

## Current preview boundary

Build only:

1. native Harness conversation embedded below the MotionReal workflow bar;
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
- unvalidated deletion outside the exact pinned Harness session layout (the
  supported deletion path uses a recoverable journal and exact session ids);
- strict media-license gating;
- completion inference from chat prose or filesystem inactivity.

This boundary preserves the proven video pipeline while adding the capabilities
that motivated Harness: interactive research, web/terminal work, asset
collection, persistent context, and structured preparation before creation.
