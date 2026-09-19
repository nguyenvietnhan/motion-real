# Architecture

MotionReal is an npm workspace monorepo. The main rule is that rendering and
authoring run through one process and one shared `@motionreal/compositions` registry
instance.

## Packages

| Package | Role |
| --- | --- |
| `@motionreal/schema` | Renderer-agnostic specs, locked specs, timing constants, short-form 9:16 geometry, caption cues, validation helpers. |
| `@motionreal/theme` | One neutral runtime theme used by render internals. It is not authored-facing. |
| `@motionreal/blocks` | Small render-runtime surface: captions, scene timing, runtime motion hooks, diagnostic layout probe, fonts, minimal chrome helpers, and `SceneImage`. Authored scenes do not import this package. |
| `@motionreal/compositions` | Registry, master `VideoComposition`, `ThumbnailComposition`, and the authored-facing re-export of `SceneImage`. |
| `@motionreal/tts` | Vivibe/LucyLab and ElevenLabs clients, audio measurement, concat/mix helpers, SRT/timestamp support. |
| `@motionreal/pipeline` | Authoring/admission, manifest conversion, ingest, TTS orchestration, lock, render, cache, review, safety grid, store, CLI, and the in-process `createTools` facade. |
| `apps/remotion` | Remotion root and sample fixtures. |
| `apps/desktop` | Electron app: create flow, workspace stages, settings, external 9router-compatible gateway (localhost:20128), hidden refine, BGM, thumbnail, export. |

## Desktop Main Internals

`apps/desktop/src/main/index.ts` remains the Electron composition root. It owns
process-wide startup side effects, settings construction, gateway/backend/worker
wiring, controller construction, IPC router registration, and Electron app
lifecycle hooks.

Local desktop-main seams now carry behavior that is narrow enough to test
directly:

- `security/runtime-env.ts` parses `.env` text and resolves boot voice env
  precedence. `runtime-security.ts` still owns non-sensitive env application and
  secret scrubbing.
- `create/image-staging.ts` owns create-time picked/dropped image staging,
  unstage, and stale staging cleanup. Project asset promotion stays with the
  create-controller dependency wiring.
- `bgm/bgm-handlers.ts` owns BGM view-model/list behavior and the contained BGM
  IPC handler group. The native picker adapter stays in `index.ts`.
- `settings/settings-handlers.ts` owns the settings/TTS IPC handler group while
  `index.ts` keeps the `SettingsStore` construction and voice-provider parser
  wiring explicit.
- `thumbnail/thumbnail-handlers.ts` owns the thumbnail IPC handler group while
  thumbnail generation stays with `WorkspaceController` and thumbnail export
  stays with `export/native-save.ts`.
- `export/native-save.ts` owns video/thumbnail save helper behavior. The
  Electron dialog/window adapter stays in `index.ts`.
- `create/create-ipc.ts` owns `projects:create` payload coercion and voice
  provider validation while `CreateController.create(...)` stays root-owned.
- `queue/queue-store.ts` persists version-1 queue containers/jobs (including
  optional normalized staging-image refs) in `VIDEO_TOOL_HOME/queues.json`;
  `queue-runner.ts` drains jobs and schedules containers FIFO.
- Startup order in `index.ts`: stale-state reconciliation completes before
  gateway/window startup. Media scheme/protocol registration and app lifecycle
  hooks stay in `index.ts`.
- `gateway/gateway-handlers.ts` owns the `ai:*` IPC handler group and the
  desktop-side selected-model mirror used by authoring. `ModelGatewayManager`
  construction and `startGateway` stay root-owned.
- The user's generation-model preference is persisted as
  `SettingsModel.preferredAiModelId` (public settings JSON only). Runtime
  `AiAccountState.selectedModel` stays process-memory; the renderer restores
  the saved id after settings load, and does not silently pick another model
  when the saved id is missing from the gateway list.

