---
inclusion: manual
---

# Authoring Contract — AUTHOR-mode scenes

How to write Remotion scene `.tsx` modules that pass admission and look on-brand.
This is the contract enforced by the admission gate (N4/N5), the static grid
(N1–N9), and the render oracles (N14/N18–N22/N28–N30; N15/N17/N23 are exported
but not auto-run — see AGENTS.md "The Safety Grid").

## Where authored scenes live

- One module per distinct visual: `projects/<id>/authored/<scene-name>.tsx`.
- Files starting with `_` (e.g. the generated `_entry.tsx`) are reserved.
- `manifest.json` lists ordered scenes referencing the authored component ids.

## Required exports (every module)

```tsx
import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Content, TitleBlock } from "@news/blocks";

export const schema = z.object({ /* this scene's props */ });
type Props = z.infer<typeof schema>;

const Scene: React.FC<SceneComponentProps<Props>> = ({ headline, body, eyebrow, props }) => (
  <Frame>
    <Content>
      <TitleBlock headline={headline} body={body} />
      {/* bespoke imagery here (optional) */}
    </Content>
  </Frame>
);

export const example: Props = { /* a valid sample payload */ };
export default registerComponent<Props>({
  id: "my-scene",            // a literal string id, referenced by the manifest
  displayName: "My Scene",
  promptGuide: "when to use this scene",
  schema,
  Component: Scene,
  example,
});
```

- MUST export `default` (the `registerComponent(...)` result), `schema`, and
  `example`; `example` MUST satisfy `schema`.
- MUST call `registerComponent({ id: "..." })` with a **literal** string id.

## Import whitelist (N4)

Only these may be imported: `react`, `remotion`, `@news/design`,
`@news/blocks`, `@news/compositions`, `zod`. Nothing else (no `node:*`, no
third-party packages, no relative imports outside the file).

## Banned APIs (N5) — scenes are pure functions of the frame

No `Math.random`, `Date`/`Date.now`, `fetch`/`XMLHttpRequest`, `eval`/`Function`,
`require`/dynamic `import()`, `fs`/`child_process`/`process`,
`window.location`/`document.cookie`, or `dangerouslySetInnerHTML`. For randomness
use Remotion's `random(seed)`; for animation use `useCurrentFrame()` +
`interpolate`/`spring`.

## Blocks (`@news/blocks`) — compose these, don't re-code containers

**Editorial skeleton (default):**
- `Story` — full-frame editorial layout: a top `HeaderBar` + centered main panels
  + optional bottom `Footer`. Use this as the scene skeleton instead of a bare
  top-left title.
- `HeaderBar({ eyebrow, label?, meta? })` — top label strip (mono, accent chip).
- `Footer({ left, right? })` — bottom strip.
- `Panel({ title?, tone?, children })` — a framed, bordered content box (the core
  "boxed" element); `tone`: accent | signal | danger | neutral.
- `Tag({ tone?, children })` — a small mono chip/label.
- `TitleBlock({ headline, body? })` — a FRAMED headline card (top accent rule).
  There is NO bare big-headline-top-left + subtitle; the title is always framed.

**Content / data:**
- `Frame` — full-bleed neutral background.
- `Content({ align? })` — content-zone column (defaults to centred → upper-middle).
- `StatBlock({ value, unit?, label, tone? })` — a BIG number reveal (the main
  "visualize a figure" block). Evidence-gated: only real/supplied numbers.
- `KeyPoints({ items, title? })` — numbered list/recap (block owns numbering).
- `IdeaPanel`, `Callout`, `StatChip` — single idea / sharp statement / small figure.
- `Captions` — caption track (composition renders it; do NOT add it yourself).

A scene composes blocks freely and may add plain `<div>` layout (e.g. a flex row
of two `Panel`s for a compare). Imagery = bespoke deterministic SVG/CSS. Drawn
figure/avatar silhouettes, icons, glyphs, charts, diagrams and metaphors are all
fair game (and encouraged where they add clarity or polish) — the media ban is
ONLY for real/external assets (photos, screenshots, logos, uploads, image/video
URLs, auto-fetch), never for things you draw yourself.

## Layout zones (from `@news/schema`)

