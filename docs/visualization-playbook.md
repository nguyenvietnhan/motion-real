# Visualization Playbook — news_remotion_tool

A menu of ways to **show** content, so an authoring AI never defaults to "count-up
number + numbered list" for everything. Read this together with
`docs/design-language.md` (the LOOK) and `.kiro/steering/authoring-contract.md`
(the rules). This doc answers one question: *given THIS idea, what is the most
fitting visual form — and how do I make it different from the last scene?*

## How to use this (the rule that matters)

1. For **each** scene, name the idea in one phrase, then name its **content
   shape** (a number? a tradeoff? a change over time? a process?).
2. Pick a visual **form** from that shape's row below — and prefer a form you
   have **not** used yet in this video.
3. For the video's **signature beats** (the 2–4 most important ideas), author a
   **bespoke, topic-specific** visual (deterministic SVG/CSS) — not a generic
   chart. Bespoke code is the whole point of AUTHOR mode.
4. The blocks (`@news/blocks`) are a **guardrail/mould** so you don't break the
   layout — they are NOT the default content. Composing them is fine; leaning on
   the same 3–4 of them for a whole video is a FAIL.

> These forms are **inspiration, not a closed catalog.** Invent new ones when the
> concept calls for it. Constraints always apply: the squared/cream design
> language, deterministic frame-pure code (no `Math.random`/`Date`), the evidence
> gate (only visualize numbers/sources actually supplied), and the media rule
> (draw in SVG/CSS freely — the ban is ONLY real/external assets; see AGENTS.md).

## Forms by content shape

**A single number / magnitude**
- Giant count-up (`CountUp`) — use sparingly, it's the obvious one.
- A unit grid (e.g. 100 squared cells, N filled) for a proportion/percentage.
- A single horizontal/vertical bar filling to the value against a labeled scale.
- A ring/arc gauge (squared-cap arc) — a dial that sweeps to the value.
- A "before vs after" pair of blocks when the number is a *reduction/increase*.

**Two-way comparison / tradeoff**
- Two `Panel`s side by side (the default — use it at most once per video).
- A split frame with a diagonal/vertical divider and a label on each side.
- An overlay: one faint "ghost" state behind a solid "current" state.
- A small scorecard table (rows = criteria, two columns, ticks/marks).
- A balance/scale metaphor tipping toward one side.

**Change over time / before → after**
- A card that **rewrites itself**: old text struck through, new text revealed.
- A two-state diff (left = stale/greyed, right = live/accented) with an arrow.
- A pin/marker that moves, or a label that updates from "soon" → "done".
- A value animating from the old figure to the new (monotonic, settles).

**Process / steps / flow**
- Numbered step blocks connected by arrows/spine (horizontal or vertical).
- A loop/cycle diagram (e.g. a background process that repeats) — arrows return.
- A pipeline: input → transform → output boxes.
- A branch/decision: one box splitting into two paths.

**Enumeration (3–4 items)**
- A row of standing cards (4 → wrap to a 2×2 grid, never a cramped row).
- A numbered list (`KeyPoints`) — fine for recaps; not for every list.
- Icon/tile tiles with a one-line label each (bespoke squared glyphs).
- A staggered checklist that ticks in.

**Part-to-whole / proportion / %**
- A 10- or 100-cell fill meter (squared).
- A stacked single bar segmented by share.
- A squared "waffle" grid.
- Avoid pie/donut (rounded; off design language) unless squared-styled.

**Relationship / mapping / architecture**
- A bespoke node-and-edge diagram (boxes + connectors).
- A layered stack (e.g. local model under a cloud layer).
- A 2×2 matrix / quadrant when two axes matter.
- A hub-and-spoke when one thing relates to many.

**Ranking / ordering / distribution**
- A sorted bar chart (longest → shortest), labeled with real values.
- A leaderboard of rows with rank chips.
- A number line / scale with markers placed at real positions.

**Timeline / evolution across versions**
- A vertical or horizontal timeline with year/version nodes (latest accented).
- A "generations" strip (v1 → v2 → v3) with a one-line note each.

**A definition / concept / sharp statement**
- A framed `TitleBlock` + `Callout` (clean, valid for hooks/CTAs/takeaways).
- A single bold metaphor visual (one strong SVG idea, lots of negative space).

## Anti-patterns (these are why videos feel lazy)

- ❌ Every figure as a `CountUp`; every list as `KeyPoints`. Rotate the forms.
- ❌ The same arrangement two scenes in a row. Vary column count, framing, rhythm.
- ❌ Copying a previous project's authored components wholesale and only swapping
  text. Author fresh visuals for THIS topic's concepts.
- ❌ A whole video built from the generic blocks with zero bespoke imagery. At
  least the signature beats must be custom-built for the topic.
- ❌ Decorative visuals that don't carry meaning (filler charts, fake data). Note:
  a drawn avatar silhouette, icon, or motif that aids recognition/polish is NOT
  "filler" — it earns its place; this rule targets meaningless decoration only.
- ❌ Overcrowding — packing many ideas/blocks edge-to-edge into one scene (the
  N30 oracle warns). One idea per scene with breathing room; split instead, and
  condense narration to the essential sentence.

## A worked example (so the intent is unambiguous)

Topic beat: *"ChatGPT's memory now updates itself — it used to think you were
still in Singapore; now it knows you came home."*
- Lazy: a two-`Panel` compare with two sentences. (What was shipped — too generic.)
- Better (bespoke, fits "change over time"): a memory **card that rewrites
  itself** — line 1 "đang ở Singapore" gets struck through and greyed, line 2
  "đã về nhà · tháng 7/2026" reveals in the accent color, with a small "updated"
  tick. One custom SVG/CSS scene that *is* the idea.

When in doubt: ask "does this visual only make sense for THIS sentence?" If it
would fit any topic unchanged, it's probably too generic for a signature beat.
