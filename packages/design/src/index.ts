/**
 * Central design system — the shared visual "grammar" every scene component
 * pulls from. This is the equivalent of math-tool's mvlib theme: diversity is
 * allowed at the component level, but the palette, type scale, spacing, and
 * motion language stay coherent so videos feel like one brand.
 */

export const theme = {
  id: "clean-luxury-tech",
  name: "Clean Luxury Tech",
  colors: {
    bg: "#06070A",
    bgElevated: "#0B0E14",
    fg: "#F6F1E6",
    muted: "#A9B0B7",
    accent: "#C7A75A", // premium gold
    signal: "#4CE0A7", // creative green
    blue: "#82B7FF",
    danger: "#FF827A",
    line: "rgba(246, 241, 230, 0.12)",
  },
  fonts: {
    // Mapped to locally available Vietnamese-safe fonts; @remotion/google-fonts
    // can later replace these with bundled webfonts for deterministic renders.
    display: '"Aptos Display", "Segoe UI Variable Display", "Segoe UI", sans-serif',
    body: '"Aptos", "Segoe UI Variable Text", "Segoe UI", sans-serif',
    mono: '"Cascadia Mono", "Consolas", monospace',
  },
  radius: {
    sm: 16,
    md: 28,
    lg: 36,
  },
  space: (n: number) => n * 8,
  // 9:16 vertical canvas
  canvas: {
    width: 1080,
    height: 1920,
  },
} as const;

export type Theme = typeof theme;

/** Easing tuned to feel deliberate / premium rather than bouncy. */
export const easing = {
  /** Smooth ease-out for entrances. */
  out: [0.16, 1, 0.3, 1] as [number, number, number, number],
  /** Gentle ease-in-out. */
  inOut: [0.65, 0, 0.35, 1] as [number, number, number, number],
};

/** Spring config presets for Remotion's spring(). */
export const springs = {
  /** Soft, no overshoot — for text and panels. */
  gentle: { damping: 200, mass: 1, stiffness: 100 },
  /** Snappy with a touch of life — for badges and accents. */
  snappy: { damping: 18, mass: 0.7, stiffness: 140 },
};

/** Shared background gradient used across scenes for visual continuity. */
export function sceneBackground(): string {
  return (
    `radial-gradient(circle at 50% 25%, rgba(199,167,90,0.12) 0%, ` +
    `rgba(76,224,167,0.06) 35%, rgba(130,183,255,0.03) 60%, rgba(6,7,10,0) 80%), ` +
    theme.colors.bg
  );
}

export const designNotes = `## Clean Luxury Tech

Premium editorial-tech video system: dark, restrained, polished. Architectural
spacing, large display typography, focus-pull transitions, no auto subtitles.

- Background: ${theme.colors.bg}
- Foreground: ${theme.colors.fg}
- Premium accent: ${theme.colors.accent}
- Creative signal: ${theme.colors.signal}

Avoid: transcript subtitles, unapproved neon gradients, noisy glitch effects.
`;
