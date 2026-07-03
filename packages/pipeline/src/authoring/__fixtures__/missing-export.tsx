import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@motionreal/compositions";

// `schema` and `example` are intentionally NOT exported (admission must reject).
const schema = z.object({ label: z.string() });
type Props = z.infer<typeof schema>;

const C: React.FC<SceneComponentProps<Props>> = ({ headline }) => <div>{headline}</div>;

const example: Props = { label: "x" };

export default registerComponent<Props>({
  id: "authored-missing-export",
  displayName: "Missing Export",
  promptGuide: "x",
  schema,
  Component: C,
  example,
});
