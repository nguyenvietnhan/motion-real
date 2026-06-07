import { PRINT, withAlpha, type Theme } from "@news/design";

/**
 * Pack-driven chrome helpers (tool-productization R1.10). Blocks call these
 * instead of hard-coding the bold-editorial chrome, so the SAME authored scene
 * adapts to the selected style pack (e.g. `clean-premium` → hairline borders,
 * soft shadow, no grid/ticks). Pure functions of the theme — deterministic.
 */

/** CSS `border` shorthand for a delineated block, per the pack's border chrome. */
export function chromeBorder(theme: Theme): string {
  const b = theme.chrome.border;
  if (b.style === "none") return "none";
  return `${b.width}px solid ${PRINT.ink}`;
}

/** Border width in px (0 when the pack draws no border) — for per-side borders. */
export function chromeBorderWidth(theme: Theme): number {
  return theme.chrome.border.style === "none" ? 0 : theme.chrome.border.width;
}

/** CSS `boxShadow` for a floating block, per the pack's shadow chrome. */
export function chromeShadow(theme: Theme, accent: string): string {
  switch (theme.chrome.shadow) {
    case "hard-offset":
      return `10px 10px 0 ${withAlpha(accent, 0.9)}`;
    case "soft-diffuse":
      return `0 12px 32px ${withAlpha(PRINT.ink, 0.14)}`;
    default:
      return "none";
  }
}
