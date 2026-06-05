import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { z } from "zod";
import { theme } from "@news/design";
import { Content, SceneFrame, bezier } from "../primitives.js";
import { registerComponent, type SceneComponentProps } from "../registry.js";

const schema = z.object({
  ctaText: z.string().min(1).max(100),
  subText: z.string().min(1).max(180),
});

type Props = z.infer<typeof schema>;

const FinalCta: React.FC<SceneComponentProps<Props>> = ({ eyebrow, props }) => {
  const frame = useCurrentFrame();
  const reveal = (delay: number) =>
    interpolate(frame, [delay, delay + 16], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: (t) => bezier([0.16, 1, 0.3, 1], t),
    });

  return (
    <SceneFrame>
      <Content>
        <div style={{ flex: 1, display: "grid", placeItems: "center", textAlign: "center" }}>
          <div style={{ display: "grid", gap: 36, maxWidth: 860, justifyItems: "center" }}>
            <div
              style={{
                fontFamily: theme.fonts.mono,
                textTransform: "uppercase",
                letterSpacing: "0.2em",
                fontSize: 22,
                color: theme.colors.signal,
                border: "1.5px solid rgba(76,224,167,0.3)",
                borderRadius: 24,
                padding: "8px 24px",
                opacity: reveal(4),
              }}
            >
              {eyebrow ?? "Takeaway"}
            </div>
            <h2
              style={{
                margin: 0,
                fontFamily: theme.fonts.display,
                fontWeight: 900,
                fontSize: 88,
                lineHeight: 1.15,
                background: `linear-gradient(90deg, #FFFFFF, ${theme.colors.accent})`,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                opacity: reveal(8),
                transform: `translateY(${(1 - reveal(8)) * 20}px)`,
              }}
            >
              {props.ctaText}
            </h2>
            <p
              style={{
                margin: 0,
                color: theme.colors.fg,
                fontSize: 40,
                lineHeight: 1.35,
                opacity: reveal(14),
              }}
            >
              {props.subText}
            </p>
          </div>
        </div>
      </Content>
    </SceneFrame>
  );
};

export const finalCta = registerComponent<Props>({
  id: "final-cta",
  displayName: "Final CTA",
  promptGuide:
    "Closing scene. ctaText = short takeaway; subText = topic-specific decision/tradeoff question. No generic subscribe/like.",
  schema,
  Component: FinalCta,
  example: {
    ctaText: "Lựa chọn nằm ở pipeline",
    subText: "Bạn sẽ ưu tiên tốc độ hay độ ổn định cho video tiếp theo?",
  },
});
