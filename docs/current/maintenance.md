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

## Refactor Guardrails

Keep docs truthful. Prefer focused fixes over rewrite campaigns. There is **no**
open backlog to split large files for size alone.

- Do **not** split `orchestrator.ts` or `render-grid.ts` without a written
  behavior boundary, owner approval, and focused tests.
- `workspace-controller.ts`, `orchestrator.ts`, and `render-grid.ts` stay large
  on purpose (stage orchestration, render sequencing/locks, render oracles).
  Do not extract for line count alone.
- Workspace pure helpers already exist (`workspace-helpers`, `workspace-stage`,
  create/script/refine flows). Async render/refine/publish orchestration stays
  in `WorkspaceController`; stage transitions log at `setStage` only.
- Desktop `reviewMode` (`full` | `stills_edit` | `skip_edit`) lives on
  `SettingsModel` / Settings tab **Dựng video**. Branches in
  `WorkspaceController.runRender` / `submitEdits` / publish `forceFull` when
  `!hasDraft`. Do not weaken pipeline draft-first for CLI without forceFull.
- `ninerouter-backend.ts` is the stable `AuthoringBackend` facade. Add behavior
  on the owning runner/helper (`content-plan-*`, reply, reauthor, crawl, visual
  QA, claim-policy, etc.). Do not thin the facade or move `authorScenes` only
  for size.

Visual QA is advisory and returns a truthful `VisualQaResult`: `checked` (ran
with a valid reply) or `skipped` (no model, manifest unavailable, no stills,
provider error, invalid response, unsupported). Only a **checked** pass with zero
high-severity defects increments the consecutive-clean early-stop streak. A
skipped pass consumes the configured refine pass and may emit a diagnostic log,
but it is never counted or presented as a clean QA result.

Settings → **Kiểm tra** (`settings:readiness`, under Tài khoản AI) runs local
doctor + gateway/account/model/voice presence checks only. It never calls an
LLM or TTS, never auto-selects a model, and never ships secrets, raw doctor
paths, or error stacks to the renderer. The IPC result uses fixed Vietnamese
labels, details, and remediations; compact status icons are the visible summary,
with safe detail/remediation text available through tooltip/accessibility copy.

**Chi tiết xử lý** (`projects:diagnostics`) projects a bounded, redacted view of
`events.ndjson` (and safe authoring/repair appends). The renderer never receives
raw Pino logs, prompts, TSX, paths, N-codes, or free-form repair text — only
fixed-language lifecycle/authoring/repair states. The reader tails at most 256
KiB from each of the current and single rotated event files and returns at most
80 newest entries.

`content-plan.ts` is the public facade; schema/types, normalization, parser,
quality checks, and prompt builders live in focused `content-plan-*` modules.
Keep imports pointed at the facade unless a local module needs an internal
helper.

`apps/desktop/src/main/index.ts` is the Electron composition root. Local tested
helpers own runtime env parsing, create-time image staging, BGM handlers, native
save/export helpers, and `projects:create` IPC payload coercion. Focused IPC
factories cover settings/TTS, BGM, thumbnail, and gateway AI; project, script,
and review handlers remain thin root wrappers. Keep Electron lifecycle, media
scheme/protocol ordering, controller construction, and broad handler composition
root-owned. Do not invent a mega-handler builder or extract more from `index.ts`
for line count alone; see the composition-root charter in `architecture.md`.

TTS provider clients, provider HTTP helpers, caption timing, and audio operations
live under `packages/tts/src/`; keep `index.ts` as the public barrel and
cache-key surface. Provider-specific adapters map errors to
`VoiceProviderFailure` at that boundary; friendly UI and Queue policy branch
only on the shared code, never on vendor response strings. Adding a provider
means adding its client/error mapper and factory entry, not another Queue branch.
Renderer bundle/composition preparation lives in
`packages/pipeline/src/render/composition-prep.ts`; keep render primitives in
`renderer.ts` unless a future slice proves a narrower behavior boundary.

## Process-Wide Workflow Gate

`WorkspaceController` serializes every cache-sensitive author/render/edit/
publish/thumbnail workflow through one process-wide FIFO gate. This includes
different projects, Home, Queue containers, and thumbnails. `isBusy()` is the
single spillover signal used by Home together with Queue runner state. Keep the
per-project AbortController/guard semantics: cancellation while waiting must
skip the queued work, not open a second lane.

The same project is additionally protected by `withProjectRenderLock`. The
shared bundle/composition caches are small mutable eviction caches
(`bundleCache` cap 2, `compositionCache` cap 8), not leased resources. Treat
the global FIFO as a hard correctness boundary; do not add a direct controller
path that bypasses it.

