/**
 * @motionreal/theme — the SINGLE neutral theme (freeform-engine R1/D1).
 *
 * The "thay máu" overhaul deletes the multi-language design system and its
 * editorial/galaxy `StyleLanguage` registry. Authored scenes now decide
 * ALL of their own visuals in code; the engine no longer imposes a look. But
 * `@motionreal/blocks` still reads a resolved `Theme` off `useTheme()` in render
 * internals, so we keep ONE neutral theme: a dark near-black base, near-white
 * ink, one accent, medium corners, render-safe fonts. Authored scenes do not
 * read this theme or import blocks.
 *
 * This module keeps the runtime `Theme` shape and the proven 2-layer cross-model
 * defense (typed alias keys + a Proxy fallback) for `colors` and `radius`, so a
 * stale runtime/fixture token read can never break a render. There is no
 * selectable style identity here: `makeTheme` derives one neutral runtime theme
 * from the dominant hue.
 *
 * Pure + deterministic (no Math.random / Date / IO): a theme is a stable function
 * of its dominant hue.
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

/** rgb 0-255 -> hsl with h in [0,360), s/l in [0,100]. */
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

/** hsl (h 0-360, s/l 0-100) -> rgb 0-255. */
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

export function hexToHsl(hex: string): [number, number, number] {
  return rgbToHsl(...hexToRgb(hex));
}

export function hslToHex(h: number, s: number, l: number): string {
  return rgbToHex(...hslToRgb(h, s, l));
}

