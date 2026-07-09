# Plan G1 — Workspace godfile seams (detailed)

**Status:** **implemented** (G1a–G1c) — keep for history until Plan G archives  

**Parent:** `docs/working-notes/2026-07-09-plan-g-godfile-seams.md` (Plan G)  
**Created:** 2026-07-09  
**Not durable contract.** Sync accepted module names into `docs/current/*` when G1 completes.

---

## Goal

Finish **all of G1** (a → b → c) so `WorkspaceController` stays the async
orchestrator but **does not own** stage-policy tables, refine-loop bodies, or
publish result shaping. Enables later UX/refine/publish features without
growing the ~1000-line godfile.

**Non-goal for G1:** change draft-before-full, cancel recovery semantics,
refine defaults, or user-visible copy (except accidental string moves that
must stay identical).

---

## Ground truth (controller today)

| Area | Location | Notes |
| --- | --- | --- |
| Size | `workspace-controller.ts` ~997 lines / ~55 KB | Still owns refine + publish + edits |
| Stage log | `setStage` + `workspace-stage.ts` | Fingerprints ignore percent |
| Labels | `shared/stage-labels.ts` | Renderer |
| Create crawl | `workspace-create-flow.ts` | Callback pattern to copy |
| Script | `workspace-script-flow.ts` | Already extracted |
| Render progress pure | `workspace-render-flow.ts` | `renderingStageOf`, preprompts |
| Ready/published pure | `workspace-view-model.ts` | `readyStageOf`, `publishedStageOf` already exist |
| Refine body | **still private** on controller | `refineBeforeDraft`, `refineEditedScenes`, `creativeBootstrapPass`, `runVisionPasses`, `snapshotFresh`, `restoreToPriorDraft` |
| Publish body | `runPublish` + `publishedStage` | Thin async; shape already pure |

**Pattern to mirror:** `runCreateCrawlThenAuthor(options)` — deps injected,
controller passes `setStage` / worker / settings closures.

---

## Principles (G1 only)

1. Behavior-preserving; no product flag changes.
2. Public methods of `WorkspaceController` keep the same names/signatures
   (`beginCreate`, `approve`, `publish`, `cancel`, `setStage`, …).
3. Extract **async flow with callbacks** for refine; **pure functions** for
   stage policy and publish error/result shaping.
4. One commit per slice (G1a, G1b, G1c) unless owner prefers a stacked PR.
5. Workflow: Check → Do → Check → Confirm → Commit per slice.
6. Update Plan G status board after each slice.
7. Do **not** hard-fail production on unknown transitions in G1a v1 (log + test
   documentation first; optional `devAssert` only if already have a pattern).

---

## G1a — Stage transition policy

### Intent

Make “which stages exist and which happy-path edges we expect” **readable and
tested** without scrolling the controller. Builds on `stageFingerprint` /
`shouldLogStageTransition` (already shipped).

### Deliverables

| Item | Detail |
| --- | --- |
| Module | Prefer extend `workspace-stage.ts` (keep one stage module) **or** add `workspace-stage-policy.ts` if file grows past ~150 lines of policy tables |
| API (pure) | See below |
| Tests | `workspace-stage.test.ts` (or `workspace-stage-policy.test.ts`) |
| Controller | Optional: call `noteStageTransition(prev, next)` that only **debug-logs** unexpected edges — **must not** throw in production |

### Proposed API

```ts
/** Kind-level graph for documentation + tests (not every phase edge). */
export type StageKind = ProjectStage["kind"];

/** Documented happy-path kind edges (examples, not exhaustive runtime FSM). */
export const DOCUMENTED_STAGE_KIND_EDGES: ReadonlyArray<readonly [StageKind | "none", StageKind]>;

/**
 * Classify a kind-level hop for tests/docs.
 * - "documented" — in the happy-path table
 * - "allowed-other" — valid recovery/error/cancel paths listed separately
 * - "unknown" — not listed (log in dev only if wired)
 */
export function classifyStageKindTransition(
  from: StageKind | "none",
  to: StageKind,
): "documented" | "allowed-other" | "unknown";

/** Extract kind from stage or "none". */
export function stageKindOf(stage: ProjectStage | undefined): StageKind | "none";
```

