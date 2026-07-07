# MotionReal Project Optimization Audit - 2026-07-07

## Scope

Temporary audit note after deleting the older working notes. This is not a
feature plan. It lists static-scan findings across docs, prompt, code, tests,
config, and repo hygiene that are not urgent blockers today but can create
noise, drift, or scaling friction later.

Second-pass check: this note was re-audited after the first write specifically
for the prompt/code-generation risk surface. The project can be operating
stably today while still having prompt debt. Stable operation means the current
pipeline is usable; it does not prove that the prompt is minimal, resilient, or
optimized against future provider drift.

Working notes deleted before this audit:

- `docs/working-notes/2026-07-07-authoring-reliability-regression-plan.md`
- `docs/working-notes/2026-07-07-media-feature-readiness-plan.md`

Local code edits from the authoring reliability work are still present in the
working tree. This note does not revert them.

## Overall Verdict

No P0 blocker found in the static audit. The project is in a generally good
state, but "good and stable" should not be read as "fully optimized."

The most sensitive optimization surface is the authoring prompt. It directly
controls AI-generated story structure, narration, manifest shape, and Remotion
TSX code. Small wording changes can alter scene count, code length, creative
pressure, parseability, admission failures, and provider truncation behavior.
Prompt changes should therefore be treated like production code changes: narrow
scope, focused tests, and real-provider smoke before declaring success.

The biggest risks are concentrated in:

- prompt density, creative-pressure balance, and prompt/docs drift;
- legacy/spec-name noise;
- large sensitive files that remain expensive to reason about;
- reserved feature surfaces that look more "live" than the current product
  intent;
- scaling assumptions around render/cache concurrency.

## Findings

### P1 - Stable Runtime Does Not Prove Prompt Optimization

Evidence:

- `AI_CONTRACT.md:57-58` says repeated AI-output defects should become schema
  checks, normalizers, admission rules, or render oracles, not just prompt wishes.
- `apps/desktop/src/main/authoring/prompt.ts:117` intentionally demands a bold
  first draft with concrete visual must-haves.
- `apps/desktop/src/main/authoring/prompt.ts:183` frames the author as a highly
  creative Remotion programmer and asks for dazzling output.
- `apps/desktop/src/main/authoring/prompt.test.ts:477-501` locks that bold-first
  prompt behavior in tests.
- `apps/desktop/src/main/authoring/contract-text.ts:58-65` carries safer motion
  guidance, but it still sits inside a long contract embedded into multiple
  authoring prompts.

Risk:

- Current authoring may pass local gates while still being too prompt-heavy for
  long-term reliability.
- The prompt is balancing several competing goals in one surface: valid TSX,
  fresh visuals, strong narration, factual safety, motion quality, image rules,
  output format, batching, and repair behavior.
- Creative pressure is useful because prior weak prompts produced bland scenes,
  but if it is not isolated from the hard output contract it can raise the chance
  of invalid TSX, missing modules, overlong replies, or fragile animation math.
- A few passing attempts are not enough to prove provider robustness; model
  behavior can drift without any repository change.

Suggested cleanup:

- Treat prompt optimization as its own stabilization slice before feature work,
  not as incidental wording cleanup.
- Keep the hard "must pass and render" contract visually and structurally above
  aspirational style guidance.
- Split prompt pressure into smaller named sections with tests: output format,
  safety/import contract, story/narration, visual ambition, motion recipes,
  image placement, batch/recovery.
- For each prompt change, define the expected metric to improve: content-plan
  parse failures, purpose/motion normalization counts, missing TSX, admission
  N5/N10 failures, response size, or provider truncation.
- Do not remove the bold-first requirement blindly; first separate it from the
  code-validity contract so quality stays high without increasing TSX fragility.

### P1 - Prompt And Durable Docs Still Have Two Sources Of Truth

Evidence:

- `apps/desktop/src/main/authoring/contract-text.ts:2-6` says the prompt
  contract is a condensed copy of `docs/current/authoring-contract.md`.
- `apps/desktop/src/main/authoring/prompt.ts:96`,
  `181`, `224`, `313`, `364`, `524`, and `558` hold large policy/prompt
  builders.
