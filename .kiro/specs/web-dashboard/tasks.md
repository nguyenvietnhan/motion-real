# Implementation Plan: web-dashboard

## Overview

This plan turns the `web-dashboard` design into incremental TypeScript coding
steps that add ONE new workspace package — `apps/desktop` (Electron main +
preload + React renderer) — plus exactly one engine-facing capability: the
`get_safety_report` MCP tool in `@news/mcp`. The dashboard is a thin surface: it
drives the SAME single-process orchestrator (`scaffoldVideoProject` /
`renderProject`) and the SAME `@news/mcp` tools through one `@news/compositions`
registry instance. No second registry, no reimplemented grid, no new render
path (Req 12; AGENTS.md "the reliable path").

Order of work is risk-first and dependency-layered:

1. **Scaffold + Electron shell + typed IPC skeleton** so every later surface has
   a home and a tested process boundary.
2. **The engine change (`get_safety_report`) + the POC_Spike** — the single
   largest build risk (Req 7). The spike decides the `AgentWorker` path (Y
   headless-runtime vs X custom-loop) BEFORE the rest of the authoring plane is
   committed. The `AgentWorker` interface is defined here so the decision is
   swappable.
3. **Pure control-plane logic** (license gate, gateway/AI gate, create
   validation, edit routing, repair-loop budget, friendly-status map, disclosure
   map, message redaction) — all testable without renders, so it lands early and
   carries the 12 property tests.
4. **Lifecycle + UI wiring** (license/gateway managers, controllers, React views)
   that compose the pure logic over typed IPC.
5. **Preserved-invariants verification + final checkpoint.**

Tasks that touch creation/draft/full go through `@news/mcp` tools / the
single-process orchestrator; UI and orchestration logic is tested by stubbing the
orchestrator/agent behind their interfaces (the `AgentWorker` interface and the
`createTools` dependency-injection the existing `tools.test.ts` uses), so no real
network or render runs in tests.

Language: TypeScript (existing monorepo). Tests run under Vitest with
`fast-check` for property tests — minimum 100 iterations each, tagged
`Feature: web-dashboard, Property {n}: {property text}`.

> **POC dependency note:** the concrete `AgentWorker` implementation (tasks 5.x)
> is **blocked on the POC_Spike outcome** (task 2.4): path Y (headless-runtime
> adapter) is built if the spike clears ≥8/10, otherwise path X (custom-loop +
> Preprompt adapter). Every other task depends only on the `AgentWorker`
> *interface* (task 2.6), not the chosen implementation, so the rest of the plan
> proceeds in parallel.

## Tasks

- [x] 1. Project scaffold, Electron shell, and typed IPC skeleton
  - [x] 1.1 Scaffold the `apps/desktop` package and Electron process model
    - Create `apps/desktop` as a workspace package depending on `@news/pipeline`
      and `@news/mcp`; add Electron + React + Vite (or equivalent) build wiring
      and a `vitest` config that reuses the repo's existing Vitest setup
    - Create `main/` (Node engine host), `preload/`, and `renderer/` (React)
      entry points with `contextIsolation: true`, `nodeIntegration: false`
    - Import the orchestrator/tools from source so registration resolves to the
      ONE `@news/compositions` instance (no second registry)
    - _Requirements: 12.10_

  - [x] 1.2 Define the typed IPC contract (`DashboardApi`) and preload bridge
    - Create `shared/ipc-contract.ts` with the `DashboardApi` interface
      (license, ai, projects, script, review, settings, events channels) and the
      channel name constants
    - Implement the preload bridge exposing an allow-listed `window.dashboard`
      typed client (invoke channels + `on` event subscriptions), and nothing else
    - Implement the main-process IPC router skeleton that registers each channel
      and dispatches to (initially stubbed) handlers
    - _Requirements: 11.5, 11.6_

  - [x]* 1.3 Write unit tests for the IPC bridge allow-list and event wiring
    - Assert only allow-listed channels are exposed; assert
      `onProgress`/`onScene`/`onStatus`/`onFriendlyError` subscribe and
      unsubscribe cleanly with a fake `ipcRenderer`
    - _Requirements: 11.5_

