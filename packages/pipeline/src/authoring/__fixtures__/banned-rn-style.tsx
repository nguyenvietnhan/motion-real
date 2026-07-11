import React from "react";
import { useCurrentFrame } from "remotion";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@motionreal/compositions";

export const schema = z.object({ label: z.string().min(1).max(40) });
type Props = z.infer<typeof schema>;

/** Fixture: RN shadow keys must fail admission (N4) even if normalize was skipped. */
const AuthoredCard: React.FC<SceneComponentProps<Props>> = ({ headline, props }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        color: "#F2F5F8",
        opacity: Math.min(1, frame / 30),
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        elevation: 4,
      }}
    >
      {headline}: {props.label}
    </div>
  );
};

export const example: Props = { label: "Demo" };

export default registerComponent<Props>({
  id: "authored-banned-rn-style",
  displayName: "Authored RN Style Ban",
  promptGuide: "Admission fixture for React Native style keys.",
  schema,
  Component: AuthoredCard,
  example,
});
