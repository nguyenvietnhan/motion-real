# Plan G4 — Pipeline core seams (detailed, feature-driven)

**Status:** **PARKED** (owner 2026-07-09) — plan kept for later; **no implementation**  
**Parent:** `docs/working-notes/2026-07-09-plan-g-godfile-seams.md` (Plan G)  
**Created:** 2026-07-09  
**Depends on:** G1–G3 complete (desktop/authoring seams done; not a code prerequisite for pipeline)  
**Not durable contract.** Sync accepted module names into `docs/current/*` only when a G4 slice ships.

**Park reason:** owner does not yet have a concrete pipeline feature that forces
orchestrator / render-grid / parallel-render seams. Reopen only with an explicit
feature unlock (see Feature gates below).

---

## Goal

Split `@motionreal/pipeline` core **only when a product or safety feature forces a
clear behavior boundary** — not to reduce the ~1000-line `orchestrator.ts` /
`render-grid.ts` files for cleanliness.

Public surfaces stay stable:

- `renderProject` / `scaffoldVideoProject` / `renderSampleDraft`
- `runRenderGrid` / `RENDER_ORACLES` / per-check exports used by tests/CLI
- `withProjectRenderLock` semantics
- draft-before-full, admission, TTS provider rules, N* check ids

**Non-goals for G4 by default:** parallel multi-project render UI, true LRU
cache hits, YouTube long-form, SFX productize, speech-sync, prompt wording.

---

## Ground truth (pipeline today)

| File | Size | Owns |
| --- | --- | --- |
| `packages/pipeline/src/orchestrator.ts` | ~1000 lines | `scaffoldVideoProject`, `renderProject` (+ lock wrapper), `renderSampleDraft`, internal stage sequence |
| `packages/pipeline/src/safety/render-grid.ts` | ~1016 lines | Individual N* checks + `RENDER_ORACLES` registry + `runRenderGrid` aggregator |
| `render/project-lock.ts` | focused | `withProjectRenderLock` (keep) |
| `render/composition-prep.ts` | focused | bundle/composition cache (parallelism design gate lives here) |
| `render/renderer.ts` | focused | render primitives (already split from prep) |
| `safety/static-grid.ts`, `build-grid.ts` | focused | tier-1/2 grids (do not fold into render-grid) |

### `renderProject` stage map (do not reorder casually)

```text
withProjectRenderLock(projectId, draft|full)
  └─ renderProjectUnlocked
       (0) admit → manifest→spec → static grid → N10 typecheck → (authored prep)
       (1) TTS
       (2) transition-aware lock
       (3) build gate + per-project Remotion entry + N31 probe family
       (4) determinism (N16)
       (5) render cache → Remotion encode (draft vs full path rules)
       (6) review loop (N24/N25 artifacts)
       (7) render oracles over keyframes (runRenderGrid + layout lanes)
       cleanup / fail paths / cancel boundaries (throwIfCancelled)
```

Cross-cutting helpers already in-file: `timedPipelineStage`, timing events,
`throwIfCancelled`, draft-first gate, cache key choices.

### `render-grid` structure (already registry-driven)

| Phase | Checks (ids) | Auto-run? |
| --- | --- | --- |
| `spec` | N20 pacing, N22 audio-sync, N28 duration, N29 captions | yes |
| `geometry-frame` | N14 in-frame | yes |
| `frame` | N14 content-zone/caption/divider (tiktok), N30 density, N19 dead-air, N18 contrast | yes |
| `transition` | N21 | yes |
| `manual` | safe-area, late-safe-area, N15 overlap, N17 truncation, N23 richness | exported, not auto-run |

`runRenderGrid` iterates `RENDER_ORACLES` by phase — registry order **is** execution
order. Any extract must keep that invariant + public re-exports.

### Parallel / cache (design exists — **no code in G4c**)

Durable docs already define the gate:

- `docs/current/architecture.md` — single-workflow cache assumption
- `docs/current/maintenance.md` — Parallel Render Assumption + Design Gate + age-based prune (not true LRU)

---

## Principles (G4)

1. **Feature gate first.** Each slice needs a written “why now” (product or safety).
2. Behavior-preserving unless owner approves a product change.
3. Public exports and N* check ids stay stable (tests/CLI/desktop depend on them).
4. Prefer **pure stage helpers / oracle modules** with fixtures over moving the
   whole `renderProjectUnlocked` body in one PR.
5. One commit per unlocked slice; tests + typecheck; broaden to pipeline tests when
   touching orchestrator/grid.
6. Update Plan G board after each slice.
7. Workflow: Check → Do → Check → Confirm → Commit.
8. **Default if no feature:** park G4 — do not start G4a/G4b “because large.”

---

## Feature gates (when to unlock)