- [x] 2. Engine `get_safety_report` tool, AgentWorker interface, and the POC_Spike (FIRST BUILD RISK)
  - [x] 2.1 Add the `get_safety_report` MCP tool to `@news/mcp`
    - Add `getSafetyReportInput` Zod schema and the `get_safety_report` tool in
      `packages/mcp/src/tools.ts`, reading the orchestrator's last report for a
      project (from the render result / `review.json`) and returning
      `{ ok, hardErrors, warnings }` using `SafetyReport`/`SafetyIssue` from
      `@news/pipeline`
    - Do NOT change the grid; expose the report the orchestrator already
      produces. `check` ids stay for the Agent_Worker/logs, never the UI
    - Register the tool through the same `createTools` injection used by the
      existing tools so it is stubbable in tests
    - _Requirements: 6.1, 6.2, 12.1, 12.2_

  - [x]* 2.2 Write unit/integration test for `get_safety_report`
    - With a stubbed orchestrator report (via `createTools` deps), assert it
      returns the hard-error subset and warnings for a given `projectId` and
      surfaces `check` ids only in the tool result (not redacted yet)
    - _Requirements: 6.1, 6.2_

  - [x] 2.3 Build the headless POC_Spike harness (path Y evaluation)
    - Create `apps/desktop/spike/` with a headless harness that runs the path-Y
      agent-runtime (auto-loading `SKILL.md` + `AGENTS.md`, calling the MCP
      tools, using the Model_Gateway as model source) 10 consecutive times with
      no human input
    - Per run record: whether `SKILL.md`/`AGENTS.md` loaded, whether MCP tools
      were invoked, and whether the produced video cleared all hard grid checks +
      the review gate; a load/tool-invocation failure is recorded as a failed
      attempt with its captured cause
    - _Requirements: 7.1, 7.2, 7.6_

  - [x] 2.4 Implement the adoption-decision rule and record the outcome
    - Implement a pure `decideAgentPath(runs)` that returns `"Y"` when ≥8 of 10
      runs passed, else `"X"`; persist the spike result + decision as a committed
      artifact the implementation tasks read
    - _Requirements: 7.3, 7.4_

  - [x]* 2.5 Write unit test for the adoption-decision rule
    - Assert the ≥8/10 boundary exactly (7/10 ⇒ X, 8/10 ⇒ Y, 10/10 ⇒ Y) over
      representative run vectors
    - _Requirements: 7.3, 7.4_

  - [x] 2.6 Define the `AgentWorker` interface and shared authoring types
    - Create `apps/desktop/main/agent/agent-worker.ts` with the `AgentWorker`
      interface (`author`, `reauthorScenes`, `generateValidateRepair`),
      `AuthorJob`, `ReauthorJob`, `RepairLoopOptions`, `RepairOutcome`,
      `AgentHooks`, `FriendlyFix`, and `PrepromptPayload`
    - Both implementations MUST drive the same MCP tools / orchestrator; the
      interface keeps the rest of the design independent of the spike outcome
    - _Requirements: 7.5_

