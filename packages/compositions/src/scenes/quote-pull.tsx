import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { z } from "zod";
import { theme } from "@news/design";
import { Content, SceneFrame, StoryHeader, bezier } from "../primitives.js";
import { registerComponent, type SceneComponentProps } from "../registry.js";

const schema = z.object({
  quote: z.string().min(1).max(200),
  attribution: z.string().min(1).max(80).optional(),
});

type Props = z.infer<typeof schema>;

const QuotePull: React.FC<SceneComponentProps<Props>> = ({ headline, body, eyebrow, props }) => {
  const frame = useCurrentFrame();
  const reveal = (delay: number) =>
    interpolate(frame, [delay, delay + 18], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: (t) => bezier([0.16, 1, 0.3, 1], t),
    });

  const quoteSize = props.quote.length > 120 ? 56 : props.quote.length > 70 ? 66 : 78;

  return (
    <SceneFrame>
      <Content>
        <StoryHeader eyebrow={eyebrow} headline={headline} body={body} />
        <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
          <div
            style={{
              position: "relative",
              width: 880,
              padding: "72px 64px",
              borderRadius: theme.radius.lg,
              border: `1.5px solid ${theme.colors.line}`,
              borderLeft: `6px solid ${theme.colors.accent}`,
              background: "rgba(9,12,20,0.9)",
              boxShadow: "0 45px 100px rgba(0,0,0,0.65)",
              opacity: reveal(8),
              transform: `translateY(${(1 - reveal(8)) * 28}px)`,
            }}
          >
            <div
              aria-hidden
              style={{
                position: "absolute",
                top: -36,
                left: 44,
                fontFamily: theme.fonts.display,
                fontWeight: 900,
                fontSize: 180,
                lineHeight: 1,
                color: theme.colors.accent,
                opacity: 0.25 * reveal(4),
              }}
            >
              “
            </div>
            <p
              style={{
                margin: 0,
                fontFamily: theme.fonts.display,
                fontWeight: 700,
                fontSize: quoteSize,
                lineHeight: 1.3,
                color: theme.colors.fg,
                opacity: reveal(12),
              }}
            >
              {props.quote}
            </p>
            {props.attribution ? (
              <div
                style={{
                  marginTop: 40,
                  display: "flex",
                  alignItems: "center",
                  gap: 18,
                  opacity: reveal(20),
                }}
              >
                <div style={{ width: 48, height: 3, background: theme.colors.signal, borderRadius: 2 }} />
                <div
                  style={{
                    fontFamily: theme.fonts.mono,
                    textTransform: "uppercase",
                    letterSpacing: "0.16em",
                    fontSize: 24,
                    color: theme.colors.muted,
                  }}
                >
                  {props.attribution}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </Content>
    </SceneFrame>
  );
};

export const quotePull = registerComponent<Props>({
  id: "quote-pull",
  displayName: "Quote Pull",
  promptGuide:
    "A single pulled statement or principle worth dwelling on. quote = the verbatim line (no invented attributions); attribution = optional source/role only if supplied in the prompt.",
  schema,
  Component: QuotePull,
  example: {
    quote: "Tốc độ không có nhiều ý nghĩa nếu thiếu đi sự ổn định.",
    attribution: "Nguyên tắc thiết kế",
  },
});
