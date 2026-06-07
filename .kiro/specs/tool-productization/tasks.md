# Implementation Plan: tool-productization

## Overview

This plan turns the `tool-productization` design into incremental TypeScript
coding steps over the existing `@news/*` monorepo. The work is purely additive:
every new surface (style packs, URL ingest, MCP server, tracker, bulk loop,
doctor) drives the proven single-process orchestrator (`scaffoldVideoProject` /
`renderProject`) and preserves the full `N1–N30` grid, determinism, the evidence
gate, the Vivibe voice, the draft-first gate, and captions.

Order of work follows the design's dependency layering: the structured error
type first (used everywhere), then the Phase 1 look-and-grounding layer (style
packs + ingest), then the cross-cutting tracker/doctor, then the Phase 2
programmable surface (MCP), then Phase 3 bulk automation, then CLI wiring, and
finally the skill package and buyer docs. Property-based tests (Properties 1–19
from the design) sit next to the units they validate; whole-pipeline grid checks
are integration examples.

Language: TypeScript (existing repo). Tests run under Vitest with `fast-check`
for property tests, minimum 100 iterations each, tagged with their design
property number.

## Tasks

- [x] 1. Structured error foundation
  - [x] 1.1 Implement `PipelineError` and `SerializedPipelineError`
    - Create `packages/pipeline/src/errors.ts` with `PipelineStage` union, the
      `PipelineError` class (`stage`, `cause`, optional `check`, `sceneId`,
      `remediation`, `severity`) and `toSerialized()`
    - Export the structured form so MCP and CLI render one error vocabulary
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x]* 1.2 Write property test for structured error fidelity
    - **Property 18: Structured error fidelity across surfaces**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.5**

- [x] 2. Selectable style packs and pack-driven theming (Phase 1)
  - [x] 2.1 Add `stylePackId` to schema theme types
    - Extend `ManifestTheme` and `SpecTheme`/`VideoSpec.theme` in `@news/schema`
      with optional `stylePackId`, kept backward compatible
    - _Requirements: 1.5_

  - [x] 2.2 Implement the style-pack registry
    - Create `packages/design/src/style-packs.ts` with `ChromeLevel`,
      `StylePack`, `STYLE_PACKS`, `DEFAULT_STYLE_PACK_ID`, `getStylePack`,
      `listStylePackIds`, `registerStylePack`
    - Define `bold-editorial` (current look) and `clean-premium` (restrained)
      packs; adding a pack requires only a registry entry
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 2.3 Implement the shared render-safe font loader
    - Add one shared module that loads each pack's fonts via
      `@remotion/google-fonts/<Font>` `loadFont()` with the explicit
      `vietnamese` subset and only the used weights, awaited at setup
    - Re-back `bold-editorial` with a bundled/Google font carrying the
      vietnamese subset; back `clean-premium` with Be Vietnam Pro (or Inter)
    - Ensure `ChromeLevel.fontFamily` family names match the loaded family names
    - _Requirements: 1.3, 10.7_

  - [x]* 2.4 Write property test for style-pack font coverage
    - **Property 19: Style-pack fonts cover Vietnamese and load render-safe**
    - **Validates: Requirements 1.3, 1.9, 10.7**

  - [x] 2.5 Extend `makeTheme` to consume style packs
    - Change signature to `makeTheme(dominant?, stylePackId?)`, resolve the pack
      (default `bold-editorial`), keep the fixed light cream base, derive
      accents/signal/data-viz from dominant, and add `stylePackId`, `chrome`,
      and pack-driven `fonts` to the `Theme`; remain pure (no `Math.random` /
      `Date` / IO)
    - _Requirements: 1.1, 1.5, 1.7, 1.8_

  - [x]* 2.6 Write property test for default style pack
    - **Property 1: Default style pack**
    - **Validates: Requirements 1.5, 10.10**

  - [x]* 2.7 Write property test for style-pack theme determinism
    - **Property 3: Style-pack theme determinism**
    - **Validates: Requirements 1.8, 10.2**

  - [x]* 2.8 Write property test for base-wash legibility
    - **Property 4: Base wash stays light and legible**
    - **Validates: Requirements 1.7, 1.9**

  - [x] 2.9 Wire `stylePackId` through spec build with an unknown-id hard error
    - Make `manifestToVideoSpec` copy `stylePackId` through and have the
      composition call `makeTheme(dominant, stylePackId)`
    - Raise a `PipelineError` (stage `admission`/`static-grid`) before TTS when
      the id is unknown, naming the id and listing registered ids; no id ⇒
      default `bold-editorial`
    - _Requirements: 1.5, 1.6_

  - [x]* 2.10 Write property test for unknown style pack
    - **Property 2: Unknown style pack is a hard error**
    - **Validates: Requirements 1.6, 7.4**

  - [x] 2.11 Make blocks read chrome tokens from the theme
    - Update `Frame`, `Story`, `Panel`, `TitleBlock`, and other chrome-bearing
      blocks to read `theme.chrome` (border/shadow/grid/ticks/density) and
      `theme.fonts` instead of hard-coding the bold-editorial chrome
    - _Requirements: 1.4, 1.10_

  - [x]* 2.12 Write unit tests for block chrome adaptation
    - Assert blocks render `bold-editorial` chrome unchanged and `clean-premium`
      chrome (hairline/none border, soft shadow, no grid/ticks) from the theme
    - _Requirements: 1.10_

  - [x] 2.13 Add a "reading chrome tokens" note to the authoring contract
    - Update `.kiro/steering/authoring-contract.md` so authored scenes read
      style-pack tokens from the theme rather than hard-coding chrome
    - _Requirements: 1.10_

  - [x]* 2.14 Write integration test that each pack passes the safety grid
    - Run the sample fixture end-to-end through `N1–N30` for each registered
      pack; assert no hard failures, including the `N18` contrast oracle on the
      pack base
    - _Requirements: 1.9_

