# Agent Workflow Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Video Agent runs cancellable and resumable, show typed workflow progress instead of chat while work runs, and make Agent review surfaces and asset admission consistent with MotionReal.

**Architecture:** `HarnessManager` remains the owner of the native Harness session and durable Agent metadata. A narrow workflow IPC cancels both the native Harness session and any Workspace operation, writes `paused`, and rejects late poll/render work by revision. The renderer selects chat, progress, or review from durable state and gets only a redacted `session.history` projection.

**Tech Stack:** Electron IPC, React, TypeScript, Vitest, DeepSeek Harness HTTP RPC, existing MotionReal WorkspaceController.

**Spec:** `docs/superpowers/specs/2026-08-29-agent-workflow-control-design.md`

## Global Constraints

- Keep native Harness chat, session, tools, questions, approval, attachment, and history; do not scrape iframe DOM or add postMessage.
- Use native Harness `session.cancel`; never terminate the shared Harness process to stop one video.
- `paused` is durable, never an error, and late work cannot create a repair prompt or advance workflow.
- Keep strict authoring validation; reject malformed manifests before still rendering.
- Do not modify Create Flow, classic Workspace authoring/render behavior, crawler, `AI_CONTRACT.md`, or user files under `skill-test/`.
- Use existing CSS/components and add no dependency.

---

### Task 1: Add durable pause/resume and brief-generation states

**Files:**
- Modify: `apps/desktop/src/shared/types.ts:47-96`
- Modify: `apps/desktop/src/main/agent/agent-workflow.ts:1-118`
- Test: `apps/desktop/src/main/agent/agent-workflow.test.ts`

**Interfaces:**
- Produces `AgentProductionState` values `preparing_brief` and `paused`.
- Produces `pausedFrom?: Exclude<AgentProductionState, "paused" | "error" | "completed">` on durable workflow records and `AgentDraftVM`.
- Produces `pauseAgentWorkflow(current, expectedRevision)` and `resumeAgentWorkflow(current, expectedRevision)`.

- [ ] **Step 1: Write the failing tests**

```ts
it("pauses a live workflow and resumes only its saved state", () => {
  const collecting = transitionAgentWorkflow(initialAgentWorkflow(), {
    expectedRevision: 0, to: "collecting_assets", jobId: "job-a",
  });
  const paused = pauseAgentWorkflow(collecting, 1);
  expect(paused).toMatchObject({ productionState: "paused", pausedFrom: "collecting_assets" });
  expect(resumeAgentWorkflow(paused, 2)).toMatchObject({ productionState: "collecting_assets" });
});

it("rejects a late transition after pause", () => {
  const paused = { workflowVersion: 1, workflowRevision: 2, productionState: "paused", activeJobId: "job-a", pausedFrom: "collecting_assets" } as const;
  expect(() => transitionAgentWorkflow(paused, { expectedRevision: 1, to: "asset_review", jobId: "job-a" })).toThrow(/đã thay đổi/);
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npm.cmd test -- apps/desktop/src/main/agent/agent-workflow.test.ts`

Expected: FAIL because pause/resume state and helpers do not exist.

- [ ] **Step 3: Add the minimal workflow helpers**

```ts
export function pauseAgentWorkflow(current: AgentWorkflowRecord, expectedRevision: number): AgentWorkflowRecord {
  if (expectedRevision !== current.workflowRevision || !isPausable(current.productionState)) throw new Error("Không thể tạm dừng Video Agent ở bước này.");
  return { ...current, workflowRevision: current.workflowRevision + 1, productionState: "paused", pausedFrom: current.productionState };
}
```

Add `preparing_brief` between `asset_review` and `brief_review`. Parsing rejects missing/invalid `pausedFrom` on `paused`, and rejects `pausedFrom` on every other state.

- [ ] **Step 4: Run focused tests**

Run: `npm.cmd test -- apps/desktop/src/main/agent/agent-workflow.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/shared/types.ts apps/desktop/src/main/agent/agent-workflow.ts apps/desktop/src/main/agent/agent-workflow.test.ts
git commit -m "feat: add pausable agent workflow states"
```

### Task 2: Stop native Harness work and reject late repair work

**Files:**
- Modify: `apps/desktop/src/main/agent/harness-manager.ts:107-130,1055-1273`
- Modify: `apps/desktop/src/main/workspace/workspace-controller.ts:252-278`
- Modify: `apps/desktop/src/main/index.ts:722-796`
- Modify: `apps/desktop/src/shared/channels.ts`
- Modify: `apps/desktop/src/shared/ipc-contract.ts:85-109`
- Modify: `apps/desktop/src/preload/client.ts:39-58`
- Test: `apps/desktop/src/main/agent/harness-manager.test.ts`
- Test: `apps/desktop/src/main/workspace/workspace-controller.test.ts`
- Test: `apps/desktop/src/preload/client.test.ts`

