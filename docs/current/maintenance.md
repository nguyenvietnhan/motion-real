# Maintenance

This project works and has meaningful tests, but it carries architectural and
documentation debt from several pivots. Cleanup should be slow, scoped, and
verified.

## Do Not Big-Bang Rewrite

The existing pipeline produces videos. Preserve behavior while improving
boundaries.

## Sensitive Files

Treat these as high-risk:

- `packages/pipeline/src/orchestrator.ts`
- `packages/pipeline/src/safety/render-grid.ts`
- `apps/desktop/src/main/workspace/workspace-controller.ts`
- `apps/desktop/src/main/authoring/ninerouter-backend.ts`
- `apps/desktop/src/main/index.ts`

Open them only with focused tests and a clear slice.

## Cleanup Order

Preferred order:

1. keep docs truthful and current;
2. split authoring backend seams;
3. revisit workspace state machine only after a new narrow slice is proven;
4. split render-grid/orchestrator only after safer outer cleanup.

The first workspace-controller pass is complete: local pure/view-model/create/
script/render helpers exist, while async render/refine/publish orchestration
stays in `WorkspaceController`. Do not force that extraction just to reduce line
count.

Phase 7 intentionally did not split `workspace-controller.ts`,
`packages/pipeline/src/orchestrator.ts`, or
`packages/pipeline/src/safety/render-grid.ts` further. These files are still
large, but they currently own real behavior boundaries: desktop stage
orchestration, render pipeline sequencing/locks, and deterministic render
oracles. Future extraction needs a written behavior boundary plus focused tests
before code changes; do not move code out of these files for size alone.

The authoring-backend seam split is complete for the current Phase 2 scope.
`ninerouter-backend.ts` remains the stable `AuthoringBackend` facade and owns
provider wiring, project paths, image-capability cache, file write/admission, and
desktop-facing methods. Focused runner modules now own content planning, author
reply generation/recovery, reauthor retry/rollback, image filtering, and article
image crawling. Future work should add behavior to the relevant runner or a new
tested seam; do not keep thinning the facade just to reduce line count.

The content-plan split is complete for the current Phase 7 scope.
`content-plan.ts` remains the public facade, while schema/types, normalization,
parser, quality checks, and prompt builders live in focused `content-plan-*`
modules. Keep imports pointed at the facade unless a local module needs an
internal helper.

The desktop-main thinning pass is complete for now. `index.ts` remains the
Electron composition root, while local tested helpers own runtime env parsing,
create-time image staging, BGM handlers, native save/export helpers, and
`projects:create` IPC payload coercion. Settings/TTS and thumbnail IPC handlers
also now live in focused handler factories with explicit root wiring. Keep
Electron lifecycle, media
scheme/protocol ordering, controller construction, and broad handler composition
root-owned unless a future slice has a narrower reason than line count.

The media-pipeline split is complete for the current Phase 6 scope. TTS provider
clients, provider HTTP helpers, caption timing, and audio operations now live in
focused modules under `packages/tts/src/`; keep `index.ts` as the public barrel
and cache-key surface. Renderer bundle/composition preparation now lives in
`packages/pipeline/src/render/composition-prep.ts`; keep render primitives in
`renderer.ts` unless a future slice proves a narrower behavior boundary.

## Parallel Render Assumption

Current render code assumes one render workflow uses the process-local
bundle/composition caches at a time. The same project is protected by
`withProjectRenderLock`, but different projects are not documented as safe to
render concurrently in one desktop/main-process runtime because the shared
bundle and composition caches are small mutable eviction caches (`bundleCache`
cap 2, `compositionCache` cap 8), not leased resources.

Treat this as a hard scaling boundary, not a missing UI button or queue. Do not
enable project-level or cross-project parallel rendering until these points have
an owner-approved design and focused tests:

- Bundle cache: `composition-prep.ts` evicts Remotion bundle directories
  best-effort and has no active-user reference count. Parallel rendering needs a
  per-render bundle lifetime, a reference-counted cache, or a no-delete eviction
  policy so one render cannot remove another render's `serveUrl`.
