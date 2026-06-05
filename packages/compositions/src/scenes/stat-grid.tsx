import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { z } from "zod";
import { theme } from "@news/design";
import { Content, SceneFrame, StoryHeader, bezier } from "../primitives.js";
import { registerComponent, type SceneComponentProps } from "../registry.js";

const schema = z.object({
  stats: z
    .array(
      z.object({
        value: z.string().min(1).max(20),
        label: z.string().min(1).max(48),
      }),
    )
    .min(2)
    .max(4),
});

type Props = z.infer<typeof schema>;

const StatGrid: React.FC<SceneComponentProps<Props>> = ({ headline, body, eyebrow, props }) => {
  const frame = useCurrentFrame();
  const columns = props.stats.length <= 2 ? props.stats.length : 2;

  return (
    <SceneFrame>
      <Content>
        <StoryHeader eyebrow={eyebrow} headline={headline} body={body} />
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            gap: 26,
            alignContent: "center",
          }}
        >
          {props.stats.map((stat, index) => {
            const delay = 12 + index * 7;
            const reveal = interpolate(frame, [delay, delay + 16], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: (t) => bezier([0.16, 1, 0.3, 1], t),
            });
            return (
              <div
                key={index}
                style={{
                  padding: "44px 38px",
                  minHeight: 220,
                  display: "grid",
                  gap: 14,
                  alignContent: "center",
                  justifyItems: "center",
                  textAlign: "center",
                  borderRadius: theme.radius.md,
                  border: `1.5px solid ${theme.colors.line}`,
                  background: "rgba(9,12,20,0.72)",
                  boxShadow: "inset 0 1px 3px rgba(255,255,255,0.06)",
                  opacity: reveal,
                  transform: `translateY(${(1 - reveal) * 30}px) scale(${0.92 + reveal * 0.08})`,
                }}
              >
                <div
                  style={{
                    fontFamily: theme.fonts.display,
                    fontWeight: 900,
                    fontSize: 96,
                    lineHeight: 1.0,
                    color: theme.colors.signal,
                    fontVariantNumeric: "tabular-nums",
                    textShadow: "0 0 44px rgba(76,224,167,0.4)",
                  }}
                >
                  {stat.value}
                </div>
                <div
                  style={{
                    fontFamily: theme.fonts.mono,
                    textTransform: "uppercase",
                    letterSpacing: "0.14em",
                    fontSize: 24,
                    color: theme.colors.muted,
                  }}
                >
                  {stat.label}
                </div>
              </div>
            );
          })}
        </div>
      </Content>
    </SceneFrame>
  );
};

export const statGrid = registerComponent<Props>({
  id: "stat-grid",
  displayName: "Stat Grid",
  promptGuide:
    "2-4 metric tiles for figures supplied in the prompt. Each stat has a compact value (e.g. '92%', '3x', '2026') and a short label. Never invent numbers.",
  schema,
  Component: StatGrid,
  example: {
    stats: [
      { value: "3x", label: "Nhanh hơn" },
      { value: "60s", label: "Mỗi video" },
      { value: "0", label: "Bước thủ công" },
    ],
  },
});
