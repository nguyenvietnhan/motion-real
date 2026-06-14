# Buyer Guide — news_remotion_tool

A production-grade generator for Vietnamese 9:16 short-form **news** videos. An
AI agent authors brand-new Remotion (React) scenes for every video; an
enumerated safety grid (N1–N30) keeps quality stable. This guide covers install,
configuration, the CLI and MCP workflows, style-pack selection, bulk production,
and the quality guarantees. It defers to the canonical contracts
(`CLAUDE.md`, `docs/authoring-contract.md`,
`docs/visualization-playbook.md`, `docs/design-language.md`,
`docs/ai-content-guide.md`) rather than restating them.

## 1. Install & configure

Prerequisites: Node.js 20.6+ (for `--env-file`), `ffmpeg` on PATH, and a
headless Chromium (downloaded by Remotion on first render). Then:

```bash
npm install
```

Configure the Vivibe (LucyLab) TTS voice in `.env` (see `.env.example`):

```
VIVIBE_API_KEY=...        # or VIETNAMESE_API_KEY
VIVIBE_VOICE_ID=...       # or VIETNAMESE_VOICEID
# optional: VIVIBE_BASE_URL, VIVIBE_RETRY_ATTEMPTS, VIVIBE_RETRY_BASE_DELAY_MS
```

Voice is **always Vivibe** — the tool never silently downgrades to a
lower-quality or offline voice. If the config is incomplete, the pipeline stops
and names the exact missing key/voice id.

Verify readiness at any time:

```bash
npx tsx packages/pipeline/src/cli/cli.ts doctor
```

`doctor` runs **every** check (Vivibe `.env`, ffmpeg, browser, registry, style
packs, Vietnamese font coverage, MCP wiring), never short-circuits, and prints
an actionable remediation for each failure plus an overall ready/not-ready.

## 2. Make one video (CLI)

The reliable path is the single-process build script (see `AGENTS.md`):

```bash
npx tsx scripts/new-video.ts <project-id> "Video title"   # writes scripts/build-<id>.ts
# author the scenes for your topic under projects/<id>/authored/, then:
npx tsx scripts/build-<id>.ts stills                       # fast layout check (mock voice)
npx tsx --env-file=.env scripts/build-<id>.ts draft vivibe # draft for review
npx tsx --env-file=.env scripts/build-<id>.ts full  vivibe # final, ONLY after approval
```

Or drive the pipeline CLI directly:

```bash
pipeline ingest <url> [--id <id>]      # ground a topic: writes planning/<id>.md (text+metadata only)
pipeline author scaffold "<topic>"     # create project skeleton + manifest + authored/ dir
pipeline render <id> --draft           # fast low-res preview (always do this first)
pipeline render <id>                    # full render — refused unless a draft exists
pipeline preview <id>                   # print the Remotion Studio command
```

**Draft-first is enforced**: a full render is refused unless a prior draft
exists for the project (override with `--force-full` only when intentional).

## 3. Style packs (selectable look)

Set `theme.stylePackId` in the manifest per project:

| Pack | Look |
|------|------|
| `bold-editorial` (default) | Bold ink borders, hard-offset shadow, decorative grid + registration ticks, full accent set — the signature editorial look. |
| `clean-premium` | Hairline/none borders, soft diffuse shadow, no grid/ticks, single accent, airy spacing — restrained "premium". |

An unknown id is a hard error (before TTS) that lists the registered ids; no id
defaults to `bold-editorial`. Adding a pack is one registry entry
(`packages/design/src/style-packs.ts`) — no scene edits. Every pack is backed by
a bundled Google font carrying the **vietnamese** subset (Inter / Be Vietnam Pro
/ Cascadia Mono), so Vietnamese diacritics render with no fallback face on any
machine.

## 4. Programmatic surface (MCP)

The MCP server (server `news` in `.mcp.json`) exposes the pipeline
as typed tools over stdio, driving the **same** orchestrator as the CLI:

`ingest_url`, `scaffold_project`, `render_draft`, `render_full`, `doctor`,
`list_projects`, `tracker_list`, `tracker_add`, `tracker_update`.

Each tool returns a structured result; on failure it carries the same
stage/cause/check/remediation a buyer sees on the CLI. The draft-first gate, the
full grid, determinism, and the Vivibe voice rule apply identically. Start it
manually with:

```bash
npx tsx --env-file=.env packages/mcp/src/bin.ts
```

## 5. Bulk production (overnight, resumable)

Queue work in a tracker (JSON or CSV) and run the resumable bulk loop:

```bash
pipeline tracker add <url> --id n1 --title "..." --source "..."
pipeline tracker list
pipeline bulk --tracker tracker.json --limit 20
```

The loop reduces over non-`done` items, persisting each status transition so a
restart **resumes without redoing** completed work. On an API/usage limit it
marks the current item `paused-resumable` and stops gracefully (the tracker
stays valid); a later run finishes the rest. A single item failure is recorded
as `failed` + reason and the run **continues**. The shared TTS/render caches mean
unchanged work is never re-synthesized or re-rendered. Authoring of each item is
performed by the driving agent (no in-tool planner); the loop owns the
ingest/render/tracker bookkeeping.

## 6. Quality guarantees (invariants)

- **Safety grid N1–N30** gates lock/render/done; hard checks block, warnings are
  advisory. Every check ships with a non-vacuous self-test.
- **Determinism**: scene visuals are pure functions of the frame; a re-render of
  identical inputs is byte-stable and cache-served.
- **Evidence gate (N9)**: no fabricated sources, dates, prices, percentages, or
  quotes; ingested research is an input, never auto-promoted to on-screen fact.
- **Captions**: burned-in, word-paged karaoke Vietnamese captions, generated
  centrally from the TTS timing.
- **Vietnamese rules**: digits as digits; brand/model names in English; no
  phonetic spellings or spaced abbreviations.
- **Draft-first**: a cheap preview is always produced before the full render.
- **Workspace hygiene**: artifacts live only under `.video-tool/` + `planning/`,
  never the repo root.

## 7. Non-goals (explicit)

- No real-image scraping/embedding — ingest is text + metadata only; the media
  ban stands (anything drawn in SVG/CSS is allowed and encouraged).
- No local/offline TTS — Vivibe is the voice, never downgraded.
- No fixed template catalog — style packs parametrize the look; every video is
  freshly authored code (pure AUTHOR mode).
- No in-tool LLM planner — the driving agent is the authoring brain.
- No chasing volume past the gate — every bulk item passes the same N1–N30 grid
  and the draft-first gate.

## Operational notes

- The MCP `news` entry uses `--env-file=.env`; ensure `.env` exists where the MCP
  client launches the server, or it will fail to start. `doctor` will flag a
  missing Vivibe config regardless.
- A longer `renderDuration` after natural Vietnamese TTS is NOT a rerender reason
  if the voice is complete, uncut, and unrushed.