- Composition cache: selected compositions are keyed by bundle key,
  composition id, and input props, but their lifetime is still tied to the
  bundle `serveUrl`. Parallel rendering needs cache mutation and eviction to be
  concurrency-safe with the bundle lifecycle.
- Project render lock: `withProjectRenderLock` is still the required boundary
  for draft, full, stills, and thumbnail jobs. Any parallel path must keep the
  in-process and file lock semantics for the same project, and must explicitly
  decide whether different projects may render concurrently in one process.
- Thumbnail/stills lock behavior: `renderProjectStillsUnlocked` writes a
  temporary no-audio locked spec to the normal project lock path, and
  `renderThumbnail` snapshots/restores that path around the private stills call.
  Parallel rendering cannot bypass the public `renderThumbnail`/
  `renderProjectStills` wrappers or another job could observe the temporary
  no-audio lock.

## Render Parallelism Design Gate

Before enabling cross-project render parallelism, approve a design that covers
these minimum points:

- Bundle lifetime: `prepareComposition` or an adjacent wrapper needs a
  per-render bundle lease/release boundary, or an equivalent reference-counted
  bundle cache. Eviction must never remove a bundle directory while an active
  render still owns its `serveUrl`.
- Composition cache lifetime: selected composition entries must be scoped to an
  active bundle lease or evicted only after the owning bundle is inactive.
- Concurrency policy: same-project rendering stays serialized by
  `withProjectRenderLock`; any cross-project rendering must declare a global
  process limit, queue/cancel behavior, and how UI progress events are routed.
- Stale lock policy: keep the current stale/dead-pid lock recovery semantics
  unless a focused change updates `PROJECT_RENDER_LOCK_STALE_MS` with tests.
- Crash cleanup: orphaned bundle/temp directories may be removed by startup or
  idle cleanup only when they are old enough and not leased; project locks still
  recover through the existing stale/dead-pid path.
- Verification: add focused tests around bundle lease eviction,
  project-lock serialization, cache pruning, and at least one render-path smoke
  before exposing a UI queue or parallel desktop workflow.

## Cache Pruning Policy

Shared render and TTS caches under `.video-tool/cache/` are capped by size and
pruned oldest mtime first. This is intentionally age-based pruning, not true
LRU: cache hits copy the cached artifact back to the project but do not refresh
the cached file mtime. Keep docs and tests using "oldest mtime" or "age-based"
wording unless a later owner-approved cache design changes hit behavior and
adds focused tests for refreshed cache entries staying warm.

The renderer CSS split is complete for the current Phase 7 scope.
`apps/desktop/src/renderer/theme.css` is the stable import entry and section
inventory; domain/layer partials live under `apps/desktop/src/renderer/theme/`.
Do not put new rules back into the entry file. Add them to the owning partial,
or add a new partial only when it represents a real UI domain or layer. Stable
renderer shell/review/empty-state layout belongs in these CSS partials; keep
runtime values such as dynamic media backgrounds, selected-scene borders, and
progress width inline in the owning TSX.

The internal `createTools` facade is pipeline-owned.
The root `.mcp.json` is local-only and ignored. Keep `.mcp.example.json` as a
template without absolute machine paths; do not reintroduce a repo-provided
MCP server without a focused owner-approved slice.

## Duration Targets

New scaffolded projects persist one resolved duration target in `brief.duration`.
The pipeline resolves it in this order: explicit tool duration, selected
duration tier, duration parsed from the prompt, then the 60 second default.
Existing project briefs are not silently migrated; stale targets such as an old
`duration: 60` paired with a longer `durationTier` need an explicit owner
requested repair or reauthoring pass.

## Authoring Output Size

Fresh authoring should stay bounded before the first draft. The current budget is
one content-plan call, at most one claim-ledger repair call, and then either one
single authoring reply plus at most one missing-TSX recovery, or compact TSX
batch calls only when a no-image plan exceeds the normal single-reply capacity.
The current compact batch path starts after 12 components, uses two component
ids per batch, and still caps total authoring at 16 components. That capacity
policy lives in `author-batch-policy.ts`; keep changes there focused and tested.
Do not add unbounded retries, extra manifest-only model calls, or provider
`max_tokens` overrides without a new owner-approved slice and tests.

