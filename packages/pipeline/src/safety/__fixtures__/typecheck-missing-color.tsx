// component: typecheck-missing-color
// A scene that reads an un-aliased color token off theme.colors (the model's
// habit: `ink`/`signalRed`/etc.). At RUNTIME the design Proxy resolves any
// unknown token to a safe on-brand color, so this scene renders fine — it just
// uses a fallback color. N10 must flag it as a WARNING (not a hard error), so it
// never blocks a render that the Proxy already made safe.
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
        {/* `whicheverToken` is not declared on ThemeColors → TS2339, but the
            runtime Proxy resolves it safely, so N10 treats this as a warning. */}
        <div style={{ color: theme.colors.whicheverToken }}>{props.label}</div>
      </Story>
    </Frame>
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
