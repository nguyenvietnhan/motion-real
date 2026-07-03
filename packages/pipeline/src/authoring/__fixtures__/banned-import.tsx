import React from "react";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@motionreal/compositions";

export const schema = z.object({ label: z.string() });
type Props = z.infer<typeof schema>;

const C: React.FC<SceneComponentProps<Props>> = ({ headline }) => <div>{headline}{String(readFileSync)}</div>;

export const example: Props = { label: "x" };

export default registerComponent<Props>({
  id: "authored-bad-import",
  displayName: "Bad Import",
  promptGuide: "x",
  schema,
  Component: C,
  example,
});
