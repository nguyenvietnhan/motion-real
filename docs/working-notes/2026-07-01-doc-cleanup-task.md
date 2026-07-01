# Temporary Task — Full Documentation Cleanup And Sync

Created: 2026-07-01

Status: first cleanup pass in progress.

First pass completed so far:

- Created `AI_CONTRACT.md` as the tool-neutral AI contract.
- Replaced `AGENTS.md` and `CLAUDE.md` with thin pointers.
- Reduced `.claude/agents/scene-author.md` and `.claude/commands/news-video.md`
  to tool adapters/pointers only.
- Created `docs/current/` with current overview, architecture, authoring,
  content, safety, desktop, render, and maintenance docs.
- Removed stale historical docs that were replaced by `docs/current/*`.

## Goal

Clean the documentation layer so the repository feels like a maintained,
current project instead of a pile of historical pivots.

The desired end state:

- Every remaining doc is current, useful, and consistent with live code.
- Obsolete docs are deleted, not kept just because they record history.
- Historical context is kept only when it actively protects future decisions.
- The doc tree has a clear structure.
- Agents and humans can find the current truth quickly.
- No doc points to an obsolete workflow, deleted package, deleted block toolkit,
  retired design system, or abandoned product direction.
- There is one shared AI-facing source of truth. No separate "Claude rules",
  "Codex rules", "Cursor rules", or hidden duplicate instructions that can drift.

This task is intentionally docs-only. No runtime behavior changes.

## Owner Direction Added

The owner wants the documentation to be general-purpose, clean, and
tool-agnostic.

Meaning:

- Any AI agent, in any future session, should read the same canonical file(s) and
  receive the same project contract.
- Files named for a specific tool, such as `CLAUDE.md` or `.claude/*`, must not
  become separate sources of truth.
- If a tool requires a special filename, that file should be only a thin adapter
  or pointer to the shared contract.
- No duplicate rules copied across multiple files.
- No "almost the same" doc written for a different AI.
- Every doc must have one job and one audience.
- If two docs serve the same purpose, merge them or delete one.
- `.claude/` must be audited too. Anything there should either be removed,
  converted into a pointer, or kept only if it serves a unique tool-integration
  purpose that cannot live in the common docs.

The target is not "docs for Claude". The target is "docs for the project".

## Why This Matters

The software currently works, but the documentation layer contains multiple
historical eras:

- old template/PICK thinking;
- deleted `@news/design`;
- deleted authored-facing `@news/blocks` layout toolkit;
- freeform AUTHOR pivot;
- hidden stills/vision refine;
- YouTube plumbing but unfinished long-form path;
- temporary implementation plans that now read like active instructions.

This creates a real risk: a future agent may obey a stale instruction and
reintroduce old architecture or break the working pipeline.

The docs must become boringly truthful.

## Scope

Audit and clean Markdown/docs-like files in:

- repo root:
- `README.md`
- `CLAUDE.md`
- `AGENTS.md`
- `docs/`
  - current docs
  - provider docs
  - ADRs
  - spec/task docs
  - working notes
- any `.claude/commands/*.md` if they exist and are still used by agents.
- `.claude/` as a whole:
  - commands;
  - prompts;
  - local agent helpers;
  - any file that duplicates the shared project contract.

Also audit scripts or comments only when they are directly referenced by docs as
part of a documented workflow. Example: `scripts/_video-template.txt` is not a
doc file, but it is directly connected to the documented `scripts/new-video.ts`
workflow and must be accounted for in the doc cleanup plan.

## Non-Goals

- Do not refactor runtime code in this task.
- Do not change safety gate behavior.
- Do not change prompt/authoring constraints.
- Do not delete compatibility code just because a doc mentions it.
- Do not rewrite the product architecture.
- Do not "prettify" docs while leaving stale facts inside.

## Cleanup Standard

A doc may remain only if it satisfies all of these:

- It describes the current project or a still-binding decision.
- Its instructions can be followed safely today.
- It does not contradict `CLAUDE.md` or live code.
- It is concise enough to be useful.
- It has a clear audience:
  - user/operator;
  - any coding AI agent;
  - runtime video-authoring model prompt;
  - maintainer/architect;
  - provider setup.
- It has a single purpose and does not duplicate another doc.

If a doc is mostly history and its useful facts can be folded into a current doc,
delete the old doc after extracting those facts.

## Single-Source Rule For AI Instructions

Current problem:

- `CLAUDE.md` is the authoritative agent contract today.
- `AGENTS.md` points to it.
- `.claude/commands/*` may also contain task-specific agent guidance.
- Future agents may not know which file wins.

Required final model:

```text
One canonical AI contract
  -> all agent-specific entry files point to it
  -> no copied duplicate rules
  -> no tool-specific fork of project truth
```