**Interfaces:**
- Produces `HarnessManager.pause(id, revision)` and `.resume(id, revision)`.
- Produces `WorkspaceController.cancelHarnessWork(projectId)`.
- Produces `window.dashboard.agent.pause(draftId, revision)` and `.resume(draftId, revision)`.

- [ ] **Step 1: Write the failing tests**

```ts
it("cancels native session and persists paused", async () => {
  const { manager, calls } = await activeManagerForTest();
  const authoring = await authoringDraft(manager);
  const paused = await manager.pause(authoring.id, authoring.workflowRevision);
  expect(calls).toContainEqual(expect.objectContaining({ method: "session.cancel", payload: { sessionId: authoring.sessionId } }));
  expect(paused).toMatchObject({ productionState: "paused", pausedFrom: "authoring" });
});

it("does not request repair after a held authoring result is paused", async () => {
  // Hold processAuthoring after read, pause, release; expect no session.prompt repair.
});
```

- [ ] **Step 2: Run focused tests to verify failure**

Run: `npm.cmd test -- apps/desktop/src/main/agent/harness-manager.test.ts apps/desktop/src/main/workspace/workspace-controller.test.ts apps/desktop/src/preload/client.test.ts`

Expected: FAIL because no Agent path calls `session.cancel` or persists pause.

- [ ] **Step 3: Implement the one authoritative pause path**

```ts
async pause(id: string, expectedRevision: number): Promise<AgentDraftVM> {
  const current = await this.mustReadRecord(id);
  this.requireActiveSession(current);
  await this.rpc(this.active!.url, "session.cancel", { sessionId: current.sessionId });
  this.stopAuthoringPoll(id);
  const next = { ...current, ...pauseAgentWorkflow(current, expectedRevision) };
  await this.writeRecord(next);
  return this.toVm(next);
}
```

Before `processAuthoring`, `requestAuthoringRepair`, `advanceAuthoringRequest`, and every post-render transition, re-read metadata and require the original revision plus `productionState === "authoring"`. `WorkspaceController.cancelHarnessWork` delegates to its existing cancellation/recovery path only for Harness-owned work. The `agent:pause` handler pauses Harness then cancels linked Workspace work; `agent:resume` activates the draft and restarts at most one matching prompt/poll.

- [ ] **Step 4: Run focused tests**

Run: `npm.cmd test -- apps/desktop/src/main/agent/harness-manager.test.ts apps/desktop/src/main/workspace/workspace-controller.test.ts apps/desktop/src/preload/client.test.ts`

Expected: PASS; releasing a paused held task sends no repair prompt.

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/main/agent/harness-manager.ts apps/desktop/src/main/agent/harness-manager.test.ts apps/desktop/src/main/workspace/workspace-controller.ts apps/desktop/src/main/workspace/workspace-controller.test.ts apps/desktop/src/main/index.ts apps/desktop/src/shared/channels.ts apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/preload/client.ts apps/desktop/src/preload/client.test.ts
git commit -m "fix: stop harness work without late repair"
```

### Task 3: Project safe activity and make brief timing truthful

**Files:**
- Create: `apps/desktop/src/main/agent/harness-activity.ts`
- Test: `apps/desktop/src/main/agent/harness-activity.test.ts`
- Modify: `apps/desktop/src/shared/types.ts:45-135`
- Modify: `apps/desktop/src/main/agent/harness-manager.ts:280-425,1275-1280`
- Test: `apps/desktop/src/main/agent/harness-manager.test.ts`

**Interfaces:**
- Produces `AgentActivityVM = { seq: number; tool: "read" | "search" | "shell" | "image" | "submission"; title: string; status: "running" | "success" | "failed" }`.
- Extends `AgentDraftVM` with `activity: AgentActivityVM[]`.
- Reads only existing `session.history`; it never sends raw event data to the renderer.

- [ ] **Step 1: Write failing projector and state tests**

```ts
it("projects only known tool events and excludes raw output", () => {
  expect(projectHarnessActivity(events)).toEqual([{ seq: 4, tool: "shell", title: "PowerShell · Tải ảnh minh họa", status: "success" }]);
});