**Composition-root charter (`index.ts` must own):** process boot (media scheme,
env scrub, privilege gate); construction order (settings → tools → gateway →
authoring → worker → workspace → create); engine seam injection into controllers;
spreading handler factories into `InvokeHandlers` + `registerIpcRouter`; Electron
lifecycle (whenReady, window, activate, quit); native dialog adapters passed into
factories.

**Do not invent extractions for line count:** keep `index.ts` composition-root
ownership as listed above. Projects/script/review IPC maps are already thin
delegates. Avoid a second “app shell” godfile or a broad `createDesktopApp()`
that hides startup order.

## Desktop Renderer UI

The renderer stylesheet entry is `apps/desktop/src/renderer/theme.css`. It is a
stable import map plus section inventory only; domain CSS lives under
`apps/desktop/src/renderer/theme/`:

- `base.css` for tokens, fonts, resets, focus, scrollbars, and native controls.
- `shell.css` for app shell, sidebar, nav, and account affordances.
- `components.css` for shared buttons, cards, inputs, and numeric controls.
- `home-create.css` and `create-layout.css` for the create/home experience,
  kept separate to preserve the original cascade order.
- `settings.css`, `projects.css`, `queue.css`, `agent.css`, workspace partials
  (`workspace-script.css`, `workspace-stages.css`, `workspace-storyboard.css`),
  and `publish.css` for their matching app surfaces.
- `custom-select.css` for custom dropdowns and final native-control polish.

Keep `theme.css` as the only renderer CSS import from TypeScript. New renderer
styles should land in the owning partial, and import order changes should be
treated as visual behavior changes because they can alter cascade priority.

## Media Pipeline Internals

`@motionreal/tts` keeps its public surface in `packages/tts/src/index.ts`, but
implementation is split by media responsibility:

- `caption-timing.ts` owns ElevenLabs alignment-to-SRT timing helpers.
- `vivibe-client.ts` and `elevenlabs-client.ts` own provider clients and
  provider-specific configuration helpers.
- `provider-error.ts` maps provider HTTP/RPC responses into the shared safe
  voice-failure vocabulary; pipeline/workspace/Queue never parse vendor text.
- `client-factory.ts` is the single provider-to-client switch reused by
  production narration and the explicit Settings voice test.
- `provider-http.ts` owns shared provider HTTP retry, download, and response
  normalization helpers.
- `audio-ops.ts` owns duration measurement, mock WAV generation, concat,
  breath-gap concat, duration normalization, BGM mix, and ffmpeg/ffprobe process
  execution.

`packages/pipeline/src/render/renderer.ts` remains the render primitive surface:
video render, scene stills, runtime probe, and determinism
frames. Bundle/composition preparation now lives in
`render/composition-prep.ts`, including Remotion root helpers, timing
instrumentation, bundle/composition cache, public-dir inference, static-audio
validation, and the workspace webpack override. `renderer.ts` re-exports the old
public helpers so callers keep importing from the same surface.

Render/cache scaling is enforced as one cache-sensitive workflow per desktop
main process. `WorkspaceController` owns a process-wide FIFO gate used by
author, render, edit, publish, and thumbnail work across every project; Queue
and Home share this controller. `withProjectRenderLock` remains the same-project
filesystem/in-process boundary. The bundle/composition caches still have no
active render leases, so cross-project parallel execution must not bypass the
gate without an accepted cache-lifetime design and focused verification.

## Desktop Workspace Internals

The workspace controller has been split only along narrow local seams:

- `workspace-helpers.ts` owns pure status, intent, and link-warning helpers.
- `workspace-stage.ts` owns stage fingerprints, kind-transition policy, and
  “should log transition” (percent ticks are ignored so draft progress stays quiet).
- `workspace-view-model.ts` owns pure ready/published/script/storyboard shaping
  and full-render start/error stage helpers.
- `workspace-create-flow.ts` owns create/crawl/image-review helpers and the
  callback-driven create runner.
- `workspace-script-flow.ts` owns script-gate, manifest-edit, and script
  authoring runner helpers.
