# Requirements Document

## Introduction

`tool-productization` evolves `news_remotion_tool` from a personal, CLI-driven
AUTHOR-mode pipeline into a **sellable, production-grade product** ("chỉn chu")
without abandoning the qualities that already make it the higher-quality option:
pure AUTHOR mode, the enumerated `N1–N30` safety grid, mandatory determinism,
the evidence gate, Vietnamese-language tuning, transition-aware locking with
breath gaps, burned-in karaoke captions, the draft-first hard gate, and Vivibe
as the voice provider.

The motivation is a competitor tool packaged as a Claude **skill + MCP server +
local dashboard** that (a) is sold as a productized agent capability, (b) runs a
**bulk crawler/tracker pipeline** that mass-produces clips overnight, (c) reads
as a **cleaner / more restrained ("premium") visual look**, and (d) offers
**selectable design styles**. Its core render technology (HTML/CSS/SVG →
headless Chromium → MP4) is the **same paradigm** as this tool and is not
superior. This spec adds the genuinely valuable capabilities the competitor has,
expressed in this tool's idioms, while keeping every existing quality bar.

The work is organized to ship in phases:

- **Phase 1 — Look & grounding:** selectable design **style packs**
  (Requirement 1) and **URL ingest** into grounded research files (Requirement
  2).
- **Phase 2 — Programmable surface:** an **MCP server** exposing the pipeline as
  tools (Requirement 3) and a **skill / power package** of the authoring
  know-how (Requirement 4).
- **Phase 3 — Scale:** an agent-driven **bulk automation** loop over a resumable
  **tracker** (Requirement 5).
- **Cross-cutting — Productization polish:** health/doctor (Requirement 6),
  actionable error reporting (Requirement 7), buyer documentation (Requirement
  8), and workspace hygiene (Requirement 9).
- **Invariants:** the must-preserve safety/quality guarantees, stated as binding
  constraints (Requirement 10).

Scope is strictly `news_remotion_tool`. `math_video_tool` / `news_video_tool`
remain reference designs only and are not modified.

### Constraints and Assumptions

- **Fixed render contract**: FPS = 30 (full) / 20 (draft), canvas 1080×1920
  (9:16), language `vi`. Unchanged by this spec.
- **Determinism is mandatory**: scene/block visuals are pure functions of the
  frame; randomness only via Remotion `random(seed)`. Every new capability MUST
  preserve byte-identical re-render (`N16`).
- **TTS**: Vivibe/LucyLab via `@news/tts` remains the voice provider; never
  silently downgraded. Local/offline TTS is out of scope.
- **AI authority**: the external authoring agent is the "brain"; no in-tool LLM
  planner is built. New surfaces (MCP, skill, bulk loop) drive the existing
  pipeline; they do not replace the agent.
- **Single-process pipeline path**: all new programmatic surfaces MUST invoke the
  proven in-process orchestrator path that the existing test suite exercises (a
  single `@news/compositions` registry instance), never a second-registry path.
- **Remotion license**: free tier (individual / non-profit) assumed.

### Explicit Non-Goals

- **No real-image scraping or embedding.** URL ingest extracts **text and
  metadata only**; photos, screenshots, logos, and external media remain banned
  (the existing media ban and evidence gate stand).
- **No local/offline TTS.** Vivibe stays the voice provider.
- **No return to fixed templates.** Pure AUTHOR mode is preserved; style packs
  parametrize the look, they do not reintroduce a closed template catalog.
- **No chasing raw volume at the expense of quality bars.** Bulk automation MUST
  pass the same `N1–N30` grid and draft-first gate per item; throughput never
  bypasses the gate.

## Glossary

- **Style pack**: a named, self-contained set of look parameters (the "chrome
  level": border weight, shadow style, grid/ticks presence, accent count,
  whitespace/density, font family) consumed by `makeTheme()` to produce a
  `Theme`. Examples: `bold-editorial` (the current look), `clean-premium` (a
  restrained look). The per-project dominant hue still applies on top of the
  selected pack.
- **Chrome level**: the degree of decorative framing a style pack applies (heavy
  borders + hard shadows + grid + registration ticks vs. hairline/none + soft
  diffuse shadow + generous whitespace).
- **Research file**: a Markdown artifact at `planning/<id>.md` holding the
  extracted main text + metadata of an ingested article; an **input** the
  authoring agent reads as grounded source. It is NOT read at render time.
