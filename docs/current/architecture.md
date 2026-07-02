# Architecture

MotionReal is an npm workspace monorepo. The main rule is that rendering and
authoring run through one process and one shared `@news/compositions` registry
instance.

## Packages

| Package | Role |
| --- | --- |
| `@news/schema` | Renderer-agnostic specs, locked specs, timing constants, format geometry, caption cues, validation helpers. |
| `@news/theme` | One neutral runtime theme used by render internals. It is not authored-facing. |
| `@news/blocks` | Render runtime internals: captions, scene timing, motion helpers, layout probe, fonts, chrome helpers, and `SceneImage`. Authored scenes do not import this package. |
| `@news/compositions` | Registry, master `VideoComposition`, `ThumbnailComposition`, and the authored-facing re-export of `SceneImage`. |
| `@news/tts` | Vivibe/LucyLab and ElevenLabs clients, audio measurement, concat/mix helpers, SRT/timestamp support. |
| `@news/pipeline` | Authoring/admission, manifest conversion, ingest, TTS orchestration, lock, render, cache, review, safety grid, store, CLI. |
| `@news/mcp` | MCP tools over the pipeline. Desktop currently also uses its `createTools` facade in-process; the external stdio server is a separate cleanup candidate. |
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

## Data Flow

```text
Topic / URL / images
-> AI authors .tsx scene modules and manifest
-> optional hidden stills/refine in desktop
-> admission gate
-> manifest -> VideoSpec
-> static safety grid
-> TTS
-> lockSpec -> LockedVideoSpec
-> build safety grid
-> determinism guard
-> Remotion render
-> render oracles and review artifacts
-> draft/full MP4
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

## Boundaries

- Authored scene code is admitted before render.
- The host never uses authored scene modules as general Node code.
- Authored scene imports are tightly whitelisted.
- The Remotion bundle imports the generated per-project authored entry.
- Desktop UI talks to the engine through typed IPC and pipeline/MCP seams.

## Sensitive Areas

Avoid broad refactors in these areas without a focused plan and tests:

- `packages/pipeline/src/orchestrator.ts`
- `packages/pipeline/src/safety/render-grid.ts`
- `apps/desktop/src/main/workspace/workspace-controller.ts`
- `apps/desktop/src/main/authoring/ninerouter-backend.ts`
- `packages/pipeline/src/render/renderer.ts`
