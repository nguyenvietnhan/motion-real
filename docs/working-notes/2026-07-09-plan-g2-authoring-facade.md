# Plan G2 — Authoring facade seams (detailed)

**Status:** plan ready for owner approval → implement  
**Parent:** `docs/working-notes/2026-07-09-plan-g-godfile-seams.md` (Plan G)  
**Created:** 2026-07-09  
**Depends on:** G1 complete  
**Not durable contract.** Sync accepted module names into `docs/current/*` when G2 completes.

---

## Goal

Keep `ninerouter-backend.ts` as the **stable `AuthoringBackend` facade**: model/
tools wiring, session caches, file write + admission orchestration, and thin
delegates. Move remaining **cohesive bodies** into tested runners/helpers so new
AI modes do not grow the facade.

**Non-goals:** change authoring success rates, admission rules, batch budgets,
prompt wording, or `AuthoringBackend` / `AgentWorker` public method signatures.

---

## Ground truth (facade today)

| Item | Reality |
| --- | --- |
| Size | `ninerouter-backend.ts` ~712 lines |
| Public contract | `AuthoringBackend` in `custom-loop-worker.ts` |
| Already extracted | content-plan-runner, author-reply-runner, author-batch-policy, reauthor-runner, image-filter-runner, article-image-crawler-runner, authoring-failure, prompt-*, content-plan-*, reply-parser, scene-files, normalize-* |

### Still living on the facade (G2 targets)

| Cluster | Members | G2 home |
| --- | --- | --- |
| **Pure manifest / theme** | `toEngineManifest`, `sanitizeTheme`, `countSafetyChecks`, `HEX6` | helper module |
| **Vision chat policy** | `imageUnsupportedModels`, `isImageRejection`, `toTextOnly`, `chatWithVisionFallback` | vision-chat helper (class or module with session Set) |
| **Image data URLs** | `buildAuthorImages`, `readStillDataUrl` | media helper |
| **Render tool adapters** | `renderDraft`, `renderStills`, `renderFull`, `getSafetyReport`, `refreshRegistry` | render-tools runner/adapter |
| **Visual QA + snapshot** | `visualQa`, `parseVisualDefects`, `snapshotScenes`, `restoreScenes` | visual-qa-runner |
| **Orchestration (stays)** | `authorScenes` top-level sequence, ctor deps, `reauthor` thin wrap, crawl/filter thin wrap | facade |

`authorCallErrorMessage` is already exported pure — leave in facade file or move to small `author-call-errors.ts` if G2a needs a home for call messaging.

---

## Principles (G2)

1. Behavior-preserving; keep user-facing Vietnamese strings identical.
2. **Do not** thin the facade only to reduce line count (G2c policy).
3. New AI capability = **new runner**, facade wires deps only.
4. Keep legacy log **message** strings; prefer `failureClass` on structured fails.
5. Mirror existing runner style: options bag + injected `chat` / `logger` / FS.
6. One commit per slice (G2a → G2b → G2c) unless owner prefers stack.
7. Update Plan G board after each slice.
8. Workflow: Check → Do → Check → Confirm → Commit.

---

## G2a — Failure taxonomy re-audit + pure helpers

### Intent

1. Confirm every **authoring structured fail** already uses `logAuthoringFailure`
   (re-audit after B+).
2. Extract **pure, side-effect-free** helpers that bloat the top of the facade
   without changing orchestration.

### Failure re-audit checklist

| Path | Expected `failureClass` / note | Action if missing |
| --- | --- | --- |
| content-plan parse/repair/quality/provider | done | none |
| author-reply parse/provider | done | none |
| author-batch parse/provider | done | none |
| missing-tsx recovery | done | none |
| admission | done | none |
| reauthor parse/provider | done | none |
| image-filter parse/provider | done | none |
| visual-qa parse | done (parse) | provider skip uses warn string — optional `visual-qa-provider` |
| URL ingest unreadable | soft warn, not failureClass | **leave** (not a hard authoring fail) |
| `render_draft/stills/full failed` | render layer | optional later `render-*` classes — **out of G2a hard scope** unless free |

**G2a deliverable for failures:** short audit table in this note’s execution log
after implementation; add only **visual-qa vision call fail** as
`failureClass: "visual-qa-provider"` (warn) if easy and consistent with image-filter.

### Pure helper extract

| Move | To |
| --- | --- |
| `toEngineManifest`, `sanitizeTheme`, `HEX6` | `author-manifest-convert.ts` (or `engine-manifest.ts`) |
| `countSafetyChecks` | same file or `authoring-failure.ts` adjacent |

**Keep on facade:** call sites only.

### Tests G2a