it("uses preparing_brief until a valid brief exists", async () => {
  const next = await manager.approveAssets(id, revision, ["asset-01"]);
  expect(next.productionState).toBe("preparing_brief");
  expect((await manager.status(id)).briefReview).toBeUndefined();
});
```

- [ ] **Step 2: Run focused tests to verify failure**

Run: `npm.cmd test -- apps/desktop/src/main/agent/harness-activity.test.ts apps/desktop/src/main/agent/harness-manager.test.ts`

Expected: FAIL because activity is not projected and Asset approval enters `brief_review` early.

- [ ] **Step 3: Implement bounded history projection**

Map only `tool/call`, `tool/result`, and known MotionReal submission events. Clamp title length, drop malformed/unknown events, and never forward tool args, stdout, file paths, credentials, or provider bodies. Tail-read existing history in `status`. Change approval/retry to enter `preparing_brief`; `status` enters `brief_review` only after `readBrief` validates the current revision.

- [ ] **Step 4: Run focused tests**

Run: `npm.cmd test -- apps/desktop/src/main/agent/harness-activity.test.ts apps/desktop/src/main/agent/harness-manager.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/main/agent/harness-activity.ts apps/desktop/src/main/agent/harness-activity.test.ts apps/desktop/src/shared/types.ts apps/desktop/src/main/agent/harness-manager.ts apps/desktop/src/main/agent/harness-manager.test.ts
git commit -m "feat: project safe agent workflow activity"
```

### Task 4: Keep authoring admission strict and assets purposeful

**Files:**
- Modify: `apps/desktop/src/main/agent/harness-manager.ts:575-616,970-1057,1310-1359,1569-1570`
- Modify: `apps/desktop/src/main/agent/harness-authoring-pacing.ts:48-104`
- Modify: the source module that emits `motionreal_submit_authoring` under `apps/desktop/src/main/agent/harness/`
- Test: `apps/desktop/src/main/agent/harness-authoring-pacing.test.ts`
- Test: `apps/desktop/src/main/agent/harness-manager.test.ts`
- Test: matching submission-tool test file

**Interfaces:**
- Asset manifest item adds `purpose: string`.
- `motionreal_submit_authoring` returns preflight schema errors before still rendering.
- A brief selects a nonempty subset of user-approved assets.

- [ ] **Step 1: Write failing admission tests**

```ts
it("rejects an asset without editorial purpose", async () => {
  await expect(readManifest({ items: [{ id: "logo", role: "logo" }] })).rejects.toThrow(/mục đích/);
});

it("rejects scene-1 and a missing component before still rendering", () => {
  const result = validateHarnessManifestPacing({ scenes: [{ id: "scene-1", narration: "x" }] }, ["scene-1"], pacing, "vi");
  expect(result.ok).toBe(false);
});

it("allows a brief to choose a subset of approved assets", () => {
  expect(validateBriefAssetIds(["hero"], ["hero", "logo"])).toEqual(["hero"]);
});
```

- [ ] **Step 2: Run focused tests to verify failure**

Run: `npm.cmd test -- apps/desktop/src/main/agent/harness-authoring-pacing.test.ts apps/desktop/src/main/agent/harness-manager.test.ts`

Expected: FAIL because purpose is not required and exact asset equality is enforced.

- [ ] **Step 3: Implement schema-first admission**

Require short nonempty asset `purpose`; expose it through `AgentAssetVM`. Asset request asks for a small editorial set. Authoring receives a generated schema-valid manifest skeleton and exact `scene-01`/component/transition requirements; it edits the scaffold instead of inventing a new format. The submission tool runs structural preflight before writing its handoff.

Keep image reads. Remove “every selected asset must appear.” Replace it with “use only assets that improve a scene; logos/icons stay supporting unless a scene is about that identity.” Keep selected assets available as the approved pool.

- [ ] **Step 4: Run focused tests**

Run: `npm.cmd test -- apps/desktop/src/main/agent/harness-authoring-pacing.test.ts apps/desktop/src/main/agent/harness-manager.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/main/agent/harness-manager.ts apps/desktop/src/main/agent/harness-manager.test.ts apps/desktop/src/main/agent/harness-authoring-pacing.ts apps/desktop/src/main/agent/harness-authoring-pacing.test.ts apps/desktop/src/main/agent/harness
git commit -m "fix: admit purposeful harness assets and manifests"
```

### Task 5: Render exclusive chat, workflow, and review surfaces

**Files:**
- Modify: `apps/desktop/src/renderer/views/agent.tsx:8-285`
- Modify: `apps/desktop/src/renderer/theme/agent.css`
- Test: `apps/desktop/src/renderer/views/agent.test.ts`

**Interfaces:**
- Consumes `AgentDraftVM.activity`, `productionState`, and `pausedFrom`.
- Produces a focused `AgentWorkflowProgress` component in the Agent view.

- [ ] **Step 1: Write failing renderer tests**

```tsx
it("shows activity rather than iframe while collecting assets", () => {
  render(<AgentWorkspace draft={draft({ productionState: "collecting_assets", activity: [shellActivity] })} {...props} />);
  expect(screen.getByText("Đang thu thập asset")).toBeInTheDocument();
  expect(screen.getByText(/PowerShell/)).toBeInTheDocument();
  expect(screen.queryByTitle(/MotionReal Agent/)).not.toBeInTheDocument();
});