| Slice | Unlock when… | Do **not** unlock for… |
| --- | --- | --- |
| **G4a** | Need a new pipeline stage, different lock/cancel policy, shared stage timing harness, or a second entry that reuses mid-pipeline steps without copy-paste | “orchestrator is 1000 lines” |
| **G4b** | Need a new oracle family, change auto-run vs manual policy, or shared fixtures for many N* checks | cosmetic file split |
| **G4c** | Owner wants cross-project parallel render **or** true LRU cache hits **and** accepts the design gate checklist | queue UI mockups without cache leases |

Owner may unlock a slice explicitly even without an immediate product ship, but
must still require a written boundary + tests (this note’s deliverables).

---

## G4a — Orchestrator sequencing seams

### Intent

Make the `renderProject` **stage sequence and lock boundary** readable and
reusable without changing draft-first, cancel, or cache semantics.

### Candidate extracts (only when unlocked)

| Module (proposed) | Owns | Leaves in `orchestrator.ts` |
| --- | --- | --- |
| Keep | `renderProject` = ensure + `withProjectRenderLock` + call unlocked | public entry |
| `render-project-instrumentation.ts` (optional XS) | `timedPipelineStage`, timing/stage_start event helpers | call sites |
| `render-project-authoring-prep.ts` | stage (0): admit, manifest→spec, static grid, N10, fail/persist patterns | options wiring |
| `render-project-audio-lock.ts` | stages (1)–(2): TTS + lock | provider opts |
| `render-project-encode.ts` | stages (3)–(5): build gate, entry, determinism, cache, encode | quality/draft rules **must** stay identical |
| `render-project-review-oracles.ts` | stages (6)–(7): review + runRenderGrid wiring | checklist deps |

**Minimum acceptable G4a** if owner only wants one PR: extract **one** coherent
stage cluster (prefer authoring-prep **or** instrumentation) with tests — not all
rows above.

### Non-negotiable behavior

- Draft-first full gate + `forceFull`
- Draft never uses full-quality render cache path
- `signal` checked at stage boundaries → `RenderCancelledError` (not `state: failed`)
- Admission failure persists report path for repair (static/N10 same posture)
- `skipAuthoring` test/back-compat path
- Progress callback + state `currentStep` strings (user-visible / logs)

### Tests G4a

| Case | Expect |
| --- | --- |
| Existing `orchestrator.test.ts` | green without behavior drift |
| Draft-first blocked | same error when no draft |
| Cancel between stages | `RenderCancelledError` if fixture exists; else preserve current coverage |
| New pure helpers | unit tests for any extracted pure decision (paths, quality flags) |

### Verification G4a

```powershell
npm.cmd test -- --run packages/pipeline/src/orchestrator.test.ts
npm.cmd test -- --run packages/pipeline/src/render/
npm.cmd run typecheck
# if encode path touched:
npm.cmd run build
```

### Acceptance G4a

- [ ] Written boundary for the extracted stage(s) in this note’s execution log
- [ ] Public `renderProject` signature unchanged
- [ ] Lock still wraps full unlocked body (or documented equivalent)
- [ ] Plan G board: G4a done

### Commit message (suggested)

```
Extract renderProject <stage-name> helpers from orchestrator

Move <boundary> out of orchestrator with behavior-preserving tests;
keep lock, draft-first, and cancel semantics at the public entry.
```

---

## G4b — Render-grid oracle groups

### Intent

Group oracles by **phase / input shape** so new N* checks land next to peers with
fixtures, without changing `runRenderGrid` emission order or severity policy.

### Candidate layout (only when unlocked)

```text
packages/pipeline/src/safety/
  render-grid.ts              ← RENDER_ORACLES + runRenderGrid + re-exports (facade)
  render-oracles-spec.ts      ← checkPacing, audio-sync, duration, captions
  render-oracles-frame.ts     ← in-frame, content-zone, caption/divider clearance,
                                 density, dead-air, contrast
  render-oracles-transition.ts← checkTransition (+ frameDiffFraction if owned)
  render-oracles-manual.ts    ← overlap, truncation, richness, safe-area helpers
  render-grid-types.ts        ← Frame/Rect/options types if needed to break cycles
```

**Facade rule:** `safety/index.ts` and external imports keep working via
`render-grid.ts` re-exports (same pattern as content-plan facade).

### Fixtures

- Prefer small synthetic `Frame` / locked-spec fixtures in `safety/__fixtures__/`
  or co-located `*.fixtures.ts` for high-churn checks.
- Port assertions from `render-grid.test.ts` into group files without weakening cases.
- Registry order test: `RENDER_ORACLES` ids/phases match expected auto-run sequence.

### Non-negotiable behavior

- Auto-run set unchanged unless owner approves product change
- Format-scoped frame checks (tiktok-only) still skip on other formats
- Missing still → warning, not crash
- Manual oracles remain non-auto-run
- N24/N25 stay review-tier (desktop strips them for draft repair — not grid scope)

### Tests G4b