- [x] 3. Checkpoint - Phase 1 look layer
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. URL ingest into grounded research files (Phase 1)
  - [x] 4.1 Implement `ingestUrl`
    - Create `packages/pipeline/src/ingest/url-ingest.ts` with `IngestResult`,
      `ArticleMetadata`, and `ingestUrl(url, opts)`; add `@mozilla/readability`
      and `linkedom` deps
    - Fetch via injectable `fetchImpl`, extract main text + metadata (title,
      site, author/date when present), write `planning/<id>.md` (resolved under
      `VIDEO_TOOL_HOME`, never repo root) with a provenance header (source URL +
      `fetchedAt`); text + metadata only, no media URLs
    - On fetch failure (non-2xx/network/timeout) or no extractable body, raise
      `PipelineError(stage: "ingest")` and write no partial/empty file
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 2.8, 2.9_

  - [x]* 4.2 Write property test for extraction and provenance fidelity
    - **Property 5: Ingest extraction and provenance fidelity**
    - **Validates: Requirements 2.1, 2.9**

  - [x]* 4.3 Write property test for text-and-metadata-only ingest
    - **Property 6: Ingest is text and metadata only**
    - **Validates: Requirements 2.3, 10.4**

  - [x]* 4.4 Write property test for failed-ingest cleanliness
    - **Property 7: Failed ingest leaves no partial file**
    - **Validates: Requirements 2.6, 2.7**

  - [x]* 4.5 Write unit tests for the evidence-gate interaction
    - Assert research files are not read in the render path and that ingested
      facts remain subject to the `N9` evidence gate
    - _Requirements: 2.5_

- [x] 5. Tracker work queue
  - [x] 5.1 Implement the tracker store
    - Create `packages/pipeline/src/tracker/` with `TrackerItem`,
      `TrackerStatus`, `readTracker`, `writeTracker`, `upsertItem`; support both
      JSON and CSV with `id`, `url`, `title`, `source`, `status` (+ optional
      `reason`, `projectId`, `updatedAt`) at a stable location, never repo root
    - _Requirements: 5.1, 9.4_

  - [x]* 5.2 Write property test for tracker serialization round-trip
    - **Property 11: Tracker serialization round-trip**
    - **Validates: Requirements 5.1**

  - [x]* 5.3 Write unit tests for tracker read/write/malformed files
    - Cover JSON and CSV readers/writers and malformed-file handling
    - _Requirements: 5.1_

