import React from "react";
import { withAlpha, type Theme } from "@motionreal/theme";

/**
 * Block surface helpers — pure functions that map the neutral runtime theme's
 * `surface` / `radius` / `colors` tokens into concrete CSS. Render internals use
 * these instead of hard-coded borders, radii, or shadows so chrome stays
 * consistent with `makeTheme`. Authored scenes do not import this package.
 *
 * All functions are pure (theme in → CSS out), so a block stays deterministic.
 */

// --- Border ---------------------------------------------------------------

/** CSS `border` shorthand for a delineated block, from theme surface tokens. */
export function surfaceBorder(theme: Theme): string {
  const w = theme.surface.borderWidth;
  if (w <= 0) return "none";
  return `${w}px solid ${theme.surface.borderColor}`;
}

/** Border width in px (0 ⇒ no border) — for per-side borders. */
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

/** Corner radius in px for a given element size, from the theme radius scale. */
export function surfaceRadius(theme: Theme, size: "sm" | "md" | "lg" = "md"): number {
  return theme.radius[size];
}

// --- Shadow ---------------------------------------------------------------

/**
 * CSS `boxShadow` for a floating block, from `theme.surface.shadowStyle`:
 * - "hard-offset" → hard offset drop (`10px 10px 0 accent`)
 * - "glow" → accent halo + soft depth shadow
 * - "soft" → gentle diffuse depth shadow (neutral theme default)
 * - "none" → no shadow
 * `accent` is the color the block wants to express (usually its tone color).
 */
export function surfaceShadow(theme: Theme, accent: string): string {
  switch (theme.surface.shadowStyle) {
    case "hard-offset":
      return `10px 10px 0 ${withAlpha(accent, 0.9)}`;
    case "glow":
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
 * Accent top-rule bar (solid strip across a block's top edge). Returns null when
 * `surface.topRule` is false (neutral theme default). Respects the block's top
 * corner radius when present.
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
 * Style for a small label/eyebrow chip, from `theme.surface.chipStyle`:
 * - "solid" → solid accent fill with readable text on it
 * - "outline" → translucent tinted pill with accent border + accent text
 * `onColor` picks readable text on a solid fill.
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
 * Shared text styling for a mono label/eyebrow (tracking + case) from
 * `theme.surface` label tokens.
 */
export function labelStyle(theme: Theme): React.CSSProperties {
  return {
    letterSpacing: theme.surface.labelTracking,
    textTransform: theme.surface.labelUppercase ? "uppercase" : "none",
  };
}