- [x] 3. Checkpoint - engine tool + spike resolved
  - Ensure all tests pass and the existing engine suite stays green; confirm the
    POC_Spike decision (Y vs X) before committing the authoring-plane impl.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Pure control-plane logic (no AI, no render — fully testable)
  - [x] 4.1 Implement the License manager and `canCreate` gate
    - Create `apps/desktop/main/license/license-manager.ts` with `LicenseState`,
      `LicenseService`, `ActivationOutcome`, `LicenseManager` (`current`,
      `activate` with 30s timeout + retry-same-key, `verifyAtLaunch` with
      node-locked skip, `canCreate`); the renderer sees state only, never the key
    - _Requirements: 1.3, 1.5, 1.6, 1.7, 1.8, 1.9_

  - [x]* 4.2 Write property test for the creation license gate
    - **Property 2: License gates new creation iff active**
    - **Validates: Requirements 1.7, 1.9**

  - [x] 4.3 Implement the Create-input validator (`CreateController.validate`)
    - Create `apps/desktop/main/create/create-controller.ts` with a pure, total
      `validate` over arbitrary strings: empty/whitespace ⇒ `empty`; topic > 500
      or URL > 2048 ⇒ `too-long`; URL-shaped-but-malformed ⇒ `malformed-url`;
      else classify URL vs topic; never start creation for `ok:false`, retain text
    - _Requirements: 3.1, 3.7, 3.8_

  - [x]* 4.4 Write property test for create-input validation
    - **Property 1: Create input validation is total and correct**
    - **Validates: Requirements 3.1, 3.7, 3.8**

  - [x] 4.5 Implement the AI-ready gate (`aiReady`)
    - Add the pure `aiReady(gw, acc)` to the Model_Gateway manager module:
      true iff gateway `ready` and account `connected`; used to gate the Create
      action and block silent draft start when false
    - _Requirements: 2.4, 2.9_

  - [x]* 4.6 Write property test for the AI-generation gate
    - **Property 3: AI generation is gated by gateway-ready and account-connected**
    - **Validates: Requirements 2.4, 2.9**

  - [x] 4.7 Implement script-edit application with empty-narration guard
    - Create the script-gate apply logic: apply confirmed `ScriptEdit[]` to the
      manifest; reject any edit leaving zero non-whitespace narration (retain
      prior text, identify the scene); on write failure leave the pre-edit
      manifest unchanged (`ApplyResult`)
    - _Requirements: 4.3, 4.4, 4.5_

  - [x]* 4.8 Write property test for script-edit narration safety
    - **Property 4: Script edits never write an empty narration**
    - **Validates: Requirements 4.3, 4.4, 4.5**

  - [x] 4.9 Implement the EditRouter (plain-text vs visual classification)
    - Create `apps/desktop/main/review/edit-router.ts` with `EditClass`,
      `ParsedSceneEdit`, `EditRouter.classify` (pure, total) and `route` that
      splits a batch into plain-text edits (apply to manifest, no AI) and the
      visual set (`sceneIds` + `PrepromptPayload`); plain-text routes through the
      engine's content normalization before manifest write
    - _Requirements: 8.6, 8.7, 8.8, 8.14_

  - [x]* 4.10 Write property test for edit routing
    - **Property 7: Edit routing — plain-text never invokes AI, visual touches only affected scenes**
    - **Validates: Requirements 8.6, 8.7, 8.8, 8.14**

  - [x] 4.11 Implement batch submission validation (empty + last-scene guards)
    - Add `BatchSubmitController.validateBatch`: reject a batch with no per-scene
      text and no global notes (`no-changes`); reject removal of the only
      remaining scene (`last-scene`); leave the current Draft unchanged in both
    - _Requirements: 8.11, 8.13_

  - [x]* 4.12 Write property test for empty and last-scene rejection
    - **Property 8: Empty and last-scene submissions are rejected without changing the draft**
    - **Validates: Requirements 8.11, 8.13**

  - [x] 4.13 Implement the friendly-status mapping (`toFriendlyStatus`)
    - Create `apps/desktop/renderer/gallery/friendly-status.ts` with
      `FriendlyStatus`, `FRIENDLY_LABELS`, and a TOTAL `toFriendlyStatus` mapping
      every `ProjectState` plus any unknown string to `building` by default;
      never returns an internal state name
    - _Requirements: 10.2, 10.3, 10.4_

  - [x]* 4.14 Write property test for the friendly-status mapping
    - **Property 10: Friendly-status mapping is total and leaks no internal state name**
    - **Validates: Requirements 10.2, 10.3, 10.4**

  - [x] 4.15 Implement the disclosure-level map (`disclosureOf`)
    - Create `apps/desktop/renderer/settings/disclosure.ts` with
      `DisclosureLevel`, `ControlId`, and a pure total `disclosureOf` placing
      every control; L0 ids map to `L0` and are never rendered
    - _Requirements: 11.1, 11.2, 11.4, 11.5_

  - [x]* 4.16 Write property test for disclosure placement
    - **Property 12: Disclosure placement is total and hides all L0 internals**
    - **Validates: Requirements 11.1, 11.2, 11.4, 11.5**

  - [x] 4.17 Implement the main-process redaction boundary (FriendlyError/FriendlyFix)
    - Create `apps/desktop/main/redact/friendly.ts` translating
      `SerializedPipelineError` / `SafetyIssue` into `FriendlyError` /
      `FriendlyFix` with a non-empty plain-language message and stripping every
      L0 token (N1–N30 codes, manifest JSON, `.tsx`, MCP, stack traces)
    - This is the ONLY error/fix shape allowed to cross IPC
    - _Requirements: 6.8, 11.5, 11.6, 12.2_

  - [x]* 4.18 Write property test for engine-internal redaction
    - **Property 6: No engine internals leak into user-facing messages**
    - **Validates: Requirements 6.8, 11.5, 11.6, 12.2**

