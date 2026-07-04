# Temporary Task - Motion Continuity Plan

Status: MOTION-0 baseline and reproduction audit, MOTION-1 scene-duration
authored context, MOTION-2 content-plan motion intent, and MOTION-3
code-authoring motion prompt/docs completed; MOTION-4 pending.

This is a temporary working note for fixing the observed issue where generated
scenes animate for the first few seconds and then hold like static slides for
the rest of the scene. It is not project contract. Current contract remains
`AI_CONTRACT.md` plus `docs/current/`.

Delete this file after the selected motion-continuity slices are implemented,
focused and broad checks pass, and the cleanup commit is made.

## Goal

Make AI-authored scenes feel alive across the useful scene duration without
reintroducing unsafe or template-like motion:

- avoid the common "intro animation, then static hold" tail on long scenes;
- keep motion deterministic, bounded, and purposeful;
- do not allow authored scenes to import `@motionreal/blocks` or
  `@motionreal/theme`;
- preserve pure AUTHOR mode with raw JSX/SVG/CSS;
- keep visual/motion quality checks advisory unless explicitly approved as hard
  gates;
- cover behavior-bearing prompt/API changes with focused tests before broad
  checks.

## Verification On 2026-07-04

Commands/checks used during verification:

```bash
git status --short
Get-ChildItem -Force docs/working-notes
Test-Path docs/working-notes/2026-07-04-test-surface-cleanup-plan.md
Test-Path docs/working-notes/2026-07-03-prompt-improvement-plan.md
rg -n "motion|DIỄN TIẾN|durationInFrames|SceneComponentProps|richness|checkRichness|SceneTimingProvider|useExactSceneProgress" AI_CONTRACT.md docs/current apps/desktop/src/main/authoring packages/compositions/src packages/blocks/src packages/pipeline/src/safety packages/pipeline/src/render -g "*.md" -g "*.ts" -g "*.tsx"
rg -n "contentPlan|ContentPlan|buildContentPlanMessages|contentPlanForAuthoring|buildAuthorMessages|records current message counts|chars:|message count|role order|durationInFrames" apps/desktop/src/main/authoring packages/compositions/src/registry.ts packages/compositions/src/video.tsx -g "*.ts" -g "*.tsx"
rg -n "buildContentPlanMessages|contentPlanForAuthoring|buildAuthorMessages|Content Plan|CONTENT PLAN|plan" apps/desktop/src/main/authoring/ninerouter-backend.ts apps/desktop/src/main/authoring/content-plan.ts apps/desktop/src/main/authoring/content-plan.test.ts apps/desktop/src/main/authoring/prompt.test.ts
Get-Content packages/compositions/src/video.tsx | Select-Object -Skip 155 -First 95
Get-Content apps/desktop/src/main/authoring/content-plan.ts | Select-Object -Skip 245 -First 110
Get-Content apps/desktop/src/main/authoring/prompt.ts | Select-Object -Skip 120 -First 95
Get-Content docs/current/authoring-contract.md | Select-Object -Skip 20 -First 120
```

Verified facts:

- Working tree was clean before this note was created; after creation, this note
  is the only active working note on disk.
- `docs/working-notes/2026-07-04-test-surface-cleanup-plan.md` is absent on
  disk.
- `docs/working-notes/2026-07-03-prompt-improvement-plan.md` is absent on disk.
- Open IDE tabs that reference older working notes may therefore be stale. If a
  note is recreated later, re-check overlap before starting a slice.
- Draft and full render use the same Remotion composition, fps, locked timing,
  and input props. Draft changes encode settings only.
- Current authoring prompt and docs encourage visual progression but make it a
  soft creative direction, not a rule.
- Current code-authoring prompt examples prime the model with short entrance
  animation ranges such as `[0, 18]`.
- Current generated scene artifacts show the same pattern: short `spring(...)`
  entrances and fixed `interpolate(frame, [...])` ranges that settle after
  roughly 1-4 seconds.
- `SceneComponentProps` is defined in
  `packages/compositions/src/registry.ts`. It currently exposes `headline`,
  `body`, `eyebrow`, `props`, and optional `image`; it does not expose scene
  duration.
- `SceneContent` in `packages/compositions/src/video.tsx` has direct access to
  `scene.durationInFrames` when it mounts an authored component, so passing
  duration as a top-level authored prop is a small runtime surface change.