- `workspace-render-flow.ts` owns pure render/refine prompt and progress helpers.
- `workspace-refine-flow.ts` owns silent pre-draft and edit-path vision refine
  (vision passes, accept-gate, restore-to-prior-draft) via callbacks.

Renderer-safe Vietnamese stage/phase copy lives in
`apps/desktop/src/shared/stage-labels.ts` (not under `main/`).

`workspace-controller.ts` still owns orchestration: live stage maps, in-flight
jobs, cancellation, retry, snapshot/restore, async render/refine/publish
ordering, publish state, and event emission. `setStage` is the single place that
emits structured `workspace stage transition` logs (`from` / `to` fingerprints).

## Desktop Workflow

The Electron app is the main user-facing workflow: create, gallery, settings,
gateway connection, image review, optional script review, hidden stills/refine,
draft review, full-render approval, BGM, thumbnail, and export. Workspace stage
kind/phase transitions are logged at `WorkspaceController.setStage` (see
`docs/current/maintenance.md`).

The Queue tab is the unattended path. Containers and jobs persist in
`VIDEO_TOOL_HOME/queues.json` (schema version 1), including FIFO Start intent
and global pause state. Startup restores that schedule after project
reconciliation when Full auto remains valid. Interrupted jobs retain
`projectId`; artifact recovery resumes the existing project and creates a new
one only when the old project folder is confirmed missing. A structured TTS
failure pauses the whole chain until an explicit Resume. Start requires the
shared Full auto preset (`skip_edit`, script gate off, crawled-image human
review off). Queue jobs, Home spillover jobs, direct project actions, and
thumbnails all enter the same process-wide FIFO gate. Optional staging-image
refs persist on non-done jobs; the staging sweep protects refs held by queued,
running, failed, or cancelled jobs and releases them after completion/deletion.

Classic Home/Create/Queue AI does not read repository docs directly. For fresh
Classic authoring, the desktop backend first asks the selected 9router-compatible
model for a structured content plan with a claim ledger, validates that plan,
and then sends it to scene-code authoring. Fresh plans choose one dominant
presentation profile by viewer task. The code author sees the approved plan and
only that selected full direction—not the routing menu or six alternatives—and
owns concrete focal objects, composition and visible states. Legacy plans
without the field keep the aggregate contract.
Classic edit/refine flows use
scoped repair prompts instead of rerunning the full fresh-authoring chain.

Agent-created projects persist `creationMode: "harness"`. They reuse the same
project scaffold, profile-selected authoring contract, admission/render tools, Workspace stages,
human review, TTS, captions, and full export, but their linked DeepSeek Harness
Session writes `manifest.json` and `authored/*.tsx` directly through a project
junction. Initial Harness authoring is final-quality: it reads the approved
source assets, writes the normal scene modules, and reaches still review through
the configured visual-refine passes. Rendered stills reach the model only for
visual refine or a user-requested visual edit, never as a mandatory first-pass
rewrite. Structured content-plan motion beats are carried canonically into the
manifest and resolved by `lockSpec()` into scene-local cue frames from existing
caption/TTS timing. Visual refine derives deterministic evidence from
`temporalMode` and `detailMode`: overview sheets cover every scoped scene,
cue-aware filmstrips cover stepped/continuous scenes, and a full-resolution
detail frame is added only for fine-detail scenes. Critical wipe, clock-wipe,
and zoom boundaries get a three-panel transition sheet. This remains bounded
temporal sampling, not complete frame-by-frame motion QA. Human edit
requests return to that same Session; Classic projects continue through the existing
`WorkspaceController.submitEdits` path.

`apps/desktop/src/main/authoring/ninerouter-backend.ts` is the public desktop
authoring facade (`AuthoringBackend`). It keeps deps construction, `authorScenes`
orchestration (ingest → plan → author reply → write → admit), runner/vision/
render wiring, and file write/admission. New AI capabilities should land as
runners or helpers; do not thin the facade only for line count, and do not extract
the full `authorScenes` spine without a dedicated orchestration test harness.

