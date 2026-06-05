import React from "react";
import { useCurrentFrame } from "remotion";
import { z } from "zod";
import { theme } from "@news/design";
import { registerComponent, type SceneComponentProps } from "@news/compositions";

export const schema = z.object({ label: z.string().min(1).max(40) });
type Props = z.infer<typeof schema>;

const AuthoredCard: React.FC<SceneComponentProps<Props>> = ({ headline, props }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ color: theme.colors.fg, opacity: Math.min(1, frame / 30) }}>
      {headline}: {props.label}
    </div>
  );
};

export const example: Props = { label: "Demo" };

export default registerComponent<Props>({
  id: "authored-demo-card",
  displayName: "Authored Demo Card",
  promptGuide: "A simple authored card used by the admission-gate self-tests.",
  schema,
  Component: AuthoredCard,
  example,
});