- `@motionreal/blocks` already has internal scene-timing helpers
  (`SceneTimingProvider`, `useSceneDurationInFrames`, `useExactSceneProgress`),
  but authored scenes cannot import `@motionreal/blocks` by contract.
- Fresh authoring is currently a two-step AI chain:
  `buildContentPlanMessages(...)` is called first, then
  `buildAuthorMessages(...)` receives `contentPlanForAuthoring(...)`.
- `apps/desktop/src/main/authoring/content-plan.ts` is therefore in scope for a
  real fix. The content-plan prompt currently asks for story progression,
  visual metaphor, and layout family, but it does not produce an explicit
  motion-continuity intent per scene.
- `apps/desktop/src/main/authoring/prompt.test.ts` already uses stable
  message/part shape assertions; exact prompt character-count snapshots are no
  longer present.
- N23 richness exists as an exported/self-tested advisory oracle, but it is
  manual and not auto-run by `runRenderGrid` because a single midpoint still
  cannot prove temporal motion.
- MOTION-0 re-confirmed the current generated-artifact pattern under
  `.video-tool/projects/`: many authored scenes use fixed-frame,
  clamp-settled entrances such as `[0, 12]`, `[10, 45]`, `[30, 65]`, and
  `spring({ frame: frame - ... })`, with only occasional longer bounded ranges.
- MOTION-1 added top-level `durationInFrames` to `SceneComponentProps` and
  passes it from `SceneContent` using `scene.durationInFrames`. It is authored
  scene context only; it was not added to manifest/schema `props`.
- MOTION-2 added required per-scene `motionProgression` to content planning,
  keeps it in `contentPlanForAuthoring(...)`, and rejects only generic weak
  motion intents such as "text appears" through the local quality check.
- MOTION-3 updated authoring/reauthor prompt text and current docs to use
  top-level `durationInFrames`, clamped scene progress, and content-plan
  `motionProgression`; removed the short `[0, 18]` entrance example from
  current prompt/docs; and kept static statement beats valid.

## Attachment Review Notes

The external review was useful but lacked current repo context.

Accepted corrections:

- The plan must explicitly verify whether older working notes still exist. They
  are absent on disk during this re-check, so the open tabs are stale rather
  than active coordination files.
- The plan must include the live two-step content-plan architecture.
- MOTION-0 should include broad `npm.cmd test` and `npm.cmd run build`, not only
  focused checks, because later slices touch public authored surface and
  sensitive render/oracle code.
- MOTION-2 must not assume old prompt-test character snapshots; current tests
  use stable shape/semantic assertions.
- The verified facts should name where `SceneComponentProps` is defined.
- Source-touching slices should run `npm.cmd run build`, not defer build
  coverage until the final audit, so build regressions are attributed to the
  slice that caused them.
- The coordination guard must include every source/doc surface this plan
  expects to touch, including prompt contract text and current docs.
- Any signal about live content-plan omission rates must come from manual/staged
  runs or logs, not from live-model tests in the default lane.

Rejected or re-scoped:

- The deleted cleanup/prompt notes do not block this plan unless they are
  recreated. The coordination guard below covers that case.
- The fix should not jump straight to render-grid wiring. The first practical
  fix is authoring API + content/code prompt guidance; runtime multi-frame
  sampling is a later advisory decision.

## Diagnosis

This is not a full-render timing bug. The likely cause is the combination of:

- code-authoring prompt examples that show short entrance animations;
- prompt wording that asks motion to be bounded/clamped and not loop forever;
- soft wording that says progression across the scene is encouraged but not
  mandatory;
- no authored-facing duration/progress prop, so model-written scenes cannot
  reliably time motion to the actual TTS-derived scene length;
- content-plan output lacking an explicit motion-continuity intent, leaving
  temporal motion decisions to the code authoring pass alone;
- current visual QA/review relying primarily on still frames, so it does not
  catch "motion finishes early, then static tail" reliably.

The fix should therefore address authoring inputs, planning, code-authoring
prompt text, and verification:

1. give authored scenes a safe way to know their own duration;
2. make the content-plan call name the intended temporal progression;
3. teach the code-authoring prompt/docs to implement bounded staged motion
   across the scene when useful;
4. add advisory multi-frame coverage so the defect does not silently return.

## Coordination Guard

Before starting any slice:

