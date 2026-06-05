import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import { springs, theme } from "@news/design";
import { Content, SceneFrame, StoryHeader, VisualFrame } from "../primitives.js";
import { registerComponent, type SceneComponentProps } from "../registry.js";

const schema = z.object({
  value: z.string().min(1).max(40),
  unit: z.string().max(60).optional(),
  note: z.string().max(120).optional(),
});

type Props = z.infer<typeof schema>;

const PriceSpotlight: React.FC<SceneComponentProps<Props>> = ({ headline, body, eyebrow, props }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - 12, fps, config: springs.snappy });

  return (
    <SceneFrame>
      <Content>
        <StoryHeader eyebrow={eyebrow} headline={headline} body={body} />
        <VisualFrame>
          <div style={{ display: "grid", placeItems: "center", textAlign: "center", gap: 16, minHeight: 460 }}>
            <div
              style={{
                fontFamily: theme.fonts.display,
                fontWeight: 900,
                fontSize: 190,
                lineHeight: 1.02,
                color: theme.colors.signal,
                fontVariantNumeric: "tabular-nums",
                textShadow: "0 0 60px rgba(76,224,167,0.55)",
                transform: `scale(${0.8 + pop * 0.2})`,
              }}
            >
              {props.value}
            </div>
            {props.unit ? (
              <div style={{ fontSize: 50, fontWeight: 700, color: theme.colors.fg }}>{props.unit}</div>
            ) : null}
            {props.note ? (
              <div
                style={{
                  marginTop: 18,
                  fontFamily: theme.fonts.mono,
                  textTransform: "uppercase",
                  letterSpacing: "0.15em",
                  fontSize: 24,
                  color: theme.colors.muted,
                }}
              >
                {props.note}
              </div>
            ) : null}
          </div>
        </VisualFrame>
      </Content>
    </SceneFrame>
  );
};

export const priceSpotlight = registerComponent<Props>({
  id: "price-spotlight",
  displayName: "Price Spotlight",
  promptGuide:
    "One supplied price, percentage, count, year, or metric. value = the number; unit = its unit; note = compact context.",
  schema,
  Component: PriceSpotlight,
  example: { value: "3 RMB", unit: "/ 1M input", note: "Cache miss input token" },
});
