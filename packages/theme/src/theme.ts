/**
 * @motionreal/theme — one neutral runtime theme for render internals.
 *
 * Authored scenes must not import this package. Runtime reads a Theme via
 * useTheme (captions, SceneImage chrome, composition backdrop).
 */

// --- Hex helpers (pure, deterministic) ------------------------------------

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Accepts "#RGB" or "#RRGGBB" (case-insensitive); returns null if unparseable. */
export function normalizeHex(input: string | undefined | null): string | null {
  if (!input) return null;
  const v = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(v)) {
    const [r, g, b] = v.split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v.toLowerCase()}`;
  return null;
}

function hexToRgb(hex: string): [number, number, number] {
  const v = (normalizeHex(hex) ?? "#000000").slice(1);
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

/** Translucent color string from a solid hex + alpha (0-1). */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${clamp(alpha, 0, 1)})`;
}

// --- Fixed constants ------------------------------------------------------

export const DEFAULT_DOMINANT = "#2F5FF0";
export const NEUTRAL_THEME_ID = "neutral";

/** Fixed companion tone for the depth wash (not hue-derived). */
const FIXED_SIGNAL = "#E8A838";

// --- Theme shape ----------------------------------------------------------

export type ThemeColors = {
  bg: string;
  bgElevated: string;
  panel: string;
  fg: string;
  muted: string;
  accent: string;
  signal: string;
};

export type ThemeRadius = { sm: number; md: number; lg: number };

export type SurfaceTokens = {
  borderWidth: number;
  borderColor: string;
};

export type Theme = {
  id: string;
  name: string;
  dominant: string;
  dark: boolean;
  colors: ThemeColors;
  fonts: { display: string; body: string; mono: string };
  radius: ThemeRadius;
  surface: SurfaceTokens;
};

const NEUTRAL_FONTS = { display: "Inter", body: "Inter", mono: "Cascadia Mono" } as const;
const NEUTRAL_RADIUS: ThemeRadius = { sm: 8, md: 14, lg: 22 };
const NEUTRAL_SURFACE: SurfaceTokens = {
  borderWidth: 1,
  borderColor: "#2A2E3A",
};

/** Fixed dark chrome; accent = project dominant hex. */
function deriveColors(dominant: string): ThemeColors {
  return {
    bg: "#0E0F13",
    bgElevated: "#16181F",
    panel: "#1B1E27",
    fg: "#F4F5F7",
    muted: "#9AA0AD",
    accent: dominant,
    signal: FIXED_SIGNAL,
  };
}

/** Build the neutral theme for a dominant hex. */
export function makeTheme(dominant: string = DEFAULT_DOMINANT): Theme {
  const hex = normalizeHex(dominant) ?? DEFAULT_DOMINANT;
  return {
    id: NEUTRAL_THEME_ID,
    name: "Neutral",
    dominant: hex,
    dark: true,
    colors: deriveColors(hex),
    fonts: { ...NEUTRAL_FONTS },
    radius: { ...NEUTRAL_RADIUS },
    surface: { ...NEUTRAL_SURFACE },
  };
}

export const theme: Theme = makeTheme(DEFAULT_DOMINANT);

/** Shared depth wash behind scenes (deterministic function of theme colors). */
export function sceneBackground(t: Theme = theme): string {
  return [
    `radial-gradient(120% 85% at 50% -12%, ${withAlpha(t.colors.accent, 0.2)} 0%, ${withAlpha(t.colors.accent, 0.05)} 38%, transparent 62%)`,
    `radial-gradient(95% 75% at 88% 112%, ${withAlpha(t.colors.signal, 0.16)} 0%, transparent 58%)`,
    `linear-gradient(180deg, ${t.colors.bgElevated} 0%, ${t.colors.bg} 58%, ${t.colors.bg} 100%)`,
  ].join(", ");
}
