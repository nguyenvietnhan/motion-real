// component: typecheck-clean
// A clean authored scene: raw JSX/CSS + a correctly-typed <SceneImage>. N10 must
// NOT flag this. Mirrors how a correct scene is now written (no layout blocks).
import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps, SceneImage } from "@motionreal/compositions";

export const schema = z.object({
  points: z.array(z.string()),
});

type Props = z.infer<typeof schema>;

const Scene: React.FC<SceneComponentProps<Props>> = ({ headline, props, image }) => {
  return (
    <div style={{ position: "absolute", inset: 0, background: "#0B1020", padding: 80, color: "#fff" }}>
      <h1 style={{ fontSize: 84, margin: 0 }}>{headline}</h1>
      <ul style={{ fontSize: 40 }}>
        {props.points.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
      {image ? <SceneImage imageRef={image.ref} alt={image.alt} maxHeight={600} /> : null}
    </div>
  );
};

export const example: Props = { points: ["a", "b", "c"] };

export default registerComponent<Props>({
  id: "typecheck-clean",
  displayName: "Typecheck Clean",
  promptGuide: "Fixture: correct raw-JSX + SceneImage usage; must pass N10.",
  schema,
  Component: Scene,
  example,
});
