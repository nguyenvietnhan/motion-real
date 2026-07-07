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

The authoring-backend seam split is complete for the current Phase 2 scope.
`ninerouter-backend.ts` remains the stable `AuthoringBackend` facade and owns
provider wiring, project paths, image-capability cache, file write/admission, and
desktop-facing methods. Focused runner modules now own content planning, author
reply generation/recovery, reauthor retry/rollback, image filtering, and article
image crawling. Future work should add behavior to the relevant runner or a new
tested seam; do not keep thinning the facade just to reduce line count.

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

Current render code assumes one render workflow uses the in-memory
bundle/composition caches at a time. Do not enable project-level or
cross-project parallel rendering until these points have an owner-approved design
and focused tests:

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

The renderer CSS split is complete for the current Phase 7 scope.
`apps/desktop/src/renderer/theme.css` is the stable import entry and section
inventory; domain/layer partials live under `apps/desktop/src/renderer/theme/`.
Do not put new rules back into the entry file. Add them to the owning partial,
or add a new partial only when it represents a real UI domain or layer.

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
ids per batch, and still caps total authoring at 16 components. Do not add
unbounded retries, extra manifest-only model calls, or provider `max_tokens`
overrides without a new owner-approved slice and tests.

Content-plan metadata that is not safety-critical should not hard-fail authoring
by itself. Purpose drift and missing/generic `motionProgression` are normalized
with diagnostics so their frequency remains observable. Claim-ledger/evidence
violations, duplicate ids, invalid JSON shape, unsafe authored code, and render
integrity failures remain hard blockers.

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