- `apps/desktop/src/main/authoring/content-plan.ts:40`, `420`, and `498`
  combine schema, validation, normalization, and prompt generation.

Risk:

- A future small wording change can update docs but not the runtime prompt, or
  update the prompt but leave docs stale.
- The runtime prompt carries product policy, creative taste, output contract,
  safety hints, visual QA rules, and image-filter policy in one place.

Suggested cleanup:

- Make `AI_CONTRACT.md` and `docs/current/*` the durable policy source, and
  make prompt text either generated from a smaller checked-in prompt module set
  or covered by explicit sync tests.
- Split prompt builders by responsibility: output format, authoring contract,
  content rules, image rules, batch rules, visual QA, image filter.
- Add a small prompt-change checklist to durable docs: what changed, which hard
  contract it touches, which focused tests cover it, and what provider smoke will
  validate it.

### P1 - Prompt Creative Pressure Is Useful But Still A Fragility Lever

Evidence:

- `apps/desktop/src/main/authoring/prompt.ts:181` builds the main author system
  prompt.
- `apps/desktop/src/main/authoring/contract-text.ts:39` and later sections tell
  the model to hardcode all visuals and push bold bespoke visuals.
- `apps/desktop/src/main/authoring/prompt.test.ts:477` explicitly protects the
  bold-first behavior because previous drafts were too timid.

Risk:

- Recent reliability work lowered motion complexity, but the broad prompt still
  strongly pushes "loá mắt", bespoke SVG/CSS, multiple layout forms, and
- mandatory visual ambition. That is good for quality, but it remains a
  reliability lever, not a free improvement knob.
- If future edits add more style or narration pressure without reducing contract
  density elsewhere, the prompt can become harder for weaker providers to obey.

Suggested cleanup:

- Keep the creative ambition, but separate "must pass and render" from
  "aspirational visual richness" in the prompt structure.
- Track provider failure classes before adding more creative rules.
- Prefer replacing vague creative pressure with a small number of safe recipes
  and examples that are known to pass admission.

### P1 - Existing Dirty Authoring Changes Need A Checkpoint Decision

Evidence:

- `git status --short` shows many modified authoring/docs/test files plus the
  tracked deletion of the old media working note.

Risk:

- The repo can be "good" but still operationally noisy if a future agent cannot
  tell whether the authoring reliability changes are accepted, pending review,
  or meant to be reverted.

Suggested cleanup:

- After owner review, either commit the accepted authoring reliability changes
  or explicitly revert only the unwanted slice.
- Do not mix this audit cleanup with behavior changes.

### P2 - Legacy Names And Historical Requirement Codes Are Still Noisy

Evidence:

- `apps/remotion/src/Root.tsx:18` and
  `packages/pipeline/src/authoring/authored-entry.ts:55` still register
  `NewsVideo` beside `MotionRealVideo`.
- `apps/desktop/src/main/index.ts:79` and `scripts/calibrate-voice.ts:74`
  still reference `news-studio-settings.json`.
- Many comments still reference historical names/codes such as
  `freeform-engine`, `author-mode-v2`, `desktop-author-mode`, `Req`, `R`, `D`,
  `Path-X`, `math_video_tool`, and `mvlib`.

Risk:

- Compatibility aliases may be intentional, but without a sunset note they look
  like competing product identities.
- Old requirement codes make comments feel like another contract beside
  `AI_CONTRACT.md`.

Suggested cleanup:

- Keep required compatibility aliases, but document why and when they can be
  removed.
- Gradually rewrite comments to describe live behavior instead of old task IDs.

### P2 - Reserved Feature Surfaces Look More Live Than The Current Intent

Evidence:

- `packages/schema/src/index.ts:117` includes `SceneSpec.sfx`.
- `packages/pipeline/src/audio/sfx.ts:4-23` defines SFX cue mapping.
- `packages/pipeline/src/index.ts:33` exports SFX helpers.
- `apps/desktop/src/shared/settings-model.ts:133-134` defaults article image
  AI filtering and human review to `true`.
- `apps/desktop/src/main/workspace/workspace-create-flow.ts:95` and `111`
  execute those image-crawl settings.

