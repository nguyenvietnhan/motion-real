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
single authoring reply plus at most one missing-TSX recovery, or up to four TSX
batch calls for long no-image plans. Each TSX batch is limited to four component
ids. Do not add unbounded retries, extra manifest-only model calls, or provider
`max_tokens` overrides without a new owner-approved slice and tests.

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
