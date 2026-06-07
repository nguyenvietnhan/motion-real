import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";

/**
 * Fixture for the dual-instance registry handshake test: a clean authored module
 * with a UNIQUE id. The test injects a custom `load` whose default export is a
 * valid definition that was NOT registered (simulating a second
 * `@news/compositions` registry instance), so the handshake must MIRROR it into
 * the pipeline's registry rather than fail.
 */
export const schema = z.object({ label: z.string().min(1).max(40) });
type Props = z.infer<typeof schema>;

const MirrorCard: React.FC<SceneComponentProps<Props>> = ({ headline, props }) => (
  <div>
    {headline}: {props.label}
  </div>
);

export const example: Props = { label: "Mirror" };

export default registerComponent<Props>({
  id: "authored-mirror-demo",
  displayName: "Authored Mirror Demo",
  promptGuide: "Fixture for the dual-instance registry mirror test.",
  schema,
  Component: MirrorCard,
  example,
});