**Documented happy paths (from real logs + code):**

```text
none → writing
writing → image-review | script | writing (phase changes stay same kind)
image-review → writing
script → rendering
rendering → ready | error | rendering (phase changes)
ready → rendering | published? no — ready → rendering (edit/full)
rendering → published (full success)
error → writing | rendering (retry create/draft/full via recover/retry)
any → (recoverAfterCancel lands on recovered stage without error)
```

**Phase changes** within `writing` / `rendering` remain free (fingerprint
already tracks them). G1a policy table is **kind-level** first to avoid a
brittle mega-FSM of every `prepare`/`qa`/`draft` hop.

**Allowed-other edges** (must list explicitly in tests):

- `rendering → error` (draft/full/edit failures)
- `error → rendering` / re-entry via retry handlers
- `ready → rendering` (edit or full)
- `published` only from successful full path (`rendering` → `published`)
- cancel recovery: engine clears stage then `setStage(recoverStage)` — treat
  recover as `none → X` or `previous → recovered` without requiring prior edge

### Controller wiring (minimal)

Inside `setStage`, after fingerprint log, optionally:

```ts
const kindClass = classifyStageKindTransition(stageKindOf(previous), stage.kind);
if (kindClass === "unknown") {
  log.debug({ projectId, from, to, kindClass }, "workspace stage kind hop not in policy table");
}
```

Use **debug** not error — first ship of the table will miss edges; unknown must
not break users. Expand table from real logs if needed.

### Verification G1a

```powershell
npm.cmd test -- --run apps/desktop/src/main/workspace/workspace-stage.test.ts
npm.cmd run typecheck
```

### Acceptance G1a

- [ ] Kind-level documented + allowed-other edges covered by tests
- [ ] Fingerprint/percent behavior unchanged
- [ ] Production never throws on unknown hop
- [ ] Plan G board: G1a done

### Commit message (suggested)

```
Add workspace stage kind transition policy

Document and test kind-level stage edges on top of fingerprints; optional
debug log for unknown hops without changing runtime gates.
```

---

## G1b — Refine flow extract (main extraction)

### Intent

Move silent refine implementation out of the controller into a callback-driven
module, same style as `workspace-create-flow.ts`.

### Deliverables

| Item | Detail |
| --- | --- |
| New module | `apps/desktop/src/main/workspace/workspace-refine-flow.ts` |
| New tests | `workspace-refine-flow.test.ts` |
| Controller | Thin wrappers calling refine-flow functions |

### Functions to move (bodies today private on controller)

| Function | Role |
| --- | --- |
| `snapshotFresh` | First-touch snapshot into shared preRefine |
| `creativeBootstrapPass` | First-author “be bolder” reauthor + stills + accept-gate |
| `runVisionPasses` | Multi-pass visualQa → reauthor → stills; early-stop streak |
| `refineBeforeDraft` | prepare stills → bootstrap → vision (all scenes) |
| `refineEditedScenes` | prepare stills → vision only (scoped); no bootstrap |
| `restoreToPriorDraft` | Optional keep with controller if tightly coupled to `generateValidateRepair` + stage edit/draft — **prefer move** with callbacks |

### Options bag (sketch)

```ts
export type RefineFlowDeps = {
  projectId: string;
  signal?: AbortSignal;
  settings: { refinePasses: number; refineEarlyStop: boolean; maxRepairAttempts: number };
  worker: Pick<
    AgentWorker,
    "renderStills" | "visualQa" | "reauthorScenes" | "snapshotScenes" | "restoreScenes" | "generateValidateRepair"
  >;
  loadManifest: (projectId: string) => Promise<{ scenes: { id: string }[] }>;
  setStage: (stage: ProjectStage) => void;
  editHooks: () => AgentHooks; // or AgentHooks value
  renderHooks?: (phase: "draft" | "full" | "edit") => AgentHooks;
  warn: (details: object, message: string) => void;
  // preprompts stay imported from workspace-render-flow
};
```

