import React from "react";
import { AbsoluteFill } from "remotion";
import { withAlpha } from "@news/design";
import { CONTENT_ZONE, rectHeight, rectWidth } from "@news/schema";
import { useTheme } from "./theme-context.js";
import { useKenBurnsScale } from "./motion.js";
import { surfaceBorder, surfaceRadius } from "./chrome.js";
// Side-effect: render-safe load of all style-pack fonts (Vietnamese subset).
import "./fonts.js";

/**
 * `Frame` — full-bleed language-driven backdrop. EVERY decision (base polarity,
 * radial vs flat fill, grid, registration ticks, starfield, outer border) reads
 * from the resolved language's `backdrop` + `surface` tokens, so one component
 * paints the editorial cream-with-grid look, the galaxy deep-radial-with-stars
 * look, or any future language — never a hard-coded base or backdrop.
 *
 * The ambient layer (grid OR starfield) gets a very slow Ken Burns zoom for
 * depth (background only — content stays inside its zone, so this never trips
 * the N14 safe-area oracle). The border + ticks stay fixed so the frame reads
 * as stable.
 */
export const Frame: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => {
  const theme = useTheme();
  // Ink for ambient detail (grid lines, ticks) follows the base polarity so a
  // dark language draws LIGHT detail, a light one draws DARK ink — never a fixed
  // ink that would vanish on the opposite base.
  const detail = withAlpha(theme.colors.fg, 0.05);
  const backdrop = theme.backdrop;
  const radial = backdrop.fill === "radial";
  const frameRadius = surfaceRadius(theme, "lg");
  const kb = useKenBurnsScale(1.07);
  // `style` is an optional passthrough: models routinely write
  // `<Frame style={{ backgroundColor: theme.colors.bg }}>` to set the scene
  // background (the exact bg Frame already paints), so we ACCEPT it and merge it
  // LAST — an authored override wins, and the common no-op case typechecks
  // instead of hard-blocking the render over a runtime-harmless prop. See the
  // N10 excess-prop softening (typecheck-authored.ts) for the general net.
  return (
    <AbsoluteFill
      style={{
        // A radial language paints a deep wash (galaxy night sky); a flat one
        // keeps its solid base (editorial cream). Both come from the same tokens.
        background: radial
          ? `radial-gradient(circle at 50% 28%, ${theme.colors.panel} 0%, ${theme.colors.bg} 70%)`
          : theme.colors.bg,
        color: theme.colors.fg,
        fontFamily: theme.fonts.body,
        overflow: "hidden",
        ...style,
      }}
    >
      {/* faint grid — slow ambient Ken Burns zoom (only when the language uses it) */}
      {backdrop.grid ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              `linear-gradient(90deg, ${detail} 1px, transparent 1px),` +
              `linear-gradient(0deg, ${detail} 1px, transparent 1px)`,
            backgroundSize: "72px 72px",
            opacity: 0.8,
            pointerEvents: "none",
            transform: `scale(${kb.toFixed(4)})`,
            transformOrigin: "50% 42%",
          }}
        />
      ) : null}
      {/* starfield backdrop (galaxy) — slow ambient drift, deterministic stars */}
      {backdrop.starfield ? <Starfield scale={kb} /> : null}
      {/* outer border (language-driven width/style; rounded radius for soft looks) */}
      {backdrop.frameBorder ? (
        <div style={{ position: "absolute", inset: 40, border: surfaceBorder(theme), borderRadius: frameRadius, pointerEvents: "none" }} />
      ) : null}
      {/* corner registration ticks (only when the language uses them) */}
      {backdrop.registrationTicks ? <CornerTicks color={theme.colors.fg} /> : null}
      {children}
    </AbsoluteFill>
  );
};

/**
 * Deterministic starfield (galaxy backdrop). Stars are a FIXED hand-authored
 * list (never a runtime RNG, so N16 determinism holds), sized/spread across the
 * canvas, with soft nebula glows from the theme accent/signal. The whole field
 * shares the Frame's slow Ken Burns scale so it drifts subtly.
 *
 * The field is denser + brighter than a token sprinkle: stars need to read
 * clearly as a starfield on a phone screen (the earlier faint version was nearly
 * invisible). Bigger stars carry a glow halo; a scatter of small ones fills in.
 */
