// component: typecheck-implicit-any
// An unannotated local helper parameter is a type-only TS7006 diagnostic. The
// emitted JavaScript is valid and renders normally, so N10 must keep it advisory.
import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";

export const schema = z.object({ label: z.string() });
type Props = z.infer<typeof schema>;

const formatLabel = (value) => String(value).toUpperCase();

const Scene: React.FC<SceneComponentProps<Props>> = ({ props }) => (
  <div style={{ position: "absolute", inset: 0 }}>{formatLabel(props.label)}</div>
);

export const example: Props = { label: "Demo" };

export default registerComponent<Props>({
  id: "typecheck-implicit-any",
  displayName: "Typecheck Implicit Any",
  promptGuide: "Fixture: implicit-any helper parameter is runtime-safe.",
  schema,
  Component: Scene,
  example,
});
