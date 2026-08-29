# Agent workflow control and workspace surfaces

## Purpose

Make the Video Agent truthful and controllable: chat is used for conversation, MotionReal owns automated-work progress and human review, and Stop always terminates the active Harness and Workspace work without a late repair restarting it.

## State model

The workflow gains `preparing_brief` and `paused`.

- `collecting_assets` and `preparing_brief` are automated Harness turns.
- `authoring`, render, and repair are automated work.
- `asset_review`, `brief_review`, still review, and draft review require a human decision.
- `paused` persists the prior actionable state. It has no running poll, queued repair, or active Harness turn. The UI presents `Tiep tuc` for that same state and does not label it as an error.

Only a current workflow revision may advance the workflow. A result from a prompt, still render, poll, or repair that began before a pause is ignored after re-reading the durable record.

## Stop and resume

`agent:cancelWorkflow` is the only Agent stop path. It:

1. calls Harness `session.cancel` for the draft session;
2. stops the authoring poll and invalidates the current operation generation;
3. asks Workspace to cancel any active render;
4. persists `paused` with its previous state before returning to the renderer.

Resume is explicit. It restores the recorded state and sends at most one applicable prompt. It never repeats a stale submission or creates a second project.

Stopping an in-flight still render is best effort at the renderer process; a late completion may finish on disk but cannot advance the Agent workflow or enqueue a repair after cancellation.

## Workspace presentations

The Agent workspace has exactly three mutually exclusive primary surfaces:

| Workflow condition | Surface |
| --- | --- |
| Conversation or explicit `Mo chat` | Native embedded Harness chat |
| Automated work | MotionReal workflow progress |
| User decision required | MotionReal review |

The Harness iframe remains loaded while the progress or review surface is visible, preserving native session state and history. It is not scraped. Main reads the existing native `session.history` API and projects a bounded activity list: tool family, safe title, sequence, and running/success/failure status. Raw command arguments, output, paths, credentials, and provider error bodies never cross IPC.

`collecting_assets` shows activities until a valid asset manifest moves it to `asset_review`. Asset approval enters `preparing_brief`; only a valid brief moves it to `brief_review`. Brief approval enters authoring/progress directly. Chat never auto-reappears during these steps.

## Authoring admission and assets

The Manifest validator remains strict. Harness authoring receives a generated manifest skeleton and exact valid scene-id/component requirements; it edits that scaffold instead of inventing the file format. `motionreal_submit_authoring` performs an early local preflight and returns actionable schema errors before MotionReal starts still rendering.

Each collected asset has an editorial purpose in its manifest. The collector makes a small, purposeful set; roles constrain intent: logo and icon are supporting elements, not automatic full-frame scenes. The authoring request treats selected assets as an approved pool and may use a relevant subset. It no longer requires every selected asset to appear merely because it was downloaded. Image reads remain required before authoring.

## Visual consistency

Agent library rows use one shared grid for header and rows. The ellipsis trigger is an unboxed icon. Create/rename and Agent settings use the existing modal spacing and Settings sections rather than Agent-only fieldsets. Brief review defaults to rendered Markdown, with edit mode for source and delivery settings. Asset, brief, still, and progress screens share MotionReal panel, spacing, typography, and action patterns.

## Verification

Focused tests cover:

- cancel during queued Harness prompt, authoring poll, still render, and Workspace render;
- no late repair or state advance after pause; exact resume once;
- `preparing_brief` cannot show review before a valid brief;
- activity projection allow-list and redaction;
- invalid manifest preflight for scene id, component, and transition;
- asset purpose/subset rules;
- library/modal/settings/brief and progress surface rendering.

Acceptance is a manual run that stops each automated phase, observes `Tam dung` promptly, resumes it once, and reaches the next review without chat taking over. The completed change runs `npm.cmd run typecheck`, `npm.cmd test`, and `npm.cmd run build` with successful exit codes.