- [ ] 6. Health / doctor check (cross-cutting)
  - [ ] 6.1 Extend `runDoctor`
    - Add style-pack registry, MCP-wiring, and per-pack font-coverage checks to
      the existing Vivibe/ffmpeg/browser/registry checks; run all checks (never
      short-circuit) and emit pass/fail plus actionable remediation per item and
      an overall ready/not-ready result
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 6.2 Write property test for doctor reporting every failure
    - **Property 16: Doctor reports every failure**
    - **Validates: Requirements 6.2, 6.3, 6.4**

  - [ ]* 6.3 Write unit tests for each doctor check
    - Assert pass/fail rendering and remediation string per check
    - _Requirements: 6.1, 6.2_

- [ ] 7. MCP server exposing the pipeline (Phase 2)
  - [ ] 7.1 Scaffold the `@news/mcp` package and `ToolResult` type
    - Create the new leaf package depending on `@news/pipeline` only, with the
      `ToolResult<T>` discriminated union whose failure branch carries the
      serialized `PipelineError`
    - _Requirements: 3.2, 7.5_

  - [ ] 7.2 Implement the MCP tools over the orchestrator
    - Implement `ingest_url`, `scaffold_project`, `render_draft`, `render_full`,
      `doctor`, `list_projects`, and `tracker_list`/`tracker_add`/
      `tracker_update`, each with a typed Zod input schema, importing
      `@news/pipeline` from source (single registry instance)
    - _Requirements: 3.1, 3.3, 3.7, 3.8_

  - [ ] 7.3 Enforce the draft-first gate in `render_full`
    - Refuse a full render unless a prior draft exists, unless an explicit
      force-full flag is supplied
    - _Requirements: 3.4, 10.8_

  - [ ] 7.4 Preserve the Vivibe provider in render tools
    - Keep configured Vivibe provider/voice; on incomplete TTS config fail with
      the exact missing key/endpoint/voice id and never downgrade to mock/none
    - _Requirements: 3.6, 10.9_

  - [ ] 7.5 Run the full grid and gate "done" on it
    - Ensure every render through the server runs `N1–N30`; a hard-check failure
      returns `ok: false` naming the failing checks and never reports done
    - _Requirements: 3.5, 10.1_

  - [ ] 7.6 Surface progress and preserve hygiene
    - Map orchestrator `onProgress` to MCP progress notifications and always
      return a terminal result; ensure artifacts stay under `.video-tool/` +
      `planning/` and scratch is cleaned in the orchestrator `finally`
    - _Requirements: 3.9, 3.10, 9.3_

  - [ ] 7.7 Register the MCP server in `.kiro/settings/mcp.json`
    - Add the stdio server entry so MCP-capable agents discover the tools
    - _Requirements: 3.1_

  - [ ]* 7.8 Write property test for the draft-first gate
    - **Property 8: Draft-first gate**
    - **Validates: Requirements 3.4, 10.8**

  - [ ]* 7.9 Write property test for TTS provider preservation
    - **Property 10: TTS provider is never downgraded**
    - **Validates: Requirements 3.6, 10.9**

  - [ ]* 7.10 Write property test for the grid on every surface
    - **Property 9: The full grid is in force on every surface**
    - **Validates: Requirements 3.5, 5.3, 10.1**

  - [ ]* 7.11 Write property test for doctor parity across surfaces
    - **Property 17: Doctor is equivalent across CLI and MCP**
    - **Validates: Requirements 6.5**

  - [ ]* 7.12 Write unit tests for tool schemas and result shapes
    - Validate representative good/bad inputs against each Zod schema and assert
      the `ToolResult` success vs `{ ok:false, error }` shape
    - _Requirements: 3.2_

  - [ ]* 7.13 Write single-process registry regression test
    - Exercise a scaffold → register → render-fixture round-trip and assert no
      "registration not found" error (no second registry instance)
    - _Requirements: 3.3, 5.2_