- **URL ingest**: the process that fetches an article URL, extracts its main
  readable text + metadata, and writes the research file.
- **Evidence gate (N9)**: the existing static check that bans fabricated
  specifics and external media; it applies unchanged to facts sourced from
  research files (only facts present in the fetched article may be used).
- **MCP server**: a Model Context Protocol server exposing pipeline operations
  (e.g. `ingest_url`, `scaffold_project`, `render_draft`, `render_full`,
  `doctor`, `list_projects`, tracker ops) as tools any MCP-capable agent can
  call.
- **Skill / power package**: a bundle of the authoring know-how (`AGENTS.md`,
  authoring-contract, visualization-playbook, design-language) + the workflow +
  the style-pack references, structured so a driving agent auto-loads the rules.
- **Tracker**: a persisted list (CSV or JSON) of work items, each with at least
  `id`, `url`, `title`, `source`, `status`, used to drive bulk automation.
- **Bulk loop**: an agent-driven loop that processes pending tracker items
  end-to-end (ingest → author → draft → full → mark done), is resumable, and
  degrades gracefully on usage/API limits.
- **Doctor / health check**: a readiness check that reports environment and
  configuration status (Vivibe `.env`, ffmpeg, browser, registry, style packs,
  MCP wiring) with actionable remediation.
- **Hard error / Warning**: a hard error blocks the affected operation
  (render/done/tool result is a failure); a warning is advisory and does not
  block.

## Requirements

### Requirement 1: Selectable design style packs [Phase 1]

**User Story:** As the product owner, I want a selectable design-style system
with at least a restrained "Clean Premium" pack alongside the current "Bold
Editorial" look, so that buyers can choose a less busy ("đỡ màu mè") aesthetic
per project without losing brand consistency or determinism.

#### Acceptance Criteria

1. THE Design_System SHALL define a named style-pack abstraction that
   parametrizes the visual "chrome level" — including at minimum border
   treatment, shadow treatment, grid/registration-tick presence, accent count,
   whitespace/density, and font family — consumed by `makeTheme()` when building
   a `Theme`.
2. THE Design_System SHALL provide a `bold-editorial` style pack that reproduces
   the current look (cream base, bold 4px ink borders, hard offset shadows,
   faint grid, corner registration ticks, derived accent + split-complement
   signal + the 7-color PRINT set).
3. THE Design_System SHALL provide a `clean-premium` style pack characterized by
   restraint: hairline or no borders, soft diffuse shadows, no grid and no
   registration ticks, a single accent, generous whitespace, and a clean sans
   font family (e.g. Inter or SF-class).
4. THE Design_System SHALL be extensible: adding a new style pack SHALL require
   only registering a new named pack definition, without modifying existing
   packs or block components.
5. WHEN a project manifest specifies a `stylePackId`, THE Pipeline SHALL build
   the project theme from that style pack; WHERE no `stylePackId` is specified,
   THE Pipeline SHALL default to `bold-editorial` for backward compatibility.
6. IF a manifest specifies a `stylePackId` that is not registered, THEN THE
   Pipeline SHALL report a hard error naming the unknown id and listing the
   available style-pack ids.
7. WHERE a style pack is selected, THE Design_System SHALL still derive accents
   and data-viz colors from the per-project dominant hue, and SHALL NOT let the
   dominant hue tint the base wash into a dark or low-contrast base.
8. THE style-pack output SHALL remain deterministic: building a theme from the
   same `stylePackId` and dominant hue SHALL produce identical theme tokens
   across runs (no `Math.random` / `Date` / IO).
9. FOR every registered style pack, a project authored and rendered with that
   pack SHALL pass the full `N1–N30` safety grid, including the contrast oracle
   (N18) for foreground text and captions on that pack's base.
10. THE Authoring_Contract documentation SHALL describe how a scene's authored
    code reads style-pack-driven tokens from the theme so authored scenes adapt
    to the selected pack rather than hard-coding the bold-editorial chrome.

### Requirement 2: URL ingest into grounded research files [Phase 1]

**User Story:** As a creator, I want to give the tool an article URL and have it
fetch and extract the main text and metadata into a research file, so that the
authoring agent works from grounded source material instead of an unverified
prompt.

#### Acceptance Criteria