Content-plan metadata that is not safety-critical should not hard-fail authoring
by itself. Purpose drift and missing/generic `motionProgression` are normalized
with diagnostics so their frequency remains observable. Claim-ledger/evidence
violations, duplicate ids, invalid JSON shape, unsafe authored code, and render
integrity failures remain hard blockers.

## Parser And Normalizer Policy

Parser recovery and authored-source normalization are compatibility tools, not a
general retry substitute. Existing transforms should stay narrow, named, and
covered by focused regression tests:

- `reply-parser.ts` may recover only parseable authored modules: fenced TSX,
  a truncated final fence whose `registerComponent` survived, bare modules with
  `// component:` plus a matching `registerComponent`, and manifest
  `sceneId` -> `component` only when matching authored code exists.
- `manifest-schema.ts` may coerce soft manifest metadata that does not affect
  code safety, such as overlong strings, image ref aliases, hashtags, and bad
  transition hints. Empty required content and invalid component ids still fail.
- `content-plan-normalize.ts` may normalize non-safety metadata with diagnostics,
  currently `purpose` and missing/generic `motionProgression`. Evidence,
  duplicate ids, schema-critical enum drift, and claim-ledger issues stay hard
  unless a documented owner-approved policy changes them.
- `normalize-imports.ts` may fix mechanical authored-source compatibility issues
  already proven by incidents, such as `SceneImage` re-home, old Remotion
  `Extrapolate`, color-valued `interpolate`, boundary markdown fences, and the
  exact `import { z } from "zx"` typo. It must leave unrelated forbidden imports
  or unsafe code for admission to reject.

Do not add a new regex/string recovery because one provider attempt failed.
Investigate first. Add a new source mutation only when the pattern is repeated
or clearly reproducible, mechanical, safer than a retry, and locked by before/
after fixtures plus the relevant parser/admission tests. Broad AST or source
rewrites need owner approval, a rollback path, and must not weaken N4/N5/N10 or
render-safety blockers.

## Reserved Feature Surfaces

Some compatibility and reserved surfaces are intentionally present and should not
be deleted during hygiene passes:

- `NewsVideo` is a legacy Remotion composition id kept for old saved render
  commands and generated entries. New work should target `MotionRealVideo`.
- `news-studio-settings.json` is the pre-rename desktop settings filename, read
  only for migration/compatibility. New writes use `motionreal-settings.json`.
- Scene `sfx` and `audio/sfx.ts` are reserved/internal sound-effect metadata.
  They are schema/export compatible surfaces, not a user-facing default audio
  mixing feature yet.

Removing any of these needs an owner-approved sunset/migration path and focused
tests for the affected alias or persisted data.

## Image Crawl Defaults

URL/image creation currently defaults to AI preselection plus human review. That
keeps crawled images useful while still making the user approve media before
authoring. Changing `imageCrawlAiFilter` or `imageCrawlHumanReview` defaults is
a product/cost/UX decision, not a cleanup task.

## Dev/Test TTS Modes

`mock` and `none` are explicit CLI/dev/offline TTS modes. Desktop production
uses real configured providers (`vivibe` or `elevenlabs`) and must block on
missing credentials instead of silently falling back to `mock`, `none`, or a
different provider.

## Prompt Change Checklist

Treat runtime prompt text as production behavior. Before changing authoring,
content-plan, batch, recovery, visual-QA, image-filter, or reauthor prompts:

- classify the change as hard contract, quality guidance, or advisory guidance;
- name the expected metric or evidence it should improve, such as parse failure,
  normalization count, missing TSX, N5/N10 admission, reply size, provider
  truncation, or debuggability;
- identify the focused tests that cover the touched prompt section;
- decide whether provider smoke or a fixed canary subset is required;
- write the rollback path, usually a commit revert or a narrow internal flag;
- do not turn visual taste, layout preference, or motion feel into a hard gate
  without owner approval and fixtures.

## Motion Tempo Validation

