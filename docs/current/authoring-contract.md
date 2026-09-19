# Authoring Contract

This contract applies to AI-authored Remotion scene modules.

## Where Scenes Live

Scene modules live under:

```text
VIDEO_TOOL_HOME/.video-tool/projects/<id>/authored/
```

Each distinct visual should be its own `.tsx` module.

## Required Scene Module Shape

Every authored module must:

- import only allowed modules;
- export `schema`;
- export `example`;
- export a default `registerComponent(...)` result;
- use a literal string component id;
- render deterministic React/Remotion code.

`manifest.scenes[].id` is the timeline identity and must be exactly sequential:
`scene-01`, `scene-02`, and so on, with no descriptive suffix. The literal id passed
to `registerComponent(...)` is the component identity and must match
`manifest.scenes[].component`; it may be descriptive, such as `market-hook`.

Minimal shape:

```tsx
import React from "react";
import { useCurrentFrame, interpolate } from "remotion";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@motionreal/compositions";

export const schema = z.object({
  label: z.string(),
});

type Props = z.infer<typeof schema>;

const Scene: React.FC<SceneComponentProps<Props>> = ({ headline, props, durationInFrames, motionCueFrames }) => {
  const frame = useCurrentFrame();
  const progress =
    durationInFrames > 1 ? Math.min(1, Math.max(0, frame / (durationInFrames - 1))) : 1;
  const enter = interpolate(progress, [0, 0.18], [0, 1], { extrapolateRight: "clamp" });
  const focus = interpolate(progress, [0.25, 0.75], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div style={{ position: "absolute", inset: 0, background: "#0B0E14", color: "#F4F7FB" }}>
      <div style={{ position: "absolute", top: 140, left: 80, right: 80, opacity: enter }}>
        <div style={{ fontSize: 76, fontWeight: 800 }}>{headline}</div>
        <div style={{ marginTop: 32, fontSize: 44 }}>{props.label}</div>
        <div style={{ marginTop: 48, width: `${Math.round(focus * 100)}%`, height: 10, background: "#60A5FA" }} />
      </div>
    </div>
  );
};

export const example: Props = { label: "Example" };

export default registerComponent<Props>({
  id: "example-scene",
  displayName: "Example Scene",
  promptGuide: "Use for a clean statement beat.",
  schema,
  Component: Scene,
  example,
});
```

## Allowed Imports

Authored scenes may import only:

- `react`
- `remotion`
- `zod`
- `@motionreal/compositions`

`SceneImage` must be imported from `@motionreal/compositions` when a scene uses its
single local `image` field.

Do not import:

- `@motionreal/blocks`
- `@motionreal/theme`
- Node built-ins
- browser host APIs
- remote media libraries
- arbitrary package dependencies

## Deleted Surfaces

These are not available to authored scenes:

- `Frame`
- `Story`
- `TitleBlock`
- `KeyPoints`
- `Panel`
- `CountUp`
- `useTheme`
- authored-facing style selection
- theme tokens
- any authored-facing layout-block toolkit

Build objects, shapes, relations, paths, labels, evidence compositions, and
typography directly with raw JSX/SVG/CSS. Every scene authors its own full-bleed
Scene-Local Atmospheric Depth (a subtle radial spotlight placed behind the focal mass,
ambient dark gradient backdrop, and soft grounding grids/textures) rather than relying
on a flat `background: 'transparent'` canvas. Avoid the frosted glass card trap:
never wrap headlines and paragraphs into generic frosted glass `<div>` containers.
Use a card only when the represented thing is genuinely a card, document, UI record, or
independent choice; a card is not the default wrapper for an idea.

## Design Tokens & Palette Token Contract

Authored scenes must strictly adhere to the authoritative Palette Token Contract bound to the project's dominant theme color (default `#38BDF8`). Arbitrary hex codes outside this contract are strictly forbidden:

- `BG`: `"#0B0F17"` (Deep dark video background)
- `SPOTLIGHT`: `"rgba(r, g, b, 0.15)"` (Radial glow behind focal object)
- `ACCENT_PRIMARY`: `"#RRGGBB"` (Project dominant accent: icons, SVG paths, active borders, key metrics)
- `ACCENT_SECONDARY`: `"#818CF8"` or `"#38BDF8"` (Secondary accent: branches, transitional states)
- `TEXT_PRIMARY`: `"#FFFFFF"` (Headlines, primary copy — contrast > 7:1)
- `TEXT_MUTED`: `"#94A3B8"` (Secondary labels, captions, measurement units)
- `STATUS_ERR`: `"#EF4444"` (Errors, risks, warnings — borders and badges only)
- `STATUS_OK`: `"#10B981"` (Success, optimal — borders and badges only)

## Geometric Archetypes

To eliminate repetitive frosted glass card layouts ("toàn card thay vì visualize"), scenes must apply 4 positive geometric archetypes:

1. **Pipeline Dataflow:** 3 sequential processing stations connected via SVG `<path>` (`stroke=ACCENT_PRIMARY`, `strokeWidth=3`, `strokeDasharray="6 6"`), with payloads animating along the path. Path extends down to `y: 1250–1350px` for structural grounding.
2. **Dual Split-Core:** Symmetrical two-column comparison (`left: 100 & 570`, `width: 410`, `y: 340–1100px`), central SVG divider axis (`x1=540, y1=360, x2=540, y2=1200`), comparison badge ("VS" or criteria) at `x: 540, y: 700`, and pedestal grounding at `y: 1200–1320px`.
3. **Metric Gauge:** Circular or semi-circular SVG dial (`cx: 540, cy: 620, r: 200`) with muted track and animated progress arc (`stroke=ACCENT_PRIMARY`, `strokeDashoffset`), giant metric number (80–160px, white) at center, and radar sweep extending to `y: 1200–1300px`.
4. **Architecture Stack:** 3 minimalist architectural tiers (Input `y: 320px`, Logic `y: 620px`, Data `y: 920px`) with 1px borders, SVG bus connectors, and wide structural shelf at `y: 1200–1340px`.

Anti-repetition rule:
- No more than 2 consecutive scenes sharing the same layout structure.
- In 9–12 scenes, use at least 3 distinct layout archetypes, with at least 1–2 scenes featuring bespoke self-drawn SVG graphics.
- At most 1 card scene in the entire video; all other scenes must use Geometric Archetypes.

## Presentation profiles

Fresh content plans choose exactly one dominant `presentationProfile` from:
`editorial-story`, `mechanism-explainer`, `evidence-explainer`,
`procedural-guide`, `comparison-decision`, `narrative-conceptual`, or
`product-showcase`. The planner chooses by the viewer's dominant task, not by
topic label or source type. It receives only the profile names and short routing
descriptions.

Code authoring receives the shared technical contract, only the selected full
profile direction, and the approved narrative plan. It owns concrete objects,
composition and visible states while preserving narration, claims, scene order
and motion anchors. `visualMetaphor` and `layoutFamily` are starting suggestions,
not authorities: authoring must replace them when they conflict with the selected
profile. It never receives the six unselected creative profiles.
There is no `general`, `mixed`, secondary profile, or per-scene profile switch.
The profile is the dominant visual grammar rather than a single layout imposed
on every scene. Scene-level `visualMetaphor`, `layoutFamily`, `temporalMode`,
`detailMode`, and `motionBeats` remain the bounded way to vary individual scenes.
Legacy plans may still parse an old `visualPlan` field, but MotionReal strips it before code
authoring so it is no longer an authority or a required workflow gate. Plans
without `presentationProfile` retain the historical aggregate creative contract
so in-flight projects remain resumable.

## Determinism

Scene visuals must be pure functions of the frame.

`SceneComponentProps` includes top-level `durationInFrames`, provided by the
locked timeline. It is scene context, not schema `props`. Use it with
`useCurrentFrame()` to derive clamped scene progress:

```tsx
const frame = useCurrentFrame();
const progress =
  durationInFrames > 1 ? Math.min(1, Math.max(0, frame / (durationInFrames - 1))) : 1;
```

Use that `progress` value for semantic scene-local motion, not for every
transition by default. When the approved content plan includes
`motionProgression`, treat it as creative intent, not as a command that every
scene needs multi-stage motion. The safe default is a quick entrance followed by
a readable hold.

When the approved scene has `motionBeats`, `SceneComponentProps` also carries
scene-local `motionCueFrames`. Read every canonical beat id with a deterministic
relative fallback:

```tsx
const receiveAt =
  motionCueFrames?.["receive-request"] ?? Math.round(durationInFrames * 0.12);
const resultAt =
  motionCueFrames?.["show-result"] ?? Math.round(durationInFrames * 0.55);
```

Do not reveal a future state before its cue. A cue must change meaning—reveal,
focus, transform, extend a path/chart, or show a result—not merely change glow.
Earlier states may remain with less emphasis, and the final state needs a
readable hold. Admission rejects a semantic scene that omits a beat lookup or
its `??` fallback. If narration edits make anchors stale, MotionReal omits cues
for that scene and these relative fallbacks keep old projects renderable.

The content plan classifies review intent independently from authored styling:
`static` scenes receive overview coverage, `stepped` scenes receive a cue
filmstrip, and `continuous` scenes receive a denser cue filmstrip. `detailMode:
fine` adds one full-resolution frame for code, tables, small labels, or evidence
regions. Human scene review continues to use the per-scene midpoint files. These
classifications choose evidence only; they are not a motion DSL and do not give
the author permission to alter canonical motion beats.

- Quick entrance/reveal/pop: for titles, labels, cards, markers, or icons
  appearing. These should usually settle in about 0.2-0.8 seconds, or a small
  early part of the scene, using `frame`, `spring`, or clamped `interpolate`.
  Do not stretch a simple opacity/translate reveal across full scene progress.
- Semantic progression: use narration cues when the content itself changes over
  time, such as a line/path/chart draw, process, timeline, terminal result,
  before/after, focus shift, evidence highlight, or cause/effect beat.
- Continuous living motion: for purposeful wave, shimmer, pulse, signal flow,
  walking cycle, orbit, or light ambient depth. Use a deterministic phase/period
  after the entrance has settled, keep it small and bounded, and avoid motion
  that hurts text readability.

For time-based examples, compute from the current fps instead of assuming one
global frame rate:

```tsx
const frame = useCurrentFrame();
const { fps } = useVideoConfig();
const enterEnd = Math.max(1, Math.round(fps * 0.45));
const enter = interpolate(frame, [0, enterEnd], [0, 1], {
  extrapolateRight: "clamp",
});

const periodFrames = Math.max(1, Math.round(fps * 1.2));
const phase =
  ((Math.max(0, frame - enterEnd)) % periodFrames) / periodFrames;
const pulse = 0.96 + Math.sin(phase * Math.PI * 2) * 0.04;
```

Do not animate only the first tiny entrance of a long scene and then leave the
rest static unless the scene is intentionally a mostly-static statement beat.

Forbidden:

- `Math.random`
- `Date` / `Date.now`
- network calls
- filesystem calls
- `process`
- `eval` / `Function`
- dynamic imports
- `dangerouslySetInnerHTML`
- remote image/video URLs
- React Native-only keys **in `style={{…}}` / `style: {…}`** (`shadowColor`,
  `shadowOffset`, `shadowOpacity`, `shadowRadius`, `elevation`,
  `paddingHorizontal` / `paddingVertical` / `marginHorizontal` /
  `marginVertical`). Prefer web CSS (`boxShadow`, `textShadow`,
  `paddingLeft`/`paddingRight`, …). The pipeline expands simple padding/margin
  RN shorthands and strips residual RN keys in style objects only; admission
  rejects leftovers there. Data objects may still use a field named `elevation`.
- Prefer brand fonts: `Inter` / `Be Vietnam Pro` for body (and `Cascadia Mono`
  for code chrome). Avoid `system-ui` / `-apple-system` as the primary stack;
  the pipeline may rewrite those to the brand stack.