1. WHEN a creator supplies an article URL to the URL_Ingest function, THE
   URL_Ingest function SHALL fetch the page and extract the main readable article
   text plus useful metadata (at least title, source/site, author when present,
   and publication date when present).
2. THE URL_Ingest function SHALL write the extracted content to a research file
   at `planning/<id>.md` in Markdown, including the source URL and the extracted
   metadata as a header section.
3. THE URL_Ingest function SHALL extract **text and metadata only**, and SHALL
   NOT download, embed, or reference real images, screenshots, logos, or other
   external media (real-image support is out of scope; the media ban stands).
4. THE research file SHALL be treated as an **input artifact** consumed by the
   authoring agent before authoring, and SHALL NOT be read during rendering, so
   that render determinism (N16) is preserved.
5. THE evidence gate (N9) SHALL continue to apply unchanged: only facts present
   in the fetched article (the research file) may be presented as fact; invented
   numbers, dates, prices, or quotes SHALL remain a hard error.
6. IF the URL cannot be fetched (network failure, non-2xx response, or timeout),
   THEN THE URL_Ingest function SHALL report a hard error naming the URL and the
   failure reason, and SHALL NOT write a partial research file.
7. IF the page is fetched but no main article text can be extracted, THEN THE
   URL_Ingest function SHALL report a hard error indicating extraction failure
   for that URL rather than writing an empty research file.
8. WHEN URL_Ingest writes a research file, THE function SHALL place it under the
   workspace's `planning/` research location and SHALL NOT write scratch to the
   repo root.
9. THE research file SHALL record provenance (source URL and fetch timestamp) so
   a reviewer can trace every claim back to the ingested source.

### Requirement 3: MCP server exposing the pipeline [Phase 2]

**User Story:** As a buyer's agent, I want to drive the tool through a stable
Model Context Protocol API, so that any MCP-capable agent can run the pipeline
without hand-invoking the CLI.

#### Acceptance Criteria

1. THE MCP_Server SHALL expose pipeline operations as MCP tools including at
   minimum: `ingest_url`, `scaffold_project`, `render_draft`, `render_full`,
   `doctor`, `list_projects`, and tracker operations (list/add/update items).
2. EACH MCP tool SHALL declare a typed input schema and SHALL return a structured
   result that distinguishes success from failure and carries actionable error
   detail on failure (per Requirement 7).
3. THE MCP_Server SHALL invoke the proven single-process orchestrator path (the
   one the existing test suite exercises, with a single `@news/compositions`
   registry instance), and SHALL NOT use a second-registry or ad-hoc runner
   path.
4. THE `render_full` tool SHALL enforce the draft-first hard gate: a full render
   SHALL be refused unless a prior draft exists for the project, unless an
   explicit force-full flag is supplied.
5. EVERY render invoked through the MCP_Server SHALL run the full `N1–N30` safety
   grid; WHEN a hard check fails, THE tool result SHALL be a failure that names
   the failing checks and SHALL NOT report the project as "done".
6. THE `render_draft` and `render_full` tools SHALL preserve the configured
   Vivibe TTS provider and voice; IF TTS configuration is incomplete, THEN the
   tool SHALL fail with the exact missing key/endpoint/voice id and SHALL NOT
   silently downgrade the voice.
7. THE `scaffold_project` tool SHALL create a self-contained project unit under
   the standard project location, equivalent to the CLI `author scaffold` path.
8. THE `list_projects` tool SHALL return each known project with its id and
   current pipeline state.
9. WHERE a long-running tool (render) is invoked, THE MCP_Server SHALL surface
   progress and SHALL return a terminal success/failure result rather than
   blocking indefinitely without feedback.
10. THE MCP_Server SHALL preserve workspace hygiene: all artifacts SHALL be
    written under `.video-tool/` and `planning/`, and process scratch SHALL be
    cleaned up on completion (per Requirement 9).

### Requirement 4: Skill / power packaging of authoring know-how [Phase 2]

**User Story:** As a driving agent, I want the authoring rules, workflow, and
style-pack references packaged as a skill, so that I auto-load the contract and
produce on-brand videos without the operator pasting documentation each time.

#### Acceptance Criteria

1. THE Skill_Package SHALL bundle the existing authoring know-how — `AGENTS.md`,
   the authoring-contract, the visualization-playbook, and the design-language —
   as the rules a driving agent loads before authoring.
