# Video Agent pipeline improvement plan

> Agentic workers: use the existing Orca supervised terminals and execute only your assigned tasks. Follow executing-plans and test-driven-development; the user's existing-terminal workflow takes precedence over spawning agents or creating worktrees.

**Goal:** Make Agent recovery reliable, show trustworthy progress and recovery actions, and preserve evidence and quality guidance through planning and authoring.

**Architecture:** Keep Harness conversation activity, durable Agent production gates, and Workspace rendering as separate responsibilities. Repair their existing handoffs and project their states consistently; do not introduce a generic workflow engine. Reuse the existing workflow transition, revision guards, render gate, and planner validation.

**Tech stack:** TypeScript, Electron IPC, React, Vitest/browser Playwright, existing Harness RPC and Remotion pipeline.

**Specification:** The reviewed audit and user-approved priority (2026-09-13): state/recovery first, UI clarity second, planner evidence/advisories third. `AI_CONTRACT.md` and `video-agent-workflow.md` remain the runtime contract. This document records implementation and acceptance, not model-facing instructions.

## Constraints and ownership

- Work in the current dirty checkout with the user's existing OpenCode and Antigravity terminals. Preserve all pre-existing edits. Do not commit, stage, reset, or delete user projects/artifacts.
- Baseline copies under `scratch/agent-pipeline-baseline-20260913` allow review of this session's delta, separate from earlier uncommitted work.
- Preserve pure AUTHOR, 9:16, configured voice/provider, review-mode policy, admission/security boundaries, and the shared FIFO render gate.
- Keep style/layout advisories advisory. Do not fabricate source text or treat an image source URL as verified article evidence.
- OpenCode exclusively owns `main/agent/*`, `main/authoring/*`, `main/index.ts`, shared IPC/channel/type declarations, and preload wiring/tests.
- Antigravity exclusively owns Agent renderer views/tests, `shared/agent-project-progress.ts` and its tests, and Agent CSS if needed. No concurrent editing of the same file.
- Supervisor owns this plan and final documentation integration. Workers supply exact file lists, self-reviewed delta, test commands/results, unresolved risks, and one final report per task.

## Task 1 — Durable recovery (OpenCode)

Files: `main/agent/harness-manager.ts`, `harness-manager.test.ts`, `agent-workflow.ts` and tests if necessary; `main/index.ts`; `shared/channels.ts`, `shared/ipc-contract.ts`; `preload/client.ts` and tests.

Interface for Task 2:

```ts
// dashboard.agent; IPC agent:returnToDiscovery
returnToDiscovery(draftId: string, expectedRevision: number): Promise<AgentDraftVM>;
```

The action is allowed only for an Agent `error` before a project is linked. It preserves session, files, approved assets/brief artifacts; invalidates the failed attempt using existing workflow revision/job rules, clears failure/pause/retry bookkeeping, stops local work, and returns to discovery. Linked-project errors retain existing phase retry/project recovery; do not detach or recreate their project. Exposing a general arbitrary transition IPC is not required.

- [x] Reproduce paused initial planning with a deferred planner in the existing manager fixture. Pause, resolve/reject the old request, resume: no authoring prompt may be sent until the current plan is ready.
- [x] Cover resume after manager recreation, stale pause/resume callbacks, repeated clicks, and already-completed plans. Assert preserved project/session/approved artifacts and no duplicate planner/prompt work for one accepted revision.
- [x] Implement minimal shared continuation between retry and resume. For initial `planning: true`, finish planning, re-check current revision, then prompt; retain the existing rerender-only retry branch.

```ts
if (request.phase === "initial" && request.planning === true) {
  await this.completeInitialContentPlan(next, request);
}
if (await this.isCurrentAuthoringRecord(next)) {
  await this.promptSession(next, resumePromptFor(next.productionState));
}
```

- [x] Reproduce dispatch failure in all three brief entry paths (`approveAssets`, `prepareBrief`, `requestBriefChanges`). Persist `error`, `failedPhase: preparing_brief` and a safe message; refresh/restart must retain retry availability. Match existing error handling rather than maintaining only ephemeral `briefReviewError`.
- [x] Add narrow `returnToDiscovery` manager/IPC/preload wiring and tests: valid pre-project error works; stale revision, running/review state and linked project reject without mutation; old callbacks cannot advance the returned draft.
- [x] Run focused manager/workflow/preload tests, inspect delta, return completion with exact checks and changed files.