Risk:

- SFX is schema/export-visible but not a complete user feature.
- Image crawl/filter/review may be an accepted current feature, but its defaults
  mean URL-based creates can spend extra model/vision work even when the owner
  wants no new feature expansion.

Suggested cleanup:

- Either mark SFX as reserved/internal in durable docs, or remove/export-hide it
  until it becomes a real feature.
- Confirm image-crawl defaults are still desired for the stable product path.

### P2 - Large Sensitive Files Still Carry High Cognitive Load

Largest non-test files from the scan:

- `apps/desktop/src/main/workspace/workspace-controller.ts` ~57 KB.
- `packages/pipeline/src/safety/render-grid.ts` ~48 KB.
- `packages/pipeline/src/orchestrator.ts` ~47 KB.
- `apps/desktop/src/main/authoring/prompt.ts` ~40 KB.
- `apps/desktop/src/main/authoring/ninerouter-backend.ts` ~35 KB.
- `apps/desktop/src/main/authoring/content-plan.ts` ~25 KB.

Risk:

- These files are documented as sensitive, so drive-by refactors are risky.
  But their size still makes audits slower and increases merge/conflict cost.

Suggested cleanup:

- Do not big-bang rewrite.
- Prefer very narrow extractions only when a behavior slice already needs them:
  prompt modules, content-plan parser/normalizer vs prompt, render-grid oracle
  groups, and workspace orchestration helpers.

### P2 - Render Scaling Is Explicitly Single-Workflow-Oriented

Evidence:

- `docs/current/maintenance.md:65-76` says bundle/composition caches are not
  designed for project-level or cross-project parallel rendering.
- `packages/pipeline/src/render/composition-prep.ts:141-143` has small in-memory
  cache caps.
- `packages/pipeline/src/render/project-lock.ts:7` uses a 6-hour stale lock
  threshold.

Risk:

- Current desktop use is fine, but scaling to multiple simultaneous renders
  needs a design first.
- Cache eviction and bundle lifetime are not ref-counted.

Suggested cleanup:

- Leave current single-workflow assumption intact.
- If scaling becomes a real goal, start with render cache/bundle lifetime design
  before UI concurrency.

### P2 - Cache Pruning Is Age-Based, Not True LRU

Evidence:

- `packages/pipeline/src/store/store.ts:457-459` notes that cache hits copy out
  cached files but do not touch cached file mtime.

Risk:

- Frequently reused cache entries can still look old and be evicted before less
  useful entries.

Suggested cleanup:

- Either accept this as age-based pruning and document it that way, or touch
  cache mtime on hit if true LRU matters.

### P2 - Raw AI Replies Are Logged On Parse Failures

Evidence:

- `apps/desktop/src/main/authoring/content-plan-runner.ts:54` and `123`.
- `apps/desktop/src/main/authoring/author-reply-runner.ts:94`, `154`, and
  `261`.
- `apps/desktop/src/main/authoring/reauthor-runner.ts:130`.

Risk:

- The first 2000 chars of model output can include user prompt details, source
  snippets, generated code, or sensitive facts. It is useful for debugging, but
  noisy and potentially sensitive if logs are shared.

Suggested cleanup:

- Keep detailed logs behind debug/dev mode, or log structured parse summaries by
  default and raw snippets only under an explicit diagnostic flag.

### P2 - String-Based TSX/JSON Recovery Is A Maintenance Hotspot

Evidence:

- `apps/desktop/src/main/authoring/reply-parser.ts` performs code fence and JSON
  recovery.
- `apps/desktop/src/main/authoring/manifest-schema.ts` extracts JSON from mixed
  replies.
- `apps/desktop/src/main/authoring/content-plan.ts:310-345` performs balanced
  JSON extraction.
- `apps/desktop/src/main/authoring/normalize-imports.ts` performs string-based
  TSX import/API normalization.

Risk:

- These are justified because AI output is messy, and tests exist. But every new
  transform added here increases parser edge cases.

Suggested cleanup:

- Keep current tested transforms.
- For future code mutation beyond simple import rehousing, prefer AST-backed
  transforms or admission errors over more regex/string rewrites.

