// component: typecheck-flat-theme
// A scene that reads a color token FLAT off the theme object (`theme.accent`,
// `theme.someUnknown`) instead of through `theme.colors.*`. A declared token like
// `theme.accent` typechecks (Theme intersects ThemeColors); an un-aliased one
// (`theme.someUnknown`) is a TS2339 on type 'Theme' that the runtime theme Proxy
// resolves safely — so N10 must treat it as a WARNING, not a hard error.
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
    <div style={{ position: "absolute", inset: 0, padding: 80 }}>
      <h1>{headline}</h1>
      {/* `theme.accent` is fine (flat alias). `theme.someUnknown` is TS2339 on
          'Theme', but the theme Proxy resolves it safely → N10 warning. */}
      <div style={{ color: theme.accent, background: theme.someUnknown }}>{props.label}</div>
    </div>
  );
};

export const example: Props = { label: "Demo" };

export default registerComponent<Props>({
  id: "typecheck-flat-theme",
  displayName: "Typecheck Flat Theme",
  promptGuide: "Fixture: flat theme.* color reads; un-aliased one must be an N10 warning.",
  schema,
  Component: Scene,
  example,
});