- SVG in React must use camelCase attributes (`strokeWidth`, `strokeDasharray`,
  `strokeDashoffset`, `strokeLinecap`, `strokeLinejoin`, `stopColor`,
  `stopOpacity`, `fillOpacity`, `clipPath`, `clipRule`, etc.). Kebab-case SVG
  attributes are normalized by the pipeline, but authored source should target
  standard React JSX camelCase properties to ensure compile-time determinism.


Use Remotion frame hooks, `interpolate`, `spring`, and `random(seed)` when
needed.

For `interpolate`, the input range must be strictly increasing. Do not pass a
circular range like `[340, 360, 60]`; split it into separate clamped
interpolations such as `340 to 360` and `0 to 60`, or normalize the value before
interpolating. Do not use `durationInFrames - N` as an end bound unless it is
clamped with something like `Math.max(1, durationInFrames - N)`; for semantic
progress, prefer the normalized `progress` value with input ranges inside
`[0, 1]`.

## Captions

Do not render subtitles or captions in authored scenes. Captions are generated
centrally from scene narration and TTS timing.

## Layout
 
For TikTok 9:16 (1080×1920), layout adheres to a Bimodal Layout Zones architecture aligned with the system canvas and caption geometry:

1. **Top Reserve (0%–12% / 0–230px):** Protected for host platform chrome (back button, search, sound info). Start eyebrows, headlines, or badges from ~12%–16% (y ≈ 230–300px); keep top reserve clear of text.
2. **Active Typography & Editorial Zone (12%–62% / 230–1190px):** Primary typography ceiling. All readable copy, headlines, card bodies, badges, and leaf conclusion text strictly terminate at or before **≤ 62%–64% (y ≤ 1228px)**. This creates a safe breathing buffer (> 140px) above the caption band, preventing any clash with karaoke subtitles or descending Vietnamese diacritics. Place the focal visual mass center around **~38%–46%** of frame height.
3. **Structural Grounding Extension (62%–70% / 1190–1350px):** Reserved exclusively for non-text structural graphics. SVG connector paths, pedestals, container drop-shadow shelves, ambient radial washes, and progress tracks extend down to **68%–70% (y ≤ 1350px)** to ground the scene visually and eliminate the bottom void. Zero readable text is permitted here.
4. **Caption Band (71%–86% / 1370–1650px):** Reserved exclusively for centrally burned-in single-line karaoke subtitles. Keep clear of authored typography and interactive visual objects.
5. **Bottom Reserve (86%–100% / 1650–1920px):** Platform user metadata and action rail reserve.

This is a soft composition preference—not a command to centre every scene—and deliberate top-aligned layouts inside the content zone or asymmetric layouts remain valid. Layout checks stay advisory unless live code marks a class as hard render-integrity failure. Avoid compressing scenes into an ungrounded narrow strip that leaves the lower half of the frame as an empty void.

## Art direction

Before authoring the scene modules, silently choose one video-level visual
grammar suited to the subject: a recessed background treatment, a narrow
background/text/accent palette, one restrained recurring motif, and a coherent
typography/spacing rhythm. Carry that grammar across the video, while adapting
the actual layout to each beat; do not copy the palette or look of an existing
publisher or product.

Each scene should be an editorial composition with one clear focal structure
(for example an evidence sheet, timeline, process, comparison, metric, diagram,
or visual metaphor). Supporting elements exist to clarify that structure—not to
fill space—and negative space is deliberate. Give the hook, turning point, and
payoff a stronger bespoke signature beat; keep explanatory scenes quieter but
still visually anchored. Real assets should participate as evidence or subjects
inside the composition, not default to a framed illustration. Logos and icons
remain supporting accents.
Every literal number, price, date, or percentage rendered through props, JSX,
SVG, or on-screen copy must come from the approved brief or content plan. Never
invent a decorative number just to make a visual look specific; use a qualitative
label when the approved material has no real number.
