# Design Language — news_remotion_tool

The single source of truth for the LOOK. Any AI authoring a scene (especially
when writing bespoke visualization code) must follow this so every video reads as
one coherent, premium product — the way a web design system keeps a site
consistent. Tokens live in `@news/design`; layout zones in `@news/schema/zones`;
reusable pieces in `@news/blocks`. This doc is the philosophy behind them.

## The system in one line

**Multiple self-contained DESIGN LANGUAGES over one invariant layout law.** A
"style" is not a color swap on one frozen look — it is a complete visual language
(`StyleLanguage` in `@news/design/core.ts`) that owns its OWN polarity, corner
geometry, surface grammar, fonts, color series, and backdrop, and derives all of
it from one per-project dominant hue. Every language obeys the SAME layout law
(zones, caption band, divider, determinism, minimum type sizes). One set of
blocks renders every language by reading the resolved theme; adding a language is
one new file under `languages/` + one registry line.

Two ship today:

- **`bold-editorial`** (default) — light editorial print: a warm cream paper base,
  near-black ink, bold SQUARED borders, a solid accent top-rule + hard-offset drop
  shadow, vivid print accents, uppercase mono labels, a faint grid + corner
  registration ticks. Like a high-end print magazine / data-brief.
- **`galaxy`** — premium dark space: a deep radial night base with light ink,
  FULLY ROUNDED corners, hairline borders that glow faintly, a soft NEON GLOW
  instead of a hard drop, outline (not solid) chips, natural-case labels, a
  deterministic starfield backdrop, neon-tuned semantic colors, Be Vietnam Pro.

## What is INVARIANT vs what VARIES

This split is the whole architecture. Get it right and the system scales to many
languages without touching blocks.

**INVARIANT (the "physics" — no language may move these):**

- **Layout zones** (`@news/schema/zones`): the content zone, the caption band, the
  bottom/right platform-UI reserve, and the content/caption divider line. Every
  language shares the exact same zones; the N14 oracles measure against them.
- **Determinism**: scenes are pure functions of the frame (no `Math.random`/`Date`/
  IO; see the banned-API list in the authoring contract).
- **Minimum type sizes**: primary text large (≈40px+), nothing below the 18px
  floor — readability on a phone is not negotiable.
- **High contrast** (N18): text must read clearly on its base, whatever the base.
- **Captions**: one shared single-line karaoke band, generated centrally.

**VARIES per language (the "look" — each language decides freely):**

- Base **polarity** (light cream vs deep night) and the whole palette derivation.
- **Corner geometry** (squared radius 0 vs rounded radius scale).
- **Surface grammar**: border weight/color, panel fill (solid vs glassy), shadow
  model (hard-offset / glow / soft / none), whether blocks lead with a solid
  accent top-rule, chip style (solid vs outline), label tracking + case.
- **Fonts** (display/body/mono stacks).
- **Semantic color series** (print hues vs neon).
- **Frame backdrop** (flat + grid + ticks vs radial + starfield).
- **Caption scrim** (none vs a faint polarity-matched plate).

## How a block stays language-agnostic

Blocks NEVER hard-code a color, a corner, or a border. They read tokens from the
resolved `Theme` via the surface-kit (`@news/blocks/chrome`):

- `surfaceBorder(theme)` / `surfaceBorderWidth(theme)` / `innerDivider(theme)` —
  border per the language (4px ink, hairline glow, or none).
- `surfaceRadius(theme, "sm"|"md"|"lg")` — corner radius per the language (0 for
  editorial, the rounded scale for galaxy).
- `surfaceShadow(theme, accent)` — the language's shadow (hard-offset / glow /
  soft / none).
- `blockSurface(theme, { accent, size, fill, shadow })` — the composite
  border+radius+fill+shadow for a floating block; spread it and add layout.
- `topRuleStyle(theme, color)` — the accent top-rule bar, or `null` for languages
  that express accent another way (galaxy returns null).
- `chipStyle(theme, color, onColor)` / `labelStyle(theme)` — eyebrow/label chip +
  mono label treatment (solid vs outline, uppercase vs natural case).

