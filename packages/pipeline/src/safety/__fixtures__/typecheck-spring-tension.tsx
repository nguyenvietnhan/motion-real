// component: typecheck-spring-tension
// Regression fixture for an authored Remotion spring config that used
// `tension`, which is not part of Remotion's SpringConfig contract.
import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@motionreal/compositions";

export const schema = z.object({});

type Props = z.infer<typeof schema>;

const Scene: React.FC<SceneComponentProps<Props>> = ({ headline }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({
    frame,
    fps,
    config: {
      tension: 160,
      damping: 18,
    },
  });

  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "#101820", color: "#F5F7FA" }}>
      <h1 style={{ transform: `scale(${scale})` }}>{headline}</h1>
    </div>
  );
};

export const example: Props = {};

export default registerComponent<Props>({
  id: "typecheck-spring-tension",
  displayName: "Typecheck Spring Tension",
  promptGuide: "Fixture: invalid Remotion spring config field must hard-fail N10.",
  schema,
  Component: Scene,
  example,
});