## Task 2 — Trustworthy progress and actions (Antigravity, concurrent with Task 1)

Files: `renderer/views/agent.tsx`, Agent browser/unit tests; `shared/agent-project-progress.ts` and tests; `renderer/theme/agent.css` only if existing styling is insufficient.

Consumes Task 1's `dashboard.agent.returnToDiscovery(draftId, expectedRevision)`; worker may use a browser-test mock before backend lands but must not edit IPC declarations.

- [x] Add browser regressions for linked authoring/refine receiving Workspace `rendering/prepare`, error recovery action, rejected `createVideo`, and review-mode labels.
- [x] Subscribe to linked project stage during authoring/refine as well as scene review. Preserve Agent gate authority while displaying the real render subphase. Never show an old ready/published artifact as completion while new authoring/refine is active.
- [x] Keep pause/error/needs-attention distinct from active work. Use the existing workflow pause route during Agent-owned work so cancellation persists; do not introduce a second conflicting cancel control.
- [x] On pre-project Agent error, show `Quay lại trao đổi` calling the narrow API. For linked-project errors retain `Thử lại bước này`/`Thử render ảnh` and existing project navigation. Keep conversation and reviewed artifacts intact.
- [x] Show a safe actionable creation failure instead of an active spinner after `createVideo` rejects; keep `Thử bắt đầu dựng` and clear errors on a successful new attempt or draft switch.
- [x] Display the review mode with the existing Vietnamese labels or equivalent accurate wording: draft review, still review, automatic full export. Respect existing per-project policy where available; do not infer published from Agent prose.
- [x] Verify switching drafts, subscription cleanup, stale events, paused/error precedence and three review modes with focused unit/browser checks. Capture representative browser test screenshots if supported; report visual verification limits honestly.

## Task 3 — Preserve planner evidence and quality guidance (OpenCode, after Task 1)

Files: `main/authoring/ninerouter-backend.ts` and tests; `main/agent/harness-manager.ts` and tests; existing content-plan artifact helpers/types; `main/index.ts` as needed; `main/authoring/prompt.ts` and tests.

- [x] Trace the available approved brief/assets/source records and existing safe research collector. Use readable source content through that collector; source URLs alone are not claim evidence. Propagate approved image refs and selected asset strategy through `AuthorInput`.
- [x] Regression: factual Harness planning receives labeled readable sources through `runContentPlan`; absent/unreadable supplied sources do not silently disable provenance. Unapproved assets never enter the planner pool. Reuse existing bounded/cancellable safe research paths and provenance repair/demotion.
- [x] Return and persist planner advisories alongside the content plan, across the `planContent` facade, manager dependency, content-plan artifact and authoring request. Prefer one explicit result shape, e.g. `{ contentPlan, advisories }`, after checking callers. Keep old persisted artifacts readable with absent advisories treated as empty.
- [x] Regression: advisories survive initial planning, reuse/restart and retry, reach authoring using the existing advisory formatter, remain soft, and do not force re-planning solely because a legacy artifact lacks advisories.
- [x] Fix text-only Classic author messages so explicit asset strategy is transmitted even with zero images; preserve existing undefined-strategy behavior and image-only rules.
- [x] Run focused authoring/manager/prompt/provenance tests and typecheck. Report available source limitations and any provider-dependent behavior not exercised.

## Task 4 — Review, integration and documentation (Supervisor + existing workers)

- [x] Review final deltas against the baseline, test evidence, and acceptance cases. Send at most one batched correction round per independent result unless new failures justify another.
- [x] Run `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build`, then the relevant Agent browser suite. Diagnose failures against the dirty baseline; never revert unrelated changes.
- [x] Verify matrix: planning pause/resume and restart; stale callback after pause/return; brief dispatch error/retry; duplicate submission/click; rejected scaffold retry; linked still generation; all three review modes; two draft switching; planner evidence and advisory persistence.
- [x] Update `video-agent-workflow.md` and `video-agent-roadmap.md` with actual behavior and fresh verification results. Keep live-provider/full-MP4 acceptance explicitly pending if not executed; do not claim visual/video quality from unit tests.
- [x] Mark plan completion only for verified items. Leave worker terminals available for the user; no commit/merge/deploy without a separate instruction.

## Deliberately outside this change

No generic state-machine rewrite, database migration, new template/theme system, full-frame motion oracle, speculative pacing rewrite, multi-file atomicity framework, or cosmetic redesign. Those did not have sufficient audit evidence to justify expanding this fix.