- [x] 5. Agent_Worker implementation and the generate-validate-repair loop
  - [x] 5.1 Implement the chosen `AgentWorker` adapter (BLOCKED ON POC — task 2.4)
    - If the spike adopted path Y: implement the headless-runtime adapter
      (wrap the embedded runtime, point it at the Model_Gateway, auto-load
      `SKILL.md`/`AGENTS.md`, translate runtime tool calls/results into
      `AgentHooks`). If path X: implement the custom-loop adapter (assemble the
      `Preprompt`, call the gateway via the OpenAI-compatible client at
      `http://localhost:20128/v1`, orchestrate MCP tool calls)
    - Implement `author` (ingest → author → script gate → draft) and
      `reauthorScenes` (re-author ONLY named scenes from batched visual edits)
      driving the SAME MCP tools
    - _Requirements: 7.5, 5.1, 8.7_

  - [x] 5.2 Implement `generateValidateRepair` with budget enforcement
    - Implement the loop: `render_draft` → `get_safety_report` → if hard errors
      and attempts remain, re-author flagged scenes and re-render; clamp
      `maxAttempts` to [1,10] (default 3); count a failed render toward the
      budget; stop on first zero-hard-error report and present; on exhaustion
      return `{ kind:"exhausted" }` driving a friendly "could not complete" +
      retry-from-new-draft; emit auto-fixes via `onRepair` as plain language
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [x]* 5.3 Write property test for the repair-loop budget
    - **Property 5: The generate-validate-repair loop respects its budget**
    - **Validates: Requirements 6.3, 6.4, 6.6, 6.7**

  - [x]* 5.4 Write integration test for the evidence-gate-on-edit path
    - With a stubbed Agent_Worker/N9 result, assert a visual edit requesting an
      unsupported figure leaves the scene's figure unchanged and returns an
      `EvidenceWarning` naming the figure
    - _Requirements: 8.9_

- [x] 6. License + Model_Gateway lifecycle managers (main process)
  - [x] 6.1 Implement the License_Service client and activation/verify lifecycle
    - Implement the network-facing `LicenseService.activate`/`verify` (30s
      timeout via `AbortSignal`) wired into `LicenseManager`; map
      timeout/offline/invalid/limit/revoked to `LicenseState` error reasons;
      node-locked launch skips re-entry; expose state over IPC, never the key
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8_

  - [x]* 6.2 Write unit tests for the activation outcome → state table
    - Cover each branch (valid, invalid, limit, revoked, timeout, offline) and
      the node-locked launch skip, with a stubbed `LicenseService`
    - _Requirements: 1.3, 1.5, 1.6, 1.8_

  - [x] 6.3 Implement the bundled Model_Gateway manager (9Router lifecycle)
    - Create `apps/desktop/main/gateway/model-gateway-manager.ts`: start the
      9Router child on localhost with no window/console, retry up to 3 attempts
      then surface `unavailable`; `ensureLocalKey` generates + auto-wires the
      `Local_Gateway_Key` internally (never returned over IPC, never the term
      "API key" in UI)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 6.4 Implement AI-account OAuth connect (Kiro default + Codex/Gemini)
    - Implement `connectAccount(provider?)` (default kiro, 120s timeout) and
      `account()`; success records the account and enables AI features; failure/
      cancel/timeout retains any previously connected account; keep Vivibe as the
      default voice (gateway TTS unused)
    - _Requirements: 2.5, 2.6, 2.7, 2.8, 2.10_

  - [x]* 6.5 Write integration tests for gateway start retry and OAuth lifecycle
    - With stubbed child-process + OAuth, assert the 3-attempt start retry →
      `unavailable`, and the connect success/cancel/timeout branches retain prior
      account state (1–3 representative cases each)
    - _Requirements: 2.2, 2.8_

- [x] 7. Create / ingest controller and project scaffolding wiring
  - [x] 7.1 Implement `CreateController.start` over the orchestrator
    - Wire `start(input)` to scaffold the project via `scaffold_project` through
      the one registry, applying selected or default style pack + accent color;
      hand off to the Agent_Worker `author` job with the configured script gate
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x]* 7.2 Write integration test for create→scaffold single-registry wiring
    - With a stubbed orchestrator/tools (via `createTools`), assert create routes
      through `scaffold_project` with no second registry, and ingest/search
      failures return friendly messages that leave authoring unstarted
    - _Requirements: 3.6, 3.9, 3.10, 12.10_