- [ ] 8. Resumable bulk automation over the tracker (Phase 3)
  - [ ] 8.1 Implement `runBulkLoop`
    - Reduce over non-`done` tracker items (ingest → scaffold → author hand-off
      → draft → full → mark done) by reusing the MCP tools / orchestrator path;
      update item status as it progresses; on usage limit record
      `paused-resumable` and stop gracefully without corrupting the tracker; on
      single-item failure mark `failed`+reason and continue; reuse TTS/render
      caches; record per-item outcomes
    - _Requirements: 5.2, 5.7, 5.8, 10.3_

  - [ ]* 8.2 Write property test for resumability
    - **Property 12: Bulk loop resumes without redoing work**
    - **Validates: Requirements 5.4**

  - [ ]* 8.3 Write property test for graceful usage-limit pause
    - **Property 13: Usage-limit pause is graceful and resumable**
    - **Validates: Requirements 5.5**

  - [ ]* 8.4 Write property test for per-item isolation
    - **Property 14: Bulk per-item isolation**
    - **Validates: Requirements 5.6, 5.7**

  - [ ]* 8.5 Write property test for cache reuse across surfaces
    - **Property 15: Caches are reused across surfaces**
    - **Validates: Requirements 5.8, 10.3**

- [ ] 9. CLI surface wiring
  - [ ] 9.1 Add the new CLI verbs
    - Wire `ingest <url> [--id]`, `tracker list|add|update`, `bulk [--tracker]
      [--limit]`, the extended `doctor`, and `mcp` (start server) into the CLI,
      reusing the same orchestrator/tools paths as MCP
    - _Requirements: 2.1, 5.1, 6.5_

  - [ ]* 9.2 Write unit tests for CLI parsing and dispatch
    - Assert each verb parses args and dispatches to the shared implementation
    - _Requirements: 6.5_

- [ ] 10. Skill packaging and buyer documentation (cross-cutting)
  - [ ] 10.1 Create the skill / power package
    - Bundle references to `AGENTS.md`, the authoring-contract, the
      visualization-playbook, and the design-language; document the end-to-end
      workflow (scaffold → author → draft → review → full incl. the draft-first
      gate), reference the style packs and the MCP tools, state the invariants,
      and reference canonical docs instead of duplicating them (no embedded LLM
      planner)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [ ] 10.2 Write buyer-facing documentation
    - Cover install/config (incl. Vivibe keys) + doctor, the CLI and MCP
      workflows, style-pack selection, the bulk tracker workflow incl. resume,
      and the quality guarantees/invariants and explicit non-goals; keep it
      consistent with the canonical contract docs
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [ ] 11. Final checkpoint
  - Ensure all tests pass (`npm run typecheck`, `npm test`, `npm run build`),
    ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test/verification sub-tasks and can be
  skipped for a faster MVP; core implementation sub-tasks are never optional.
- Each task references specific requirement clauses for traceability.
- Property-based tests (Properties 1–19) validate the design's universal
  correctness properties at a minimum of 100 iterations each, using `fast-check`
  under Vitest, with injected `fetchImpl`/stubs so no live network or real
  renders run; example/integration tests cover concrete behavior and the
  whole-pipeline grid checks.
- Every new safety guard (unknown-pack guard, ingest media-ban, draft-first
  gate, contrast on a new pack base) ships with a non-vacuous self-test per the
  `N`-grid discipline.
- All new surfaces drive the single-process orchestrator; no second
  `@news/compositions` registry instance is introduced.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "5.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "4.1", "5.2", "5.3"] },
    { "id": 2, "tasks": ["2.3", "4.2", "4.3", "4.4", "4.5", "6.1"] },
    { "id": 3, "tasks": ["2.4", "2.5", "6.2", "6.3"] },
    { "id": 4, "tasks": ["2.6", "2.7", "2.8", "2.9", "2.11"] },
    { "id": 5, "tasks": ["2.10", "2.12", "2.13", "2.14", "7.1"] },
    { "id": 6, "tasks": ["7.2", "7.7"] },
    { "id": 7, "tasks": ["7.3", "7.4", "7.5", "7.6", "8.1", "9.1"] },
    { "id": 8, "tasks": ["7.8", "7.9", "7.10", "7.11", "7.12", "7.13", "8.2", "8.3", "8.4", "8.5", "9.2", "10.1"] },
    { "id": 9, "tasks": ["10.2"] }
  ]
}
```
