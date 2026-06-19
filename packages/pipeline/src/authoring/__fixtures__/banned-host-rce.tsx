// The specific host-RCE bypass the audit found: `global.process` (the OLD
// identifier visitor skipped `process` because it sat in a property-name slot,
// and `global` was not on the ban list at all — so `global.process.
// getBuiltinModule("child_process").execSync(...)` admitted and ran in Electron
// main). The hardened gate adds the global ROOTS (global/self/window/document)
// to the ban set and treats them as identifiers anywhere they appear, plus
// rejects a runtime-built computed key (`x["con"+"structor"]`) and `import.meta`.
// This fixture exercises all three new vectors at once. It is intentionally
// never imported — admission rejects it as a pure static check.
import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";

export const schema = z.object({ label: z.string() });
type Props = z.infer<typeof schema>;

const C: React.FC<SceneComponentProps<Props>> = ({ headline }) => {
  // 1) Global ROOT — the working bypass.
  const cp = (global as { process: { getBuiltinModule: (m: string) => { execSync: (c: string) => void } } })
    .process.getBuiltinModule("child_process");
  // 2) Computed key BUILT at runtime (string concat) so the by-name guard can't see it.
  const evil = (self as Record<string, unknown>)["ev" + "al"];
  // 3) `import.meta` leaks the host path / `import.meta.resolve` exists on recent Node.
  const here = import.meta.url;
  void cp;
  void evil;
  void here;
  return <div>{headline}</div>;
};

export const example: Props = { label: "x" };

export default registerComponent<Props>({
  id: "authored-host-rce",
  displayName: "Host RCE",
  promptGuide: "x",
  schema,
  Component: C,
  example,
});
