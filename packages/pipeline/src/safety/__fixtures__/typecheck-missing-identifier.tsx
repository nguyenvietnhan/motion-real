import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@motionreal/compositions";

export const schema = z.object({});
type Props = z.infer<typeof schema>;

const Scene: React.FC<SceneComponentProps<Props>> = ({ headline }) => (
  <div style={{ opacity: imageOpacity }}>{headline}</div>
);

export const example: Props = {};

export default registerComponent<Props>({
  id: "typecheck-missing-identifier",
  displayName: "Typecheck Missing Identifier",
  promptGuide: "Fixture: undefined variable must hard-fail N10.",
  schema,
  Component: Scene,
  example,
});
