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
2. inventory legacy compatibility;
3. de-scope the legacy MCP stdio surface only after the internal tool facade has
   a neutral owner outside `@news/mcp`;
4. split authoring backend seams;
5. revisit workspace state machine only after a new narrow slice is proven;
6. split render-grid/orchestrator only after safer outer cleanup.

The first workspace-controller pass is complete: local pure/view-model/create/
script/render helpers exist, while async render/refine/publish orchestration
stays in `WorkspaceController`. Do not force that extraction just to reduce line
count.

The desktop-main thinning pass is complete for now. `index.ts` remains the
Electron composition root, while local tested helpers own runtime env parsing,
create-time image staging, BGM handlers, native save/export helpers, and
`projects:create` IPC payload coercion. Keep Electron lifecycle, media
scheme/protocol ordering, controller construction, and broad handler composition
root-owned unless a future slice has a narrower reason than line count.

The external MCP stdio entrypoint is legacy/product-optional under the current
desktop-app direction. Do not delete `packages/mcp` until product code no longer
imports `createTools` or MCP-owned types through `@news/mcp`.

## Repository Hygiene

Prefer descriptive, domain-owned paths over loose root files:

- root: project metadata and compatibility entry points only;
- `apps/desktop/assets/<domain>/`: bundled desktop assets shipped with the app;
- `VIDEO_TOOL_HOME/.video-tool/<domain>/`: generated runtime state and user-added
  media;
- `docs/current/`: durable documentation;
- `docs/working-notes/`: temporary plans only.

AI guidance must stay vendor-neutral. `AI_CONTRACT.md` is the only contract and
`AGENTS.md` is the generic entry-point pointer. Do not add assistant-specific
contract files unless the owner explicitly accepts the tool adapter and it does
not duplicate project rules.

Bundled media should not be copied into runtime libraries just to make it
selectable. Prefer virtual built-in entries that point to their app asset, while
user-added media is copied into the canonical `.video-tool` library.

## Legacy Terms

These terms may appear only when explicitly discussing compatibility or ADR
history:

- `@news/design`
- `stylePack`
- `stylePackId`
- `clean-luxury-tech`
- old block names such as `Frame`, `Story`, `TitleBlock`, `KeyPoints`, `Panel`
- `PICK mode`

They must not appear as current instructions.

## Working Notes

Temporary task planning belongs in `docs/working-notes/`. Those notes may mention
obsolete terms while tracking cleanup, but they are not project contracts.
