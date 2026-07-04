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

  return (
    <div style={{ position: "absolute", inset: 0, background: "#0B0E14", color: "#F4F7FB" }}>
      <div style={{ position: "absolute", top: 140, left: 80, right: 80, opacity: enter }}>
        <div style={{ fontSize: 76, fontWeight: 800 }}>{headline}</div>
        <div style={{ marginTop: 32, fontSize: 44 }}>{props.label}</div>
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

Use Remotion frame hooks, `interpolate`, `spring`, and `random(seed)` when
needed.

## Captions

Do not render subtitles or captions in authored scenes. Captions are generated
centrally from scene narration and TTS timing.

## Layout

For TikTok 9:16, keep primary content in the upper content zone and leave the
caption/platform reserve clear. These layout checks are advisory warnings for
refine unless live code marks a class as hard render-integrity failure.

For YouTube format, there is no burned caption band, but long-form YouTube is
not yet the stable production path.
