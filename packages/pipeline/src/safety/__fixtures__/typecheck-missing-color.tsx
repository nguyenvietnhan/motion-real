// component: typecheck-missing-color
// A scene that reads an un-aliased color token off theme.colors (the model's
// habit: `whicheverToken`). At RUNTIME the theme Proxy resolves any unknown token
// to a safe color, so this renders fine — N10 must flag it as a WARNING, never a
// hard error. (A scene MAY still read the theme via useTheme even though the
// layout blocks are gone; useTheme is re-exported from @motionreal/compositions.)
import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps, useTheme } from "@motionreal/compositions";

export const schema = z.object({
  label: z.string(),
});

type Props = z.infer<typeof schema>;

const Scene: React.FC<SceneComponentProps<Props>> = ({ headline, props }) => {
  const theme = useTheme();
  return (
    <div style={{ position: "absolute", inset: 0, background: "#0B1020", padding: 80 }}>
      <h1 style={{ color: theme.colors.fg }}>{headline}</h1>
      {/* `whicheverToken` is not declared on ThemeColors → TS2339, but the runtime
          Proxy resolves it safely, so N10 treats this as a warning. */}
      <div style={{ color: theme.colors.whicheverToken }}>{props.label}</div>
    </div>
  );
};

export const example: Props = { label: "Demo" };

export default registerComponent<Props>({
  id: "typecheck-missing-color",
  displayName: "Typecheck Missing Color",
  promptGuide: "Fixture: un-aliased color token; must be an N10 warning, not error.",
  schema,
  Component: Scene,
  example,
});