Recommended final shape:

```text
AGENTS.md                 # tiny universal pointer for any agent runner
AI_CONTRACT.md            # optional: canonical shared AI contract, tool-neutral
CLAUDE.md                 # if kept, tiny compatibility pointer to AI_CONTRACT.md
.claude/                  # optional thin tool adapters only, no duplicated rules
docs/current/...          # detailed current docs linked by AI_CONTRACT.md
```

Alternative:

```text
AGENTS.md                 # tiny pointer
CLAUDE.md                 # canonical shared AI contract despite the name
.claude/                  # thin pointers only
docs/current/...          # detailed docs linked by CLAUDE.md
```

Owner preference captured here:

- The name should not imply the rules belong to one AI.
- Prefer a tool-neutral canonical contract if the ecosystem allows it.
- If `CLAUDE.md` must stay for compatibility, it should not contain unique rules
  that are missing from the common contract.

## Proposed Target Doc Structure

Proposed final structure:

```text
README.md
AGENTS.md
AI_CONTRACT.md             # proposed canonical tool-neutral AI contract
CLAUDE.md                  # compatibility pointer only, if still needed
.claude/                   # tool adapters only; no duplicated contract
docs/
  current/
    overview.md
    architecture.md
    authoring-contract.md
    content-guide.md
    safety-grid.md
    desktop-flow.md
    render-workflow.md
    maintenance.md
  providers/
    vivibe.md
    elevenlabs.md
  adr/
    001-pure-author-mode.md
    002-selective-rewrite-scope.md
    003-safety-grid-as-contract.md
    004-single-process-orchestration.md
    005-library-adoption-strategy.md
  working-notes/
    ...
```

Possible deletion/archive candidates after extraction:

```text
docs/freeform-vision-loop.md
docs/specs/freeform-engine/requirements.md
docs/specs/freeform-engine/design.md
docs/specs/freeform-engine/tasks.md
docs/refactor-backlog.md
```

Important: "archive" should not become a junk drawer. If a historical doc is not
important for current decisions, delete it. If it is important, preserve only the
decision in an ADR or concise maintenance note.

## Current File Classification Draft

### Root Docs

`AGENTS.md`

- Keep.
- Purpose: small pointer for tools that look for `AGENTS.md`.
- Should remain short and point to the true current contract.

`CLAUDE.md`

- Keep, but likely shorten later.
- Purpose: current always-on agent contract.
- Must not contain stale instructions.
- Should point to a smaller set of current docs after reorganization.

`README.md`

- Keep.
- Purpose: human quick start and product summary.
- Must be synced with actual supported workflows.
- Must not recommend obsolete authoring paths.

### Current Docs In `docs/`

`docs/vision.md`

- Keep or fold into `docs/current/overview.md`.
- Should be concise and current.
- Remove historical comparison if it distracts from current product truth.

`docs/architecture.md`

- Keep, likely move to `docs/current/architecture.md`.
- Must match live package boundaries and current code.
- Needs line-count/god-file info refreshed or moved to maintenance note.

`docs/authoring-contract.md`

- Keep, likely move to `docs/current/authoring-contract.md`.
- Critical.
- Must match admission gate exactly.
- Must clearly say no `@news/blocks`/`@news/theme` imports in authored scenes.

`docs/visualization-playbook.md`

- Keep if it still helps AUTHOR scene quality.
- Could move to `docs/current/content-guide.md` or remain separate if concise.
- Must be guidance, not a hard runtime contract.

`docs/ai-content-guide.md`

- Keep, but consolidate with authoring/content docs if redundant.
- Must be current for Vietnamese/English, TTS provider rules, evidence gate,
  caption ownership, and CTA rules.

`docs/design-language.md`

- Reassess.
- It currently says the old design language is gone and the AI is free.
- Keep only if renamed/reframed as "visual guidance", not "design system".
- Remove old-style explanations that no longer help.

`docs/refactor-backlog.md`

- Reassess.
- Some content is useful, but as a living backlog it may be stale.
- Candidate to replace with concise `docs/current/maintenance.md` plus task notes
  in `docs/working-notes/`.

`docs/freeform-vision-loop.md`

- Strong deletion candidate.
- It is mostly historical/pivot narrative.
- Extract only current facts about hidden stills/refine into `desktop-flow.md`.

### Provider Docs

`docs/providers/vivibe.md`

- Keep if still accurate.
- Must mention Vivibe is Vietnamese-only.
- Verify env names against code/settings.

`docs/providers/elevenlabs.md`

- Keep if still accurate.
- Verify env names/default model against code/settings.

### ADRs

`docs/adr/001-pure-author-mode.md`

- Keep.
- Binding decision.
- May need minor sync wording.