- Unit: `toEngineManifest` keeps allowed image refs, strips invented refs (port
  any existing ninerouter tests that only cover conversion).
- Unit: `countSafetyChecks` aggregation.
- Existing `ninerouter-backend.test.ts` must stay green (behavior lock).

### Verification G2a

```powershell
npm.cmd test -- --run `
  apps/desktop/src/main/authoring/ninerouter-backend.test.ts `
  apps/desktop/src/main/authoring/authoring-failure.test.ts
# + new helper tests
npm.cmd run typecheck
```

### Acceptance G2a

- [ ] Pure convert helpers extracted + tested
- [ ] Failure audit recorded; visual-qa provider class optional but preferred
- [ ] Facade still compiles as sole `AuthoringBackend` impl
- [ ] Plan G board: G2a done

### Commit message (suggested)

```
Extract authoring manifest convert helpers

Move pure toEngineManifest/theme sanitize out of the ninerouter facade;
re-audit failureClass coverage for vision soft-fails.
```

---

## G2b — Visual-QA + snapshot/restore runner

### Intent

Extract the **vision QA product surface** used by workspace refine from the
facade into a focused runner (mirrors image-filter / reauthor).

### Deliverables

| Item | Detail |
| --- | --- |
| New module | `apps/desktop/src/main/authoring/visual-qa-runner.ts` |
| Tests | `visual-qa-runner.test.ts` |
| Move | `parseVisualDefects`, `visualQa` body, optionally `snapshotScenes` / `restoreScenes` |

### Proposed API

```ts
export type VisualQaRunnerDeps = {
  projectId: string;
  sceneIds?: string[];
  signal?: AbortSignal;
  model: string | undefined;
  apiKey: () => string | undefined;
  chat: (model: string, messages: ChatMessage[], signal?: AbortSignal) => Promise<string>;
  loadManifest: (projectId: string) => Promise<Manifest | null>;
  reviewDir: string; // or projectPaths(projectId).reviewDir inside
  readStillDataUrl: (path: string) => string | undefined;
  logger: { warn/error/debug... };
};

export async function runVisualQa(deps: VisualQaRunnerDeps): Promise<VisualDefect[]>;

export function parseVisualDefects(reply: string, knownScenes: Set<string>): VisualDefect[];

// Snapshot/restore can share the same file or scene-snapshot.ts
export async function snapshotAuthoredScenes(...): Promise<SceneSnapshot>;
export async function restoreAuthoredScenes(...): Promise<void>;
```

Facade becomes:

```ts
async visualQa(...) {
  return runVisualQa({ model: this.deps.model(), chat: ..., ... });
}
```

**Chat path:** visual-QA currently uses `client.chat` **without**
`chatWithVisionFallback` (full multimodal). Preserve that exact behavior unless
tests prove otherwise — do **not** silently switch to text-only fallback for QA.

### Tests G2b

| Case | Expect |
| --- | --- |
| no model | `[]` |
| no stills on disk | `[]` |
| valid JSON high severity known scene | one defect |
| hallucinated sceneId / low severity | filtered out |
| chat throw | `[]` + warn (and failureClass if G2a added provider) |
| snapshot missing file | skip that scene |
| restore writes + admit called | path invoked |

Port assertions from any ninerouter tests that cover visual QA if present.

### Verification G2b

```powershell
npm.cmd test -- --run `
  apps/desktop/src/main/authoring/visual-qa-runner.test.ts `
  apps/desktop/src/main/authoring/ninerouter-backend.test.ts `
  apps/desktop/src/main/workspace/workspace-refine-flow.test.ts
npm.cmd run typecheck
```

### Acceptance G2b

- [ ] Visual QA + parse (+ snapshot/restore) live outside facade body
- [ ] Refine flow still works via same `AuthoringBackend` methods
- [ ] Plan G board: G2b done

### Commit message (suggested)

```
Extract visual-QA and scene snapshot runners

