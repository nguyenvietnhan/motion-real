import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { z } from "zod";
import { theme } from "@news/design";
import { Content, SceneFrame, StoryHeader, bezier } from "../primitives.js";
import { registerComponent, type SceneComponentProps } from "../registry.js";

const schema = z.object({
  steps: z.array(z.string().min(1).max(80)).min(2).max(4),
});

type Props = z.infer<typeof schema>;

const InsightStack: React.FC<SceneComponentProps<Props>> = ({ headline, body, eyebrow, props }) => {
  const frame = useCurrentFrame();

  return (
    <SceneFrame>
      <Content>
        <StoryHeader eyebrow={eyebrow} headline={headline} body={body} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 24 }}>
          {props.steps.map((step, index) => {
            const delay = 14 + index * 8;
            const reveal = interpolate(frame, [delay, delay + 16], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: (t) => bezier([0.16, 1, 0.3, 1], t),
            });
            return (
              <div
                key={index}
                style={{
                  display: "grid",
                  gridTemplateColumns: "80px 1fr",
                  alignItems: "center",
                  gap: 28,
                  minHeight: 120,
                  padding: "30px 40px",
                  borderRadius: theme.radius.md,
                  border: `1.5px solid ${theme.colors.line}`,
                  background: "rgba(9,12,20,0.7)",
                  opacity: reveal,
                  transform: `translateX(${(1 - reveal) * -40}px)`,
                }}
              >
                <div
                  style={{
                    width: 64,
                    height: 64,
                    display: "grid",
                    placeItems: "center",
                    background: "rgba(76,224,167,0.18)",
                    border: "1.8px solid rgba(76,224,167,0.45)",
                    color: theme.colors.signal,
                    fontFamily: theme.fonts.mono,
                    fontSize: 26,
                    fontWeight: 700,
                    borderRadius: 18,
                  }}
                >
                  {String(index + 1).padStart(2, "0")}
                </div>
                <strong style={{ fontSize: 46, lineHeight: 1.25, color: theme.colors.fg, fontWeight: 650 }}>
                  {step}
                </strong>
              </div>
            );
          })}
        </div>
      </Content>
    </SceneFrame>
  );
};

export const insightStack = registerComponent<Props>({
  id: "insight-stack",
  displayName: "Insight Stack",
  promptGuide: "2-4 hidden layers, reasons, or insights under one theme. Do not prefix items with numbers.",
  schema,
  Component: InsightStack,
  example: { steps: ["Giữ style", "Kiểm schema", "Render ổn định"] },
});
