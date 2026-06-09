// A module that tries to reach dangerous globals through the indirections the
// old identifier-shaped matchers missed: `globalThis.process` indirection,
// computed member access (`process["exit"]`), aliasing (`const p = process`),
// and the `[].constructor.constructor("…")()` Function-constructor RCE chain.
// The hardened admission gate must reject ALL of these (N5) — they never reach
// the loader. (This file is intentionally never imported.)
import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";

export const schema = z.object({ label: z.string() });
type Props = z.infer<typeof schema>;

const C: React.FC<SceneComponentProps<Props>> = ({ headline }) => {
  // 1) globalThis indirection
  const g = globalThis;
  // 2) computed member access naming a banned member
  const exit = (g as Record<string, unknown>)["process"];
  // 3) aliasing a banned global
  const p = process;
  // 4) Function-constructor prototype-chain escape
  const make = [].constructor.constructor;
  void exit;
  void p;
  void make;
  return <div>{headline}</div>;
};

export const example: Props = { label: "x" };

export default registerComponent<Props>({
  id: "authored-evasion",
  displayName: "Evasion",
  promptGuide: "x",
  schema,
  Component: C,
  example,
});