| Case | Expect |
| --- | --- |
| Existing `render-grid.test.ts` | green (or split but same coverage) |
| Registry order | stable id list for auto-run phases |
| One fixture per moved group | representative hard/soft issue |

### Verification G4b

```powershell
npm.cmd test -- --run packages/pipeline/src/safety/render-grid
npm.cmd test -- --run packages/pipeline/src/safety/
npm.cmd run typecheck
```

### Acceptance G4b

- [ ] Oracle groups extracted with facade re-exports
- [ ] `runRenderGrid` behavior identical (fixture/golden if present)
- [ ] Plan G board: G4b done

### Commit message (suggested)

```
Split render-grid oracles by phase modules

Move spec/frame/transition/manual checks behind the render-grid facade;
keep RENDER_ORACLES order and runRenderGrid aggregation.
```

---

## G4c — Parallel render / true LRU (design-only by default)

### Intent

**No implementation** until owner approves a design that satisfies the durable
checklist. This plan does **not** re-derive that checklist — it points at it.

### Source of truth (already durable)

1. `docs/current/maintenance.md` — Parallel Render Assumption, Design Gate,
   Cache Pruning Policy (age-based, not true LRU)
2. `docs/current/architecture.md` — single-workflow cache assumption + lease requirements

### G4c deliverables **if unlocked**

| Track | Work |
| --- | --- |
| **Design PR (required first)** | Update durable docs with chosen lease model, concurrency limit, UI progress routing, stale-lock, crash cleanup |
| **Code (only after design merge)** | Bundle refcount/lease in `composition-prep`, composition-cache scoping, global concurrency gate, tests per design, **no** UI queue until smoke passes |

### Explicit non-work under G4c “plan only”

- Do not add a desktop multi-job queue
- Do not change prune to true LRU without hit-mtime tests + owner sign-off
- Do not weaken `withProjectRenderLock` for same-project jobs

### Acceptance G4c (design-only path)

- [ ] Owner either parks G4c or merges design update in durable docs
- [ ] Plan G board reflects design-only vs code status
- [ ] **No code** until design acceptance is explicit

---

## Implementation order (when unlocked)

```text
Prefer: unlock one of {G4a, G4b, G4c-design} based on feature need
If multiple: G4b (oracles) is usually safer/smaller than full G4a encode split
G4c code always last and only after design
```

Do **not** require G4a before G4b — they are independent files.

---

## Files touch map (when coding)

| Slice | Create | Modify |
| --- | --- | --- |
| G4a | stage helper module(s) under `pipeline/src/` (+ tests) | `orchestrator.ts`, maybe `index.ts` re-exports |
| G4b | `render-oracles-*.ts` (+ fixtures/tests) | `render-grid.ts`, `safety/index.ts` if needed |
| G4c design | — | `architecture.md`, `maintenance.md` |
| G4c code | lease helpers | `composition-prep.ts`, `project-lock.ts`, cache prune, tests |

**Do not touch for G4:** desktop `index.ts`, authoring facade, workspace (unless a
pipeline API change requires a thin adapter — separate PR).

---

## Global verification (any G4 code slice)

```powershell
npm.cmd run typecheck
npm.cmd test -- --run packages/pipeline/src/orchestrator.test.ts
npm.cmd test -- --run packages/pipeline/src/safety/
npm.cmd test -- --run packages/pipeline/src/render/
npm.cmd test
npm.cmd run build   # required if Remotion/bundle/encode touched
```

---

## Rollback

| Slice | |
| --- | --- |
| G4a–b | Revert slice commit; public APIs unchanged so desktop keeps working |
| G4c code | Revert + restore single-workflow assumption docs if behavior changed |

Never weaken draft-before-full, admission, TTS provider hard-fail, or N* severity
classes while fixing extract bugs.

---

## Effort (rough, if unlocked)

| Slice | Effort |
| --- | --- |
| G4a (one stage cluster) | M |
| G4a (full stage split) | L — avoid unless needed |
| G4b | M |
| G4c design | S–M (docs only) |
| G4c code | L+ |

---

## Done when (per slice / G4 overall)

**G4 is not “all rows green.”** G4 is done for the product when:

- Unlocked slices that shipped are tested and documented; **and**
- Remaining rows stay **blocked on need** without pressure to “finish G4.”

Checklist when a slice ships:

- [ ] Feature gate recorded in Plan G board evidence column  
- [ ] Durable docs mention new modules if permanent  
- [ ] This note execution status updated  

---

## Owner decision

**2026-07-09 — PARKED.** Do not implement G4a/G4b/G4c until owner reopens with a
concrete feature reason. Plan text stays as the resume map.

When reopening:

1. Confirm G4 remains **feature-driven**.  
2. **Pick which gate unlocks** (G4a stage? G4b oracles? G4c design only?).  
3. Reject “split everything in orchestrator for line count.”

After approval of a **specific unlocked slice**, implement that slice only.