2. THE Skill_Package SHALL document the end-to-end workflow: scaffold → author →
   draft → review → full, including the draft-first gate and the review loop.
3. THE Skill_Package SHALL reference the available style packs (Requirement 1) so
   a driving agent knows the selectable looks and how to choose one per project.
4. THE Skill_Package SHALL reference the MCP tools (Requirement 3) as the
   recommended programmatic surface for driving the pipeline.
5. THE Skill_Package SHALL NOT embed or require an in-tool LLM planner: the
   driving agent remains the authoring "brain"; the package supplies rules and
   workflow only.
6. THE Skill_Package SHALL state the must-preserve invariants (full safety grid,
   determinism, evidence gate, Vietnamese rules, draft-first, Vivibe voice,
   captions) so a driving agent does not violate them.
7. WHEN the authoring rules or style packs change, THE Skill_Package SHALL
   reference the canonical source docs rather than duplicating their content, so
   that the packaged know-how cannot drift out of sync with the repo.

### Requirement 5: Resumable bulk automation over a tracker [Phase 3]

**User Story:** As an operator, I want to queue many news items in a tracker and
have an agent-driven loop produce videos for all pending items end-to-end, so
that I can mass-produce clips overnight and resume after interruptions or usage
limits.

#### Acceptance Criteria

1. THE Tracker SHALL persist work items as CSV or JSON, where each item carries
   at least `id`, `url`, `title`, `source`, and `status`.
2. THE Bulk_Loop SHALL process each pending tracker item end-to-end (ingest →
   author → draft → full → mark done) by reusing the MCP tools / orchestrator
   path, and SHALL update the item's `status` as it progresses.
3. EACH item produced by the Bulk_Loop SHALL pass the full `N1–N30` safety grid
   and the draft-first gate; the Bulk_Loop SHALL NOT bypass any quality bar to
   increase throughput.
4. THE Bulk_Loop SHALL be resumable: WHEN restarted, THE loop SHALL skip items
   already marked done and SHALL resume from pending/in-progress items without
   redoing completed work.
5. IF an API or usage limit is hit during processing, THEN THE Bulk_Loop SHALL
   record the current item's progress and a resumable status, SHALL stop
   gracefully without corrupting the tracker, and SHALL be able to resume later
   from the recorded point.
6. IF processing a single item fails (e.g. ingest failure, admission rejection,
   render hard error), THEN THE Bulk_Loop SHALL mark that item with a failed
   status and a reason, and SHALL continue processing the remaining pending items
   rather than aborting the whole run.
7. THE Bulk_Loop SHALL record per-item outcome (done, failed-with-reason, or
   paused-resumable) so the operator can see, after a run, which items succeeded
   and which need attention.
8. THE Bulk_Loop SHALL reuse the shared TTS and render caches so that re-running
   the loop does not re-synthesize or re-render unchanged work.

### Requirement 6: Health / doctor check [Cross-cutting]

**User Story:** As a buyer setting up the tool, I want a single health check that
tells me whether my environment is ready, so that I can fix configuration
problems before running the pipeline.

#### Acceptance Criteria

1. THE Doctor function SHALL check and report the status of: Vivibe `.env`
   configuration (API key + voice id), ffmpeg availability, the headless browser
   availability, the compositions registry, the registered style packs, and the
   MCP server wiring.
2. FOR each checked item, THE Doctor function SHALL report a clear pass/fail
   status, and FOR each failure SHALL include an actionable remediation message
   naming the exact missing key, binary, or configuration.
3. WHEN all checks pass, THE Doctor function SHALL report overall readiness.
4. WHEN any check fails, THE Doctor function SHALL report overall not-ready and
   SHALL list every failing check (not stop at the first failure).
5. THE Doctor function SHALL be invocable both from the CLI (`doctor`) and as the
   MCP `doctor` tool, returning equivalent results.

### Requirement 7: Actionable error reporting [Cross-cutting]

**User Story:** As a buyer operating the tool, I want clear, actionable error
messages, so that I can understand and fix failures without reading source code.

#### Acceptance Criteria

1. WHEN any pipeline operation fails (ingest, admission, static grid, build gate,
   determinism, render, render oracles, review), THE system SHALL report an error
   that names the failing stage and the specific cause.
