// component: typecheck-tone-enum
// A scene that passes an INVALID string-literal enum value to a block prop — the
// recurrent model habit of `<Tag tone="regular">` when the `Tone` union is
// `"accent" | "signal" | "blue" | …` (no "regular"). At RUNTIME the block's
// `toneColor` switch has a `default:` arm that returns a safe on-brand color
// (theme.colors.accent), so an unknown tone renders fine with a fallback color;
// it only fails the transpile-only typecheck. N10 must flag this as a WARNING
// (not a hard error), so it never blocks a render that is actually safe.
//
// This is DISTINCT from a crash-class wrong-shape prop ({text}[] vs string[]):
// there the assignability error's source type is an OBJECT/ARRAY shape, not a
// quoted string literal, so the string-literal-enum softening never catches it.
import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, Tag } from "@news/blocks";

export const schema = z.object({
  label: z.string(),
});

type Props = z.infer<typeof schema>;

const Scene: React.FC<SceneComponentProps<Props>> = ({ eyebrow, props }) => {
  return (
    <Frame>
      <Story eyebrow={eyebrow ?? "DEMO"}>
        {/* "regular" is not a member of the Tone union → TS2322, but the block's
            toneColor default arm makes it render safely → N10 warning. */}
        <Tag tone="regular">{props.label}</Tag>
      </Story>
    </Frame>
  );
};

export const example: Props = { label: "Demo" };

export default registerComponent<Props>({
  id: "typecheck-tone-enum",
  displayName: "Typecheck Tone Enum",
  promptGuide: "Fixture: an invalid Tone enum value; must be an N10 warning, not error.",
  schema,
  Component: Scene,
  example,
});