Focused modules own bounded workflows:

- `content-plan-runner.ts` owns content-plan call, parse, quality check, optional
  one-shot claim repair when every blocker is `claim-ledger` or
  `claim-provenance`, then deterministic finalize for URL-grounded runs.
- `content-plan-provenance.ts` owns the single provenance verdict shared by
  quality evaluation and demote recovery.
- `content-plan-claim-policy.ts` owns demote of unusable `source_material` and
  residual claim-ledger soften (never invents excerpts).
- `author-reply-runner.ts` owns single-reply authoring, compact TSX batches, and
  missing-TSX recovery.
- `author-batch-policy.ts` owns the no-image compact batching threshold and
  safety budget used before `author-reply-runner.ts` is called.
- `reauthor-runner.ts` owns per-scene repair retry, parse, fake-fix guard, and
  rollback policy.
- `image-filter-runner.ts` and `article-image-crawler-runner.ts` own best-effort
  crawled-image preselection and crawling. The backend still supplies the
  SSRF-safe fetcher (timeout + AbortSignal) and image data-URL staging. Crawl
  emits structured `"article image crawl report"` logs; extract prefers CMS lazy
  attrs (`data-src`, etc.) over placeholder `src`. Relevance gates stay AI
  filter + human review — not site-specific rank tables.
- `visual-qa-runner.ts` owns visual layout QA parse/call plus authored scene
  snapshot/restore (full multimodal chat; no vision text-only fallback).
- `author-manifest-convert.ts` owns pure AuthorManifest → engine Manifest
  conversion and admission violation check counts.
- `authoring-vision-chat.ts` owns per-session image-capability cache and
  chat-with-vision-fallback policy used by plan/author/reauthor/filter.
- `authoring-render-tools.ts` owns draft/stills/full/safety-report adapters.
- `authoring-failure.ts` is the shared `failureClass` emitter for structured
  authoring fail logs (preserves legacy message strings for continuity).
- `scene-mentions.ts` (in `packages/pipeline/src/authoring`) is the pure shared helper
  for diacritic- and case-tolerant Vietnamese scene-id mention matching, used by both
  the Harness submission tool (in-turn validation) and Main-process review notes backstop.

The public `content-plan.ts` module stays as the import facade for content-plan
types and helpers. Internals are split into schema/types, normalization,
parser, quality, prompt-builder, provenance verdict, and claim-policy recovery
so policy changes stay local and testable.

URL/image workflows currently default to AI image preselection plus blocking
human review. Keep that default unless product explicitly accepts the cost,
latency, and UX change.

Fresh authoring has bounded stabilization before admission. When every content-
plan blocker is `claim-ledger` or `claim-provenance`, the runner may make one
repair call, then (on URL-grounded runs, including zero readable sources)
always runs deterministic finalize: demote unusable `source_material` claims and,
if only claim-ledger remains blocking, soften that ledger to advisory without
inventing evidence. Text-only runs (no `researchSources`) never demote or soften.
Content-plan purpose drift and missing/generic motion intent are normalized with
diagnostics, because they are metadata guidance rather than safety blockers.
Normal no-image plans up to the single-reply capacity use one authoring reply,
where a valid manifest with missing TSX modules may get one targeted
missing-module recovery call. Larger no-image plans use a deterministic manifest
plus compact TSX batches of at most two component ids, capped at 20 components
total; plans beyond that budget fail instead of looping. Image-placement plans
keep the single-reply authoring path. None of these paths accept partial output
or weaken admission, N10 typecheck, or render safety.

Before the user sees a first draft, the desktop flow may run a hidden sequence:

```text
author initial TSX/manifest
-> render stills when visual refine is enabled
-> visual QA/refine passes, re-rendering only scenes that change
-> render draft MP4
```

