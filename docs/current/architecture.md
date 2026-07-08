# Architecture

MotionReal is an npm workspace monorepo. The main rule is that rendering and
authoring run through one process and one shared `@motionreal/compositions` registry
instance.

## Packages

| Package | Role |
| --- | --- |
| `@motionreal/schema` | Renderer-agnostic specs, locked specs, timing constants, format geometry, caption cues, validation helpers. |
| `@motionreal/theme` | One neutral runtime theme used by render internals. It is not authored-facing. |
| `@motionreal/blocks` | Small render-runtime surface: captions, scene timing, runtime motion hooks, diagnostic layout probe, fonts, minimal chrome helpers, and `SceneImage`. Authored scenes do not import this package. |
| `@motionreal/compositions` | Registry, master `VideoComposition`, `ThumbnailComposition`, and the authored-facing re-export of `SceneImage`. |
| `@motionreal/tts` | Vivibe/LucyLab and ElevenLabs clients, audio measurement, concat/mix helpers, SRT/timestamp support. |
| `@motionreal/pipeline` | Authoring/admission, manifest conversion, ingest, TTS orchestration, lock, render, cache, review, safety grid, store, CLI, and the in-process `createTools` facade. |
| `apps/remotion` | Remotion root and sample fixtures. |
| `apps/desktop` | Electron app: create flow, workspace stages, settings, 9router gateway, hidden refine, BGM, thumbnail, export. |

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
- `startup-sequence.ts` keeps the tested ordering seam: stale-state
  reconciliation completes before gateway/window startup. Media scheme/protocol
  registration and app lifecycle hooks stay in `index.ts`.

Avoid creating a broad desktop handler builder or moving Electron lifecycle code
just to reduce line count; those pieces are clearer at the composition root
unless a future focused slice proves otherwise.

## Desktop Renderer UI

The renderer stylesheet entry is `apps/desktop/src/renderer/theme.css`. It is a
stable import map plus section inventory only; domain CSS lives under
`apps/desktop/src/renderer/theme/`:

- `base.css` for tokens, fonts, resets, focus, scrollbars, and native controls.
- `shell.css` for app shell, sidebar, nav, and account affordances.
- `components.css` for shared buttons, cards, inputs, and numeric controls.
- `home-create.css` and `create-layout.css` for the create/home experience,
  kept separate to preserve the original cascade order.
- `settings.css`, `projects.css`, `workspace.css`, and `publish.css` for their
  matching app surfaces.
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
- `provider-http.ts` owns shared provider HTTP retry, download, and response
  normalization helpers.
- `audio-ops.ts` owns duration measurement, mock WAV generation, concat,
  breath-gap concat, duration normalization, BGM mix, and ffmpeg/ffprobe process
  execution.

`packages/pipeline/src/render/renderer.ts` remains the render primitive surface:
video render, scene stills, runtime probe, layout measurement, and determinism
frames. Bundle/composition preparation now lives in
`render/composition-prep.ts`, including Remotion root helpers, timing
instrumentation, bundle/composition cache, public-dir inference, static-audio
validation, and the workspace webpack override. `renderer.ts` re-exports the old
public helpers so callers keep importing from the same surface.

Render/cache scaling is currently a single-workflow process assumption. The
same-project boundary is enforced by `withProjectRenderLock`, while the
bundle/composition caches are small in-memory eviction caches without active
render leases. Cross-project render parallelism needs an accepted cache lifetime
design before any UI or queue work enables it; that design must cover bundle
leases/ref counts, composition-cache lifetime, concurrency limits, stale-lock
recovery, crash cleanup, and focused render-path verification.

## Desktop Workspace Internals

The workspace controller has been split only along narrow local seams:

- `workspace-helpers.ts` owns pure status, intent, and link-warning helpers.
- `workspace-view-model.ts` owns pure ready/published/script/storyboard shaping.
- `workspace-create-flow.ts` owns create/crawl/image-review helpers and the
  callback-driven create runner.
- `workspace-script-flow.ts` owns script-gate, manifest-edit, and script
  authoring runner helpers.
- `workspace-render-flow.ts` owns pure render/refine prompt and progress helpers.

`workspace-controller.ts` still owns orchestration: live stage maps, in-flight
jobs, cancellation, retry, snapshot/restore, async render/refine/publish
ordering, publish state, and event emission.