Motion tempo is authoring guidance, not a hard render oracle. Automated tests
should lock the contract/prompt/planner/bootstrap wording and the
content-plan advisory behavior, but they cannot prove whether a generated
animation feels natural.

Do not add a regex or visual hard gate for "slow entrance" or "too much living
motion" without owner-approved fixtures and a low false-positive criterion.
These problems are context-sensitive: a chart draw can legitimately span most
of a scene, while a title pop usually should not.

Manual E2E validation for motion-tempo slices needs a real provider-connected
desktop run. Use a prompt that asks for all three cases in one video:
quick title/card reveal, continuous wave/pulse/flow or walking motion, and a
semantic path/chart/process progression. Inspect the authored TSX and draft:
simple entrances should settle quickly, living motion should continue with a
bounded deterministic phase/period, and semantic progress should only span the
scene when the beat truly changes over time. Existing generated projects are not
migrated by prompt-only slices; reauthor/refine them separately if needed.

## Renderer CSS Checklist

For CSS-only edits:

- Keep `theme.css` as the import map and preserve partial import order unless
  the change intentionally changes cascade behavior.
- Keep responsive rules beside the partial that owns the surface.
- For move-only edits, do not rename selectors, do not change declarations, and
  verify the inlined import output still matches the previous CSS.
- Run:

```powershell
git diff --check
npm.cmd run typecheck
npm.cmd run build
```

Manual UI inspection should use:

```powershell
npm.cmd --workspace @motionreal/desktop run app
```

Check Home/create flow, Settings, Workspace storyboard/review, and Publish.
Specifically inspect long Vietnamese text, button labels/icons, dropdowns,
modals, toasts, cover lightbox, thumbnail aspect modes, and narrow-window
responsive wrapping.

## Repository Hygiene

Prefer descriptive, domain-owned paths over loose root files:

- root: project metadata and compatibility entry points only;
- `apps/desktop/assets/<domain>/`: bundled desktop assets shipped with the app;
- `VIDEO_TOOL_HOME/.video-tool/<domain>/`: generated runtime state and user-added
  media;
- `docs/current/`: durable documentation.

AI guidance must stay vendor-neutral. `AI_CONTRACT.md` is the only contract and
`AGENTS.md` is the generic entry-point pointer. Do not add assistant-specific
contract files unless the owner explicitly accepts the tool adapter and it does
not duplicate project rules.

For stale AUTHOR-surface audits, prefer narrow scans that avoid generated
payloads, temporary working notes, tests, and fixture code. Do not expect zero
hits: classify each hit as a canonical prohibition, compatibility alias,
runtime-only package wiring, or actionable stale surface.

```powershell
rg -n "@motionreal/(blocks|theme)|<(/?)(Frame|Story|TitleBlock|KeyPoints|Panel|CountUp)\b" `
  AI_CONTRACT.md README.md docs/current apps/desktop/src/main/authoring packages/pipeline/src/authoring packages/pipeline/src/safety/typecheck-authored.ts `
  --glob '!**/node_modules/**' `
  --glob '!**/dist/**' `
  --glob '!**/*.test.ts' `
  --glob '!**/*.test.tsx' `
  --glob '!packages/pipeline/src/authoring/__fixtures__/**'

rg -n "kit-based|NewsVideo|news-studio-settings" `
  AI_CONTRACT.md README.md docs/current docs/providers apps packages scripts `
  --glob '!**/node_modules/**' `
  --glob '!.video-tool/**' `
  --glob '!**/dist/**' `
  --glob '!apps/desktop/dist-electron/**' `
  --glob '!**/vendor-fonts.generated.ts' `
  --glob '!**/*.test.ts' `
  --glob '!**/*.test.tsx' `
  --glob '!packages/pipeline/src/authoring/__fixtures__/**' `
  --glob '!packages/pipeline/src/safety/__fixtures__/**' `
  --glob '!docs/working-notes/**'
```

Bundled media should not be copied into runtime libraries just to make it
selectable. Prefer virtual built-in entries that point to their app asset, while
user-added media is copied into the canonical `.video-tool` library.