2. WHERE a failure is caused by a safety-grid check, THE error SHALL name the
   failing check by its technical safety-check identifier (e.g. `N9`, `N14`) and
   the affected scene id when applicable, and SHALL identify the check by that
   technical identifier only — the error SHALL NOT be required to embed a verbose
   description of the check's purpose (remediation is covered by criterion 7.4).
3. THE system SHALL distinguish hard errors (which block the operation) from
   warnings (which are advisory and do not block), consistent with the existing
   grid semantics.
4. WHERE a failure has a known remediation (missing TTS key, unknown style pack,
   unfetchable URL, missing prior draft), THE error SHALL include the remediation
   step.
5. THE error reporting surfaced through the MCP tools SHALL carry the same
   stage/cause/remediation detail as the CLI, in a structured form.

### Requirement 8: Buyer-facing documentation [Cross-cutting]

**User Story:** As a buyer, I want documentation suitable for someone who did not
build the tool, so that I can install, configure, and operate it confidently.

#### Acceptance Criteria

1. THE Documentation SHALL describe installation, environment configuration
   (including Vivibe keys), and the doctor readiness check.
2. THE Documentation SHALL describe the end-to-end workflow (ingest → scaffold →
   author → draft → review → full) for both the CLI and the MCP surfaces.
3. THE Documentation SHALL describe the available style packs and how to select
   one per project.
4. THE Documentation SHALL describe the bulk-automation tracker workflow,
   including how to resume after an interruption or usage limit.
5. THE Documentation SHALL state the product's quality guarantees and invariants
   (safety grid, determinism, evidence gate, Vietnamese tuning, draft-first,
   Vivibe voice, captions) and the explicit non-goals (no real-image embedding,
   no local TTS, no fixed templates).
6. THE Documentation SHALL be kept consistent with the canonical contract docs
   (`AGENTS.md`, authoring-contract, design-language) rather than contradicting
   them.

### Requirement 9: Workspace hygiene preserved [Cross-cutting]

**User Story:** As a maintainer, I want all new capabilities to keep the
workspace clean, so that the repo root stays free of scratch and each project
remains self-contained.

#### Acceptance Criteria

1. ALL generated artifacts SHALL live under `.video-tool/` (projects, shared
   caches) and research files under `planning/`; the system SHALL NOT write
   scratch specs, scripts, MP4s, or screenshots to the repo root.
2. EACH project SHALL remain self-contained under its project folder so that
   deleting the folder removes the whole video (only shared regenerable caches
   live outside).
3. PROCESS scratch (generated bundle entries, ffmpeg concat lists, temp frames)
   created by any new surface (MCP, bulk loop) SHALL be auto-removed on
   completion.
4. THE Tracker file and research files SHALL be stored in stable, documented
   locations and SHALL NOT pollute the repo root.

### Requirement 10: Must-preserve invariants [Cross-cutting constraint]

**User Story:** As the product owner, I want the qualities that already make this
tool better than the competitor preserved across all new work, so that
productization never regresses the core quality bars.

#### Acceptance Criteria

1. THE full `N1–N30` safety grid SHALL remain in force for every video produced
   through any surface (CLI, MCP, bulk loop); no surface SHALL bypass it.
2. DETERMINISM SHALL be preserved: rendering the same locked spec twice SHALL be
   byte-identical (N16), and no new capability SHALL introduce render-time
   nondeterminism (no network/`Date`/`Math.random` in scene/block code).
3. THE render cache and TTS cache SHALL remain valid and reused across the new
   surfaces.
4. THE evidence gate (N9) SHALL remain in force, including for content derived
   from ingested research files.
5. THE Vietnamese number normalizer, phonetics dictionary, and the
   no-phonetic-spelling / no-spaced-abbreviation rules SHALL remain in force.
6. THE transition-aware lock with breath gaps SHALL remain in force so audio
   stays in sync and no speech is clipped.
7. THE burned-in single-line Vietnamese karaoke captions, generated centrally
   from narration + SRT timing, SHALL remain in force.
8. THE draft-first hard gate SHALL remain in force: a full render SHALL require a
   prior draft unless explicitly forced.
9. VIVIBE SHALL remain the TTS voice provider; the system SHALL NOT introduce
   local/offline TTS and SHALL NOT silently downgrade the voice.
10. PURE AUTHOR mode SHALL be preserved: style packs parametrize the look but
    SHALL NOT reintroduce a fixed template catalog or a "choose a template" path.