Those intermediate stills are hidden from the user. After review, edit flows
use scoped scene repair. Script review is optional (`scriptGateEnabled`).
Post-author human review is controlled by Settings `reviewMode`:

| Mode | Preview | Scene edit | Full export |
|------|---------|------------|-------------|
| `full` (default) | Draft MP4 (+ stills) | Yes | After approve; draft-first |
| `stills_edit` | Stills only | Yes | After approve; `forceFull` if no draft |
| `skip_edit` | No human review stop | No | Auto full after silent refine + stills; `forceFull` |

The Agent tab displays this effective mode next to project progress. Therefore
“no draft MP4” under `stills_edit` or `skip_edit` is a selected workflow, not a
render failure.

BGM is chosen on **Home create knobs** for Classic/Queue and on **Agent brief
approval** for Harness-owned projects. The accepted choice is written to the
project manifest before authoring so `skip_edit` auto-full and storyboard
approve both use it. The storyboard review UI does not re-offer a BGM picker.

Silent refine (`refinePasses`) is independent of `reviewMode` and still runs for
`stills_edit` / `skip_edit` before the stills (or full) handoff. Desktop publish
passes `forceFull` when no draft MP4 exists. CLI and in-process `createTools`
stay draft-first unless the caller sets forceFull. Deliberate cancellation
between stages is not treated as project failure.

## Data Flow

```text
Topic / URL / images
-> AI plans story beats and usable claims
-> validate content plan pacing/claims
-> optional one-shot claim repair (claim-ledger/provenance only)
-> URL-grounded: deterministic demote/soften finalize (no inventing evidence)
-> AI authors manifest + TSX in one reply,
   or deterministic manifest + compact TSX batches for larger no-image plans
-> optional one-shot missing-TSX module recovery on the single-reply path
-> optional hidden stills/refine in desktop
-> stage/admit/promote candidate (transactional)
-> admission gate (staged modules)
-> manifest -> VideoSpec
-> static safety grid
-> authored scene typecheck
-> TTS
-> lockSpec -> LockedVideoSpec
-> build safety grid
-> generated authored entry
-> strict N31 runtime probe
-> determinism guard
-> render draft MP4
-> still evidence for render oracles
-> render oracles
-> user review
-> approved full MP4
```

## State

Project state lives under `VIDEO_TOOL_HOME/.video-tool/projects/<id>/`.

Important files include:

- `brief.json`
- `manifest.json`
- `video-spec.json`
- `video-spec.lock.json`
- `video-spec.stills.lock.json` (temporary no-TTS still timeline; never replaces the canonical lock)
- `safety-report.json`
- `events.ndjson`
- `authored/*.tsx`
- `evidence.json` (optional script-review claim provenance from URL-grounded runs)
- `review/*.png`
- `renders/*.mp4`

Shared caches live under `VIDEO_TOOL_HOME/.video-tool/cache/`.

Shared user-added background music lives under
`VIDEO_TOOL_HOME/.video-tool/bgm/`. A project stores only the selected track
filename in its manifest. Bundled application media lives with the app, for
example `apps/desktop/assets/bgm/default.mp3`; the default BGM is exposed as a
virtual built-in track that resolves directly to this asset, not as a copied
runtime-library file. Root-level media assets should not be added.

Stills are the cheap visual pass: admit + separate no-TTS still lock + PNG
midpoints for human review. When model visual refine is enabled, the same render
preparation also creates model-facing composites under `review/evidence/`:
overview sheets (up to six scenes), cue/dense filmstrips, optional fine-detail
frames, and only critical transition sheets required by the review scope.
Intermediate cue frames are temporary and are not accumulated by revision.
These paths share the same composition/admission stack as production
stills but do **not** use the TTS-locked draft/full timeline, and are not
pixel-identical to H.264 frames. Draft MP4s are lower-quality previews that
follow the same TTS lock timing path as full renders (draft also uses lower
fps/scale/encode knobs). Ready-stage storyboard review can seek/highlight scenes
from the locked timeline (`video-spec.lock.json`) without estimating timing; a
missing lock keeps still-only review. Full MP4 output is the deliverable and
should run only after user approval. TTS provider and voice come from
project/user settings; missing credentials stop render instead of silently
falling back to another provider. `mock` and `none` are explicit CLI/dev/offline
TTS modes; the desktop production path must not select them as a hidden fallback.