Public entrypoints:

```ts
export async function refineBeforeDraft(deps: RefineFlowDeps): Promise<SceneSnapshot>;
export async function refineEditedScenes(deps: RefineFlowDeps, sceneIds: string[]): Promise<boolean>;
export async function restoreToPriorDraft(
  deps: RefineFlowDeps,
  snapshot: SceneSnapshot,
  hooks: AgentHooks,
): Promise<boolean>;
```

Keep `creativeBootstrapPass` / `runVisionPasses` as **module-private** exports
only if tests need them; otherwise unexported functions in the same file.

### Behavioral invariants (must preserve)

1. First author: stills (all) → creative bootstrap → vision passes → return snapshot.
2. Edit path: **no** creative bootstrap; vision scoped to edited ids.
3. Accept-gate: empty stills after rewrite → restore snapshot; edit path returns
   false when first stills empty.
4. Early-stop: two consecutive clean passes when `refineEarlyStop`; else full
   `refinePasses`.
5. Stages: `prepare` for hidden stills; `qa` with `qaPass`/`qaTotal` during vision.
6. Skip entire refine when `refinePasses <= 0` or missing `renderStills`/`visualQa`.

### Tests G1b

Prefer **unit tests with fake worker** (vi.fn), not full Electron:

| Case | Expect |
| --- | --- |
| refine disabled | empty snapshot / true skip |
| first stills empty | return early, no bootstrap |
| vision flags one scene | reauthor + renderStills called with those ids |
| empty stills after reauthor | restoreScenes called; changedAny false |
| earlyStop two cleans | breaks before max passes |
| edit path | never calls reauthor with creativeBootstrapPreprompt |

Port or thin-wrap any existing controller tests that only exercise refine if
they become cheaper at module level.

### Controller after G1b

```ts
private async refineBeforeDraft(...) {
  return refineBeforeDraftFlow({ ...deps built from this });
}
```

Same for edit/restore. No logic left in the private method beyond wiring.

### Verification G1b

```powershell
npm.cmd test -- --run `
  apps/desktop/src/main/workspace/workspace-refine-flow.test.ts `
  apps/desktop/src/main/workspace/workspace-controller.test.ts `
  apps/desktop/src/main/workspace/workspace-render-flow.test.ts
npm.cmd run typecheck
```

Optional: one desktop create→draft smoke (owner).

### Acceptance G1b

- [ ] Refine implementation lives in `workspace-refine-flow.ts`
- [ ] Controller only wires deps
- [ ] Fake-worker tests cover accept-gate + early-stop + edit vs first-author
- [ ] No intentional UX/stage string change
- [ ] Plan G board: G1b done

### Commit message (suggested)

```
Extract workspace refine flow from controller

Move silent pre-draft and edit-path vision refine into a callback-driven
module; preserve accept-gate and early-stop behavior.
```

### Risk note

G1b is the **largest** G1 slice. If mid-extract is risky, split commits:

1. Move pure-enough helpers + tests with controller still calling them via
   re-export  
2. Switch call sites  

Do not leave half-duplicated refine bodies.

---

## G1c — Publish / full-path helpers

### Intent

`runPublish` is already small; `publishedStage` async only loads manifest
fields. G1c **tightens the boundary** so publish success/error staging is pure
and testable—without a fake “extract for size.”

### Deliverables

| Item | Detail |
| --- | --- |
| Extend | `workspace-view-model.ts` and/or new `workspace-publish-flow.ts` |
| Pure | Map publish worker result + manifest fields → `ProjectStage` |
| Pure | Map publish failure → `error` stage shape (`fixable`, `retry: "full"`) |
| Controller | `runPublish` remains guard + worker call + setStage |

### Proposed pure helpers

```ts
// Already: publishedStageOf(outputPath, { title, hashtags, format, thumbnailPath })

