// component: typecheck-duration-in-frames
// A clean authored scene proving durationInFrames is available as top-level
// scene context from @motionreal/compositions.
import React from "react";
import { useCurrentFrame } from "remotion";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@motionreal/compositions";

export const schema = z.object({});

type Props = z.infer<typeof schema>;

const Scene: React.FC<SceneComponentProps<Props>> = ({ headline, durationInFrames }) => {
  const frame = useCurrentFrame();
  const progress =
    durationInFrames > 1 ? Math.min(1, Math.max(0, frame / (durationInFrames - 1))) : 1;

  return (
    <div style={{ position: "absolute", inset: 0, background: "#101820", color: "#F5F7FA" }}>
      <h1>{headline}</h1>
      <p>{progress.toFixed(2)}</p>
    </div>
  );
};

export const example: Props = {};

export default registerComponent<Props>({
  id: "typecheck-duration-in-frames",
  displayName: "Typecheck Duration In Frames",
  promptGuide: "Fixture: durationInFrames is top-level scene context; must pass N10.",
  schema,
  Component: Scene,
  example,
});
