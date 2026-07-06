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

Fresh authoring has bounded stabilization before admission. A claim-ledger-only
content-plan failure may get one repair call. Long no-image plans are authored
from a deterministic manifest in TSX batches of at most four component ids, with
at most four batches; plans beyond that budget fail instead of looping. Short
plans and image-placement plans keep the single-reply authoring path, where a
valid manifest with missing TSX modules may get one targeted missing-module
recovery call. None of these paths accept partial output or weaken admission,
N10 typecheck, or render safety.

Before the user sees a first draft, the desktop flow may run a hidden sequence:

```text
author blind draft
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
   or deterministic manifest + bounded TSX batches for long no-image plans
-> optional one-shot missing-TSX module recovery on the single-reply path
-> optional hidden stills/refine in desktop
-> admission gate
-> manifest -> VideoSpec
-> static safety grid
-> TTS
-> lockSpec -> LockedVideoSpec
-> build safety grid
-> authored scene typecheck
-> strict N31 runtime probe
-> determinism guard
-> Remotion render stills
-> draft MP4
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
falling back to another provider.

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
