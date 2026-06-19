import React from "react";
import { withAlpha, type Theme } from "@news/theme";

/**
 * The block SURFACE-KIT — pure helpers that turn a resolved language's `surface`
 * / `radius` / `colors` tokens into concrete CSS. Blocks call these instead of
 * hard-coding `4px solid #17150F`, `border-radius: 0`, or a fixed drop shadow, so
 * the SAME block renders correctly in EVERY design language (editorial print,
 * galaxy dark, and any future language) by reading the theme. This is the seam
 * that makes the look swappable end-to-end.
 *
 * All functions are pure (theme in → CSS out), so a block stays deterministic.
 */

// --- Border ---------------------------------------------------------------

/** CSS `border` shorthand for a delineated block, per the language's surface tokens. */
export function surfaceBorder(theme: Theme): string {
  const w = theme.surface.borderWidth;
  if (w <= 0) return "none";
  return `${w}px solid ${theme.surface.borderColor}`;
}

/** Border width in px (0 ⇒ the language draws no border) — for per-side borders. */
export function surfaceBorderWidth(theme: Theme): number {
  return Math.max(0, theme.surface.borderWidth);
}

/** A per-side inner divider (e.g. number-tile right edge) in the border color. */
export function innerDivider(theme: Theme): string {
  const w = surfaceBorderWidth(theme);
  if (w <= 0) return "none";
  return `${w}px solid ${theme.surface.borderColor}`;
}

// --- Radius ---------------------------------------------------------------

/** Corner radius in px for a given element size, from the language's radius scale. */
export function surfaceRadius(theme: Theme, size: "sm" | "md" | "lg" = "md"): number {
  return theme.radius[size];
}

// --- Shadow ---------------------------------------------------------------

/**
 * CSS `boxShadow` for a floating block, per the language's shadow style:
 *  - "hard-offset" → editorial print drop (`10px 10px 0 accent`)
 *  - "glow"        → galaxy neon glow in the accent + a soft depth shadow
 *  - "soft"        → a gentle diffuse depth shadow
 *  - "none"        → no shadow
 * `accent` is the color the block wants to express (usually its tone color).
 */
export function surfaceShadow(theme: Theme, accent: string): string {
  switch (theme.surface.shadowStyle) {
    case "hard-offset":
      return `10px 10px 0 ${withAlpha(accent, 0.9)}`;
    case "glow":
      // Neon halo in the accent + a soft dark depth shadow so the card lifts off
      // the night base without a hard edge.
      return `0 0 24px ${withAlpha(accent, 0.45)}, 0 12px 32px rgba(0,0,0,0.45)`;
    case "soft":
      return `0 12px 32px rgba(0,0,0,0.22)`;
    default:
      return "none";
  }
}

// --- Composite surface ----------------------------------------------------

/**
 * The standard style object for a delineated, floating block (panel/card/stat):
 * border + radius + fill + shadow, all from tokens. Blocks spread this and add
 * their own layout (padding/grid). `accent` drives the shadow's color; `size`
 * picks the radius step; `fill` overrides the default panel fill if needed.
 */
export function blockSurface(
  theme: Theme,
  opts: { accent?: string; size?: "sm" | "md" | "lg"; fill?: string; shadow?: boolean } = {},
): React.CSSProperties {
  const accent = opts.accent ?? theme.colors.accent;
  return {
    border: surfaceBorder(theme),
    borderRadius: surfaceRadius(theme, opts.size ?? "md"),
    background: opts.fill ?? theme.surface.panelFill,
    boxShadow: opts.shadow === false ? "none" : surfaceShadow(theme, accent),
  };
}

/**
 * The accent TOP-RULE bar style (the editorial print detail: a solid accent strip
 * across a block's top edge). Returns null for languages that express accent
 * another way (galaxy = glow + tint, `surface.topRule: false`) so a block simply
 * omits the bar. The bar respects the block's top corners (rounded languages).
 */
export function topRuleStyle(theme: Theme, color: string): React.CSSProperties | null {
  if (!theme.surface.topRule) return null;
  const r = surfaceRadius(theme, "md");
  return {
    height: theme.surface.topRuleHeight,
    background: color,
    borderBottom: innerDivider(theme),
    borderTopLeftRadius: r,
    borderTopRightRadius: r,
  };
}

// --- Chips / labels -------------------------------------------------------

/**
 * Style for a small label/eyebrow CHIP, per the language's chip style:
 *  - "solid"   → a solid accent fill with readable text on it (editorial)
 *  - "outline" → a translucent tinted pill with an accent border + accent text (galaxy)
 * `onColor` is the function that picks readable text on a solid fill (passed in
 * so blocks keep using the language-aware resolver).
 */
export function chipStyle(
  theme: Theme,
  color: string,
  onColor: (hex: string) => string,
): React.CSSProperties {
  const radius = surfaceRadius(theme, "sm");
  if (theme.surface.chipStyle === "outline") {
    return {
      background: withAlpha(color, 0.14),
      color,
      border: `1px solid ${withAlpha(color, 0.6)}`,
      borderRadius: radius,
    };
  }
  return {
    background: color,
    color: onColor(color),
    border: surfaceBorder(theme),
    borderRadius: radius,
  };
}

/**
 * Shared text styling for a mono label/eyebrow (tracking + case), per the
 * language: editorial shouts in uppercase with wide tracking; galaxy keeps a
 * calmer natural case with tight tracking.
 */
export function labelStyle(theme: Theme): React.CSSProperties {
  return {
    letterSpacing: theme.surface.labelTracking,
    textTransform: theme.surface.labelUppercase ? "uppercase" : "none",
  };
}
