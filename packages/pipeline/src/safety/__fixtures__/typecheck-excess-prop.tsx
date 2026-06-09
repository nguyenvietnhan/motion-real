// component: typecheck-excess-prop
// A scene that passes an UNDECLARED prop to a block component — the recurrent
// model habit of `<Frame style={{ backgroundColor }}>` / `<TitleBlock style=…>`
// to set a background. At RUNTIME React simply ignores a prop a function
// component never destructures, so the scene renders fine; it only fails the
// transpile-only typecheck. N10 must flag this as a WARNING (not a hard error),
// so it never blocks a render that is actually safe. Here `TitleBlock` is typed
// `{ headline; kicker?; body? }` — it has no `style`, so `style=` is the
// excess-attribute error (`... does not exist on type 'IntrinsicAttributes …`).
import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock } from "@news/blocks";

export const schema = z.object({
  label: z.string(),
});

type Props = z.infer<typeof schema>;

const Scene: React.FC<SceneComponentProps<Props>> = ({ headline, props }) => {
  return (
    <Frame>
      <Story eyebrow="DEMO">
        {/* `style` is not a declared prop of TitleBlock → TS2322 excess attribute,
            but React drops it at runtime, so N10 treats this as a warning. */}
        <TitleBlock headline={headline} style={{ backgroundColor: "red" }} />
        <div>{props.label}</div>
      </Story>
    </Frame>
  );
};

export const example: Props = { label: "Demo" };

export default registerComponent<Props>({
  id: "typecheck-excess-prop",
  displayName: "Typecheck Excess Prop",
  promptGuide: "Fixture: an undeclared prop on a block; must be an N10 warning, not error.",
  schema,
  Component: Scene,
  example,
});
