import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { z } from "zod";
import { theme } from "@news/design";
import { Content, SceneFrame, StoryHeader, bezier } from "../primitives.js";
import { registerComponent, type SceneComponentProps } from "../registry.js";

const sideSchema = z.object({
  label: z.string().min(1).max(40),
  detail: z.string().min(1).max(90),
});

const schema = z.object({
  left: sideSchema,
  right: sideSchema,
});

type Props = z.infer<typeof schema>;

const ComparisonSplit: React.FC<SceneComponentProps<Props>> = ({ headline, body, eyebrow, props }) => {
  const frame = useCurrentFrame();
  const reveal = (delay: number) =>
    interpolate(frame, [delay, delay + 18], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: (t) => bezier([0.16, 1, 0.3, 1], t),
    });

  const column = (side: Props["left"], accent: string, fromLeft: boolean, delay: number): React.ReactNode => {
    const enter = reveal(delay);
    return (
      <div
        style={{
          flex: 1,
          padding: "48px 40px",
          borderRadius: theme.radius.md,
          border: `1.5px solid ${theme.colors.line}`,
          background: "rgba(9,12,20,0.78)",
          display: "grid",
          gap: 22,
          alignContent: "start",
          opacity: enter,
          transform: `translateX(${(1 - enter) * (fromLeft ? -50 : 50)}px)`,
        }}
      >
        <div
          style={{
            fontFamily: theme.fonts.display,
            fontWeight: 900,
            fontSize: 56,
            lineHeight: 1.1,
            color: accent,
          }}
        >
          {side.label}
        </div>
        <div style={{ height: 4, width: 80, background: accent, borderRadius: 2, opacity: 0.8 }} />
        <div style={{ fontSize: 38, lineHeight: 1.35, color: theme.colors.fg }}>{side.detail}</div>
      </div>
    );
  };

  return (
    <SceneFrame>
      <Content>
        <StoryHeader eyebrow={eyebrow} headline={headline} body={body} />
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 28, position: "relative" }}>
          {column(props.left, theme.colors.accent, true, 12)}
          <div
            style={{
              flex: "0 0 auto",
              width: 86,
              height: 86,
              display: "grid",
              placeItems: "center",
              borderRadius: "50%",
              border: `2px solid ${theme.colors.line}`,
              background: theme.colors.bgElevated,
              fontFamily: theme.fonts.mono,
              fontWeight: 700,
              fontSize: 30,
              color: theme.colors.muted,
              opacity: reveal(8),
              transform: `scale(${0.6 + reveal(8) * 0.4})`,
            }}
          >
            VS
          </div>
          {column(props.right, theme.colors.signal, false, 16)}
        </div>
      </Content>
    </SceneFrame>
  );
};

export const comparisonSplit = registerComponent<Props>({
  id: "comparison-split",
  displayName: "Comparison Split",
  promptGuide:
    "Two-column A-vs-B contrast for a tradeoff or before/after. left/right each have label (short) + detail (one line). Use only contrasts grounded in the prompt.",
  schema,
  Component: ComparisonSplit,
  example: {
    left: { label: "Tốc độ", detail: "Ra mắt nhanh, lặp lại liên tục" },
    right: { label: "Ổn định", detail: "Bền vững, ít lỗi về sau" },
  },
});
