import React from "react";
import { interpolateColors, useCurrentFrame, useVideoConfig } from "remotion";
import { withAlpha } from "@motionreal/theme";
import { type CaptionCue, CANVAS, CAPTION_BAND, rectWidth } from "@motionreal/schema";
import { useTheme } from "./theme-context.js";
import { easeOut } from "./motion.js";

/**
 * `Captions` — burned-in single-line KARAOKE caption track, rendered
 * top-level by the composition (outside the transition series). Text only — NO
 * background box by default; bold ink text with a base-colored halo so it stays
 * legible on EITHER polarity (cream on editorial, deep night on galaxy). Each cue
 * is a short "page" of words; the word currently being spoken is highlighted in
 * the accent color (already-spoken words stay fg, upcoming words are dimmed).
 * Pure function of the frame (N16).
 *
 * ONE shared caption band for every language (`CAPTION_BAND`) — the N29 oracle
 * reads the SAME constant, so the caption is drawn and measured in the same
 * place. A language may set `theme.captionScrim`, a faint plate behind the text
 * (chrome, the "outfit") for looks whose caption sits low over busy video.
 */
export const Captions: React.FC<{ cues: CaptionCue[] }> = ({ cues }) => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const active = cues.find((c) => frame >= c.startFrame && frame < c.endFrame);
  if (!active) return null;

  const band = CAPTION_BAND;
  const scrim = theme.captionScrim;
  // Halo follows base polarity: the page background color (cream on editorial,
  // deep night on galaxy) so the ink/light caption text is wrapped in a glow that
  // matches its base and pops on busy video underneath.
  const halo = theme.colors.bg;
  // Deterministic shrink-to-fit: the band is fixed-width and captions are single
  // line (no wrap), so size the font from the page length to guarantee no clip.
  const usableWidth = rectWidth(band) - 24;
  const len = Math.max(1, active.text.length);
  const fontSize = Math.max(32, Math.min(56, Math.floor(usableWidth / (len * 0.66))));

  const haloShadow = `0 0 6px ${halo}, 0 0 6px ${halo}, 0 2px 3px ${halo}, 0 0 2px ${halo}`;
  // Smooth highlight ramp (~0.13s) so a word's emphasis EASES in/out instead of
  // snapping bigger — softer, more premium karaoke.
  const ramp = Math.max(2, Math.round(0.13 * fps));

  return (
    <div
      style={{
        position: "absolute",
        left: band.left,
        top: band.top,
        width: rectWidth(band),
        height: band.bottom - band.top,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        pointerEvents: "none",
        // Optional faint plate (chrome): a translucent scrim behind the caption
        // for looks whose band sits low over busy video. Its base matches the
        // language polarity — a dark ink plate on galaxy, a light paper plate on
        // a light language. Omitted ⇒ no box (the classic look draws directly on
        // the base).
        ...(scrim
          ? {
              // The plate base is the language's own background (dark night on
              // galaxy, cream on a light language), so the scrim always matches
              // the polarity it sits over.
              background: withAlpha(theme.colors.bg, scrim.opacity),
              backdropFilter: scrim.blur > 0 ? `blur(${scrim.blur}px)` : undefined,
              borderRadius: scrim.radius,
            }
          : null),
      }}
    >
      <div
        style={{
          maxWidth: "100%",
          whiteSpace: "nowrap",
          fontFamily: theme.fonts.body,
          fontWeight: 900,
          fontSize,
          lineHeight: 1.18,
          textAlign: "center",
          textShadow: haloShadow,
        }}
      >
        {active.words && active.words.length > 0 ? (
          active.words.map((w, i) => {
            const isSpoken = frame >= w.endFrame;
            // Smooth 0..1 emphasis bump while the word is active (ease in at its
            // start, ease out near its end) — no hard scale snap.
            const inRamp = easeOut(Math.min(1, Math.max(0, (frame - w.startFrame) / ramp)));
            const outRamp = easeOut(Math.min(1, Math.max(0, (w.endFrame - frame) / ramp)));
            const emphasis = Math.max(0, Math.min(inRamp, outRamp));
            const base = isSpoken ? theme.colors.fg : theme.colors.muted;
            const color = interpolateColors(emphasis, [0, 1], [base, theme.colors.accent]);
            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  color,
                  // transform scale (not font-size) so highlighting never shifts
                  // the neighbouring words / the line.
                  transform: `scale(${(1 + 0.12 * emphasis).toFixed(4)})`,
                  transformOrigin: "center bottom",
                  marginRight: i < active.words!.length - 1 ? "0.32em" : 0,
                }}
              >
                {w.text}
              </span>
            );
          })
        ) : (
          <span style={{ color: theme.colors.fg }}>{active.text}</span>
        )}
      </div>
    </div>
  );
};

/** Exposed for the N29 caption oracle / tests: the band the track must stay in. */
export const CAPTION_RENDER_BAND = CAPTION_BAND;
export const CAPTION_CANVAS = CANVAS;
