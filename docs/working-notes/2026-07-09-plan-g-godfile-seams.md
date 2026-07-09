# Plan G — Godfile seams (temporary working note)

**Status:** active resume surface for AI/owner  
**Created:** 2026-07-09  
**Last updated:** 2026-07-09  
**HEAD at note open:** check `git log -1` (note written after `5b83b51` era; re-check hash when resuming)  
**Not durable contract.** Accepted policy stays in `AI_CONTRACT.md` + `docs/current/*`.  
**Archive/delete:** only after G1–G4 outcomes (or explicit stop) are reflected in `docs/current/maintenance.md` / `architecture.md` and owner approves.

---

## Why this plan exists

Product path (TikTok/Reels/Shorts 9:16, pure AUTHOR) is **stable enough** that the
owner prioritizes **extracting godfiles** so future features can land on clear
seams—not more production smoke for its own sake.

Goal: **gradual, behavior-preserving extraction** with tests. Not big-bang
rewrites of `orchestrator` / `render-grid` / full async `WorkspaceController`.

---

## Ground truth (as of 2026-07-09)

### Product

| Item | Reality |
| --- | --- |
| Stable path | Short-form 9:16 AUTHOR → draft → full |
| YouTube long-form | Deferred (`docs/current/youtube-mode-deferred.md`) |
| Owner confidence | High on create/render stability after real full publishes |
| Recent real smoke | Stage logs + full publish OK; soft URL 403 / reauthor N5 recovered |

### Observability already shipped (pre–Plan G)

| Piece | Location | Notes |
| --- | --- | --- |
| Stage fingerprints | `apps/desktop/src/main/workspace/workspace-stage.ts` | Ignores `percent` |
| Transition log | `WorkspaceController.setStage` | `msg: "workspace stage transition"` |
| UI phase labels | `apps/desktop/src/shared/stage-labels.ts` | Renderer-safe |
| `failureClass` | `apps/desktop/src/main/authoring/authoring-failure.ts` | Keeps legacy log messages |
| How to read logs | `docs/current/maintenance.md` | Stage + failureClass tables |

### Workspace modules already split (do not re-extract for line count)

```text
apps/desktop/src/main/workspace/
  workspace-controller.ts     ← async orchestration STAYS here
  workspace-helpers.ts
  workspace-stage.ts          ← fingerprints + shouldLogStageTransition
  workspace-view-model.ts
  workspace-create-flow.ts
  workspace-script-flow.ts
  workspace-render-flow.ts
  recall-author-input.ts
  + matching *.test.ts
```

Shared UI labels: `apps/desktop/src/shared/stage-labels.ts`.

### Authoring modules already split

```text
ninerouter-backend.ts         ← AuthoringBackend facade STAYS
content-plan.ts + content-plan-* 
author-reply-runner.ts
author-batch-policy.ts
reauthor-runner.ts
image-filter-runner.ts
article-image-crawler-runner.ts
authoring-failure.ts
prompt.ts + prompt-* modules
```

### Desktop main seams already thinned

Composition root: `apps/desktop/src/main/index.ts`.  
Local factories/helpers exist for env, image staging, BGM, settings/TTS IPC,
thumbnail IPC, create IPC, native save, startup sequence. **Do not** invent a
broad “handler mega-builder.”

### Still intentionally large (Plan G targets)

| File | Plan G phase | Owns |
| --- | --- | --- |
| `workspace-controller.ts` | **G1** | Stages, jobs, cancel, refine/draft/full async |
| `ninerouter-backend.ts` | **G2** | Facade + admit/write/wiring |
| `index.ts` (desktop main) | **G3** | Electron composition root |
| `orchestrator.ts` | **G4** | Pipeline sequence/locks |
| `render-grid.ts` | **G4** | Render oracles |

Sensitive-file rule (durable): extraction needs **behavior boundary + tests**,
not size alone. See `docs/current/maintenance.md`.

---

## Plan G map

### Non-negotiable principles (all G*)

1. Behavior-preserving unless owner approves a product change.
2. Public facades stay stable (`WorkspaceController` methods, `AuthoringBackend`,
   pipeline tools, IPC channels).
3. Extract **pure / policy / callback-driven runners** before moving async maps.
4. One seam (or small stack) per PR; focused tests + `typecheck`.
5. No prompt wording campaigns, no weakening admission/TTS/draft-before-full.
6. No cross-project parallel render code without design gate in durable docs.
7. Update **this note** after each completed G slice (status table below).
8. When a slice is accepted permanently, sync one paragraph into
   `docs/current/architecture.md` or `maintenance.md`, then continue.

### G0 — Baseline (informational, largely done)

Not a coding phase. Captures work **before** Plan G that still matters:

| Area | Status |
| --- | --- |
| Pure AUTHOR short-form path | stable |
| Hygiene / ticket-comment cleanup | done (ongoing kẹp-theo only) |
| Stage transition logs | done |
| Authoring `failureClass` (+ provider throws B+) | done |
| Docs sync with observability | done |
| Temporary optimization plan 2026-07-07 | deleted; residuals in maintenance |

### G1 — Workspace godfile (do all G1 before G2)

**Objective:** Make `WorkspaceController` a thin async orchestrator over pure/
callback modules so new UX stages, refine, and publish features do not grow the
godfile further.