- `CONTENT_ZONE` — top safe margin → ~62% height. Primary content lives here;
  `Content` enforces it. N14 flags content outside it.
- `CAPTION_BAND` — ~64%–84% height; the burned-in single-line caption renders
  here. Do not place authored content here.
- `UI_RESERVE` — bottom ~16% + a right action-rail column; keep it empty (the
  host platform paints its own UI there).
- A global **black divider line** is drawn at the content-zone bottom (the caption
  boundary) on every video — you don't author it. Keep authored content ABOVE it:
  content drifting into the caption-clearance gap is a HARD N14 error (blocks the
  render), so leave a clear gap above the captions.
- **Balance the zone.** `Content`/`Story` centre vertically; a scene with only a
  short title + one line reads top-heavy / half-empty. Give a sparse beat a
  confident anchor (a bold stat, a small bespoke diagram) or let one element own
  the zone — don't leave a tiny block floating at the top. (Overcrowding is the
  opposite failure, warned by N30.)

## Design language (R17)

> The LOOK is owned by `docs/design-language.md` — **READ IT before authoring a
> bespoke visual.** In code terms, the only invariants you must not break:
> squared geometry (corner radius `0`), the fixed light **cream/ink** base with
> bold `4px` ink borders (never dark, never hairline), and the per-project
> `useTheme()` dominant color driving `accent`/`signal` + data-viz only. Keep
> text high-contrast (N18).

**Font sizes (readability).** The canvas is 1080×1920 viewed on a phone, so text
must be large. Primary content — headlines, body copy, list items, stat values —
should be roughly `40px+` (headlines far larger); never set primary text below
`32px`. Only genuinely secondary marks (chart axis labels, units, fine captions
inside a bespoke diagram) may go smaller, and never below `18px` — anything under
that is unreadable and is raised to the floor deterministically before render, so
don't rely on tiny text to fit content (condense the content instead).

**Reading style-pack chrome tokens (tool-productization R1).** The chosen
**style pack** (`bold-editorial` default, `clean-premium`, …) drives the decorative
"chrome". Bespoke imagery you author should READ these from `useTheme()` rather
than hard-coding the bold look, so the same scene adapts to the selected pack:
- `theme.chrome.border` / `theme.fonts` — or the `@news/blocks` helpers
  `chromeBorder(theme)`, `chromeBorderWidth(theme)`, `chromeShadow(theme, accent)`
  for borders/shadows.
- `theme.chrome.grid` / `theme.chrome.registrationTicks` — only draw the grid /
  ticks when the pack enables them (the `Frame` block already does this).
- `theme.chrome.accentCount` / `theme.chrome.density` — lean on a single accent
  and more whitespace when the pack is restrained.
Composed `@news/blocks` already adapt automatically; this only matters for the
bespoke SVG/CSS you draw yourself.

## Captions

Single-line Vietnamese captions are generated centrally from each scene's
`narration` (timed from the TTS SRT) and burned in. Do not author captions in
props or render your own subtitle text. The active word is highlighted with a
smooth eased ramp (word-paged karaoke) — also produced centrally, never authored.

## When to visualize vs. when to keep it simple (R18)

> The menu of visual FORMS and the count/shape mechanics live in
> `docs/visualization-playbook.md` — **run EVERY scene through it.** This section
> is only the contract-level rules; don't restate the playbook here.

- Before coding, make a one-line **visual plan** per scene: idea → content shape
  → chosen form (bespoke vs block). **Decompose the narration/headline for an
  embedded number, relationship, change, or process** — if one exists, prefer a
  visual that carries it (e.g. "X nhanh hơn Y" is a two-rate divergence → a line
  chart, not a sentence), and prefer a form not used yet in this video.
