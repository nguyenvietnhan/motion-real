/**
 * @motionreal/theme — one neutral runtime theme for render internals.
 *
 * Authored scenes must not import this package. Runtime reads a Theme via
 * useTheme (captions, SceneImage chrome, composition backdrop).
 */

// --- Color math (pure, deterministic) -------------------------------------

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

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [h, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = ln - c / 2;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function hexToHsl(hex: string): [number, number, number] {
  return rgbToHsl(...hexToRgb(hex));
}

function hslToHex(h: number, s: number, l: number): string {
  return rgbToHex(...hslToRgb(h, s, l));
}

/** Translucent color string from a solid hex + alpha (0-1). */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${clamp(alpha, 0, 1)})`;
}

// --- Fixed constants ------------------------------------------------------

export const CANVAS = { width: 1080, height: 1920 } as const;
export const DEFAULT_DOMINANT = "#2F5FF0";
export const NEUTRAL_THEME_ID = "neutral";

/** Semantic accents for charts / compares on the dark base. */
export const PRINT = {
  blue: "#5B8CFF",
  red: "#FF6B5E",
  yellow: "#F4C430",
  green: "#34D399",
  violet: "#A98BFF",
} as const;

/** Easing for Remotion interpolate / motion helpers. */
export const easing = {
  out: [0.16, 1, 0.3, 1] as [number, number, number, number],
  inOut: [0.65, 0, 0.35, 1] as [number, number, number, number],
};

// --- Theme shape ----------------------------------------------------------

export type ThemeColors = {
  bg: string;
  bgElevated: string;
  panel: string;
  fg: string;
  muted: string;
  accent: string;
  signal: string;
  line: string;
  red: string;
  blue: string;
  yellow: string;
  green: string;
  violet: string;
};

export type ThemeRadius = { sm: number; md: number; lg: number };

export type SurfaceTokens = {
  borderWidth: number;
  borderColor: string;
  panelFill: string;
};

export type BackdropTokens = {
  /** When true, paint the horizontal caption divider (production default: off). */
  divider: boolean;
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
  backdrop: BackdropTokens;
  canvas: typeof CANVAS;
};

const NEUTRAL_FONTS = { display: "Inter", body: "Inter", mono: "Cascadia Mono" } as const;
const NEUTRAL_RADIUS: ThemeRadius = { sm: 8, md: 14, lg: 22 };
const NEUTRAL_SURFACE: SurfaceTokens = {
  borderWidth: 1,
  borderColor: "#2A2E3A",
  panelFill: "#1B1E27",
};
const NEUTRAL_BACKDROP: BackdropTokens = { divider: false };

function deriveColors(dominant: string): ThemeColors {
  const [h, s] = hexToHsl(dominant);
  const accent = hslToHex(h, clamp(Math.max(s, 62), 50, 92), 62);
  const signal = hslToHex((h + 150) % 360, clamp(Math.max(s, 55), 48, 88), 60);
  return {
    bg: "#0E0F13",
    bgElevated: "#16181F",
    panel: "#1B1E27",
    fg: "#F4F5F7",
    muted: "#9AA0AD",
    accent,
    signal,
    line: "#2A2E3A",
    red: PRINT.red,
    blue: PRINT.blue,
    yellow: PRINT.yellow,
    green: PRINT.green,
    violet: PRINT.violet,
  };
}

/** Build the neutral theme for a dominant hue. */
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
    backdrop: { ...NEUTRAL_BACKDROP },
    canvas: CANVAS,
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