- list `docs/working-notes/` and check for newly created plans touching
  `apps/desktop/src/main/authoring/content-plan.ts`,
  `apps/desktop/src/main/authoring/content-plan.test.ts`,
  `apps/desktop/src/main/authoring/contract-text.ts`,
  `apps/desktop/src/main/authoring/prompt.ts`,
  `apps/desktop/src/main/authoring/prompt.test.ts`,
  `docs/current/authoring-contract.md`,
  `docs/current/content-guide.md`,
  `packages/compositions/src/registry.ts`,
  `packages/compositions/src/video.tsx`,
  `packages/pipeline/src/safety/typecheck-authored.test.ts`,
  `packages/pipeline/src/safety/render-grid.ts`, or
  `packages/pipeline/src/safety/render-grid.test.ts`;
- if a prompt-improvement or cleanup note is recreated, coordinate overlapping
  prompt/schema/test edits before proceeding;
- do not run a prompt contract change and a prompt test cleanup in parallel
  without one final broad check lane.

## Guardrails

- Do not reintroduce authored imports from `@motionreal/blocks` or
  `@motionreal/theme`.
- Do not expose theme tokens, style packs, block helpers, or layout kits.
- Do not use perpetual loops as the default solution.
- Do not require every scene to move all the time; deliberate static statement
  beats remain valid.
- Do not make N23/motion continuity a hard blocker without owner approval.
- Do not add live-model tests to the default lane.
- Keep prompt changes behavior-bearing and covered by focused tests.
- Keep render-oracle work scoped; `render-grid.ts`, `renderer.ts`, and workspace
  render flow are sensitive.

## Slice Plan

### MOTION-0: Baseline And Reproduction Audit

Status: completed on 2026-07-04.

Purpose: lock down current evidence before changing API, schema, or prompt text.

Touch:

- no source files.

Actions:

- confirmed working tree state and active working notes;
- recorded current prompt/docs lines that encourage soft motion and short entrance
  examples;
- confirmed fresh authoring still runs content planning before code authoring;
- confirmed current `prompt.test.ts` uses shape/semantic assertions, not exact
  character-count snapshots;
- inspected generated authored scenes under `.video-tool/projects/`
  for fixed-frame entrance ranges;
- ran focused and broad checks before behavior/API changes.

Checks:

```bash
git status --short
Get-ChildItem -Force docs/working-notes
npm.cmd test -- apps/desktop/src/main/authoring/content-plan.test.ts
npm.cmd test -- apps/desktop/src/main/authoring/prompt.test.ts
npm.cmd test -- apps/desktop/src/main/authoring/ninerouter-backend.test.ts
npm.cmd test -- packages/pipeline/src/safety/typecheck-authored.test.ts
npm.cmd test -- packages/compositions/src/video.test.ts
npm.cmd test -- packages/pipeline/src/safety/render-grid.test.ts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Stop point:

- If baseline checks are red before edits, stop and fix or re-scope before
  touching prompt/API.

Result:

- `docs/working-notes/` contains only this active working note; the older prompt
  and cleanup note paths are absent on disk.
- Focused checks passed:
  - content-plan: 16 tests;
  - prompt: 29 tests;
  - ninerouter backend: 30 tests;
  - authored typecheck: 11 tests;
  - composition video: 3 tests;
  - render-grid: 57 tests.
- `npm.cmd run typecheck` passed.
- `npm.cmd test` passed with 92 test files and 903 tests total.
- `npm.cmd run build` passed; Remotion webpack bundle succeeded.

### MOTION-1: Expose Safe Scene Duration To Authored Scenes

Status: completed on 2026-07-04.

Purpose: let AI-authored code stage motion relative to the actual scene length
without importing runtime internals.

Touch:

- `packages/compositions/src/registry.ts`
- `packages/compositions/src/video.tsx`
- `packages/pipeline/src/safety/__fixtures__/typecheck-clean.tsx` or a new N10
  fixture
- `packages/pipeline/src/safety/typecheck-authored.test.ts`
- `docs/current/authoring-contract.md`

Actions:

- added `durationInFrames: number` as a top-level `SceneComponentProps` field;
- passed `scene.durationInFrames` from `SceneContent` into authored components;
- added a focused authored typecheck fixture proving `durationInFrames` is
  available from `@motionreal/compositions`'s current authored surface;
- documented how to derive a clamped scene progress value:

```tsx
const frame = useCurrentFrame();
const progress = durationInFrames > 1
  ? Math.min(1, Math.max(0, frame / (durationInFrames - 1)))
  : 1;