`docs/adr/002-selective-rewrite-scope.md`

- Keep.
- Binding cleanup strategy.
- Confirm current off-limits boundaries.

`docs/adr/003-safety-grid-as-contract.md`

- Keep.
- Binding defect-handling philosophy.

`docs/adr/004-single-process-orchestration.md`

- Keep.
- Binding registry/process decision.

`docs/adr/005-library-adoption-strategy.md`

- Keep if still useful.
- Could shorten if too historical, but the decision about not adding parallel AI
  SDK layers is important.

### Specs

`docs/specs/freeform-engine/requirements.md`

- Deletion candidate after extraction.
- It mixes binding decisions, implemented status, and old planning.
- Current useful facts should move into `current/overview.md`,
  `current/architecture.md`, or ADRs.

`docs/specs/freeform-engine/design.md`

- Deletion candidate after extraction.
- Useful current facts should move into architecture/desktop/render docs.

`docs/specs/freeform-engine/tasks.md`

- Deletion candidate after extraction.
- It is a historical implementation checklist, not a current contract.
- Any still-open task, especially YouTube Group J, should become a small current
  maintenance/backlog note if still relevant.

## Known Drift Items To Fix During Cleanup

### Documented Authoring Script vs Current Contract

Problem:

- Docs recommend `scripts/new-video.ts`.
- That script uses `scripts/_video-template.txt`.
- The template imports deleted authored-facing symbols from `@news/blocks`.

Required outcome:

- Either update the documented workflow and template to current raw JSX/SVG
  AUTHOR mode, or remove/retire that workflow from docs until fixed.
- Add a doc/task note to avoid future agents using the stale template.

### `@news/compositions` Comment Drift

Problem:

- Package comment says authored scenes compose slot-based layout blocks.
- Current contract says authored scenes must not import blocks.

Required outcome:

- Update wording in docs and package comments when code cleanup begins.
- For this task, ensure docs do not repeat the stale statement.

### Deleted Design System Vocabulary

Problem:

- Terms like `@news/design`, `stylePack`, and old design language still appear
  across docs.

Required outcome:

- Keep only where necessary to explain a compatibility shim or ADR.
- Remove from active instructions.

### YouTube Status

Problem:

- YouTube has format plumbing but not the full long-form author-by-segment path.

Required outcome:

- Every current doc must state this consistently:
  - TikTok 9:16 is the stable production path.
  - YouTube 16:9 primitives exist.
  - Long-form YouTube author-by-segment / true production path remains pending.

### Safety Grid Severity

Problem:

- Some historical docs can sound like layout/aesthetic oracles hard-block render.

Required outcome:

- Current docs must consistently say:
  - hard blockers are admission/security and render-integrity;
  - layout/aesthetic checks are advisory warnings unless code says otherwise;
  - do not tighten gates without owner approval.

## Suggested Work Plan

### Step 1 — Freeze Cleanup Rules

Write down and agree on the cleanup rules before editing real docs.

Rules to confirm:

- one canonical AI contract;
- no duplicate tool-specific contracts;
- docs-only for this cleanup;
- delete obsolete history unless it protects a current decision;
- every kept doc has one purpose;
- no active doc may contradict live code.

Output:

- this task note updated with owner-approved rules.

### Step 2 — Build A Doc Inventory

Create a table with:

- path;
- audience;
- keep/delete/move/merge;
- current/stale/mixed;
- facts to extract;
- blocking questions.

No edits yet except this inventory.

Important inventory categories:

- canonical contract;
- thin pointer/adapter;
- current user/operator doc;
- current maintainer doc;
- runtime prompt/authoring source;
- provider setup;
- ADR / binding decision;
- historical but useful;
- obsolete/delete.

### Step 3 — Decide Final Structure

Confirm target doc tree with owner before moving/deleting files.

Key decision:

- Use `AI_CONTRACT.md` as the canonical AI contract, or keep `CLAUDE.md` as the
  canonical contract despite the tool-specific name.
- Decide whether `CLAUDE.md` becomes a pointer.
- Decide what `.claude/` is allowed to contain.

Recommended:

- Prefer `AI_CONTRACT.md` or another tool-neutral name for the canonical
  contract.
- Make `AGENTS.md` a tiny universal pointer.
- Make `CLAUDE.md` a tiny compatibility pointer if possible.
- Put detailed current docs in `docs/current/*`.

### Step 4 — Create Current Docs

Draft the new current docs first, without deleting old docs yet.

Suggested current docs:

- `docs/current/overview.md`
- `docs/current/architecture.md`
- `docs/current/authoring-contract.md`
- `docs/current/content-guide.md`
- `docs/current/safety-grid.md`
- `docs/current/desktop-flow.md`
- `docs/current/render-workflow.md`
- `docs/current/maintenance.md`

