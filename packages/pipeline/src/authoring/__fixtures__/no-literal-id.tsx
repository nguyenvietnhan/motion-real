import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";

export const schema = z.object({ label: z.string() });
type Props = z.infer<typeof schema>;

const C: React.FC<SceneComponentProps<Props>> = ({ headline }) => <div>{headline}</div>;

export const example: Props = { label: "x" };

// id is a variable, not a string literal: admission cannot verify the id statically.
const dynamicId = "authored-dynamic";

export default registerComponent<Props>({
  id: dynamicId,
  displayName: "No Literal Id",
  promptGuide: "x",
  schema,
  Component: C,
  example,
});