```

Checks:

```bash
npm.cmd test -- packages/pipeline/src/safety/typecheck-authored.test.ts
npm.cmd test -- packages/compositions/src/video.test.ts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Result:

- `packages/pipeline/src/safety/typecheck-authored.test.ts` passed with 12
  tests, including duration-aware authored context coverage;
- `packages/compositions/src/video.test.ts` passed with 3 tests;
- `npm.cmd run typecheck` passed;
- `npm.cmd test` passed with 91 test files in the main shard plus the N10 shard,
  904 tests total;
- `npm.cmd run build` passed; Remotion webpack bundle succeeded.

Stop point:

- If adding `durationInFrames` leaks into manifest/schema or makes authored
  `props` ambiguous, stop and keep it top-level only. Do not put duration inside
  scene `props`.

Commit suggestion:

```text
feat: expose scene duration to authored components
```

### MOTION-2: Add Motion Intent To Content Planning

Status: completed on 2026-07-04.

Purpose: make Call A plan temporal visual progression before Call B writes TSX.

Touch:

- `apps/desktop/src/main/authoring/content-plan.ts`
- `apps/desktop/src/main/authoring/content-plan.test.ts`
- `apps/desktop/src/main/authoring/prompt.test.ts` only if authoring prompt
  tests need to assert the new field is passed through in `CONTENT PLAN ĐÃ DUYỆT`
- `apps/desktop/src/main/authoring/ninerouter-backend.test.ts` for deterministic
  content-plan fixtures.

Actions:

- added a compact per-scene motion intent to the content-plan schema as required
  `motionProgression`;
- kept it non-code: describe the intended temporal beat, not Remotion APIs;
- updated content-plan prompt examples to show motion that supports the beat
  across early/mid/late moments;
- updated `contentPlanForAuthoring(...)` tests so the field survives filtering
  while omitted claims remain filtered;
- added quality/prompt tests that prevent generic "text appears" motion
  language.

Checks:

```bash
npm.cmd test -- apps/desktop/src/main/authoring/content-plan.test.ts
npm.cmd test -- apps/desktop/src/main/authoring/prompt.test.ts
npm.cmd test -- apps/desktop/src/main/authoring/ninerouter-backend.test.ts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Result:

- `apps/desktop/src/main/authoring/content-plan.test.ts` passed with 18 tests;
- `apps/desktop/src/main/authoring/prompt.test.ts` passed with 29 tests;
- `apps/desktop/src/main/authoring/ninerouter-backend.test.ts` passed with 30
  tests;
- `npm.cmd run typecheck` passed;
- `npm.cmd test` passed with 91 test files in the main shard plus the N10 shard,
  906 tests total;
- `npm.cmd run build` passed; Remotion webpack bundle succeeded.

Stop point:

- If adding a schema field would make old live model replies fail too often,
  stop and decide whether to retry content planning with repair feedback before
  broad rollout. "Too often" must be judged from deterministic local fixtures
  plus owner-approved manual/staged runs or production logs, not live-model
  tests in the default lane. Do not silently fall back to one-step authoring.

Commit suggestion:

```text
feat: plan motion progression before authoring
```

### MOTION-3: Tighten Code-Authoring Motion Prompt And Docs

Status: completed on 2026-07-04.

Purpose: change code-authoring behavior from short entrance-only animation
toward bounded, duration-aware staged scene progression.

Touch:

- `apps/desktop/src/main/authoring/contract-text.ts`
- `apps/desktop/src/main/authoring/prompt.ts`
- `apps/desktop/src/main/authoring/prompt.test.ts`
- `docs/current/authoring-contract.md`
- `docs/current/content-guide.md`

Actions:

- updated code-authoring examples to destructure `durationInFrames` and compute
  clamped scene progress;
- replaced the short-only example with a multi-phase bounded example that still
  settles cleanly;
- consumed the content-plan `motionProgression` field explicitly when present;
- kept "not every scene must move" language, but made "do not animate only the
  first 1-3 seconds of a long scene" explicit;
- taught acceptable patterns:
  - staged reveals tied to `progress`;
  - line/chart/path draw across a scene;
  - focus shifts between elements;
  - slow bounded background depth;
  - final hold only after the main beat has completed;
- kept bans on meaningless perpetual loops, `Math.sin(frame)` loops,
  `frame % n` loops, and non-deterministic APIs;
- added semantic prompt tests using the current stable shape/semantic assertion
  style, not exact character-count snapshots.

Checks:

```bash
npm.cmd test -- apps/desktop/src/main/authoring/prompt.test.ts
npm.cmd test -- apps/desktop/src/main/authoring/content-plan.test.ts
npm.cmd test -- packages/pipeline/src/safety/typecheck-authored.test.ts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Stop point:

