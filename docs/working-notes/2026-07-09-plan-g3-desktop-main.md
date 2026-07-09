# Plan G3 — Desktop main composition root (detailed)

**Status:** plan ready for owner approval → implement  
**Parent:** `docs/working-notes/2026-07-09-plan-g-godfile-seams.md` (Plan G)  
**Created:** 2026-07-09  
**Depends on:** G1 + G2 complete  
**Not durable contract.** Sync accepted module names into `docs/current/*` when G3 completes.

---

## Goal

Keep `apps/desktop/src/main/index.ts` as the **Electron composition root**: construct
settings/tools/gateway/authoring/workspace/create, register IPC, and own app
lifecycle order. Extract **one more focused IPC handler group** so new AI-gateway
channels do not grow the root, then **stop** — no mega-builder, no line-count
thinning of workspace/create wiring.

**Non-goals:** change IPC channel names, license/dev activation semantics, gateway
behavior, create/workspace product flow, security boot order, or Electron lifecycle.

---

## Ground truth (`index.ts` today)

| Item | Reality |
| --- | --- |
| Size | ~540 lines / ~504 non-empty |
| Role | Composition root (already thinned once) |
| Pattern to mirror | `createSettingsHandlers` / `createBgmHandlers` / `createThumbnailHandlers` |

### Already extracted (do **not** redo)

| Seam | Module |
| --- | --- |
| Settings / TTS IPC | `settings/settings-handlers.ts` |
| BGM IPC + VM | `bgm/bgm-handlers.ts` |
| Thumbnail IPC | `thumbnail/thumbnail-handlers.ts` |
| Create payload coerce | `create/create-ipc.ts` |
| Image staging | `create/image-staging.ts` |
| Native save | `export/native-save.ts` |
| Startup order | `startup-sequence.ts` |
| Runtime env / scrub | `security/runtime-env.ts`, `runtime-security.ts` |
| Media protocol | `media-protocol.ts` |
| Controllers / gateway mgr | workspace, create, license manager, model-gateway-manager (exist) |

### Still living on the root (G3 targets + keep)

| Cluster | Members | G3 home |
| --- | --- | --- |
| **AI gateway IPC** | `ai:gatewayState`, `listProviders`, `connectedAccounts`, `beginConnect`, `listModels`, `selectModel`, `selectedModel` + in-module `selectedModel` state | **G3a** handler factory |
| **License IPC** | `license:get`, `license:activate` (2 thin lines) | optional micro in G3a **or leave** (Plan G: pick one group) |
| **Projects IPC** | list/create/pick/import/stage/rename/open/delete/reveal/save/cancel/retry/fix/submitImageReview | **keep** thin wrappers on root |
| **Script / review IPC** | script gate + review edit/approve | **keep** thin wrappers on root |
| **Electron dialog adapters** | `pickImages`, `pickBgmAudioFiles`, `showNativeSaveDialog` | **keep** on root (same as BGM/native-save charter) |
| **Construction** | SettingsStore, tools, nrClient, gateway, authoringBackend, worker, workspace, create | **keep** on root |
| **Lifecycle** | `registerMediaScheme`, `whenReady`, privilege gate, cache prune, `createWindow`, activate/quit | **keep** on root |
| **startGateway** | background `gateway.start()` | stay near gateway construction (root or G3a factory export) |

---

## Principles (G3)

1. Behavior-preserving; keep user-facing Vietnamese strings identical.
2. **Do not** invent a single `createAllHandlers(...)` mega-builder.
3. New IPC group = **new factory** next to its domain folder (mirror settings/BGM).
4. Electron dialog / `BrowserWindow` / `app` stay at the root unless a factory already
   takes them as injected deps (pattern: `pickAudioFiles` on BGM).
5. One commit per slice unless owner prefers a stack.
6. Update Plan G board after each slice.
7. Workflow: Check → Do → Check → Confirm → Commit.
8. **G3 ends when root is wire-only for remaining groups** — not when line count
   is minimal. Further projects/script extraction needs a *new* feature reason.

---

## Decision: which IPC group for G3a?

Plan G map allows **license OR gateway**. Recommendation:

