import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";

export const schema = z.object({ label: z.string() });
type Props = z.infer<typeof schema>;

const C: React.FC<SceneComponentProps<Props>> = ({ headline }) => <div>{headline}{Math.random()}</div>;

export const example: Props = { label: "x" };

export default registerComponent<Props>({
  id: "authored-bad-api",
  displayName: "Bad API",
  promptGuide: "x",
  schema,
  Component: C,
  example,
});