### P2 - Content Plan Tolerance Is Purpose-Specific

Evidence:

- `apps/desktop/src/main/authoring/content-plan.ts:8-11` keeps strict enums for
  purpose/layout family.
- `apps/desktop/src/main/authoring/content-plan.ts:179-194` normalizes purpose
  values.
- `apps/desktop/src/main/authoring/content-plan.ts:197-220` normalizes purpose
  and motion intent only.

Risk:

- The recent failure class was purpose/motion, but similar non-safety metadata
  drift could happen in `layoutFamily` or `hookType`.

Suggested cleanup:

- Do not broaden tolerance preemptively.
- If logs show layout-family drift, add the same style of diagnostic
  normalization instead of a broad retry.

### P3 - Renderer Still Has Many Inline Styles Despite CSS Split

Evidence:

- `apps/desktop/src/renderer/primitives.tsx` contains many repeated inline style
  objects.
- `apps/desktop/src/renderer/views/workspace.tsx` and
  `apps/desktop/src/renderer/views/storyboard.tsx` mix class-based layout with
  inline layout/styling.
- `docs/current/maintenance.md:146` documents a CSS-partial workflow.

Risk:

- Inline styles are fine for small primitives, but repeated layout constants make
  responsive fixes and visual consistency harder over time.

Suggested cleanup:

- Leave dynamic sizing inline.
- Move stable repeated layout/style clusters into the owning CSS partial during
  the next UI polish slice.

### P3 - Deferred YouTube Note Is Durable But Not Active

Evidence:

- `AI_CONTRACT.md:28`, `README.md:59`, and
  `docs/current/youtube-mode-deferred.md` keep YouTube deferred docs visible.

Risk:

- It is correctly labeled deferred, but if the owner wants no feature expansion,
  this can still add planning noise.

Suggested cleanup:

- Keep it if it prevents accidental YouTube scope creep.
- Otherwise archive it outside `docs/current/` so current docs stay operational.

### P3 - Dev/Test Providers Need Clear Scope

Evidence:

- `packages/pipeline/src/types.ts:22` includes `mock` and `none`.
- `packages/pipeline/src/cli/cli.ts:46`, `122`, and `558` expose
  `--tts mock|none`.
- `apps/desktop/src/main/index.ts:105` handles `mock`/`none` provider values.
- `AI_CONTRACT.md:50-51` forbids silently falling back to `mock` or `none`.

Risk:

- This is not a direct contradiction if `mock`/`none` are explicit dev choices,
  but it should stay clearly scoped so nobody treats them as runtime fallback.

Suggested cleanup:

- Durable docs should say `mock`/`none` are explicit CLI/dev modes only.
- Desktop production paths should keep blocking missing real voice config.

## Suggested Optimization Order

1. Checkpoint the current dirty authoring reliability changes: commit accepted
   changes or explicitly revert only the unwanted slice.
2. Run a prompt-specific stabilization pass before new feature work:
   isolate hard contract vs creative ambition, split prompt builders, keep the
   bold-first quality requirement, and validate with focused tests plus provider
   smoke.
3. Remove historical task-code/comment noise where it no longer explains live
   behavior.
4. Make prompt/docs sync safer: split prompt modules and add sync/snapshot tests.
5. Decide reserved surfaces: SFX export/schema, image-crawl defaults, and
   dev-only TTS modes.
6. Keep sensitive-file refactors opportunistic and behavior-led, not size-led.
7. Do not start render parallelism until bundle/cache lifetime has an approved
   design.

## Verification Performed

Static scans only:

- `rg --files`
- `rg` scans for working notes, legacy names, prompt/code surfaces, TTS fallback
  terms, batching/retry/concurrency, cache/render terms, inline styles, and raw
  logging.
- `git status --short --ignored`
- targeted file reads for current docs, prompt, content plan, settings, root
  scripts, package metadata, SFX, and Remotion root.
- second-pass focused scans for prompt pressure, prompt tests, durable-doc
  prompt wording, raw AI reply logging, normalization diagnostics, and batching
  logs.

No full test/typecheck/build run was performed for this audit note.