- Bundle cache: `composition-prep.ts` evicts Remotion bundle directories
  best-effort and has no active-user reference count. Parallel rendering needs a
  per-render bundle lifetime, a reference-counted cache, or a no-delete eviction
  policy so one render cannot remove another render's `serveUrl`.
- Composition cache: selected compositions are keyed by bundle key,
  composition id, and input props, but their lifetime is still tied to the
  bundle `serveUrl`. Parallel rendering needs cache mutation and eviction to be
  concurrency-safe with the bundle lifecycle.
- Project render lock: `withProjectRenderLock` remains required for draft,
  full, stills, and thumbnail jobs. Any future parallel path must keep the
  in-process and file lock semantics for the same project, and must explicitly
  decide whether different projects may render concurrently in one process.
- Thumbnail/stills lock behavior: `renderProjectStillsUnlocked` writes a
  temporary no-audio locked spec to the normal project lock path, and
  `renderThumbnail` snapshots/restores that path around the private stills call.
  Parallel rendering cannot bypass the public `renderThumbnail`/
  `renderProjectStills` wrappers or another job could observe the temporary
  no-audio lock.

## Cross-Project Parallelism Design Gate

Before enabling cross-project render parallelism, approve a design that covers
these minimum points:

- Bundle lifetime: `prepareComposition` or an adjacent wrapper needs a
  per-render bundle lease/release boundary, or an equivalent reference-counted
  bundle cache. Eviction must never remove a bundle directory while an active
  render still owns its `serveUrl`.
- Composition cache lifetime: selected composition entries must be scoped to an
  active bundle lease or evicted only after the owning bundle is inactive.
- Concurrency policy: same-project rendering stays serialized by
  `withProjectRenderLock`; any replacement for the current process FIFO must
  declare a global process limit, queue/cancel behavior, and UI progress routing.
- Stale lock policy: keep the current stale/dead-pid lock recovery semantics
  unless a focused change updates `PROJECT_RENDER_LOCK_STALE_MS` with tests.
- Crash cleanup: orphaned bundle/temp directories may be removed by startup or
  idle cleanup only when they are old enough and not leased; project locks still
  recover through the existing stale/dead-pid path.
- Verification: add focused tests around bundle lease eviction,
  project-lock serialization, cache pruning, and at least one render-path smoke
  before enabling parallel desktop workflows. The existing UI Queue is serial
  and is not authorization to remove the gate.

## Cache Pruning Policy

Shared render and TTS caches under `.video-tool/cache/` are capped by size and
pruned oldest mtime first. This is intentionally age-based pruning, not true
LRU: cache hits copy the cached artifact back to the project but do not refresh
the cached file mtime. Keep docs and tests using "oldest mtime" or "age-based"
wording unless a later owner-approved cache design changes hit behavior and
adds focused tests for refreshed cache entries staying warm.

Renderer CSS is split by surface. `apps/desktop/src/renderer/theme.css` is the
stable import entry and section inventory; domain/layer partials live under
`apps/desktop/src/renderer/theme/`. Do not put new rules back into the entry
file. Add them to the owning partial, or add a new partial only when it
represents a real UI domain or layer. Stable renderer shell/review/empty-state
layout belongs in these CSS partials; keep runtime values such as dynamic media
backgrounds, selected-scene borders, and progress width inline in the owning
TSX.

The internal `createTools` facade is pipeline-owned.
The root `.mcp.json` is local-only and ignored. Keep `.mcp.example.json` as a
template without absolute machine paths; do not reintroduce a repo-provided
MCP server without a focused owner-approved slice.

## Duration Targets

