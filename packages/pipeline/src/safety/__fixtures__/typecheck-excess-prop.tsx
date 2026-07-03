// component: typecheck-excess-prop
// A scene that passes an UNDECLARED prop to the SceneImage component — the
// recurrent model habit of adding props a component never declares. At RUNTIME
// React drops an undeclared prop, so the scene renders fine; it only fails the
// transpile-only typecheck. N10 must flag this as a WARNING (not a hard error).
// SceneImage is typed `{ imageRef; alt?; maxHeight?; style? }` — it has no
// `caption`, so `caption=` is the excess-attribute error (TS2322,
// "... does not exist on type 'IntrinsicAttributes …").
import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps, SceneImage } from "@motionreal/compositions";

export const schema = z.object({
  label: z.string(),
});

type Props = z.infer<typeof schema>;

const Scene: React.FC<SceneComponentProps<Props>> = ({ props, image }) => {
  return (
    <div style={{ position: "absolute", inset: 0, padding: 80 }}>
      {/* `caption` is not a declared prop of SceneImage → TS2322 excess attribute,
          but React drops it at runtime, so N10 treats this as a warning. */}
      <SceneImage imageRef={image?.ref ?? "assets/x.png"} caption={props.label} />
    </div>
  );
};

export const example: Props = { label: "Demo" };

export default registerComponent<Props>({
  id: "typecheck-excess-prop",
  displayName: "Typecheck Excess Prop",
  promptGuide: "Fixture: an undeclared prop on SceneImage; must be an N10 warning, not error.",
  schema,
  Component: Scene,
  example,
});