## Repository Layout

Root files are reserved for project-wide metadata and entry points: package
metadata, TypeScript/Vitest config, `.env.example`, `README.md`, `LICENSE`,
`AI_CONTRACT.md`, `AGENTS.md`, and `.mcp.example.json` as the local tool config
template. Machine-specific `.mcp.json` files are local-only and ignored.

Use domain folders for content:

- bundled desktop assets: `apps/desktop/assets/<domain>/`;
- Remotion fixtures: `apps/remotion/src/fixtures/`;
- runtime/generated/user state: `VIDEO_TOOL_HOME/.video-tool/<domain>/`;

Do not add vendor-specific AI contract files or loose root media files. Shared
AI guidance belongs in `AI_CONTRACT.md` and `docs/current/`.

## URL ingest egress

Desktop URL/article-image fetches go through `@motionreal/pipeline` SSRF-safe
fetchers (`safe-fetch.ts` + `public-address.ts`). Each hop is DNS-resolved once,
classified with `net.BlockList`, and the undici transport is pinned to those
public addresses so a rebinding hostname cannot open a private socket after the
guard. When both A and AAAA are public, **dial prefers IPv4** so broken desktop
IPv6 routes do not hang image crawls. Redirects are followed manually and
re-pinned. Body size, timeout, and abort signals apply to both text and binary
paths. Responses are buffered before the per-request dispatcher closes.

Cloud TTS uses the same primitive with HTTPS-only policy. Authenticated API
requests reject every redirect; anonymous audio/SRT downloads can follow up to
five re-pinned redirects and discard credentials whenever origin changes. The
local VieNeu worker does not use this public-network transport.

## Delivery format (short-form only)