### Step 5 — Consolidate AI-Facing Entry Points

Goal:

- Any AI reads the same project truth.
- Tool-specific files contain no unique project rules.

Tasks:

- Create or choose the canonical AI contract.
- Reduce `AGENTS.md` to a pointer.
- Reduce `CLAUDE.md` to a pointer if a neutral contract is created.
- Audit `.claude/commands/*`.
- Move any still-useful `.claude` instructions into the canonical contract or
  `docs/current/*`.
- Delete stale `.claude` commands that duplicate or contradict current docs.

Acceptance:

- Grep confirms project rules are not copied in multiple agent entry files.
- `.claude/` has no independent contract.

### Step 6 — Sync Root Docs

Update:

- `README.md`
- `AGENTS.md`
- `CLAUDE.md`

Rules:

- `README.md` for humans.
- `AGENTS.md` only points to current contract.
- `CLAUDE.md` is either the canonical contract or a compatibility pointer, never
  a second divergent contract.

### Step 7 — Delete Or Move Stale Docs

After current docs are complete and reviewed:

- delete stale historical specs if facts were extracted;
- do not keep old plans just because they are interesting;
- avoid an `archive/` folder unless the content is genuinely still useful.

### Step 8 — Verify With Grep

Run targeted searches and inspect every hit:

```bash
rg -n "@news/design|stylePack|StylePack|accentColor|Frame|Story|TitleBlock|KeyPoints|Panel|PICK mode|template kit|block toolkit" README.md CLAUDE.md AGENTS.md docs
rg -n "YouTube|youtube|16:9|long-form|Group J" README.md CLAUDE.md docs
rg -n "hard|block|error|warning|advisory|N14|N10|N16" CLAUDE.md docs
rg -n "scripts/new-video|_video-template|build-.*\\.ts" README.md CLAUDE.md docs
rg -n "Claude|Codex|Cursor|AGENTS|AI_CONTRACT|CLAUDE\\.md|\\.claude" README.md CLAUDE.md AGENTS.md docs .claude
```

Every remaining hit must be intentional and current.

### Step 9 — Run Health Checks

Docs-only changes usually do not need a full build, but because root agent docs
can affect future code generation, run at least:

```bash
npm.cmd run typecheck
npm.cmd test
```

If the cleanup touches scripts, package exports, or comments near build-time
code examples, also run:

```bash
npm.cmd run build
```

## Acceptance Criteria

This task is done when:

- The doc tree has a clear, agreed structure.
- There is exactly one canonical AI/project contract.
- Tool-specific files are pointers/adapters only.
- `.claude/` has no duplicated or contradictory project rules.
- No active doc recommends obsolete authored block imports.
- No active doc presents deleted `@news/design`/style-pack behavior as current.
- No active doc overstates YouTube production readiness.
- No active doc says aesthetic/layout warnings are hard gates unless live code
  truly does.
- Historical docs that do not protect current decisions are deleted.
- Any kept history is in ADRs or concise maintenance notes.
- A new agent can answer these quickly:
  - What is the current production path?
  - How does AUTHOR mode work?
  - What can authored scenes import?
  - What blocks render?
  - What checks are hard vs advisory?
  - Where do generated artifacts live?
  - What is pending/not production-ready?

## Owner Decisions Needed Before Editing Real Docs

1. Should the canonical AI contract be renamed to a neutral file such as
   `AI_CONTRACT.md`, with `CLAUDE.md` kept only as a pointer?
2. Should `AGENTS.md` become the only root pointer, with all tool-specific files
   pointing to the same neutral contract?
3. What should be allowed inside `.claude/` after cleanup: no files, pointers
   only, or command helpers that contain no duplicated project rules?
4. Should `docs/specs/freeform-engine/*` be deleted after extraction, or moved to
   an explicit archive?
5. Should `CLAUDE.md` stay long and self-contained, or become shorter with links
   to `docs/current/*`?
6. Should `docs/design-language.md` survive as visual guidance, or be merged into
   authoring/content docs?
7. Should `docs/refactor-backlog.md` survive, or should backlog items move into
   working notes/task files?
8. Should the local build-script workflow remain documented after fixing its
   template, or should desktop/MCP be the only blessed workflow?

## First Small Concrete Task After Approval

Recommended first action:

Fix the documented local authoring workflow mismatch.

Options:

- Update `scripts/_video-template.txt` to raw JSX/SVG AUTHOR scenes and keep
  `scripts/new-video.ts` as a supported workflow.
- Or remove `scripts/new-video.ts` from recommended docs until the template is
  modernized.

This should be done before broad doc deletion, because it is an active
misleading workflow.