Color reads go through `useTheme()` → `theme.colors.*`. The canonical keys are
`bg`, `bgElevated`, `panel`, `fg`, `muted`, `accent`, `signal`, `line`, and the
semantic series `red`/`blue`/`yellow`/`green`/`violet`. Standard-name synonyms
also resolve (`ink`→`fg`, `paper`→`bg`, `primary`→`accent`, `border`→`line`,
`surface`/`card`→`panel`, …); an unknown token falls back to `fg` at render time
(never crashes, but it is a mis-color — stick to the listed keys).

## Layout & zones (`@news/schema/zones`)

- Primary content lives in the **content zone** (upper/middle band) — compose
  `Story`/`Content`. The **caption band** + bottom/right **platform-UI reserve**
  stay clear of authored content. A global divider line marks the content/caption
  boundary (drawn on every video, in the language's `fg`/line color); content must
  stay above it — drifting into the caption-clearance gap is a hard N14 error.
- No top-left big-headline + small-subtitle convention. The title is a FRAMED
  card (`TitleBlock`).
- **Compose the layout to fit the content** (count + shape): adapt the
  arrangement to the real item count and the content's shape, and vary the form
  across scenes — never one rigid mould. The menu of forms lives in
  `docs/visualization-playbook.md`; don't reproduce it here.

## Motion (invariant across languages)

- Disciplined and deterministic (pure functions of the frame).
- **Entrances settle** (springs / clamped ramps, fps-aware).
- **Ambient:** the scene's block wrapper tilts subtly in 3D (≈5°, left→right
  across the scene) — alive, never jittery. No perpetual oscillation
  (`Math.sin(frame)` etc. are banned).
- **Emphasis (AI-chosen, per scene):** a whole-scene punch-in zoom on key beats
  (`emphasis:"zoom"` in the manifest — hook, big reveal), plus a one-time pop on
  an important figure. Reserve it; do not zoom every scene.
- **Captions:** burned-in single-line karaoke — the spoken word eases up in scale
  + color (smooth, not a hard snap). The halo + optional scrim match the
  language's polarity.
- **Transitions:** `springTiming` with varied DOM presentations (slide/wipe/
  clock-wipe/zoom), ~0.5s. No WebGL transitions (non-deterministic in render).

## Imagery rules (invariant across languages)

- Bespoke imagery = deterministic **SVG/CSS only** (charts, meters, diagrams,
  metaphors, figure/avatar silhouettes, icons, glyphs). The ban is on real/external
  media only — **photos, screenshots, logos, uploads, image/video URLs** — never on
  shapes you draw yourself, which are encouraged where they aid clarity or polish.
  (The one sanctioned real image is a user-attached asset via `<SceneImage>`.)
- Bespoke imagery must READ its colors/border/radius from `useTheme()` + the
  surface-kit, so the same drawn chart is squared-on-cream in editorial and
  rounded-with-glow in galaxy — never hard-code a hex or a `0` radius.
- Author imagery for the signature beats; it must carry meaning and fit the
  content. Decorative filler is a fail.
- Evidence gate: only visualize numbers/sources actually supplied — never invent
  data to fill a chart.

## Adding a new design language

1. Create `packages/design/src/languages/<id>.ts` exporting a `StyleLanguage`:
   its `fonts` (leading family MUST be a render-safe vendored face — today Inter,
   Be Vietnam Pro, Cascadia Mono), a pure `derive(dominant)` returning the full
   `{ colors, surface, radius, backdrop, captionScrim? }`, a `preview` for the
   picker thumbnail, and a `contract` (the Vietnamese authoring slice for THAT
   look, appended to the BASE contract when the AI writes scenes).
2. Add it to `BUNDLED` in `style-packs.ts`.
3. That's it — no edits to blocks, the base contract, or other languages. A new
   coherent look exists end-to-end (palette, surfaces, backdrop, picker chip, AI
   authoring rules). A new vendored font needs a `scripts/vendor-fonts.ts` run.

## Quick "don't" list

- ❌ hard-code a color hex, a `border`, a `0`/`Npx` radius, or a shadow in a block
  or bespoke SVG — read tokens from `useTheme()` + the surface-kit
- ❌ assume the editorial look (cream/squared/ink border) — the language may be
  galaxy (dark/rounded/glow); both are first-class
- ❌ top-left eyebrow+headline header, authored caption text, word-by-word karaoke
  that snaps
- ❌ perpetual/looping motion, zoom on every scene, CSS `transform-origin` on SVG
  nodes
- ❌ photos/logos (except a user asset via `<SceneImage>`), invented numbers, the
  same layout every scene
