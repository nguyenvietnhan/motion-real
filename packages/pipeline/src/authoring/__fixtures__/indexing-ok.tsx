// Regression fixture: ordinary array/dataviz indexing patterns that authored
// scenes use constantly — `colors[i]`, `springs[index]`, `arr[i + 1]`, and a
// computed key whose value is a STATIC string literal naming a safe member —
// MUST still admit. The hardened gate rejects only NAME-BUILDING keys (string
// concat / template / call), so plain numeric indexing and a single-literal
// key remain valid. Without this fixture a too-broad ban would silently roll
// back valid scenes (the `colors[i]` pattern shows up in a dozen scenes today).
import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";

export const schema = z.object({ label: z.string() });
type Props = z.infer<typeof schema>;

const C: React.FC<SceneComponentProps<Props>> = ({ headline, props }) => {
  const colors = ["#fff", "#000"];
  const springs = [0, 1, 2];
  const i = 0;
  const a = colors[i];
  const b = springs[i + 1];
  const safe = ({ alpha: 1 } as Record<string, number>)["alpha"]; // single string literal — by-name check, allowed
  void a;
  void b;
  void safe;
  return <div>{headline}: {props.label}</div>;
};

export const example: Props = { label: "ok" };

export default registerComponent<Props>({
  id: "authored-indexing-ok",
  displayName: "Indexing OK",
  promptGuide: "x",
  schema,
  Component: C,
  example,
});
