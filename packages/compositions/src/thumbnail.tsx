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
 * Thumbnail / cover composition — a CLEAN brand card
 * for both delivery formats: the theme's wash background with the publish title
 * centered in the format's content zone.
 *
 * Why NOT composite over a real scene frame: an authored scene is itself a
 * text-heavy card (its own headline / stat / eyebrow), so overlaying the publish
 * title on top of it stacks two big text blocks that collide (the observed bug).
 * A cover is a SEPARATE artifact — one title on a clean on-brand background —
 * not a screenshot of a scene. So there is no `bgImageSrc` / scene picker
 * anymore; the cover is the same for 9:16 and 16:9 (only the canvas + content
 * zone differ).
 *
 * Every visual decision reads from `makeTheme(dominant)` (the SAME theme the
 * video used), so the cover is on-brand with the video. Canvas size is driven by
 * `geometry(format)` at the Remotion `calculateMetadata` layer (Root.tsx), NOT
 * here — this component just lays out for whatever canvas it's mounted in.
 *
 * Determinism (N16): pure function of props; no time/random/network. The title's
 * entrance animation (`useReveal`) settles to 1 within ~2 frames, so the still is
 * rendered at the composition's LAST frame where reveal === 1.
 */

export const ThumbnailPropsSchema = z.object({
  format: VideoFormatSchema,
  /** Dominant hex that drives `makeTheme` — the same one the video used. */
  dominant: z.string(),
  /** Publish title shown on the cover. */
  title: z.string(),
});

export type ThumbnailProps = z.infer<typeof ThumbnailPropsSchema>;

export const ThumbnailComposition: React.FC<ThumbnailProps> = ({ format, dominant, title }) => {
  const g = geometry(format);
  const theme = makeTheme(dominant);
  const zone = g.contentZone;
  // Settle the title's entrance within ~2 frames; the still is taken at the last
  // frame (reveal === 1), so the cover is the fully-arrived card.
  const reveal = useReveal();

  return (
    <ThemeProvider theme={theme}>
      <AbsoluteFill style={{ background: sceneBackground(theme), overflow: "hidden" }}>
        {/* Title positioned in the format's content zone (16:9 vs 9:16), centered. */}
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
