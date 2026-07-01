# Project Audit Notes — 2026-07-01

This note captures the current maintainability assessment before any cleanup or
refactor work. It is intentionally detailed and temporary: use it as a shared
map for deciding what to do slowly, with tests, without breaking the parts that
already make real videos.

## Executive Summary

The project is not broken. It has a working product core: it can author Remotion
scenes, admit them, synthesize voice, lock timing, render drafts/finals, and run
safety checks. The main concern is not functional collapse; it is accumulated
architectural and documentation debt after many AI-assisted pivots.

The safest conclusion is:

- Do not do a big-bang rewrite.
- Preserve the working AUTHOR-mode pipeline.
- First stabilize source-of-truth docs and remove misleading legacy paths.
- Then refactor high-churn modules in small, behavior-preserving slices.
- Keep `typecheck`, test suite, and Remotion bundle green after each slice.

Baseline checks run during this audit:

- `npm.cmd run typecheck` passed.
- `npm.cmd test` passed: 81 test files, 825 tests.
- `npm.cmd run build` passed: Remotion webpack bundle succeeded.

Existing dirty worktree note:

- `packages/mcp/src/bin.ts` was already modified before this audit. Do not touch
  or revert it unless explicitly asked.

## What Is Strong

The codebase has a real working spine:

- Pure AUTHOR mode is a clear product/architecture decision.
- The admission gate protects authored scene imports and banned APIs.
- The N1-N30 safety grid gives the system concrete failure classes.
- Draft-first is enforced in code, not only in docs.
- Single-process orchestration avoids duplicate registry-instance failures.
- Project state is file-based and mostly atomic.
- Render cache keys include authored scene source, avoiding stale visual renders.
- TTS lock, breath gaps, captions, and transition-aware timing are coherent.
- Tests are substantial and passing.
- The desktop app already has many recovery/friendly-error paths.

This is why the application can feel messy internally while still producing
usable videos.

## Main Diagnosis

The project has product proof, but not yet long-term development hygiene.

The system has gone through several pivots:

- old template / block-toolkit thinking;
- deleted `@news/design`;
- deleted authored-facing layout blocks;
- freeform AUTHOR mode;
- hidden stills/vision refine;
- format plumbing for TikTok and YouTube;
- desktop orchestration and self-repair.

The working code adapted, but many comments, docs, shims, scripts, and mental
models did not fully converge. This creates a dangerous situation for future
agents and developers: the code often works, but the project explains itself in
multiple conflicting historical layers.

## Evidence From Repo Shape

Large files / god-file pressure:

- `apps/desktop/src/main/workspace/workspace-controller.ts` — about 1157 lines.
- `packages/pipeline/src/safety/render-grid.ts` — about 967 lines.
- `packages/pipeline/src/orchestrator.ts` — about 864 lines.
- `packages/tts/src/index.ts` — about 809 lines.
- `apps/desktop/src/main/authoring/ninerouter-backend.ts` — about 754 lines.
- `apps/desktop/src/main/index.ts` — about 697 lines.
- `packages/pipeline/src/render/renderer.ts` — about 662 lines.
- `packages/pipeline/src/cli/cli.ts` — about 559 lines.

Approximate code volume:

- Source files: about 161 files, 24.2k lines, excluding tests and generated font
  file.
- Test files: 81 files, about 11.8k lines.

The test coverage is a real asset. The large-file shape is the main
maintainability problem.

## Critical Drift Found

### 1. Reliable Video Template Is Stale

`CLAUDE.md` and `README.md` recommend the scaffolded script path:

```bash
npx tsx scripts/new-video.ts <project-id> "Video title"
```

But the template it writes, `scripts/_video-template.txt`, still imports removed
authored-facing block toolkit symbols:

- `Frame`
- `Story`
- `TitleBlock`
- `Callout`
- `CountUp`
- from `@news/blocks`

This conflicts with the current AUTHOR contract:

- authored scenes must not import `@news/blocks`;
- there is no authored-facing layout-block toolkit;
- scenes should write raw JSX/SVG;
- `SceneImage` via `@news/compositions` is the only sanctioned visual import
  beyond React/Remotion/Zod.

Risk:

- A future agent following the documented "reliable" path can generate code that
  fails admission immediately.
- This is more serious than an old comment because it sits on an active workflow
  path.

Suggested handling:

- Treat this as an early cleanup item.
- Replace the template with raw JSX/SVG scenes that match the current contract,
  or clearly mark the script as obsolete until fixed.
- Add a small test that the generated template does not contain `@news/blocks`,
  `Frame`, `Story`, `TitleBlock`, etc.

### 2. `@news/compositions` Barrel Comment Contradicts Current Contract

`packages/compositions/src/index.ts` says reusable slot-based layout blocks live
in `@news/blocks` and authored scenes compose those.