| Option | Channels | Value | Choice |
| --- | --- | --- | --- |
| **Gateway (AI)** | 7 channels + `selectedModel` state | High — product surface for connect/list/select; grows with AI UX | **Recommended** |
| License | 2 channels | Low — already one-liners over `LicenseManager` | Skip unless free |

**G3a ships gateway handlers.** License stays inline (or a 10-line factory in the
same PR only if it costs nothing — not required for G3 acceptance).

---

## G3a — Gateway AI IPC handler factory

### Intent

Move the `ai:*` invoke map and the mutable `selectedModel` cache into a tested
factory so future gateway channels (re-auth, multi-account polish, etc.) land next
to gateway code, not in `index.ts`.

### Deliverables

| Item | Detail |
| --- | --- |
| Module | `apps/desktop/src/main/gateway/gateway-handlers.ts` (preferred) |
| Tests | `gateway-handlers.test.ts` |
| Move | All `ai:*` handlers from `handlers` object; `selectedModel` lives in factory closure |
| Root keeps | Construct `ModelGatewayManager` + `NineRouterClient`; pass into factory; call `startGateway` in startup sequence |

### Proposed API

```ts
export type GatewayHandlers = Required<Pick<
  InvokeHandlers,
  | "ai:gatewayState"
  | "ai:listProviders"
  | "ai:connectedAccounts"
  | "ai:beginConnect"
  | "ai:listModels"
  | "ai:selectModel"
  | "ai:selectedModel"
>>;

export type GatewayHandlerDeps = {
  ensureReady: () => Promise<unknown> | unknown;
  listProviders: () => Promise<unknown> | unknown;
  refreshConnections: () => Promise<unknown> | unknown;
  beginConnect: (providerId: string) => Promise<unknown> | unknown;
  listModels: () => Promise<unknown> | unknown;
  selectModel: (model: ModelInfo) => Promise<unknown> | unknown;
  getSelectedFromGateway: () => ModelInfo | undefined; // or gateway.selectedModel()
};

/**
 * Owns desktop-side selectedModel mirror used by authoring `model: () => selectedModel?.id`.
 * Returns handlers + a read accessor for the composition root wiring.
 */
export function createGatewayHandlers(deps: GatewayHandlerDeps): {
  handlers: GatewayHandlers;
  /** Live selected model id for authoring backend. */
  getSelectedModelId: () => string | undefined;
  /** Optional: set initial selection if gateway already has one. */
};
```

**Wire sketch in `index.ts`:**

```ts
const gateway = new ModelGatewayManager(...);
const { handlers: gatewayHandlers, getSelectedModelId } = createGatewayHandlers({
  ensureReady: () => gateway.ensureReady(),
  // ...
  selectModel: (model) => gateway.selectModel(model),
  getSelectedFromGateway: () => gateway.selectedModel(),
});

const authoringBackend = new NineRouterAuthoringBackend({
  model: () => getSelectedModelId(),
  // ...
});

const handlers: InvokeHandlers = {
  "license:get": () => licenseManager.current(),
  "license:activate": (key) => licenseManager.activate(String(key)),
  ...gatewayHandlers,
  // projects / script / review / bgm / thumbnail / settings
};
```

**Preserve exactly:**

- `ai:selectModel` sets local selected model `{ id, label }` then calls `gateway.selectModel`.
- `ai:selectedModel` returns gateway's selected model (current code: `gateway.selectedModel()`).
- Authoring `model: () => selectedModel?.id` continues to track **desktop** selection
  (today the in-root `selectedModel` variable — move that state into the factory).
- Channel names and argument coercion (`String(modelId)`, `String(providerId)`).

**Do not move:** `startGateway` body must remain root-owned lifecycle **or** stay as a
one-liner next to construction; do not hide `app.whenReady` inside the factory.

### Tests G3a

| Case | Expect |
| --- | --- |
| selectModel | stores id; calls deps.selectModel with `{ id, label }` |
| getSelectedModelId | returns id after select; undefined before |
| beginConnect | string-coerces providerId |
| listModels / listProviders | forward to deps |
| selectedModel channel | returns deps gateway selected (match current) |

### Verification G3a

```powershell
npm.cmd test -- --run `
  apps/desktop/src/main/gateway/gateway-handlers.test.ts `
  apps/desktop/src/main/gateway/ `
  apps/desktop/src/main/startup-sequence.test.ts
