// component: typecheck-wrong-prop
// A scene that reproduces the real Gemini bug: KeyPoints expects items: string[],
// but this wraps each string into a {text} OBJECT. esbuild/webpack strip the type
// and the object then crashes headless Chromium (React error #31). N10 must catch
// this at typecheck time, before any render.
import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, KeyPoints } from "@news/blocks";

export const schema = z.object({
  capabilities: z.array(z.string()),
});

type Props = z.infer<typeof schema>;

const Scene: React.FC<SceneComponentProps<Props>> = ({ props }) => {
  return (
    <Frame>
      <Story>
        <KeyPoints items={props.capabilities.map((text) => ({ text }))} />
      </Story>
    </Frame>
  );
};

export const example: Props = { capabilities: ["a", "b", "c"] };

export default registerComponent<Props>({
  id: "typecheck-wrong-prop",
  displayName: "Typecheck Wrong Prop",
  promptGuide: "Fixture: wrong KeyPoints item shape; must trip N10.",
  schema,
  Component: Scene,
  example,
});
