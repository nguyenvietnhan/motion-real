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
3. thin desktop main wiring;
4. split authoring backend seams;
5. clarify workspace state machine;
6. split render-grid/orchestrator only after safer outer cleanup.

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