Move vision layout QA parse/call and snapshot restore out of the
ninerouter facade; preserve empty-array soft-fail behavior.
```

---

## G2c — Vision chat policy + render tool adapters + facade charter

### Intent

1. Extract **session vision capability** (`chatWithVisionFallback` + model set)
   so reauthor/image-filter/author share one tested unit.
2. Extract **render tool adapters** (draft/stills/full/safety report) into a
   thin adapter module.
3. Document what **must remain** on the facade (G2c policy — not line-count
   thinning).

### G2c-1 Vision chat module

| Item | Detail |
| --- | --- |
| Module | `authoring-vision-chat.ts` or class `VisionChatSession` |
| Owns | `imageUnsupportedModels` Set, `isImageRejection`, `toTextOnly`, `chatWithVisionFallback` |
| State | **Per backend instance** (session cache) — construct in `NineRouterAuthoringBackend` ctor and pass to runners |

```ts
export class VisionChatSession {
  constructor(private readonly client: NineRouterClient, private readonly apiKey: () => string | undefined, private readonly logger: ...) {}
  chatWithVisionFallback(model: string, messages: ChatMessage[], signal?: AbortSignal): Promise<string>;
  isUnsupported(model: string): boolean;
}
```

Wire: `authorScenes` / `reauthor` / `filterCrawledImages` use session methods
instead of private facade methods.

**Tests:** 400 image rejection marks model unsupported; second call goes text-only;
non-image errors still throw when no image parts.

### G2c-2 Render tool adapters

| Item | Detail |
| --- | --- |
| Module | `authoring-render-tools.ts` |
| Functions | `renderDraft`, `renderStills`, `renderFull`, `getSafetyReport` (+ optional `refreshRegistry`) |
| Deps | `tools`, `onRenderProgress`, `loadManifest`/`unregisterComponent` for registry refresh |

Facade methods become one-liners delegating to the module.

**Preserve:** N24/N25 filter in `getSafetyReport`; empty stills on stills failure;
progress callback signature.

**Tests:** safety report strips N24/N25 from hardErrors; draft fail returns error
object; stills fail returns `{ stills: [] }`.

### G2c-3 Facade charter (docs)

Add to this note + sync paragraph to `architecture.md` / `maintenance.md`:

**`NineRouterAuthoringBackend` owns:**

- deps construction fields  
- `authorScenes` orchestration (ingest → plan → author reply → write → admit)  
- wiring runners + vision session + render adapters  
- implementing `AuthoringBackend`

**Does not own (after G2):**

- content-plan / author-reply / reauthor / image-filter / article-crawl bodies  
- visual-QA parse/loop body  
- pure manifest conversion  
- vision session policy internals  
- render tool call details  

**Explicitly do not extract next “for size”:** the full `authorScenes` method
unless a future G2d is planned with a full orchestration test harness — it is
the product spine and already calls runners.

### Verification G2c

```powershell
npm.cmd test -- --run apps/desktop/src/main/authoring/
npm.cmd run typecheck
```

Optional owner smoke: create → draft (vision + stills path).

### Acceptance G2c

- [ ] Vision session + render adapters extracted + tested
- [ ] Facade methods are thin for QA/render/vision
- [ ] Durable docs list new modules
- [ ] Plan G board: G2c done; G2 complete checklist

### Commit message (suggested)

```
Extract authoring vision chat and render tool adapters

Move session vision fallback and draft/stills/full/safety adapters out of
the ninerouter facade; document what the facade must keep owning.
```

---

## Implementation order

```text
G2a  pure helpers + failure re-audit          (XS–S)
G2b  visual-QA + snapshot/restore runner      (S–M)
G2c  vision session + render adapters + docs  (M)
Update Plan G board + architecture/maintenance
```

---

## Files touch map

| Slice | Create | Modify |
| --- | --- | --- |
| G2a | `author-manifest-convert.ts` (+ test) | `ninerouter-backend.ts`, maybe `authoring-failure.ts` |
| G2b | `visual-qa-runner.ts` (+ test); optional snapshot helpers in same file | `ninerouter-backend.ts` |
| G2c | `authoring-vision-chat.ts`, `authoring-render-tools.ts` (+ tests) | `ninerouter-backend.ts`, durable docs, Plan G note |

**Do not touch:** `orchestrator.ts`, `render-grid.ts`, workspace refine (G1 done),
prompt wording modules (except imports).

---

## Global verification (end of G2)

```powershell
npm.cmd run typecheck
npm.cmd test -- --run apps/desktop/src/main/authoring/
npm.cmd test -- --run apps/desktop/src/main/workspace/
npm.cmd test
npm.cmd run build
```

---

## Rollback

| Slice | |
| --- | --- |
| G2a–c | Revert slice commit; `AuthoringBackend` surface unchanged so workspace/refine keep working |

Never weaken admission, draft-before-full, or TTS rules while fixing extract bugs.

---

## Effort (rough)

| Slice | Effort |
| --- | --- |
| G2a | XS–S |
| G2b | S–M |
| G2c | M |
| **G2 total** | ~1–2 days |

---

## Done when (G2 complete)

- [ ] G2a–G2c merged  
- [ ] New AI features can land as runners without editing unrelated facade code  
- [ ] Facade charter in durable docs  
- [ ] Plan G board G2 rows done  
- [ ] This note marked implemented  

---

## Owner decision before code

Approve this G2 plan (especially: keep `authorScenes` orchestration on facade;
visual-QA chat without vision-fallback change; N24/N25 filter stays).

After approval, implement **G2a first**.
