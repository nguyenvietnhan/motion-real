import React from "react";
import { interpolateColors, useCurrentFrame, useVideoConfig } from "remotion";
import { type CaptionCue, CAPTION_BAND, rectWidth } from "@motionreal/schema";
import { withAlpha } from "@motionreal/theme";
import { useTheme } from "./theme-context.js";
import { easeOut } from "./motion.js";

/**
 * `Captions` — burned-in single-line KARAOKE caption track, rendered
 * top-level by the composition (outside the transition series). Text only — NO
 * heavy plate; bold ink with a dual-edge halo so it stays legible over busy
 * (often near-black) short-form video. Each cue is a short "page" of words; the
 * word currently being spoken is highlighted in a **contrast-safe** caption
 * color (not raw project dominant — AI can pick dark accents that vanish on
 * the dark canvas). Already-spoken words stay fg, upcoming words are dimmed.
 * Pure function of the frame (N16).
 *
 * ONE shared caption band (`CAPTION_BAND`) — the N29 oracle reads the same
 * constant, so the caption is drawn and measured in the same place.
 */
export const Captions: React.FC<{ cues: CaptionCue[] }> = ({ cues }) => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const active = cues.find((c) => frame >= c.startFrame && frame < c.endFrame);
  if (!active) return null;

  const band = CAPTION_BAND;
  // Dual-edge halo: dark outer + light inner so ink pops on both pure-black
  // scene fills and brighter authored panels under the band.
  const haloDark = withAlpha(theme.colors.bg, 0.95);
  const haloLight = withAlpha(theme.colors.fg, 0.55);
  const usableWidth = rectWidth(band) - 24;
  const len = Math.max(1, active.text.length);
  const fontSize = Math.max(32, Math.min(56, Math.floor(usableWidth / (len * 0.66))));

  const haloShadow = [
    `0 0 2px ${haloDark}`,
    `0 0 6px ${haloDark}`,
    `0 2px 4px ${haloDark}`,
    `0 0 1px ${haloLight}`,
    `0 1px 0 ${haloDark}`,
  ].join(", ");
  // Smooth highlight ramp (~0.13s) so a word's emphasis EASES in/out instead of
  // snapping bigger — softer, more premium karaoke.
  const ramp = Math.max(2, Math.round(0.13 * fps));
  const highlight = theme.colors.captionHighlight;

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
        // Soft legibility wash — keeps karaoke readable when the authored
        // scene paints full-bleed near-black under the band (common AUTHOR mode).
        background: `linear-gradient(180deg, transparent 0%, ${withAlpha(theme.colors.bg, 0.45)} 55%, ${withAlpha(theme.colors.bg, 0.72)} 100%)`,
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
            const color = interpolateColors(emphasis, [0, 1], [base, highlight]);
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