- [x] 8. Script-approval gate wiring
  - [x] 8.1 Implement the Script_Approval_Gate model and sequencing
    - Implement `ScriptGateModel`, default-ON state (Req 4.1), gate sequencing so
      the first Draft does not begin until the user approves or disables the gate,
      and the approve-before-initialized wait; on approve proceed to first draft,
      on disable skip the text gate; reuse the empty-narration apply logic (4.6)
    - _Requirements: 4.1, 4.2, 4.6, 4.7, 4.8_

  - [x]* 8.2 Write unit tests for gate default and sequencing
    - Assert default ON, approve-before-initialized waits for config, and
      disable-skips-gate paths with a stubbed Agent_Worker
    - _Requirements: 4.1, 4.2, 4.6, 4.7, 4.8_

- [x] 9. Storyboard review, batch submit, and approve/full render wiring
  - [x] 9.1 Implement the Storyboard model and batch-submit controller
    - Implement `SceneCard`/`StoryboardModel` reading existing review keyframes
      (`review/<sceneId>.png`), the per-scene (≤2000) and global notes (≤4000)
      boxes, `SceneAction`s, and `BatchSubmitController.submit` that batches,
      routes via the EditRouter, and re-renders only changed scenes (cache keeps
      the rest byte-identical); preserve edits + prior still on per-scene
      re-render failure
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.8, 8.10, 8.12_

  - [x] 9.2 Implement approve → full render with the draft-first gate
    - Implement `approveDraft` enabling Approve iff a reviewed Draft exists and
      driving `render_full` (begins within 2s); a full render with no reviewed
      draft and no force-full is refused (`RefusedResult`) leaving project
      unchanged; full progress updates ≥ every 5s; on full-render failure stop
      progress, retain the draft, offer retry
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 12.5_

  - [x] 9.3 Implement the gallery controller (`toCards` + load state)
    - Implement `GalleryController.toCards` building `ProjectCardVM[]` from
      `ProjectSummary[]` newest-first with title, thumbnail-or-placeholder,
      friendly status, and `ngày D tháng M năm YYYY` date; `loadState` returns
      empty-state only after load; Advanced/Batch view surfaces the `tracker_*`
      tools
    - _Requirements: 10.1, 10.6, 10.7, 10.8, 10.9_

  - [x]* 9.4 Write property test for the draft-first approve/full gate
    - **Property 9: Approve and full render are gated by a reviewed draft (draft-first)**
    - **Validates: Requirements 5.6, 9.1, 9.2, 9.4, 12.5**

  - [x]* 9.5 Write property test for gallery card completeness and ordering
    - **Property 11: Gallery cards are complete and ordered newest-first**
    - **Validates: Requirements 10.1, 10.6**

  - [x]* 9.6 Write integration test for progress forwarding and badge updates
    - With a fake clock and stubbed orchestrator `onProgress`, assert ratio →
      percentage forwarding, draft cadence ≥ every 2s / full ≥ every 5s, scenes
      appear within 2s of production, and status badges update within 5s on
      state change
    - _Requirements: 5.2, 5.3, 10.5_

- [x] 10. Settings, progressive disclosure, and defaults
  - [x] 10.1 Implement the SettingsModel with pre-populated L3 defaults
    - Implement `SettingsModel` (`voiceProvider:"vivibe"` default, default
      output dir under `.video-tool` home, `maxRepairAttempts` default 3 clamped
      [1,10], `scriptGateEnabled` default true) so the full flow runs without
      opening Settings; leaving Settings preserves in-progress project state;
      L3 controls live on a separate Settings screen
    - _Requirements: 11.3, 11.4, 11.7, 11.8_

  - [x]* 10.2 Write unit tests for settings defaults and state preservation
    - Assert every L3 setting is pre-populated and that a settings round-trip
      preserves in-progress project state
    - _Requirements: 11.7, 11.8_

