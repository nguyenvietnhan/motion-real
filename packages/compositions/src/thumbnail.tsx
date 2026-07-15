import React from "react";
import { AbsoluteFill } from "remotion";
import { z } from "zod";
import { geometry, rectWidth, rectHeight, VideoFormatSchema } from "@motionreal/schema";
import { makeTheme, sceneBackground } from "@motionreal/theme";
// Importing from @motionreal/blocks evaluates its index, whose font module side-effect
// loads the Vietnamese-subset fonts, so the thumbnail gets render-safe diacritics.
// `useReveal` settles the title's entrance within ~2 frames (the still is taken at
// the last frame, reveal === 1). The layout blocks are gone (the AI no longer uses
// them), so the cover draws its title card as raw JSX from the theme tokens.
import { ThemeProvider, useReveal } from "@motionreal/blocks";

/**
 * Thumbnail / cover composition — a CLEAN brand card for short-form 9:16:
 * the theme's wash background with the publish title centered in the content zone.
 *
 * Why NOT composite over a real scene frame: an authored scene is itself a
 * text-heavy card, so overlaying the publish title collides. A cover is a
 * SEPARATE artifact — one title on a clean on-brand background.
 *
 * Canvas size is driven by `geometry()` at Remotion `calculateMetadata` (Root.tsx).
 * Determinism (N16): pure function of props; no time/random/network.
 */

export const ThumbnailPropsSchema = z.object({
  format: VideoFormatSchema,
  /** Dominant hex that drives `makeTheme` — the same one the video used. */
  dominant: z.string(),
  /** Publish title shown on the cover. */
  title: z.string(),
});

export type ThumbnailProps = z.infer<typeof ThumbnailPropsSchema>;

export const ThumbnailComposition: React.FC<ThumbnailProps> = ({ dominant, title }) => {
  const g = geometry();
  const theme = makeTheme(dominant);
  const zone = g.contentZone;
  // Settle the title's entrance within ~2 frames; the still is taken at the last
  // frame (reveal === 1), so the cover is the fully-arrived card.
  const reveal = useReveal();

  return (
    <ThemeProvider theme={theme}>
      <AbsoluteFill style={{ background: sceneBackground(theme), overflow: "hidden" }}>
        {/* Title positioned in the short-form content zone, centered. */}
        <div
          style={{
            position: "absolute",
            top: zone.top,
            left: zone.left,
            width: rectWidth(zone),
            height: rectHeight(zone),
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            opacity: reveal,
            transform: `translateY(${(1 - reveal) * 24}px)`,
          }}
        >
          <div
            style={{
              borderLeft: `8px solid ${theme.colors.accent}`,
              paddingLeft: 36,
              fontFamily: theme.fonts.display,
              fontWeight: 800,
              fontSize: 88,
              lineHeight: 1.08,
              color: theme.colors.fg,
            }}
          >
            {title}
          </div>
        </div>
      </AbsoluteFill>
    </ThemeProvider>
  );
};