That is no longer true. Current contract says authored scenes must not import
`@news/blocks` and should write raw JSX/SVG.

Risk:

- Misleads maintainers and agents reading package entry comments.
- Encourages old architecture to creep back in.

Suggested handling:

- Update comments only; no behavior change.
- Lock with a test if there is already an invariant test around the contract.

### 3. Legacy Style/Theme Shims Are Still Mixed Into Current Surface

`packages/theme/src/theme.ts` keeps compatibility-looking exports such as:

- `getStylePack`
- `listStylePackIds`
- `registerStylePack`
- `stylePackId`

Some are probably harmless or needed for older call sites/tests, but they keep
the deleted design-system vocabulary alive.

Risk:

- A future change can accidentally revive style-pack thinking.
- It blurs the difference between "runtime compatibility shim" and "current
  product concept".

Suggested handling:

- Inventory all callers.
- If still needed, move or label them as explicit compatibility shims.
- If not needed, remove in a separate tested cleanup.

### 4. Docs Are Both Contract And History

Several docs are very useful but too mixed:

- `CLAUDE.md` is the live contract but long and dense.
- `docs/specs/freeform-engine/tasks.md` is partly roadmap, partly historical log,
  partly status report.
- `docs/specs/freeform-engine/design.md` contains implemented design, pending
  design, and superseded design.
- `docs/freeform-vision-loop.md` is explicitly historical but still contains
  strong product language.

Risk:

- Agents can obey an old instruction from a historical section.
- Owner and future contributors cannot quickly know what is current.

Suggested handling:

- Create a small "Current Contract Index" doc later.
- Archive or clearly label historical docs.
- Keep `CLAUDE.md` shorter by linking to specialized current docs.

## Architectural Debt

### Desktop Main Process

`apps/desktop/src/main/index.ts` wires too many responsibilities:

- env loading and scrubbing;
- settings store;
- 9router gateway;
- authoring backend;
- workspace controller;
- create controller;
- image staging;
- BGM library;
- thumbnail export;
- IPC handler registration;
- Electron window lifecycle.

Risk:

- Any new UI/product feature tends to add more to this file.
- Harder to test wiring separately from app lifecycle.

Refactor direction:

- Extract small composition modules:
  - voice config / env bootstrap;
  - media/image staging handlers;
  - BGM handlers;
  - thumbnail handlers;
  - IPC handler factory.
- Keep behavior unchanged.
- Do not touch pipeline semantics during this cleanup.

### Workspace Controller

`workspace-controller.ts` is the highest-pressure file. It owns a lot:

- project stages;
- create workflow;
- image review;
- hidden stills and creative bootstrap;
- vision QA loop;
- draft/full render transitions;
- edits and retry/fix flows;
- cancellation and recovery.

Risk:

- This is probably the most important long-term refactor target.
- It also has tests, which is good.
- But changing it casually can break the product experience.

Refactor direction:

- Do not start by rewriting it.
- First draw the state machine/stage graph.
- Extract pure helpers around already-tested seams.
- Consider XState later only after a separate ADR or design note.

### Authoring Backend

`ninerouter-backend.ts` is high churn and model-facing. It handles:

- prompt calls;
- parsing author replies;
- image hints;
- scene file writes;
- admission and retry feedback;
- reauthor/snapshot/restore;
- model error messages.

Risk:

- Bugs here waste tokens and can silently degrade output quality.
- It is also where old prompt/contract assumptions tend to return.

Refactor direction:

- Split into narrow services:
  - author call transport wrapper;
  - reply parse/normalize/write;
  - admission feedback builder;
  - reauthor snapshot/restore;
  - image hint preservation.
- Keep current tests as characterization tests before moving logic.

### Pipeline Orchestrator

`orchestrator.ts` is large but central and currently works.

Risk:

- It is not the best first refactor target.
- Single-process registry behavior is fragile by design and must be preserved.

Refactor direction:

- Treat as off-limits until the docs/contracts are cleaned and safer seams exist.
- If opened later, only extract pure stage helpers with high test coverage.

### Render Grid

`render-grid.ts` is large and oracle-heavy.

Risk:

- It encodes many safety decisions and severity choices.
- Changes can accidentally turn advisory warnings back into product-blocking
  gates.

Refactor direction:

- Do not change semantics first.
- Split by oracle group later:
  - frame bounds / in-frame;
  - contrast and density;
  - pacing/duration/captions;
  - transition/flicker/audio sync;
  - measurement-based overlap/truncation.

## Compatibility And Legacy Inventory Candidates

Items that look like legacy, compatibility, or historical residue:

- `styleId: "clean-luxury-tech"` as legacy discriminator.
- `stylePackId` in schema/theme.
- `LegacyTitleLanguage`.
- `visualQaEnabled` migration in settings.
- `getStylePack/listStylePackIds/registerStylePack` theme shims.
- comments mentioning `Frame`, `Story`, `TitleBlock`, `KeyPoints`, `Panel`.
- comments saying `@news/blocks` is composable by authored scenes.
- references to old `@news/design`.
- `scripts/_video-template.txt` still using old block toolkit.
- docs/specs sections that are status logs rather than current contract.

Not all of these should be deleted. Some are likely needed to open older project
state or keep tests stable. The first step is to classify each item:

- keep as current behavior;
- keep but move/label as compatibility;
- remove now;
- remove later after migration.

## Suggested Cleanup Phases

### Phase 0 — Freeze The Truth

Goal: make it harder for humans/agents to follow stale instructions.

Candidate tasks:

- Fix `scripts/_video-template.txt` or mark it obsolete.
- Update misleading package comments.
- Add a small invariant test around generated video template imports.
- Create a short current-contract index.
- Mark historical docs as historical at the top.

Exit criteria:

- No active workflow doc points to code that violates the current AUTHOR
  contract.
- A new agent can find the current contract in under a minute.

### Phase 1 — Inventory And Quarantine Legacy

Goal: understand what is compatibility and what is dead.

Candidate tasks:

- Grep and list all `stylePack`, `styleId`, `@news/design`, old block symbols.
- For each, decide: current, compatibility, dead, unknown.
- Move temporary findings into separate task notes in this folder.
- Do not delete broad surfaces yet.

Exit criteria:

- Every legacy vocabulary item has an owner/status.
- No accidental deletion of compatibility paths.

### Phase 2 — Thin Desktop Main

Goal: reduce the central wiring file without changing product behavior.

Candidate tasks:

- Extract image staging handlers.
- Extract BGM IPC handlers.
- Extract thumbnail IPC handlers.
- Extract voice/env bootstrap.
- Keep IPC contract unchanged.

Exit criteria:

- `apps/desktop/src/main/index.ts` becomes smaller.
- Existing desktop tests stay green.
- No pipeline behavior changes.

### Phase 3 — Authoring Backend Slices

Goal: reduce high-churn authoring risk.

Candidate tasks:

- Extract reply parse/write flow.
- Extract reauthor snapshot/restore service.
- Extract retry feedback builder.
- Extract image preservation hints.

Exit criteria:

- Existing authoring tests stay green.
- New code has narrower responsibilities.
- No prompt/contract tightening without owner approval.

### Phase 4 — Workspace State Clarity

Goal: make the desktop project lifecycle understandable.

Candidate tasks:

- Draw current stage graph.
- Add tests for any missing transitions.
- Extract pure transition helpers.
- Consider a formal state machine only after a separate decision.

Exit criteria:

- Stage transitions are documented and tested.
- The controller is easier to reason about before any major rewrite.

### Phase 5 — Pipeline/Oracle Cleanup

Goal: split large core files only after outer chaos is reduced.

Candidate tasks:

- Split render-grid by oracle group, semantics unchanged.
- Extract orchestrator stage helpers only if characterization tests are strong.
- Keep single-process registry path intact.

Exit criteria:

- No change in gate severity or render behavior unless explicitly approved.

## Safety Rules For Future Cleanup

- No big-bang rewrite.
- Keep video generation working at every step.
- Prefer comment/doc/template cleanup before behavior cleanup.
- Do not reintroduce authored-facing block toolkit.
- Do not reintroduce hard aesthetic gates.
- Do not tighten AUTHOR-mode constraints without owner approval.
- Do not refactor `orchestrator.ts` casually.
- Do not remove compatibility shims until callers and old project state are
  audited.
- Every cleanup that changes code should have at least one focused test or an
  explicit reason why existing tests cover it.
- Run:

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

after meaningful source changes.

## First Likely Task Candidates

These are small, high-signal, low-risk candidates for the next working session:

1. Fix or retire `scripts/_video-template.txt`.
2. Add a test that `scripts/new-video.ts` output respects current AUTHOR import
   rules.
3. Correct stale comments in `packages/compositions/src/index.ts`.
4. Create a short `docs/current-contract.md` or similar index.
5. Mark `docs/specs/freeform-engine/*` as design/archive/status docs, not the
   immediate agent contract.
6. Create a legacy inventory table for `stylePackId`, `styleId`,
   `LegacyTitleLanguage`, and old block vocabulary.

## Current Best Interpretation

This repo is best treated as a functioning system with messy boundaries, not as
a failed prototype.

The cleanup strategy should be archaeological and conservative: first make the
system explain itself truthfully, then remove dead paths, then split modules.
The product behavior should stay boringly stable while the internal shape gets
cleaner.