- **Visuals must EARN their place and FIT the content** — pick the form from the
  meaning, never because a component exists. **Do NOT lazily reuse one component
  for everything**: a video that is 10× the same `TitleBlock`+`KeyPoints` is a
  FAIL. Vary the form, layout, and rhythm; don't repeat one arrangement
  back-to-back. **Compose the layout to fit the actual item COUNT and content
  SHAPE** (the playbook's core rule) — never force every idea into one mould.
- **Author bespoke, topic-specific imagery for the signature beat(s)** — custom
  SVG/CSS built for THIS topic (e.g. a memory bar shrinking under a GPU-capacity
  line), not a generic chart. Bespoke code is the whole point of AUTHOR mode. Do
  NOT bootstrap by copying a previous project's authored components and swapping
  text.
- A clean text/list scene is a DELIBERATE choice for genuinely text content
  (definition/recap/CTA) — never a default for a scene you didn't design, and
  never the only mode. Diversity is advisory (the playbook nudges it; there is no
  hard "variety" oracle); layout-correctness (overflow / caption-clearance) is
  the hard gate.



Every scene needs deliberate, tasteful motion — content must neither just "pop" in
fully formed nor sit frozen. The rules:

- **Entrances settle.** Drive entrances with `useReveal`/`useRamp` (springs /
  clamped ramps, fps-aware) so they ease in and reach a steady state. The blocks
  already do this; compose them.
- **Ambient "living card" tilt.** The `Story`/scene parent wrapper slowly tilts
  from a slight LEFT lean to a slight RIGHT lean across the whole scene
  (`useTilt`, synced to scene end via `SceneTimingProvider`). This keeps the
  scene alive without the queasy "floating up" drift. Apply such ambient motion
  to the ONE parent wrapper that holds all the scene's floating blocks — never
  per-child — so they move together as a unit.
- **No perpetual oscillation / no unbounded motion.** Never animate off
  `Math.sin(frame)`, `frame % n`, a non-clamped `interpolate`, or a looping
  pulse. Monotonic motion that resolves by (or at) the scene end is fine; a
  shape that keeps bouncing forever reads as a bug.
- **One-time emphasis (zoom).** For an important figure, do a single visible
  "zoom in then settle" pop (`usePop` on `CountUp`) and/or a scene-entrance zoom
  (`useIntroZoom`). These settle to scale 1.0 before the midpoint, so they never
  trip N14 (which samples the midpoint still).
- **SVG transforms: scale/rotate about a point correctly.** CSS `transform-origin`
  is unreliable on SVG nodes — use `translate(cx cy) scale|rotate(...) translate(-cx -cy)`,
  or animate `opacity` + a small `translate`. Never combine an attribute
  `transform` with a CSS `transformOrigin`.
- **Captions are smooth karaoke.** The caption track highlights the spoken word
  with an EASED scale + color ramp (not a hard snap). It is generated centrally;
  do not author it.
- Stagger multiple elements so a scene assembles, but finish well before the hold.

## Duration target (rather over than under)

- Each project carries a soft target duration (the brief's `duration`); the N28
  oracle warns (advisory) if the finished video lands outside `target ± 20s`.
- **Rather over than under**: if you must miss, miss long. A video briefed at
  ~2 minutes should land ~120–140s, never ~70s. Add scenes / richer narration to
  reach the target rather than padding holds with silence.
- Free pacing still holds: scene count and per-scene length are not fixed presets,
  and a naturally longer Vietnamese render is fine. The target is a floor on
  substance, not a straitjacket.

## Render workflow (stills → draft → USER REVIEW → full)

Never jump straight to the expensive full render — this is mandatory every time,
not just while iterating:

1. **Stills** (mock voice, free) — eyeball layout/alignment per scene.
2. **Draft** (`renderProject(..., { quality: "draft" })`) — a fast preview at
   **20 fps**, half-res, ultrafast x264, max concurrency, with identical timing
   (motion is fps-aware). Use it (plus the render oracles + keyframe review) to
   catch MOTION/PACING bugs cheaply. Drafts write to `<id>.draft.mp4` and never
   touch the full-quality render cache.
3. **User review** — report the draft path to the user and let them watch + give
   feedback. Do NOT proceed to full on your own.
4. **Full** (`quality: "full"`) — the final, rendered at **30 fps**, only AFTER
   the user approves the draft (or explicitly asks to skip it) and the oracles
   are clean. TTS is cached, so the final render mostly just re-encodes (at full
   resolution).

## Transitions & timing

- Set `transitionToNext` per scene in the manifest (`slide` default; `fade` for
  recap/CTA). The lock makes the transition overlap land on a silent breath gap
  so no speech is clipped — you do not manage timing yourself.
- Real timing follows the measured Vietnamese TTS; a longer render than any
  target is fine when the voice is complete and unrushed.
