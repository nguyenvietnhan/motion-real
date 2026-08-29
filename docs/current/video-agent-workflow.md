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
IPC. The fork's embedded mode hides only the sidebar and resize handle and
applies MotionReal color tokens; standalone Harness behavior remains intact.
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
    brief.json
    authoring-v1/
      manifest.json
      authored/
      stills/
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
still_review
draft_render
draft_review
final_render
paused
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
new valid `brief.json` advances to `brief_review`; no review screen is shown
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
  "format": "tiktok",
  "duration_tier": 2,
  "target_seconds": 90,
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

The first valid scene submission is a positioning pass and is not shown to the
user immediately. Every non-final scene must explicitly choose a supported
`transitionToNext`; MotionReal does not silently accept the runtime's default
transition. MotionReal renders one still per scene and archives the V1 manifest,
scene modules, and still evidence under `handoff/authoring-v1/`.

Harness must then open every archived PNG and perform a creative rewrite V2 of
every scene module. Changing only palette, glow, decorative frames, icons, or
pulses does not meet the creative instruction. The mechanical check is narrower:
MotionReal compares V2 source against the V1 archive, rejects any byte-identical
module, and fails on missing/unreadable V2 source rather than counting it as a
change. Byte differences do not prove a meaningful visual rewrite; still review
must judge the result. Facts, narration, timing, and approved asset references
stay fixed. MotionReal renders V2 again, then issues a separate `image_review`
request with a new revision and the newly rendered PNG paths. Only an
acknowledgement of that request can open the existing human per-scene review UI;
notes submitted with the rewrite concern V1 and cannot approve the V2 images.
No MP4 is encoded for this internal V1/V2 loop, so it
does not claim to evaluate easing or continuous motion.

The image-review request binds manifest, authored modules, referenced assets and
still-image bytes with a fingerprint. Generated `_*.tsx` runtime entries are
excluded. Changed or missing evidence triggers a fresh still render and a new
review revision; unchanged evidence is acknowledged without rendering again.
Inputs changing during a render invalidate that attempt. Missing review notes
or stale submissions cannot advance human review. The request persists across
restart. This prevents stale-image acceptance; it is not a sandbox against an
Agent deliberately rewriting MotionReal metadata under Full access.

Each review request also captures the owning Harness session's history sequence
before the request is published. Main reads native `session.history` and pairs
successful direct `read_image` calls with tool-result image attachments for every
requested PNG. Those results must follow the request's sequence and precede a
subsequent assistant message: reading and submitting in the same model step is
not enough. Text-only reads, failed calls, other files and previous-request reads
do not count. This check applies even to direct JSON handoffs, not only the
submission tool. Review requests from older builds without a sequence marker
receive a fresh review request instead of being silently accepted. No raw history
or image content is forwarded to the renderer or copied into a new log.

This is execution/attachment evidence, not proof of visual comprehension. The
check deliberately uses direct `read_image`; a nested Code Mode dispatch is not
counted merely because its internal tool ran, since its image need not be returned
to the model. Missing evidence asks for the direct read. The final fingerprint is
checked again after reading history so changes during that RPC cannot open review
with stale stills. Live model-image and visual-quality acceptance remain required.
Graceful Harness shutdown drains in-progress local authoring-request/metadata
writes before returning, so reopening cannot race that commit. It does not wait
for a model turn or render, and is not a claim of atomic two-file recovery after
an abrupt OS/process crash.

Archive and source comparison resolve component IDs through the existing static
admission pass, just as rendering does; a component ID is not assumed to be a
filename. Renaming an unchanged module does not count as a rewrite. Authored
code is parsed, never executed in Main, to obtain this mapping.

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
authoring request; MotionReal renders the edited scenes and sends a new
`image_review` request before showing the updated cards. This review-only turn
records remaining issues for the human and does not demand another creative
rewrite. A Classic project continues through
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
  stop or a draft encode. This does not skip Harness's V1/V2 image review.

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

After project linking, the persisted Agent `still_review` state records accepted
image review; live draft/full/review/completion is projected from Workspace.
The review-mode branch runs immediately after that acceptance, not after an
extra human still approval in `full` or `skip_edit`.

| From | Trigger | To |
| --- | --- | --- |
| `discovery` | User clicks prepare | `collecting_assets` |
| `collecting_assets` | Valid asset submission | `asset_review` |
| `asset_review` | User requests more | `collecting_assets` |
| `asset_review` | User approves selection | `preparing_brief` |
| `preparing_brief` | Valid brief submission | `brief_review` |
| `brief_review` | User approves frozen brief | `queued_create` |
| `queued_create` | CreateController scaffolds and links the project | `authoring` |
| `authoring` | Valid Harness submission, still render, and self-review | `still_review` |
| `draft_render` | Healthy draft artifact and ready stage | `draft_review` |
| `still_review` | User requests an edit | same Harness Session → `authoring` |
| `still_review` | User approves scenes in `stills_edit` | `final_render` |
| `draft_review` | User approves full render | `final_render` |
| `final_render` | Healthy full artifact | `completed` |
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
| Automated work (`collecting_assets`, `preparing_brief`, `queued_create`, `authoring`, render, `paused`) | MotionReal workflow progress | `AgentWorkflowProgress`: top-anchored fixed header (`padding-top: 64px`), spinner/paused icon, clean activity list |
| Human decision required (`asset_review`, `brief_review`, `still_review`, `draft_review`) | MotionReal review | `AssetReview` gallery, `BriefReview` (KnobButton chips, structured scene dividers, raw prompt editor), storyboard cards |

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

## V1 Scope

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
- physical deletion of archived shared-home Session logs;
- strict media-license gating;
- completion inference from chat prose or filesystem inactivity.

This boundary preserves the proven video pipeline while adding the capabilities
that motivated Harness: interactive research, web/terminal work, asset
collection, persistent context, and structured preparation before creation.