npm.cmd run typecheck
```

### Acceptance G3a

- [ ] `ai:*` handlers live in `gateway-handlers.ts` (+ tests)
- [ ] Root spreads `...gatewayHandlers`; no duplicate selectedModel on root
- [ ] Authoring still resolves model id via factory accessor
- [ ] Plan G board: G3a done

### Commit message (suggested)

```
Extract desktop gateway AI IPC handlers

Move ai:* invoke handlers and selectedModel state into a focused
gateway-handlers factory; keep composition root for construction/lifecycle.
```

---

## G3b — Root charter + stop rule (docs, minimal code)

### Intent

Lock the **composition-root charter** so future agents do not continue extracting
projects/script/review “for cleanliness,” invent a mega-builder, or move Electron
lifecycle out of `index.ts`.

### Deliverables

| Item | Detail |
| --- | --- |
| Durable docs | Paragraph in `architecture.md` Desktop Main Internals + pointer in `maintenance.md` |
| Plan G board | G3 complete; next = G4 only when feature-driven |
| Code | **No required code** in G3b unless a trivial comment inventory update in `index.ts` |

### Charter: `index.ts` **must own**

- Process boot: media scheme, env read/scrub, privilege gate
- Construction order: settings → tools → gateway → authoring → worker → workspace → create
- Injecting engine seams into WorkspaceController / CreateController (path/media/FS adapters)
- Spreading handler factories into `InvokeHandlers` + `registerIpcRouter`
- Electron lifecycle: `whenReady`, window create, activate, quit
- Native dialog adapters (open/save pickers) as thin functions passed into factories
- Dev license manager construction (service swap stays root-visible)

### Charter: **do not extract next** without a feature gate

- Full `WorkspaceController` deps bag builder
- Projects/script/review IPC map “for line count” (already thin delegates)
- `createWindow` / protocol / prune caches into a second godfile
- Cross-cutting `createDesktopApp()` that hides startup order

### Acceptance G3b

- [ ] Durable docs list gateway-handlers + restate stop rule
- [ ] Plan G board: G3 complete
- [ ] This note marked implemented

### Commit message (suggested)

```
Document desktop main composition-root charter after G3

Record gateway IPC factory boundary and stop rule against further
index.ts thinning without a feature-driven seam.
```

---

## Implementation order

```text
G3a  gateway AI IPC factory + tests     (S)
G3b  durable charter + Plan G board     (XS)
```

---

## Files touch map

| Slice | Create | Modify |
| --- | --- | --- |
| G3a | `gateway/gateway-handlers.ts` (+ test) | `index.ts` |
| G3b | — | `architecture.md`, `maintenance.md`, Plan G notes |

**Do not touch:** `workspace-controller.ts`, authoring runners, `orchestrator.ts`,
`render-grid.ts`, renderer UI, IPC channel list (unless adding channels — out of scope).

---

## Global verification (end of G3)

```powershell
npm.cmd run typecheck
npm.cmd test -- --run apps/desktop/src/main/gateway/
npm.cmd test -- --run apps/desktop/src/main/startup-sequence.test.ts
npm.cmd test -- --run apps/desktop/src/main/settings/
npm.cmd test -- --run apps/desktop/src/main/bgm/
# optional broader desktop main suite if present
npm.cmd test
```

---

## Rollback

| Slice | |
| --- | --- |
| G3a | Revert commit; restore inline `ai:*` handlers + `selectedModel` on root |
| G3b | Revert docs only |

Never weaken license gate, gateway auth, or security scrub during rollback.

---

## Effort (rough)

| Slice | Effort |
| --- | --- |
| G3a | S |
| G3b | XS |
| **G3 total** | ~half day |

---

## Done when (G3 complete)

- [ ] G3a merged with tests  
- [ ] G3b charter in durable docs  
- [ ] New AI gateway IPC can land in `gateway-handlers` without editing unrelated root wiring  
- [ ] Plan G board G3 rows done  
- [ ] Explicit **stop**: no further index.ts extraction without owner + feature reason  

---

## Owner decision before code

Approve this G3 plan (especially: **gateway** not license for G3a; projects/script
stay on root; no mega-builder; G3b is charter/stop not more code).

After approval, implement **G3a first**.