| ID | Slice | Intent | Status |
| --- | --- | --- | --- |
| **G1a** | Stage transition policy | Pure policy on top of fingerprints: document/allowed edges, optional assert; tests for create/cancel/error paths | **pending** — next detailed plan |
| **G1b** | Refine flow extract | Move silent pre-draft refine / vision loop body into `workspace-refine-flow.ts` (callback style like create-flow) | **pending** |
| **G1c** | Publish / full-path helpers | Tighten pure helpers for full render → published stage / metadata (extend view-model or small flow module); controller keeps job/cancel | **pending** |

**G1 done when:**

- [ ] G1a–G1c committed with tests
- [ ] `workspace-controller.ts` no longer owns refine loop implementation detail
- [ ] Stage policy is readable without scrolling the whole controller
- [ ] Durable docs mention refine-flow / stage-policy modules
- [ ] No intentional behavior change to draft-before-full or cancel recovery

**G1 out of scope:** multi-project queue, parallel renders, prompt changes.

**Resume rule:** implement G1 only via a **dedicated G1 plan** (owner will request
after this note exists). Do not start G1 code from this note alone without that plan.

### G2 — Authoring facade

**Objective:** Keep `ninerouter-backend.ts` as wiring + admit/write only; new AI
capabilities = new runners.

| ID | Slice | Intent | Status |
| --- | --- | --- | --- |
| **G2a** | Failure taxonomy completeness | Ensure remaining structured fails use `authoring-failure` where appropriate | largely done (B+); re-audit when starting G2 |
| **G2b** | Visual-QA / draft-error surfaces | Extract if backend methods keep growing | pending |
| **G2c** | No facade thinning for line count | Policy | always |

**G2 done when:** new authoring features can land as runners without editing
unrelated backend methods; facade public surface documented.

### G3 — Desktop main composition root

**Objective:** `index.ts` only constructs, registers, and owns lifecycle order.

| ID | Slice | Intent | Status |
| --- | --- | --- | --- |
| **G3a** | One more IPC group | License **or** gateway handlers factory (pick one) | pending |
| **G3b** | Stop when root is wire-only | Avoid mega-builder | pending |

**Already extracted (do not redo):** settings/TTS, BGM, thumbnail, create IPC,
image staging, runtime-env, native-save, startup-sequence.

### G4 — Pipeline core (feature-driven only)

**Objective:** Only split when a feature forces a clear boundary.

| ID | Slice | Intent | Status |
| --- | --- | --- | --- |
| **G4a** | `orchestrator.ts` | Extract only with written sequencing/lock boundary + tests | not started |
| **G4b** | `render-grid.ts` | Extract oracle groups with fixtures | not started |
| **G4c** | Parallel render / LRU | Design in durable docs first | design exists; **no code** |

---

## Feature expansion cheat sheet (after seams)

| Future feature | Prefer after |
| --- | --- |
| New workspace stage / gate UX | G1a |
| Deeper refine / multi-pass QA product | G1b |
| Publish/export metadata UX | G1c |
| New AI authoring mode | G2 runner |
| New desktop IPC surface | G3a style factory |
| New render oracle | G4b |
| Multi-job render queue | G4c design + owner |

Reserved/deferred product (not Plan G): SFX productize/sunset, YouTube long-form,
speech-sync — own owner gates; use Plan G seams when implementing.

---

## Execution status board

Update this table after every Plan G commit or owner decision.

| Phase | Status | Evidence / notes |
| --- | --- | --- |
| G0 baseline | done | Observability + hygiene + stable short-form |
| Working note (this file) | **done** | 2026-07-09 |
| G1 detailed plan | **next** | Owner: “lập Plan cho G1” after this note |
| G1a | pending | |
| G1b | pending | |
| G1c | pending | |
| G2* | pending | After G1 complete unless owner reprioritizes |
| G3* | pending | |
| G4* | blocked on need | Do not start “for cleanliness” |

---

## Next action for AI sessions

1. Read `AI_CONTRACT.md` then this note.
2. If task is **Plan G progress** and G1 not planned yet: **only** help produce
   the G1 detailed plan (no G1 code until owner approves that plan).
3. If G1 plan exists and is approved: implement **one** G1 slice (a→b→c order
   unless owner says otherwise), verify, commit, **update this board**.
4. Do not start G2–G4 while G1 incomplete without explicit owner override.

### First concrete next step

**Write detailed G1 plan** covering G1a + G1b + G1c: files, APIs, tests,
verification, non-goals. Then implement after owner approval.

---

## Verification baseline (any G* code)

```powershell
npm.cmd run typecheck
npm.cmd test -- --run apps/desktop/src/main/workspace/
# broaden when touching authoring/pipeline
npm.cmd test
npm.cmd run build   # if render/bundle touched
```

Windows: prefer `npm.cmd`.

---

## Rollback posture

- Revert the G slice commit(s) if behavior regresses.
- Do not weaken admission, draft-before-full, or TTS provider rules during rollback.
- Observability (stage logs / failureClass) should survive unrelated G1 extracts;
  do not delete log anchors casually.

---

## Archive criteria

Archive or delete this note when:

1. G1 complete and durable docs list the new workspace modules; and  
2. Owner either completes G2–G3 or explicitly parks Plan G; and  
3. Residual G4 “only when needed” is stated in `maintenance.md`.

Until then, **this file is the Plan G progress source of truth** for agents.
