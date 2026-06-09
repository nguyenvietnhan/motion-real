// component: typecheck-flat-theme
// A scene that reads color tokens FLAT off the theme object (`theme.accent`,
// `theme.someUnknown`) instead of through `theme.colors.*` — the exact habit
// seen from the gizmodo 591bfd84 render (TS2339 on type 'Theme'). A declared
// token like `theme.accent` now typechecks (Theme intersects ThemeColors); an
// un-aliased one (`theme.someUnknown`) is a TS2339 on 'Theme' that the runtime
// theme Proxy resolves to a safe color — so N10 must treat it as a WARNING, not
// a hard error, exactly like the `theme.colors.*` case.
import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, useTheme } from "@news/blocks";

export const schema = z.object({
  label: z.string(),
});

type Props = z.infer<typeof schema>;

const Scene: React.FC<SceneComponentProps<Props>> = ({ headline, props }) => {
  const theme = useTheme();
  return (
    <Frame>
      <Story eyebrow="DEMO">
        <TitleBlock headline={headline} />
        {/* `theme.accent` is fine (flat alias). `theme.someUnknown` is TS2339 on
            'Theme', but the theme Proxy resolves it safely → N10 warning. */}
        <div style={{ color: theme.accent, background: theme.someUnknown }}>{props.label}</div>
      </Story>
    </Frame>
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