export function publishErrorStageOf(input: {
  message: string;
  fixable: boolean;
}): ProjectStage; // { kind: "error", retry: "full", ... }

export function fullRenderStageStart(): ProjectStage;
// { kind: "rendering", percent: 0, phase: "full" }
```

Optional async helper **not** in pure module:

```ts
// stays on controller or thin publish-flow with loadManifest injected
async function buildPublishedStage(projectId, outputPath, deps): Promise<ProjectStage>
```

Only extract `buildPublishedStage` if it reduces duplication with other
call sites; today single call site is OK to keep as private method that **only**
loads manifest + calls `publishedStageOf`.

### Tests G1c

- `publishErrorStageOf` / `fullRenderStageStart` shapes
- `publishedStageOf` already tested — add cases if missing title/hashtags omit

### Verification G1c

```powershell
npm.cmd test -- --run apps/desktop/src/main/workspace/workspace-view-model.test.ts
# + publish-flow tests if new file
npm.cmd run typecheck
```

### Acceptance G1c

- [ ] Publish stage construction is pure + tested
- [ ] `runPublish` control flow unchanged (draft-first still enforced by worker)
- [ ] Plan G board: G1c done; G1 complete checklist

### Commit message (suggested)

```
Clarify publish stage helpers as pure workspace seams

Centralize full-render start/error stage shapes next to publishedStageOf
without changing publish orchestration.
```

---

## Implementation order

```text
G1a (policy + tests)     → small, safe, unlocks docs of stage graph
G1b (refine extract)     → main godfile win
G1c (publish pure)       → small closeout
Update Plan G board + architecture.md workspace list
```

Do **not** interleave G2 until G1 checklist is green unless owner overrides.

---

## Files touch map

| Slice | Create | Modify |
| --- | --- | --- |
| G1a | (optional policy file) | `workspace-stage.ts`, `workspace-stage.test.ts`, maybe `workspace-controller.ts` setStage debug |
| G1b | `workspace-refine-flow.ts`, `workspace-refine-flow.test.ts` | `workspace-controller.ts` (delete private bodies) |
| G1c | optional `workspace-publish-flow.ts` | `workspace-view-model.ts` (+ test), `workspace-controller.ts` thin |
| Closeout | — | `docs/working-notes/2026-07-09-plan-g-godfile-seams.md`, `docs/current/architecture.md` |

**Do not touch:** `orchestrator.ts`, `render-grid.ts`, prompt modules, IPC contracts,
`ninerouter-backend` (except if refine tests need fakes only in workspace tests).

---

## Global verification (end of G1)

```powershell
npm.cmd run typecheck
npm.cmd test -- --run apps/desktop/src/main/workspace/
npm.cmd test
npm.cmd run build
```

Owner optional: one create→draft→full desktop run; confirm stage logs still
read `prepare` → `qa` → `draft` → `ready` → `full` → `published`.

---

## Rollback

| Slice | Rollback |
| --- | --- |
| G1a | Revert commit; fingerprints remain |
| G1b | Revert extract commit; highest risk slice |
| G1c | Revert; publish path trivial |

Never weaken draft-before-full or admission while fixing extract bugs.

---

## Effort (rough)

| Slice | Effort |
| --- | --- |
| G1a | XS–S |
| G1b | M |
| G1c | XS |
| **G1 total** | ~1–2 days focused |

---

## Done when (G1 complete)

- [ ] G1a–G1c merged
- [ ] Refine loop not implemented inside controller body
- [ ] Stage kind policy documented + tested
- [ ] Publish stage helpers pure + tested
- [ ] Plan G board all G1 rows done
- [ ] `architecture.md` lists `workspace-refine-flow` / stage policy
- [ ] This plan note marked complete; parent Plan G points next → G2 plan or park

---

## Owner decision required before code

Approve this G1 plan (especially G1a **debug-only** unknown hops, and G1b
callback surface). After approval, implement **G1a first**.
