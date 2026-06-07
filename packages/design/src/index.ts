/**
 * Central design system — the shared visual "grammar" every scene component
 * pulls from.
 *
 * The look is NO LONGER a single frozen palette. Layout, type scale, spacing,
 * radius, and motion stay constant (the "defaults" that keep every video on
 * brand and readable), but the COLOR palette is derived from one dominant hue
 * per project via `makeTheme(dominant)`. The whole video — background tint,
 * accent, companion tone, lines — flows from that single hue, so each project
 * reads as one coherent color while different projects look distinct.
 *
 * Determinism: pure math only (no Math.random / Date / IO), so the palette is a
 * stable function of the dominant color stored in the spec.
 */

// --- Color math (pure, deterministic) -------------------------------------

function clamp(n: number, min: number, max: number): number {
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
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ];
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

// --- Constant grammar (the stable defaults) -------------------------------

const FONTS = {
  display: '"Aptos Display", "Segoe UI Variable Display", "Segoe UI", sans-serif',
  body: '"Aptos", "Segoe UI Variable Text", "Segoe UI", sans-serif',
  mono: '"Cascadia Mono", "Consolas", monospace',
} as const;

const RADIUS = { sm: 0, md: 0, lg: 0 } as const;

const CANVAS = { width: 1080, height: 1920 } as const;

/** Fallback dominant when a spec carries no palette (a punchy editorial blue). */
export const DEFAULT_DOMINANT = "#2F5FF0";

/**
 * Bright "print" accents for the light editorial look — used semantically by
 * scenes/blocks (e.g. blue vs red in a compare, yellow to highlight). Fixed +
 * deterministic. `ink`/`paper` are the base.
 */
export const PRINT = {
  ink: "#17150F",
  paper: "#F2ECDC",
  blue: "#2F5FF0",
  red: "#E8412E",
  yellow: "#F4B400",
  green: "#1FA463",
  violet: "#7A4DE0",
} as const;

/** Pick ink or paper text so it reads on a given solid fill (by luminance). */
export function onColor(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.62 ? PRINT.ink : PRINT.paper;
}

/**
 * A curated set of dominant colors that all read well on the cream base. The
 * planner/mock pick one per project; nothing here is random at render time.
 */
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

// --- Theme type + builder -------------------------------------------------

export type ThemeColors = {
  bg: string;
  bgElevated: string;
  /** Card / panel surface (solid); use withAlpha() for translucent variants. */
  panel: string;
  fg: string;
  muted: string;
  /** Primary project color the AI chose. */
  accent: string;
  /** Analogous companion derived from the dominant (same family, shifted). */
  signal: string;
  /** Hairline borders. */
  line: string;
};

export type Theme = {
  id: string;
  name: string;
  /** The dominant hex this palette was derived from. */
  dominant: string;
  colors: ThemeColors;
  fonts: typeof FONTS;
  radius: typeof RADIUS;
  space: (n: number) => number;
  canvas: typeof CANVAS;
};

/**
 * Derive a LIGHT editorial palette: a warm cream paper base with near-black ink
 * text + bold ink borders, and a vivid accent pair from the per-project
 * dominant. The base (paper/ink/borders) is fixed and high-contrast (readable in
 * any lighting); only `accent`/`signal` follow the dominant. Print accents
 * (`PRINT.*`) are available for multi-color semantic use.
 */
export function makeTheme(dominant: string = DEFAULT_DOMINANT): Theme {
  const hex = normalizeHex(dominant) ?? DEFAULT_DOMINANT;
  const [h, s] = hexToHsl(hex);

  // Accent: vivid, dark enough to carry paper-colored text on a solid chip and
  // to read against the cream base.
  const accent = hslToHex(h, clamp(Math.max(s, 70), 55, 95), 50);
  // Companion: a strong split-complement so compares/segments are distinct.
  const signal = hslToHex((h + 150) % 360, clamp(Math.max(s, 60), 55, 92), 47);

  return {
    id: "editorial-light",
    name: "Editorial Light",
    dominant: hex,
    colors: {
      bg: PRINT.paper, // warm cream
      bgElevated: "#EAE2CE", // a touch deeper cream
      panel: "#FCF9F1", // near-white card
      fg: PRINT.ink, // near-black ink
      muted: "#6E6757", // warm grey
      accent,
      signal,
      line: PRINT.ink, // bold ink borders
    },
    fonts: FONTS,
    radius: RADIUS,
    space: (n: number) => n * 8,
    canvas: CANVAS,
  };
}

/** Default theme (used by Studio / tests / any consumer with no project palette). */
export const theme: Theme = makeTheme(DEFAULT_DOMINANT);

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

/** Shared background gradient, derived from the active theme's accent/companion. */
export function sceneBackground(t: Theme = theme): string {
  return (
    `radial-gradient(circle at 50% 25%, ${withAlpha(t.colors.accent, 0.16)} 0%, ` +
    `${withAlpha(t.colors.signal, 0.08)} 35%, ${withAlpha(t.colors.accent, 0.04)} 60%, ` +
    `${withAlpha(t.colors.bg, 0)} 80%), ` +
    t.colors.bg
  );
}

export const designNotes = `## Light editorial design system

Light-print video system: a warm CREAM paper base (#F2ECDC) with near-black ink
text + bold squared ink borders, vivid print accents, mono labels, and
registration ticks — readable in dark / bright / glare. Squared geometry (no
rounded corners); each content block is a clearly delineated, framed unit.

The base (paper/ink/borders) is fixed; only the ACCENT pair is derived from the
per-project dominant color (highlights + data-viz), plus a fixed multi-color
PRINT set for semantic use. Architectural spacing, large heavy display type.

Motion: deterministic, fps-aware — settling entrances, a subtle 3D "living card"
tilt, AI-chosen whole-scene zoom on key beats. Captions: single-line burned-in
KARAOKE (spoken word eased in scale + color), no background box. Avoid: dark
bg, rounded corners, low-contrast text, perpetual/looping motion. See
docs/design-language.md for the full philosophy.
`;
