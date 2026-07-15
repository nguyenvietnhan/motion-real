import type { Theme } from "@motionreal/theme";

/**
 * Thin surface helpers for SceneImage chrome (border + radius from theme).
 * Authored scenes do not import this package.
 */

/** CSS `border` shorthand for a delineated block, from theme surface tokens. */
export function surfaceBorder(theme: Theme): string {
  const w = theme.surface.borderWidth;
  if (w <= 0) return "none";
  return `${w}px solid ${theme.surface.borderColor}`;
}

/** Corner radius in px for a given element size, from the theme radius scale. */
export function surfaceRadius(theme: Theme, size: "sm" | "md" | "lg" = "md"): number {
  return theme.radius[size];
}
