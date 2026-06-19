// component: typecheck-tone-enum
// A scene that passes an INVALID string-literal enum value to a typed prop — the
// recurrent model habit of an invented enum member (`tone="regular"` when the
// union is `"accent" | "signal" | "danger"`). At RUNTIME a `default:` switch arm
// resolves an unknown tone to a safe color, so it renders fine; it only fails the
// transpile-only typecheck. N10 must flag this as a WARNING (not a hard error).
//
// Post-block-removal the `Tone` union is no longer exported — but the diagnostic
// CLASS (an out-of-union string literal) is exactly the same, so the fixture
// declares a local `Tone` union + a local chip that consumes it. TS reports
// "... is not assignable to type 'Tone'", the same message the oracle softens.
import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";

type Tone = "accent" | "signal" | "danger";
const toneColor = (tone: Tone): string => {
  switch (tone) {
    case "signal":
      return "#FFB020";
    case "danger":
      return "#FF5A5A";
    case "accent":
    default:
      return "#6CC7FF";
  }
};
const Chip: React.FC<{ tone: Tone; children: React.ReactNode }> = ({ tone, children }) => (
  <span style={{ color: toneColor(tone), fontSize: 36 }}>{children}</span>
);

export const schema = z.object({
  label: z.string(),
});

type Props = z.infer<typeof schema>;

const Scene: React.FC<SceneComponentProps<Props>> = ({ props }) => {
  return (
    <div style={{ position: "absolute", inset: 0, padding: 80 }}>
      {/* "regular" is not a member of the Tone union → TS2322, but toneColor's
          default arm makes it render safely → N10 warning. */}
      <Chip tone="regular">{props.label}</Chip>
    </div>
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
