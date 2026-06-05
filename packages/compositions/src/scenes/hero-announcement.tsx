import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { z } from "zod";
import { theme } from "@news/design";
import { Content, SceneFrame, StoryHeader, bezier } from "../primitives.js";
import { registerComponent, type SceneComponentProps } from "../registry.js";

const schema = z.object({
  badgeText: z.string().min(1).max(60),
  highlight: z.string().min(1).max(60),
});

type Props = z.infer<typeof schema>;

const HeroAnnouncement: React.FC<SceneComponentProps<Props>> = ({ headline, body, eyebrow, props }) => {
  const frame = useCurrentFrame();
  const ringSpin = (frame % 750) * (360 / 750);
  const plaque = interpolate(frame, [8, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (t) => bezier([0.16, 1, 0.3, 1], t),
  });

  return (
    <SceneFrame>
      <Content>
        <StoryHeader eyebrow={eyebrow} headline={headline} body={body} />
        <div style={{ flex: 1, display: "grid", placeItems: "center", position: "relative" }}>
          <div
            style={{
              position: "absolute",
              width: 520,
              height: 520,
              borderRadius: "50%",
              border: "1.5px dashed rgba(76,224,167,0.2)",
              transform: `rotate(${ringSpin}deg)`,
            }}
          />
          <div
            style={{
              position: "relative",
              width: 720,
              padding: "70px 60px",
              borderRadius: theme.radius.lg,
              border: `2px solid rgba(199,167,90,0.5)`,
              background: "rgba(9,12,18,0.94)",
              boxShadow: "0 45px 100px rgba(0,0,0,0.7), 0 0 50px rgba(199,167,90,0.15)",
              textAlign: "center",
              opacity: plaque,
              transform: `translateY(${(1 - plaque) * 30}px) scale(${0.95 + plaque * 0.05})`,
            }}
          >
            <div
              style={{
                fontFamily: theme.fonts.mono,
                textTransform: "uppercase",
                letterSpacing: "0.28em",
                fontSize: 28,
                color: theme.colors.accent,
                marginBottom: 28,
              }}
            >
              {props.badgeText}
            </div>
            <div
              style={{
                fontFamily: theme.fonts.display,
                fontWeight: 900,
                fontSize: 96,
                lineHeight: 1.05,
                background: `linear-gradient(180deg, #FFFFFF, ${theme.colors.accent})`,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {props.highlight}
            </div>
            <div
              style={{
                marginTop: 34,
                height: 5,
                width: 180,
                marginInline: "auto",
                background: `linear-gradient(90deg, ${theme.colors.accent}, ${theme.colors.signal})`,
                borderRadius: 3,
              }}
            />
          </div>
        </div>
      </Content>
    </SceneFrame>
  );
};

export const heroAnnouncement = registerComponent<Props>({
  id: "hero-announcement",
  displayName: "Hero Announcement",
  promptGuide:
    "Opening hook for scene-01 only. badgeText = short brand/topic; highlight = 2-5 word hook keyword.",
  schema,
  Component: HeroAnnouncement,
  example: { badgeText: "DeepSeek", highlight: "V4-Pro" },
});