it("shows rendered brief review once valid", () => {
  render(<AgentWorkspace draft={draft({ productionState: "brief_review", briefReview })} {...props} />);
  expect(screen.getByRole("heading", { name: "Video Brief" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run renderer test to verify failure**

Run: `npm.cmd test -- apps/desktop/src/renderer/views/agent.test.ts`

Expected: FAIL because chat is still default and brief is a raw textarea.

- [ ] **Step 3: Implement the three-surface selector**

Render native iframe only for discovery or explicit “Mở chat.” Render MotionReal progress for collection, brief preparation, queued create, authoring, render, and pause. Keep iframe mounted but visually hidden during progress/review. Review always wins. Use existing Markdown support if already installed; otherwise use the smallest existing renderer capability rather than adding a parser. Wire pause/resume buttons to the new Agent IPC.

- [ ] **Step 4: Run renderer tests**

Run: `npm.cmd test -- apps/desktop/src/renderer/views/agent.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/renderer/views/agent.tsx apps/desktop/src/renderer/theme/agent.css apps/desktop/src/renderer/views/agent.test.ts
git commit -m "feat: show agent workflow progress outside chat"
```

### Task 6: Align library, dialogs, settings, and brief assets

**Files:**
- Modify: `apps/desktop/src/renderer/views/agent.tsx:101-151,231-285`
- Modify: `apps/desktop/src/renderer/theme/agent.css`
- Reference: `apps/desktop/src/renderer/views/settings.tsx`
- Reference: `apps/desktop/src/renderer/theme/settings.css`
- Test: `apps/desktop/src/renderer/views/agent.test.ts`

**Interfaces:** No IPC changes. Reuse `PageHeader`, `ConfirmDialog`, input/button primitives, and MotionReal spacing tokens.

- [ ] **Step 1: Write failing visual-structure tests**

```tsx
it("uses an unboxed overflow trigger", () => {
  render(<AgentLibrary {...props} />);
  expect(screen.getByLabelText(/Tùy chọn/)).toHaveClass("ns-agent-row-menu-trigger");
  expect(screen.getByLabelText(/Tùy chọn/)).not.toHaveClass("ns-btn-icon-only");
});

it("keeps the create field in the modal body", () => {
  render(<AgentNameDialog open title="Tạo video mới" {...dialogProps} />);
  expect(screen.getByLabelText("Tên video")).toBeContainedIn(screen.getByRole("dialog"));
});
```

- [ ] **Step 2: Run renderer test to verify failure**

Run: `npm.cmd test -- apps/desktop/src/renderer/views/agent.test.ts`

Expected: FAIL because the ellipsis inherits icon-button chrome and label/input are siblings.

- [ ] **Step 3: Implement shared visual structure**

Use the same grid for table header and row target; make the ellipsis a transparent icon control. Add modal body/footer and wrap input in its label. Replace Agent-only fieldsets with Settings-view grouping/card styling. Show asset label, role, and purpose in brief review.

- [ ] **Step 4: Run renderer tests**

Run: `npm.cmd test -- apps/desktop/src/renderer/views/agent.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/renderer/views/agent.tsx apps/desktop/src/renderer/theme/agent.css apps/desktop/src/renderer/views/agent.test.ts
git commit -m "fix: align agent surfaces with motionreal"
```

### Task 7: Verify and document

**Files:**
- Modify only if necessary: `docs/current/architecture.md`
- Modify only if necessary: `docs/current/maintenance.md`

- [ ] **Step 1: Document manual acceptance**

Add exact checks for pausing collection, brief generation, repair, and render; confirm no late prompt after pause; resume once; asset purpose labels; and preflight invalid scene id/component/transition.

- [ ] **Step 2: Run focused regressions**

Run: `npm.cmd test -- apps/desktop/src/main/agent/agent-workflow.test.ts apps/desktop/src/main/agent/harness-manager.test.ts apps/desktop/src/main/agent/harness-activity.test.ts apps/desktop/src/main/agent/harness-authoring-pacing.test.ts apps/desktop/src/main/workspace/workspace-controller.test.ts apps/desktop/src/preload/client.test.ts apps/desktop/src/renderer/views/agent.test.ts`

Expected: PASS.

- [ ] **Step 3: Run repository verification**

Run: `npm.cmd run typecheck`

Expected: exit code 0.

Run: `npm.cmd test`

Expected: exit code 0.

Run: `npm.cmd run build`

Expected: exit code 0.

- [ ] **Step 4: Commit docs**

```powershell
git add docs/current/architecture.md docs/current/maintenance.md
git commit -m "docs: document agent workflow control"
```