The product ships **TikTok/Reels/Shorts 9:16** only. Specs use `format: "tiktok"`
and `ratio: "9:16"`. Desktop create always uses short-form delivery; the Home
duration knobs pick `durationTier` **1 / 2 / 3 / 4** (~45s / ~90s / ~150s /
~210s pacing; fresh install defaults to **2** (~90s) and the most recently
accepted duration tier becomes the next UI default. There is no landscape /
YouTube format option.
Generic pipeline/API callers without an explicit duration tier or prompt length
fall back to tier **1** (~45s); desktop passes its tier-2 default explicitly.
Geometry, captions, and thumbnail cover are vertical short-form only.

**Duration resolution:** desktop **Settings/knobs always win**. An explicit
length in the prompt is ignored for pacing when a tier is set (conflicts are
logged only). `resolveEffectiveDuration` is the pure resolver; create wires
`AuthorInput.targetSeconds` from the selected tier. Content-plan quality also
blocks **under-budget** total narration (far below the target word count).
Harness-owned authoring receives the same decision as a machine-readable pacing
contract in `handoff/authoring-request.json`; MotionReal validates the authored
manifest against that contract before still render and stamps the approved tier
and language onto the manifest. A stale duration sentence inside the brief is
therefore not allowed to override the user's reviewed tier.

**N10 B-minimal (crash-only):** authored typecheck still runs, but **only**
unbound-name diagnostics (`TS2304` / “Cannot find name”) are emitted as hard
errors (they become `ReferenceError` under transpile-only bundling). Style /
CSSProperties excess, missing data fields, and other type noise are **dropped**
(not soft-warnings — no repair consumer). Expand the crash allowlist only with
a proven N31/ReferenceError fixture. RN style/fonts → normalizer; layout → vision.

**Authored normalizers (pre-write):** RN shadow/padding shorthands **only inside
CSS/JSX `style` objects** + brand font rewrite (`Inter` / `Be Vietnam Pro` /
`Cascadia Mono`) via `normalizeAuthoredSource`. Data objects may use names like
`elevation` without being treated as CSS.

## Research context (URL-grounded authoring)

Fresh desktop authoring collects sources via `research-context.ts`:

- At most **5** source URLs (first N in prompt order); extras are `skipped-limit`.
- Concurrent extract of **2**; in-memory `extractUrlContent` (planning files remain
  a CLI/tool path).
- Per-source / total retained char budgets (40k / 100k).
- Planner/repair receive **labeled untrusted** source blocks + `sourceRef` rules;
  code authoring receives the approved content plan and claim ledger only — never
  raw article bodies.
- Sanitized multi-link warnings may appear on script review (`sourceWarning`).

## Fresh-author candidate transaction

Canonical manifest/TSX/evidence are applied through
`author-candidate-transaction.ts`: stage under `.authoring-candidate/`, journal
`prepared`, admit **staged** files, **backup canonical**, journal `promoting`,
then promote, journal `committed`, cleanup. Failure/abort restores prior bytes
only when a usable backup exists (empty/missing backup never wipes good
canonical). Startup (and pre-author) reconciles stale journals.

## Cancellation

**Dừng tạo** on the writing stage aborts the workspace job signal. The signal is
threaded through script authoring, agent author, content-plan/author chat, and
candidate apply. Cancel recovers the prior reviewable stage (not an authoring
error toast). Delete aborts then awaits the in-flight task before removing
project state.

## Workspace restart recovery

`workspace-recovery.ts` decides stage from artifact health (nonzero regular
files), not “stills required for ready”:

1. healthy full MP4 → `published`;
2. healthy draft + nonempty manifest → `ready` (even with zero stills);
3. healthy draft + missing/unreadable manifest → `draft-recovery` (view-only);
4. nonempty manifest + stills, no draft → `ready`;
5. nonempty manifest, no draft/stills → `script`;
6. otherwise recoverable create error.

## Media protocol boundary

The desktop renderer loads local stills, draft/full MP4s, staged images, BGM, and
bundled assets only through the privileged `media://` scheme
(`apps/desktop/src/main/media-protocol.ts`).

- URLs are **route-relative** locators (`media://file/<kind>/…`), not absolute
  filesystem paths. The handler recomputes the physical path from an allow-listed
  kind plus relative segments.
- Allowed locations only: `projects/<id>/assets|review|renders/*`,
  `staging/*`, `bgm/*`, and `apps/desktop/assets/*` (bundled). Known media MIME
  extensions only; unknown extensions are denied (no `application/octet-stream`
  fallback).
- Client **cache-bust fragments** (`#rN` on stills) are ignored for lookup; query
  strings remain denied.
- Before streaming, the handler `realpath`s root and target, requires a regular
  file, and re-checks extension + containment (blocks junction/symlink escape).
- `toMedia` / `mediaUrl` return a safe media URL or empty/`null` — never a raw
  absolute path to the renderer. Settings, planning research, events, authored
  TSX, project JSON, and `audio/**` are not media roots.
- Range requests (`200` / `206` / `416`) remain supported for MP4 seeking.
- Scheme privileges do not set `bypassCSP`.

## Boundaries

- Authored scene code is admitted before render.
- The host never uses authored scene modules as general Node code.
- Authored scene imports are tightly whitelisted.
- The Remotion bundle imports the generated per-project authored entry.
- Desktop UI talks to the engine through typed IPC and pipeline-owned tool seams.

## Sensitive Areas

Avoid broad refactors in these areas without a focused plan and tests:

- `packages/pipeline/src/orchestrator.ts`
- `packages/pipeline/src/safety/render-grid.ts`
- `apps/desktop/src/main/workspace/workspace-controller.ts`
- `apps/desktop/src/main/authoring/ninerouter-backend.ts`
- `packages/pipeline/src/render/renderer.ts`