For short-form delivery format, duration tiers (45s / 90s / 150s / 210s), and duration resolution order, see [`architecture.md#delivery-format-short-form-only`](architecture.md#delivery-format-short-form-only).

## Authoring Output Size

Fresh authoring should stay bounded before the first draft. The current budget is
one content-plan call, at most one repair call when every blocker is
`claim-ledger` or `claim-provenance`, and then either one single authoring reply
plus at most one missing-TSX recovery, or compact TSX batch calls only when a
no-image plan exceeds the normal single-reply capacity. Single-reply holds through
**16** components; the compact batch path (two component ids per batch, max 10
batches) covers **17–20** components and rejects above **20**. Content-plan pacing
`maxScenes` is currently ≤16 for all tiers, so live plans usually stay on the
single path; batch/too-large remain unit-tested headroom in
`author-batch-policy.ts`. Keep changes there focused and tested. Do not add
unbounded retries, extra manifest-only model calls, or provider `max_tokens`
overrides without a new owner-approved slice and tests.

Content-plan metadata that is not safety-critical should not hard-fail authoring
by itself. Purpose drift and missing/generic `motionProgression` are normalized
with diagnostics so their frequency remains observable. Duplicate ids, invalid
JSON shape, unsafe authored code, and render integrity failures remain hard
blockers. Claim-ledger / claim-provenance start as quality blockers; on
URL-grounded claim-only failures the runner may one-shot AI-repair then always
runs deterministic recovery (`content-plan-claim-policy.ts`): demote unusable
`source_material` (including when readable sources is `[]`), and soften residual
claim-ledger to advisory only when no other hard blockers remain. Never invent
excerpts. Text-only plans do not demote or soften.

On URL-grounded runs (`researchSources` provided, including empty), a usable
`source_material` claim must carry a known source id and a bounded excerpt that
matches normalized source text — or it is demoted to omit/uncertain. `user_brief`
and `common_knowledge` claims must not carry source references. If every URL is
unreadable, authoring may continue after demote without validated URL evidence;
source references are not manufactured. New authoring writes `evidence.json`
only after staged admission succeeds and promote commits, and never persists raw
research bodies there.

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
  currently `purpose`, missing/generic `motionProgression`, tolerant `sourceRef`
  shape coercion, and defaulting missing `evidenceClaimIds` to `[]`. Duplicate
  ids and schema-critical enum drift stay hard. Claim-ledger / provenance stay
  quality-gated; URL-grounded demote/soften is the documented recovery in
  `content-plan-claim-policy.ts`, not silent inventing of evidence.
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

## Reserved Compatibility Surfaces

Do not delete these during hygiene unless the owner explicitly opens a migration:

- `NewsVideo` — legacy Remotion composition id for old saves; new work uses
  `MotionRealVideo`.
- `news-studio-settings.json` — pre-rename settings filename (read-compat only);
  new writes use `motionreal-settings.json`.

Scene `sfx` / `audio/sfx.ts` and theme `mood` were removed as unused (never mixed
into render audio; mood never drove palette). Old manifests that still carry
those keys are stripped on parse and not re-emitted.

## Known Residual Risks

Accepted production residuals (not drive-by “fix” tasks, not an open backlog):

- Compact TSX batch authoring (no-image plans above the single-reply capacity)
  remains the higher-risk path versus normal single-reply authoring.
- Reauthor/refine can still hit one-off N4 syntax failures on a single scene;
  pipeline recovery or retry may continue, but that noise is not eliminated.
- URL/RAG ingest can fail with HTTP errors (for example 401). Unreadable-link
  fallback may still produce a draft, but cannot supply validated URL evidence;
  that is resilience, not proof that source reading succeeded.
- Provider smoke evidence is still thinner than a full multi-model canary set.
  Local typecheck/test/build green does not replace provider-connected checks
  after prompt or recovery changes.
- Cross-project render parallelism and true LRU cache hits remain out of scope
  until an owner-approved design lands (see render/cache sections above).

## Image Crawl Defaults

URL/image creation currently defaults to AI preselection plus human review. That
keeps crawled images useful while still making the user approve media before
authoring. Changing `imageCrawlAiFilter` or `imageCrawlHumanReview` defaults is
a product/cost/UX decision, not a cleanup task.

### Crawl reliability (timeout + report)

- Page/image fetches support **timeout** (~15s page / ~10s image) and
  **AbortSignal** so cancel can stop hung downloads.
- Structured log: `"article image crawl report"` (per URL). Example:
  `rg "article image crawl report" path\to\app.log`
- Lazy CMS photos: prefer `data-src` (and similar) over placeholder `data:` GIF
  `src` so body images are not dropped when only the lead `og:image` would remain.
- Site-specific rank/demote / per-domain hardcoding is **not** in scope; soft AI
  filter + human review remain the product gates for relevance.

## Dev/Test TTS Modes

`mock` and `none` are explicit CLI/dev/offline TTS modes. Desktop production
uses real configured providers (`vivibe` or `elevenlabs`) and must block on
missing credentials instead of silently falling back to `mock`, `none`, or a
different provider. The Settings voice test is explicit, synthesizes one short
real sample, caps its file at 1 MiB, and removes its temporary output. It is not
an automatic preflight and may consume a small amount of provider credit.

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

## Workspace Stages And Authoring Failure Logs

Observability only — does not change hard safety gates, retry budgets, or TTS
fallback rules.

### Workspace stage transitions

`WorkspaceController.setStage` logs kind/phase changes as:

```text
scope=workspace message="workspace stage transition"
fields: projectId, from, to
```

Fingerprints ignore render `percent` so draft progress ticks stay quiet. Useful
shapes:

| Fingerprint | Meaning |
| --- | --- |
| `none` | first stage for a project |
| `writing:crawl` / `writing:image-filter` / `writing:author` | create/author path |
| `image-review` | user confirms crawled images |
| `script` | optional script gate |
| `rendering:prepare` / `rendering:draft` / `rendering:full` / `rendering:qa:N/M` | render/refine |
| `ready` / `published` / `error:draft` | terminal review states |

UI phase copy lives in `apps/desktop/src/shared/stage-labels.ts` (renderer-safe).
Fingerprint helpers live in `apps/desktop/src/main/workspace/workspace-stage.ts`.

### Authoring failure classes

Authoring fail logs keep their legacy message strings for continuity and add a
`failureClass` field (`apps/desktop/src/main/authoring/authoring-failure.ts`).

| failureClass | Typical message anchor |
| --- | --- |
| `content-plan-parse` | `content-plan parse failed` |
| `content-plan-repair` | `content-plan repair parse failed` |
| `content-plan-quality` | `content-plan blocking quality checks failed` |
| `content-plan-provider` | `AI content-plan call failed` |
| `author-reply-parse` | `author-reply parse failed` |
| `author-reply-provider` | `AI call failed` (main author chat throw) |
| `author-batch-parse` | `authoring batch parse failed` |
| `author-batch-provider` | `AI authoring batch call failed` |
| `missing-tsx-recovery` | missing-TSX recovery parse **or** chat throw |
| `admission` | `admission failed` (+ `violationCounts`) |
| `reauthor-parse` | `[reauthor] parse failed` |
| `reauthor-provider` | `[reauthor] AI call failed` |
| `image-filter-parse` / `image-filter-provider` | soft warn, non-blocking |
| `visual-qa-parse` | soft warn, non-blocking |
| `visual-qa-provider` | soft warn, vision call failed / skip QA |

Example filters:

```powershell
# Stage path for one project
rg "workspace stage transition" path\to\app.log

# All typed authoring failures
rg "failureClass" path\to\app.log
```

## Comment Hygiene

When renaming or cleaning comments only:

- Edit by allowlist / file, not a repo-wide string rewrite.
- Never strip empty `()` or collapse indentation across whole files; that
  corrupts code and JSDoc (for example `res.text().catch` or `staticFile()`).
- Prefer product stage names over plan labels: article image crawl, AI image
  preselection, crawled-image review (user confirm only).
- After comment-only edits: `git diff` must show comment/docs lines only, then
  `npm.cmd run typecheck`. Run focused tests if `describe`/`it` titles changed.

## Architecture Cross-References

The following system invariants and boundary contracts are maintained canonically in [`architecture.md`](architecture.md):
- **Outbound URL Fetch (SSRF / DNS Pinning):** See [`architecture.md#url-ingest-egress`](architecture.md#url-ingest-egress).
- **Fresh-Author Candidate Transactions:** See [`architecture.md#fresh-author-candidate-transaction`](architecture.md#fresh-author-candidate-transaction).
- **Source Context Budgets (max 5 URLs, 40k chars/source):** See [`architecture.md#research-context-url-grounded-authoring`](architecture.md#research-context-url-grounded-authoring).
- **Workspace Restart Recovery:** See [`architecture.md#workspace-restart-recovery`](architecture.md#workspace-restart-recovery).
- **Media Protocol Boundary (`media://` scheme allow-list):** See [`architecture.md#media-protocol-boundary`](architecture.md#media-protocol-boundary).

## Repository Hygiene

Prefer descriptive, domain-owned paths over loose root files:

- root: project metadata and compatibility entry points only;
- `apps/desktop/assets/<domain>/`: bundled desktop assets shipped with the app;
- `VIDEO_TOOL_HOME/.video-tool/<domain>/`: generated runtime state and user-added
  media;
- `docs/current/`: durable documentation only;
- avoid long-lived `docs/working/`; if a short mid-task note exists,
  sync outcomes into `docs/current/` or `AI_CONTRACT.md` and **delete** the note
  in the same cleanup. Agents must not implement from working notes.

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
  AI_CONTRACT.md README.md docs/current apps packages scripts `
  --glob '!**/node_modules/**' `
  --glob '!.video-tool/**' `
  --glob '!**/dist/**' `
  --glob '!apps/desktop/dist-electron/**' `
  --glob '!**/vendor-fonts.generated.ts' `
  --glob '!**/*.test.ts' `
  --glob '!**/*.test.tsx' `
  --glob '!packages/pipeline/src/authoring/__fixtures__/**' `
  --glob '!packages/pipeline/src/safety/__fixtures__/**'
```

Bundled media should not be copied into runtime libraries just to make it
selectable. Prefer virtual built-in entries that point to their app asset, while
user-added media is copied into the canonical `.video-tool` library.
