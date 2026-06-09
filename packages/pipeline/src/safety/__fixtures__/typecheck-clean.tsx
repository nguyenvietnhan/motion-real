// component: typecheck-clean
// A clean authored scene: KeyPoints receives items: string[] exactly as typed.
// N10 must NOT flag this. Mirrors how a correct scene composes @news/blocks.
import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, KeyPoints } from "@news/blocks";

export const schema = z.object({
  points: z.array(z.string()),
});

type Props = z.infer<typeof schema>;

const Scene: React.FC<SceneComponentProps<Props>> = ({ headline, props }) => {
  return (
    <Frame>
      <Story eyebrow="DEMO">
        <TitleBlock headline={headline} />
        <KeyPoints items={props.points} />
      </Story>
    </Frame>
  );
};

export const example: Props = { points: ["a", "b", "c"] };

export default registerComponent<Props>({
  id: "typecheck-clean",
  displayName: "Typecheck Clean",
  promptGuide: "Fixture: correct KeyPoints usage; must pass N10.",
  schema,
  Component: Scene,
  example,
});