- Do not make prompt language demand constant motion in every scene. The goal is
  purposeful progression, not decorative jitter.

Result:

- `apps/desktop/src/main/authoring/prompt.test.ts` passed with 29 tests;
- `apps/desktop/src/main/authoring/content-plan.test.ts` passed with 18 tests;
- `packages/pipeline/src/safety/typecheck-authored.test.ts` passed with 12
  tests;
- `apps/desktop/src/main/authoring/agent-guidance.test.ts` passed with 3 tests
  after docs were synced to say motion should settle or resolve cleanly;
- `npm.cmd run typecheck` passed;
- `npm.cmd test` passed with 91 main-shard test files plus the N10 shard, 906
  tests total;
- `npm.cmd run build` passed; Remotion webpack bundle succeeded.

Commit suggestion:

```text
refactor: guide authored scenes toward duration-aware motion
```

### MOTION-4: Add Advisory Motion-Continuity Coverage

Status: pending.

Purpose: make the failure mode visible in tests/review without blocking renders
as an aesthetic hard gate.

Touch:

- `packages/pipeline/src/safety/render-grid.ts`
- `packages/pipeline/src/safety/render-grid.test.ts`
- possibly `packages/pipeline/src/review.ts` or render-still sampling only if
  the existing exported `checkRichness(...)` input path is insufficient.

Actions:

- add or adjust pure tests that distinguish:
  - long scene with no motion;
  - long scene with only early motion then static tail;
  - long scene with staged motion across early/mid/late samples;
  - short scene exempted from motion-richness warnings;
- keep the result advisory warning (`N23`) unless owner approves a hard gate;
- prefer pure frame fixtures first. Only wire extra Remotion still sampling if
  the review path needs the warning in normal desktop output.

Checks:

```bash
npm.cmd test -- packages/pipeline/src/safety/render-grid.test.ts
npm.cmd test -- packages/pipeline/src/review.test.ts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Stop point:

- If reliable multi-frame sampling would add too much render cost to every
  review, stop after pure coverage and make the runtime sampling decision
  explicit.

Commit suggestion:

```text
test: cover static-tail motion warnings
```

### MOTION-5: Final Audit And Delete This Note

Status: pending.

Purpose: prove the selected motion-continuity fix is complete and remove this
temporary plan.

Touch:

- delete `docs/working-notes/2026-07-04-motion-continuity-plan.md`.

Actions:

- audit prompt/docs/code for stale short-entrance-only wording;
- confirm authored imports remain limited to the allowed public packages;
- confirm `durationInFrames` is top-level scene context, not manifest `props`;
- confirm content-plan motion intent reaches code authoring input;
- run broad checks;
- delete this temporary note;
- commit final cleanup.

Checks:

```bash
rg -n "durationInFrames|motionProgression|scene progress|DIỄN TIẾN|\\[0, 18\\]|checkRichness|N23|@motionreal/blocks|@motionreal/theme" apps/desktop/src/main/authoring docs/current packages/compositions/src packages/pipeline/src/safety
git status --short
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Stop point:

- Do not delete this note until selected slices pass focused and broad checks.

Commit suggestion:

```text
chore: finish motion continuity cleanup
```

## Recommended Order

1. MOTION-0 baseline.
2. MOTION-1 expose scene duration as safe authored context.
3. MOTION-2 add motion intent to content planning.
4. MOTION-3 update code-authoring prompt/docs to use duration-aware staged
   motion.
5. MOTION-4 add advisory static-tail coverage.
6. MOTION-5 broad audit, delete this note, commit cleanup.

## Risk Notes

- MOTION-1 is a public authored-surface addition, but it is additive and does
  not relax import safety.
- MOTION-2 changes the content-plan structured output contract; it may require
  stricter retry/repair behavior if a live model omits the new field.
- MOTION-3 is behavior-bearing because it changes live LLM prompt text.
- MOTION-4 can become expensive if wired to real multi-frame Remotion sampling
  by default. Keep it advisory and measure before broadening.
- The first practical win should come from MOTION-1 through MOTION-3; MOTION-4
  is the guard against regressions.
