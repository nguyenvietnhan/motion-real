# Design Language — news_remotion_tool

The single source of truth for the LOOK. Any AI authoring a scene (especially
when writing bespoke visualization code) must follow this so every video reads as
one coherent, premium product — the way a web design system keeps a site
consistent. Tokens live in `@news/design`; layout zones in `@news/schema/zones`;
reusable pieces in `@news/blocks`. This doc is the philosophy behind them.

## The look in one line

**Light editorial print.** A warm cream paper base, near-black ink, bold squared
borders, vivid print accents, mono labels, and registration ticks — like a
high-end print magazine / data-brief, not a glossy dark UI.

## Palette (`@news/design`)

- **Base:** cream paper `#F2ECDC` (bg), near-white panel `#FCF9F1`, ink
  `#17150F` (text + all borders), warm grey `#6E6757` (muted/labels).
- **Accents:** one per-project `dominant` hue drives `accent` + a split-complement
  `signal`; the fixed `PRINT` set (`blue #2F5FF0`, `red #E8412E`, `yellow
  #F4B400`, `green #1FA463`, `violet #7A4DE0`) is for semantic, multi-color use
  (compare sides, chart series, danger). Use `onColor(hex)` to pick ink/paper text
  on a solid fill.
- The base is FIXED and high-contrast so it reads in dark / bright / glare; only
  accents change per project. Never put the base toward dark — this is a LIGHT system.

## Geometry & type

- **Squared. Corner radius is 0** — never round a card, chip, bar, or button.
- Every block is a clearly delineated unit: a bold `4px` ink border, often with a
  solid accent top-rule and an offset hard shadow (`Npx Npx 0 accent`).
- Display type: heavy (`800–900`), tight tracking, large. Mono (`Cascadia Mono`)
  for eyebrows / labels / numbers-as-data / footers — uppercase, letter-spaced.
- High contrast always (ink on cream / paper on accent). No low-contrast greys for
  primary text.

## Layout & zones (`@news/schema/zones`)

- Primary content lives in the **content zone** (upper/middle band) — compose
  `Story`/`Content`. The **caption band** + bottom/right **platform-UI reserve**
  stay clear of authored content. A global black divider line marks the
  content/caption boundary (drawn on every video); content must stay above it —
  drifting into the caption-clearance gap is a hard N14 error.
- No top-left big-headline + small-subtitle convention. The title is a FRAMED
  card (`TitleBlock`).
- **Compose the layout to fit the content** (count + shape): adapt the
  arrangement to the real item count and the content's shape, and vary the form
  across scenes — never one rigid mould. The menu of forms lives in
  `docs/visualization-playbook.md`; don't reproduce it here.

## Motion

- Disciplined and deterministic (pure functions of the frame).
- **Entrances settle** (springs / clamped ramps, fps-aware).
- **Ambient:** the scene's block wrapper tilts subtly in 3D (≈5°, left→right
  across the scene) — alive, never jittery. No perpetual oscillation
  (`Math.sin(frame)` etc. are banned).
- **Emphasis (AI-chosen, per scene):** a whole-scene punch-in zoom on key beats
  (`emphasis:"zoom"` in the manifest — hook, big reveal), plus a one-time pop on
  an important figure. Reserve it; do not zoom every scene.
- **Captions:** burned-in single-line karaoke — the spoken word eases up in scale
  + color (smooth, not a hard snap). No box; ink text with a paper halo.
- **Transitions:** `springTiming` with varied DOM presentations (slide/wipe/
  clock-wipe/zoom), ~0.5s. No WebGL transitions (non-deterministic in render).

## Imagery rules

- Bespoke imagery = deterministic **SVG/CSS only** (charts, meters, diagrams,
  metaphors, figure/avatar silhouettes, icons, glyphs). The ban is on real/external
  media only — **photos, screenshots, logos, uploads, image/video URLs** — never on
  shapes you draw yourself, which are encouraged where they aid clarity or polish.
- Author imagery for the signature beats; it must carry meaning and fit the
  content. Decorative filler is a fail.
- Evidence gate: only visualize numbers/sources actually supplied — never invent
  data to fill a chart.

## Quick "don't" list

- ❌ dark backgrounds, rounded corners, low-contrast text
- ❌ top-left eyebrow+headline header, caption background box, word-by-word karaoke that snaps
- ❌ perpetual/looping motion, zoom on every scene, CSS `transform-origin` on SVG nodes
- ❌ photos/logos, invented numbers, the same layout every scene
