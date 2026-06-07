import React from "react";
import { AbsoluteFill } from "remotion";
import { withAlpha, PRINT } from "@news/design";
import { CONTENT_ZONE, rectHeight, rectWidth } from "@news/schema";
import { useTheme } from "./theme-context.js";
import { useKenBurnsScale } from "./motion.js";
import { chromeBorder } from "./chrome.js";
// Side-effect: render-safe load of all style-pack fonts (Vietnamese subset).
import "./fonts.js";

/**
 * `Frame` — full-bleed CREAM paper background with a faint ink grid, a bold
 * outer border, and registration "tick" marks in the corners (editorial print
 * detail). Squared, high-contrast, readable in any lighting.
 *
 * The faint grid gets a very slow Ken Burns zoom for ambient depth (background
 * only — content stays inside its zone, so this never trips the N14 safe-area
 * oracle). The bold border + ticks stay fixed so the frame reads as stable.
 */
export const Frame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const theme = useTheme();
  const grid = withAlpha(PRINT.ink, 0.05);
  const kb = useKenBurnsScale(1.07);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.colors.bg,
        color: theme.colors.fg,
        fontFamily: theme.fonts.body,
        overflow: "hidden",
      }}
    >
      {/* faint grid — slow ambient Ken Burns zoom (only when the pack uses it) */}
      {theme.chrome.grid ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              `linear-gradient(90deg, ${grid} 1px, transparent 1px),` +
              `linear-gradient(0deg, ${grid} 1px, transparent 1px)`,
            backgroundSize: "72px 72px",
            opacity: 0.8,
            pointerEvents: "none",
            transform: `scale(${kb.toFixed(4)})`,
            transformOrigin: "50% 42%",
          }}
        />
      ) : null}
      {/* bold outer border (pack-driven width/style) */}
      <div style={{ position: "absolute", inset: 40, border: chromeBorder(theme), pointerEvents: "none" }} />
      {/* corner registration ticks (only when the pack uses them) */}
      {theme.chrome.registrationTicks ? <CornerTicks /> : null}
      {children}
    </AbsoluteFill>
  );
};

const CornerTicks: React.FC = () => {
  const bar = (s: React.CSSProperties): React.CSSProperties => ({ position: "absolute", background: PRINT.ink, ...s });
  const L = 28;
  const T = 6;
  const off = 22; // just outside the inset:40 border
  return (
    <>
      {/* top-left */}
      <div style={bar({ left: off, top: off, width: L, height: T })} />
      <div style={bar({ left: off, top: off, width: T, height: L })} />
      {/* top-right */}
      <div style={bar({ right: off, top: off, width: L, height: T })} />
      <div style={bar({ right: off, top: off, width: T, height: L })} />
      {/* bottom-left */}
      <div style={bar({ left: off, bottom: off, width: L, height: T })} />
      <div style={bar({ left: off, bottom: off, width: T, height: L })} />
      {/* bottom-right */}
      <div style={bar({ right: off, bottom: off, width: L, height: T })} />
      <div style={bar({ right: off, bottom: off, width: T, height: L })} />
    </>
  );
};

/**
 * `Content` — the primary content column, CONSTRAINED to the content zone
 * (R15.2). Authored scenes drop their blocks in here and never have to think
 * about the caption band or the platform-UI reserve: anything inside `Content`
 * is guaranteed to sit in the upper/middle content zone.
 *
 * `align="center"` (default) vertically centres content within the zone so it
 * sits in the upper-middle (not pinned to the very top); `align="top"` keeps it
 * high when a scene wants a full top-down editorial fill.
 */
export const Content: React.FC<{
  children: React.ReactNode;
  gap?: number;
  align?: "top" | "center";
}> = ({ children, gap = 40, align = "center" }) => (
  <div
    style={{
      position: "absolute",
      top: CONTENT_ZONE.top,
      left: CONTENT_ZONE.left,
      width: rectWidth(CONTENT_ZONE),
      height: rectHeight(CONTENT_ZONE),
      display: "flex",
      flexDirection: "column",
      justifyContent: align === "center" ? "center" : "flex-start",
      gap,
    }}
  >
    {children}
  </div>
);
