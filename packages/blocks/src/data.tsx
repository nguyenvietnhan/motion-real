import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { onColor, type Theme } from "@news/design";
import { useTheme } from "./theme-context.js";
import { frameRamp } from "./motion.js";
import { blockSurface, innerDivider, surfaceRadius } from "./chrome.js";

/**
 * Data blocks — `KeyPoints` (numbered recap) + `StatChip` (single framed figure).
 * Surface grammar (border/radius/fill/shadow + the number-tile chip) reads from
 * the resolved language tokens via the surface-kit, so one block renders every
 * language. The BLOCK owns the numbering — authored scenes never number items.
 */

/** `KeyPoints` — a numbered list / recap. Number tiles + rows are language-styled. */
export const KeyPoints: React.FC<{ items: string[]; title?: string }> = ({ items, title }) => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div data-nrt-block="keypoints" style={{ display: "grid", gap: 20 }}>
      {title ? (
        <div style={{ fontFamily: theme.fonts.display, fontSize: 56, fontWeight: 900, color: theme.colors.fg, overflowWrap: "anywhere" }}>
          {title}
        </div>
      ) : null}
      {items.map((item, i) => {
        const r = frameRamp(frame, fps, 6 + i * 7, 16);
        const c = i % 2 === 0 ? theme.colors.accent : theme.colors.signal;
        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "stretch",
              gap: 22,
              ...blockSurface(theme, { accent: c, size: "md", shadow: false }),
              opacity: r,
              transform: `translateX(${(1 - r) * 26}px)`,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                flexShrink: 0,
                width: 84,
                background: c,
                color: onColor(c),
                borderRight: innerDivider(theme),
                fontFamily: theme.fonts.display,
                fontWeight: 900,
                fontSize: 48,
                display: "grid",
                placeItems: "center",
                borderTopLeftRadius: surfaceRadius(theme, "md"),
                borderBottomLeftRadius: surfaceRadius(theme, "md"),
              }}
            >
              {i + 1}
            </div>
            <div style={{ fontSize: 42, lineHeight: 1.26, color: theme.colors.fg, padding: "22px 26px 22px 4px", overflowWrap: "anywhere", minWidth: 0 }}>
              {item}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** `StatChip` — a single framed figure: a big `value` over a small `label`. */
export const StatChip: React.FC<{ value: string; label: string }> = ({ value, label }) => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const r = frameRamp(frame, fps, 4, 18);
  return (
    <div
      data-nrt-block="stat-chip"
      style={{
        ...blockSurface(theme, { accent: theme.colors.accent, size: "md" }),
        padding: "26px 32px",
        display: "grid",
        gap: 6,
        opacity: r,
        transform: `scale(${0.96 + r * 0.04})`,
      }}
    >
      <div style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 84, lineHeight: 1, color: theme.colors.accent }}>
        {value}
      </div>
      <div style={{ fontSize: 30, color: theme.colors.muted, fontFamily: theme.fonts.mono, letterSpacing: theme.surface.labelTracking }}>
        {label}
      </div>
    </div>
  );
};