/** Translucent color string from a solid hex + alpha (0-1). */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${clamp(alpha, 0, 1)})`;
}

/** Relative luminance 0-1 (sRGB approximation) of a solid hex. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Pick a text color that reads on a given solid fill. Returns one of the two
 * provided "ends" (a near-black ink and a near-white paper) by luminance.
 */
export function readableOn(fillHex: string, dark: string, light: string): string {
  return luminance(fillHex) > 0.62 ? dark : light;
}

// --- Fixed constants ------------------------------------------------------

/** The 9:16 canvas (TikTok). YouTube 16:9 geometry lives in `@motionreal/schema`'s `geometry()`. */
export const CANVAS = { width: 1080, height: 1920 } as const;

/** Fallback dominant when a spec carries no palette (a punchy blue that reads on the dark base). */
export const DEFAULT_DOMINANT = "#2F5FF0";

/**
 * Semantic accent set for charts / compares / danger, tuned to read on the dark
 * neutral base. `onColor` references ink/paper to pick readable text on a fill.
 */
export const PRINT = {
  ink: "#0E0F13",
  paper: "#F4F5F7",
  blue: "#5B8CFF",
  red: "#FF6B5E",
  yellow: "#F4C430",
  green: "#34D399",
  violet: "#A98BFF",
} as const;

/** Pick ink or paper text so it reads on a given solid fill. */
export function onColor(hex: string): string {
  return readableOn(hex, PRINT.ink, PRINT.paper);
}

/** A curated set of dominant colors that read on the dark base. */
export const CURATED_DOMINANTS: readonly string[] = [
  "#2F5FF0", // electric blue
  "#E8412E", // signal red
  "#1FA463", // print green
  "#7A4DE0", // violet
  "#E8762E", // orange
  "#1E9CB0", // teal
  "#C2367E", // magenta
  "#3B7A1E", // leaf
] as const;

/** Deterministic dominant pick from a seed string (no Math.random). */
export function pickDominant(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const index = Math.abs(hash) % CURATED_DOMINANTS.length;
  return CURATED_DOMINANTS[index]!;
}

/** Easing tuned to feel deliberate / premium rather than bouncy. */
export const easing = {
  out: [0.16, 1, 0.3, 1] as [number, number, number, number],
  inOut: [0.65, 0, 0.35, 1] as [number, number, number, number],
};

/** Spring config presets for Remotion's spring(). */
export const springs = {
  gentle: { damping: 200, mass: 1, stiffness: 100 },
  snappy: { damping: 18, mass: 0.7, stiffness: 140 },
};

// --- Runtime token model --------------------------------------------------

/** Corner radius scale (px). Read by blocks instead of hard-coding. */
export type RadiusScale = { sm: number; md: number; lg: number };

/**
 * The resolved radius scale runtime helpers read off `theme.radius`. Canonical is
 * `sm/md/lg`; the extra keys are cross-model ALIASES (Layer 1) so stale/generated
 * code reaching for the Tailwind vocabulary both typechecks (N10) and renders a
 * real radius instead of a TS2339 / `undefined`. Any UNFORESEEN key is caught at
 * runtime by the Proxy fallback (`wrapRadius`).
 */
export type ThemeRadius = RadiusScale & {
  none: number; xs: number; s: number; small: number; tiny: number; zero: number; flat: number; square: number;
  m: number; medium: number; regular: number; normal: number; base: number; default: number; card: number; panel: number; box: number; rounded: number;
  l: number; large: number; xl: number; "2xl": number; "3xl": number; big: number; hero: number; full: number; pill: number;
};

/** How a block draws itself — the surface grammar blocks read instead of hard-coding CSS. */
export type SurfaceTokens = {
  borderWidth: number;
  borderColor: string;
  panelFill: string;
  panelFillElevated: string;
  shadowStyle: "hard-offset" | "glow" | "soft" | "none";
  topRule: boolean;
  topRuleHeight: number;
  chipStyle: "solid" | "outline";
  labelTracking: string;
  labelUppercase: boolean;
};

/** The full-frame backdrop a language paints behind content (the `Frame`). */
export type BackdropTokens = {
  fill: "flat" | "radial";
  grid: boolean;
  registrationTicks: boolean;
  starfield: boolean;
  frameBorder: boolean;
  divider: boolean;
};

/** Optional translucent plate behind the burned-in caption. */
export type CaptionScrim = {
  opacity: number;
  blur: number;
  radius: number;
  tone: "light" | "dark";
};

/** The canonical color palette. */
export type CoreColors = {
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

export type ThemeColors = CoreColors & {
  /** → fg. */ ink: string;
  /** → bg. */ paper: string;
  /** → accent. */ primary: string;
  /** → signal. */ danger: string;
  /** → signal. */ signalRed: string;
  /** → fg. */ foreground: string;
  /** → fg. */ text: string;
  /** → bg. */ background: string;
  /** → line. */ border: string;
  /** → panel. */ surface: string;
  /** → panel. */ card: string;
  /** → accent. */ accentLight: string;
  /** → muted. */ textSecondary: string;
  /** → muted. */ secondaryText: string;
  /** → muted. */ subtle: string;
};

/**
 * The resolved theme object blocks and composition runtime consume. `surface` is omitted
 * from the color spread because `ThemeColors` carries a `surface: string` alias
 * (→ panel) that would otherwise intersect with the structured `surface:
 * SurfaceTokens`; the structured shape is the truth, the color alias stays
 * reachable via `theme.colors.surface`.
 */
export type Theme = Omit<ThemeColors, "surface"> & {
  id: string;
  name: string;
  dominant: string;
  dark: boolean;
  colors: ThemeColors;
  fonts: { display: string; body: string; mono: string };
  radius: ThemeRadius;
  surface: SurfaceTokens;
  backdrop: BackdropTokens;
  captionScrim?: CaptionScrim;
  space: (n: number) => number;
  canvas: typeof CANVAS;
};

// --- The one neutral look -------------------------------------------------

/** Stable id of the single neutral theme. */
export const NEUTRAL_THEME_ID = "neutral";

/** Render-safe font families (Inter + Cascadia Mono ship the Vietnamese subset). */
const NEUTRAL_FONTS = { display: "Inter", body: "Inter", mono: "Cascadia Mono" } as const;

/**
 * Derive the neutral palette from a dominant hue: a dark near-black base, near-
 * white ink, an accent + split-complement companion lifted to read on the dark
 * base, and a vivid semantic series. Pure.
 */
function deriveNeutral(dominant: string): CoreColors {
  const [h, s] = hexToHsl(dominant);
  const accent = hslToHex(h, clamp(Math.max(s, 62), 50, 92), 62);
  const signal = hslToHex((h + 150) % 360, clamp(Math.max(s, 55), 48, 88), 60);
  return {
    bg: "#0E0F13", // near-black base
    bgElevated: "#16181F",
    panel: "#1B1E27",
    fg: "#F4F5F7", // near-white ink
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

/** The neutral surface grammar: hairline border, soft shadow, outline chips, medium corners. */
const NEUTRAL_SURFACE: SurfaceTokens = {
  borderWidth: 1,
  borderColor: "#2A2E3A",
  panelFill: "#1B1E27",
  panelFillElevated: "#16181F",
  shadowStyle: "soft",
  topRule: false,
  topRuleHeight: 0,
  chipStyle: "outline",
  labelTracking: "0.08em",
  labelUppercase: false,
};

/** Medium rounding ("bo vừa"): never square, never a full pill. */
const NEUTRAL_RADIUS: RadiusScale = { sm: 8, md: 14, lg: 22 };

const NEUTRAL_BACKDROP: BackdropTokens = {
  // A radial fill so `Frame` paints the depth wash (accent/signal glows over the
  // base gradient) instead of a dead flat near-black — the same look the
  // composition backdrop paints, so a scene that wraps in `<Frame>` matches the
  // global wash rather than covering it with a flat fill.
  fill: "radial",
  grid: false,
  registrationTicks: false,
  starfield: false,
  frameBorder: false,
  // The horizontal caption divider line is OFF (project owner: drop the visible
  // rule). The old above-divider N14 profile is opt-in/manual and is not part of
  // the production default while this stays false.
  divider: false,
};

// --- Cross-model resolution (Layers 1 + 2) --------------------------------

/** Build the full cross-model `ThemeColors`: canonical + semantic + Layer-1 aliases. */
function buildThemeColors(c: CoreColors): ThemeColors {
  return {
    ...c,
    ink: c.fg,
    paper: c.bg,
    primary: c.accent,
    danger: c.signal,
    signalRed: c.signal,
    foreground: c.fg,
    text: c.fg,
    textSecondary: c.muted,
    secondaryText: c.muted,
    subtle: c.muted,
    background: c.bg,
    border: c.line,
    surface: c.panel,
    card: c.panel,
    accentLight: c.accent,
  };
}

/** Build the full cross-model `ThemeRadius`: canonical sm/md/lg + every alias by size intent. */
function buildThemeRadius(r: RadiusScale): ThemeRadius {
  return {
    ...r,
    none: r.sm, xs: r.sm, s: r.sm, small: r.sm, tiny: r.sm, zero: r.sm, flat: r.sm, square: r.sm,
    m: r.md, medium: r.md, regular: r.md, normal: r.md, base: r.md, default: r.md, card: r.md, panel: r.md, box: r.md, rounded: r.md,
    l: r.lg, large: r.lg, xl: r.lg, "2xl": r.lg, "3xl": r.lg, big: r.lg, hero: r.lg, full: r.lg, pill: r.lg,
  };
}

/** JS/React/serialization probe keys that must pass through the Proxies untouched. */
const PROBE_KEYS = new Set<string>([
  "then", "toJSON", "toString", "valueOf", "constructor", "$$typeof",
  "@@iterator", "asymmetricMatch", "nodeType", "hasOwnProperty",
]);
const loggedUnknownColors = new Set<string>();
const loggedUnknownRadius = new Set<string>();
const loggedFlatColorReads = new Set<string>();

/** Layer 2 for colors — an unknown string key resolves to `fg`, logged once. */
function wrapColors(colors: ThemeColors): ThemeColors {
  return new Proxy(colors, {
    get(target, key, receiver) {
      if (typeof key !== "string" || key in target || PROBE_KEYS.has(key)) {
        return Reflect.get(target, key, receiver);
      }
      if (!loggedUnknownColors.has(key)) {
        loggedUnknownColors.add(key);
        // eslint-disable-next-line no-console
        console.warn(`[theme] runtime read unknown color token "colors.${key}" — falling back to colors.fg.`);
      }
      return target.fg;
    },
  });
}

/** Layer 2 for radius — an unknown string key resolves to `md`, logged once. */
function wrapRadius(radius: ThemeRadius): ThemeRadius {
  return new Proxy(radius, {
    get(target, key, receiver) {
      if (typeof key !== "string" || key in target || PROBE_KEYS.has(key)) {
        return Reflect.get(target, key, receiver);
      }
      if (!loggedUnknownRadius.has(key)) {
        loggedUnknownRadius.add(key);
        // eslint-disable-next-line no-console
        console.warn(`[theme] runtime read unknown radius token "radius.${key}" — falling back to radius.md.`);
      }
      return target.md;
    },
  });
}

/** Wrap the theme so a FLAT color read (`theme.accent`) forwards into `colors`. */
function wrapTheme(base: Omit<Theme, keyof ThemeColors>, colors: ThemeColors): Theme {
  return new Proxy(base as Theme, {
    get(target, key, receiver) {
      if (typeof key !== "string" || key in target || PROBE_KEYS.has(key)) {
        return Reflect.get(target, key, receiver);
      }
      if (key in colors) {
        if (!loggedFlatColorReads.has(key)) {
          loggedFlatColorReads.add(key);
          // eslint-disable-next-line no-console
          console.warn(`[theme] runtime read color token "theme.${key}" directly — resolving via theme.colors.${key}.`);
        }
        return (colors as unknown as Record<string, string>)[key];
      }
      return Reflect.get(target, key, receiver);
    },
  });
}

// --- Theme assembly -------------------------------------------------------

/** Build the neutral theme for a dominant hue. */
export function makeTheme(dominant: string = DEFAULT_DOMINANT): Theme {
  const hex = normalizeHex(dominant) ?? DEFAULT_DOMINANT;
  const core = deriveNeutral(hex);
  const colors = wrapColors(buildThemeColors(core));
  const base = {
    id: NEUTRAL_THEME_ID,
    name: "Neutral",
    dominant: hex,
    dark: true,
    colors,
    fonts: { ...NEUTRAL_FONTS },
    radius: wrapRadius(buildThemeRadius(NEUTRAL_RADIUS)),
    surface: NEUTRAL_SURFACE,
    backdrop: NEUTRAL_BACKDROP,
    // No captionScrim: the burned karaoke caption is text-only (bold ink + halo),
    // no background plate behind it — the halo alone keeps it legible over video.
    captionScrim: undefined,
    space: (n: number) => n * 8,
    canvas: CANVAS,
  };
  return wrapTheme(base, colors);
}

/** Default theme (Studio / tests / any consumer with no project palette). */
export const theme: Theme = makeTheme(DEFAULT_DOMINANT);

/**
 * Shared background wash, derived from the active theme's accent/companion. A
 * flat near-black base reads "dead" on a phone screen, so this layers depth:
 *   - a soft ACCENT glow blooming from the top (where the title sits),
 *   - a cooler SIGNAL glow rising from the bottom-right corner,
 *   - over a vertical base gradient from the ELEVATED tone down to the deep base.
 * The glows use transparent outer stops so they fade into the base rather than
 * banding. Pure function of the theme tokens — deterministic (N16 holds).
 */
export function sceneBackground(t: Theme = theme): string {
  return [
    `radial-gradient(120% 85% at 50% -12%, ${withAlpha(t.colors.accent, 0.2)} 0%, ${withAlpha(t.colors.accent, 0.05)} 38%, transparent 62%)`,
    `radial-gradient(95% 75% at 88% 112%, ${withAlpha(t.colors.signal, 0.16)} 0%, transparent 58%)`,
    `linear-gradient(180deg, ${t.colors.bgElevated} 0%, ${t.colors.bg} 58%, ${t.colors.bg} 100%)`,
  ].join(", ");
}

/** Short design-system note surfaced to tooling (doctor). */
export const designNotes = `## Neutral theme (freeform)

Một theme trung tính DUY NHẤT cho video 9:16/16:9: nền tối gần đen, chữ gần trắng,
một màu nhấn theo dominant, bo góc vừa, font render-safe (Inter + Cascadia Mono).
A.I tự quyết toàn bộ màu/bố cục trong code cảnh. Theme này chỉ phục vụ runtime
internals như captions, thumbnail, backdrop và SceneImage; authored scenes không
đọc theme tokens và không import \`@motionreal/theme\`.`;