## Desktop Workflow

The Electron app is the main user-facing workflow: create, gallery, settings,
gateway connection, image review, optional script review, hidden stills/refine,
draft review, full-render approval, BGM, thumbnail, and export.

Runtime AI does not read repository docs directly. For fresh authoring, the
desktop backend first asks the selected 9router-compatible model for a structured
content plan with a claim ledger, then validates that plan and feeds only usable
facts and scene-plan data into the scene-code authoring prompt built from the
current authoring contract. Edit/refine flows use scoped repair prompts instead
of rerunning the full fresh-authoring chain.

`apps/desktop/src/main/authoring/ninerouter-backend.ts` is the public desktop
authoring facade. It keeps provider wiring, image-capability cache, project
paths, file writing/admission, and the `AuthoringBackend` contract, while focused
runner modules own bounded model-call workflows:

- `content-plan-runner.ts` owns content-plan call, parse, quality check, and
  one-shot claim-ledger repair.
- `author-reply-runner.ts` owns single-reply authoring, compact TSX batches, and
  missing-TSX recovery.
- `author-batch-policy.ts` owns the no-image compact batching threshold and
  safety budget used before `author-reply-runner.ts` is called.
- `reauthor-runner.ts` owns per-scene repair retry, parse, fake-fix guard, and
  rollback policy.
- `image-filter-runner.ts` and `article-image-crawler-runner.ts` own best-effort
  crawled-image preselection and crawling. The backend still supplies the
  SSRF-safe fetcher, chat fallback, and image-capability cache.

The public `content-plan.ts` module stays as the import facade for content-plan
types and helpers. Its internals are split into schema/types, normalization,
parser, quality, and prompt-builder modules so policy changes stay local and
testable.

URL/image workflows currently default to AI image preselection plus blocking
human review. Keep that default unless product explicitly accepts the cost,
latency, and UX change.

Fresh authoring has bounded stabilization before admission. A claim-ledger-only
content-plan failure may get one repair call. Content-plan purpose drift and
missing/generic motion intent are normalized with diagnostics, because they are
metadata guidance rather than safety blockers. Normal no-image plans up to the
single-reply capacity use one authoring reply, where a valid manifest with
missing TSX modules may get one targeted missing-module recovery call. Larger
no-image plans use a deterministic manifest plus compact TSX batches of at most
two component ids, capped at 16 components total; plans beyond that budget fail
instead of looping. Image-placement plans keep the single-reply authoring path.
None of these paths accept partial output or weaken admission, N10 typecheck, or
render safety.

Before the user sees a first draft, the desktop flow may run a hidden sequence:

```text
author initial TSX/manifest
-> render stills
-> creative bootstrap pass
-> render stills again
-> visual QA/refine passes
-> render draft MP4
```

Those rough intermediate stills are hidden from the user. After draft review,
edit flows skip broad creative bootstrap and use scoped scene repair. Script
review is optional; draft review is mandatory before full render. Deliberate
cancellation between stages is not treated as project failure.

## Data Flow

```text
Topic / URL / images
-> AI plans story beats and usable claims
-> validate content plan pacing/claims
-> optional one-shot claim-ledger repair
-> AI authors manifest + TSX in one reply,
   or deterministic manifest + compact TSX batches for larger no-image plans
-> optional one-shot missing-TSX module recovery on the single-reply path
-> optional hidden stills/refine in desktop
-> admission gate
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
-> review stills/contact sheet
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
- `safety-report.json`
- `events.ndjson`
- `authored/*.tsx`
- `review/*.png`
- `renders/*.mp4`

Shared caches live under `VIDEO_TOOL_HOME/.video-tool/cache/`.

Shared user-added background music lives under
`VIDEO_TOOL_HOME/.video-tool/bgm/`. A project stores only the selected track
filename in its manifest. Bundled application media lives with the app, for
example `apps/desktop/assets/bgm/default.mp3`; the default BGM is exposed as a
virtual built-in track that resolves directly to this asset, not as a copied
runtime-library file. Root-level media assets should not be added.

Stills are the cheap visual pass. Draft MP4s are lower quality previews that
follow the same timing path as full renders. Full MP4 output is the deliverable
and should run only after user approval. TTS provider and voice come from
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