- [ ] 11. React UI views wiring each surface over typed IPC
  - [ ] 11.1 Implement Onboarding/License and AI-connect views
    - Build the activation screen (in-progress indicator, plain-language
      timeout/offline/invalid messages, retry-same-key) and the single "Connect
      AI account" action with Advanced (Codex/Gemini), driven by `window.dashboard`
    - _Requirements: 1.1, 1.2, 2.4, 2.5, 2.6, 2.7, 2.9_

  - [ ] 11.2 Implement Create, Storyboard, Gallery, and Settings views
    - Wire the topic/URL input + Create action, the per-scene Storyboard with
      stills + edit boxes + L2 collapsed actions, the embedded draft player +
      Approve, the project gallery (cards, empty-state, friendly badges), and the
      Settings screen — each consuming the pure controllers/maps from tasks 4/9/10
      and rendering only translated view-models (no L0 internals)
    - _Requirements: 3.1, 5.4, 8.1, 8.2, 8.3, 8.4, 9.1, 9.6, 10.1, 10.8, 11.1, 11.2, 11.3_

  - [ ] 11.3 Wire streaming events into the renderer state
    - Subscribe `onProgress`/`onScene`/`onStatus`/`onFriendlyError` to update the
      `DesktopState` (progress %, growing Storyboard, status badges, friendly
      errors with the correct retry action)
    - _Requirements: 5.2, 5.3, 5.5, 9.5, 9.7, 10.5_

  - [ ]* 11.4 Write unit tests for view-model rendering and friendly errors
    - With stubbed IPC, assert views render only translated view-models, show the
      correct retry per `FriendlyError`, and never surface L0 tokens
    - _Requirements: 11.5, 11.6_

- [ ] 12. Preserved-invariants verification and final checkpoint
  - [ ]* 12.1 Write integration tests asserting preserved engine invariants
    - Through the stubbed orchestrator/tools boundary, assert the dashboard never
      bypasses the grid, draft-first, Vivibe guard, hygiene, or the single
      registry: full render refused without a reviewed draft (Req 12.5), no
      second registry on create→render (Req 12.10), voice-config-incomplete
      surfaces the exact missing setting and never downgrades (Req 12.7, 12.8),
      and artifacts stay under `.video-tool/`/`planning/` (Req 12.9)
    - _Requirements: 12.1, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10_

  - [ ] 12.2 Final checkpoint
    - Ensure all tests pass (`npm run typecheck`, `npm test`, `npm run build`)
      and the EXISTING engine suite stays green; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test/verification sub-tasks and can be
  skipped for a faster MVP; core implementation sub-tasks are never optional.
- **POC dependency:** task 5.1 (the concrete `AgentWorker` adapter) is blocked on
  the POC_Spike adoption decision (task 2.4). All other tasks depend only on the
  `AgentWorker` interface (task 2.6), so they proceed independently of the
  Y-vs-X choice.
- The single engine change is the additive `get_safety_report` MCP tool (task
  2.1); everything else reuses `@news/mcp` tools and the single-process
  orchestrator through one `@news/compositions` registry instance.
- Property-based tests (Properties 1–12) validate the pure control-plane logic at
  a minimum of 100 iterations each, using `fast-check` under Vitest, tagged
  `Feature: web-dashboard, Property {n}: …`, with the orchestrator/agent stubbed
  (the `createTools` injection used by `tools.test.ts`) so no live network or real
  render runs.
- The real N1–N30 grid, determinism (N16), the evidence gate (N9), the Vivibe TTS
  guard, render-cache byte-identity, workspace hygiene, and the single registry
  are covered by the existing engine suite and must stay green (Req 12); they are
  not re-derived as dashboard properties.
- All payloads crossing IPC are already-translated view-models; the main process
  is the redaction boundary (task 4.17).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.3"] },
    { "id": 2, "tasks": ["1.3", "2.4", "2.6"] },
    { "id": 3, "tasks": ["2.5", "4.1", "4.3", "4.5", "4.7", "4.9", "4.11", "4.13", "4.15", "4.17"] },
    { "id": 4, "tasks": ["4.2", "4.4", "4.6", "4.8", "4.10", "4.12", "4.14", "4.16", "4.18", "5.1"] },
    { "id": 5, "tasks": ["5.2", "6.1", "6.3", "7.1", "8.1", "9.1", "9.3", "10.1"] },
    { "id": 6, "tasks": ["5.3", "5.4", "6.2", "6.4", "6.5", "7.2", "8.2", "9.2"] },
    { "id": 7, "tasks": ["9.4", "9.5", "9.6", "10.2", "11.1", "11.2", "11.3"] },
    { "id": 8, "tasks": ["11.4", "12.1"] }
  ]
}
```