const STARS: ReadonlyArray<readonly [number, number, number, number]> = [
  // [x%, y%, sizePx, opacity]
  [8, 6, 3, 0.9], [22, 12, 4, 1.0], [37, 5, 2, 0.8], [54, 10, 3, 0.95], [71, 4, 4, 0.9],
  [86, 12, 3, 0.85], [14, 24, 3, 0.9], [44, 22, 2, 0.7], [63, 26, 4, 1.0], [92, 28, 3, 0.85],
  [6, 40, 4, 0.95], [29, 38, 2, 0.75], [50, 44, 3, 0.85], [77, 40, 3, 1.0], [88, 48, 4, 0.8],
  [18, 56, 3, 0.9], [40, 60, 4, 0.95], [60, 56, 2, 0.7], [82, 62, 3, 0.9], [10, 70, 3, 0.8],
  [33, 74, 2, 0.85], [55, 72, 4, 1.0], [70, 78, 3, 0.8], [90, 74, 3, 0.9], [24, 88, 4, 0.95],
  [46, 92, 3, 0.8], [66, 90, 2, 0.85], [84, 94, 3, 1.0],
  // a finer scatter of small stars for depth/density
  [4, 16, 1.5, 0.6], [31, 17, 1.5, 0.55], [48, 31, 1.5, 0.6], [67, 14, 1.5, 0.5], [79, 22, 1.5, 0.6],
  [12, 34, 1.5, 0.55], [38, 48, 1.5, 0.5], [58, 38, 1.5, 0.6], [72, 52, 1.5, 0.55], [95, 40, 1.5, 0.5],
  [16, 64, 1.5, 0.6], [26, 50, 1.5, 0.5], [52, 64, 1.5, 0.55], [74, 66, 1.5, 0.6], [4, 82, 1.5, 0.55],
  [38, 84, 1.5, 0.5], [62, 82, 1.5, 0.6], [78, 86, 1.5, 0.55], [20, 96, 1.5, 0.5], [50, 80, 1.5, 0.6],
];
const Starfield: React.FC<{ scale: number }> = ({ scale }) => {
  const theme = useTheme();
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", transform: `scale(${scale.toFixed(4)})`, transformOrigin: "50% 40%" }}>
      {/* soft nebula glows from the accent/signal, for depth behind the stars */}
      <div style={{ position: "absolute", left: "16%", top: "18%", width: 520, height: 520, borderRadius: 999,
        background: `radial-gradient(circle, ${withAlpha(theme.colors.accent, 0.26)} 0%, transparent 70%)` }} />
      <div style={{ position: "absolute", right: "10%", bottom: "22%", width: 440, height: 440, borderRadius: 999,
        background: `radial-gradient(circle, ${withAlpha(theme.colors.signal, 0.2)} 0%, transparent 70%)` }} />
      {STARS.map(([x, y, sz, op], i) => (
        <span key={i} style={{ position: "absolute", left: `${x}%`, top: `${y}%`, width: sz, height: sz,
          borderRadius: 999, background: "#FFFFFF", opacity: op,
          boxShadow: sz >= 3 ? `0 0 ${sz * 3}px rgba(255,255,255,0.9)` : `0 0 ${sz * 2}px rgba(255,255,255,0.6)` }} />
      ))}
    </div>
  );
};

const CornerTicks: React.FC<{ color: string }> = ({ color }) => {
  const bar = (s: React.CSSProperties): React.CSSProperties => ({ position: "absolute", background: color, ...s });
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
}> = ({ children, gap = 40, align = "center" }) => {
  // ONE shared content zone for every style (styles differ only in chrome, not in
  // where content sits). The CaptionDivider + N14 oracles read the SAME constant,
  // so content, the divider line, and validation all agree on where content lives.
  const zone = CONTENT_ZONE;
  return (
    <div
      style={{
        position: "absolute",
        top: zone.top,
        left: zone.left,
        width: rectWidth(zone),
        height: rectHeight(zone),
        display: "flex",
        flexDirection: "column",
        justifyContent: align === "center" ? "center" : "flex-start",
        gap,
      }}
    >
      {children}
    </div>
  );
};
