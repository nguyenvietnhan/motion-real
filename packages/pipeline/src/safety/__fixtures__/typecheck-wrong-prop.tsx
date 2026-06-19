// component: typecheck-wrong-prop
// Reproduces the crash-class wrong-shape prop: a value whose SOURCE type is an
// object/array shape passed where a scalar is required — the analogue of the old
// {text}[] vs string[] Gemini bug. Here `maxHeight` is typed `number` on
// SceneImage, but this passes a `string[]` (an array). esbuild/webpack strip the
// type and the bad value reaches render. N10 must catch this at typecheck time.
import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps, SceneImage } from "@news/compositions";

export const schema = z.object({
  caps: z.array(z.string()),
});

type Props = z.infer<typeof schema>;

const Scene: React.FC<SceneComponentProps<Props>> = ({ props, image }) => {
  return (
    <div style={{ position: "absolute", inset: 0, background: "#101010" }}>
      {/* maxHeight is typed `number`; passing an array is a TS2322 whose source
          type is an array shape (not a quoted string literal) → N10 catches it. */}
      <SceneImage imageRef={image?.ref ?? "assets/x.png"} maxHeight={props.caps} />
    </div>
  );
};

export const example: Props = { caps: ["a", "b", "c"] };

export default registerComponent<Props>({
  id: "typecheck-wrong-prop",
  displayName: "Typecheck Wrong Prop",
  promptGuide: "Fixture: array passed to a numeric prop; must trip N10.",
  schema,
  Component: Scene,
  example,
});
