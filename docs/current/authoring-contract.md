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

const Scene: React.FC<SceneComponentProps<Props>> = ({ headline, props, durationInFrames }) => {
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

Build containers, cards, lists, diagrams, charts, and typography directly with
raw JSX/SVG/CSS.

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

- Quick entrance/reveal/pop: for titles, labels, cards, markers, or icons
  appearing. These should usually settle in about 0.2-0.8 seconds, or a small
  early part of the scene, using `frame`, `spring`, or clamped `interpolate`.
  Do not stretch a simple opacity/translate reveal across full scene progress.
- Semantic progression: use scene `progress` when the content itself changes
  over time, such as a line/path/chart draw, process, timeline, before/after,
  map movement, focus shift, or cause/effect beat. A final hold after the main
  beat lands is valid and often desirable.
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
- React Native-only style keys in objects (`shadowColor`, `shadowOffset`,
  `shadowOpacity`, `shadowRadius`, `elevation`, `paddingHorizontal` /
  `paddingVertical` / `marginHorizontal` / `marginVertical`). Prefer web CSS
  (`boxShadow`, `textShadow`, `paddingLeft`/`paddingRight`, …). The pipeline
  expands simple padding/margin RN shorthands and strips residual RN keys;
  admission still rejects leftovers.
- Prefer brand fonts: `Inter` / `Be Vietnam Pro` for body (and `Cascadia Mono`
  for code chrome). Avoid `system-ui` / `-apple-system` as the primary stack;
  the pipeline may rewrite those to the brand stack.

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

For TikTok 9:16, keep primary content in the upper content zone and leave the
caption/platform reserve clear. These layout checks are advisory warnings for
refine unless live code marks a class as hard render-integrity failure.

The product is short-form 9:16 only; always leave the burned caption band clear.
