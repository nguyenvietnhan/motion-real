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

import {
  getStylePack,
  listStylePackIds,
  DEFAULT_STYLE_PACK_ID,
  type ChromeLevel,
  type StylePack,
} from "./style-packs.js";

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
  // --- Canonical tokens (the 8 the system is built on) ---
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

  // --- Cross-model alias tokens (Layer 1) ---
  // AI-authored scenes reach for industry-standard token names (Tailwind /
  // Material / common design systems) regardless of which 9router model wrote
  // them — `ink`, `paper`, `primary`, `border`, … These are declared as REAL
  // keys mapped to the right canonical color in makeTheme, so an authored scene
  // using a standard name BOTH typechecks (N10 passes) AND renders the correct
  // color, instead of resolving to `undefined` (silent color loss). This list is
  // strict on purpose — a typo in OUR code is still caught — while any unforeseen
  // key is caught at runtime by the Proxy fallback (Layer 2; see makeTheme).
  /** → fg (near-black ink). */
  ink: string;
  /** → bg (cream paper). */
  paper: string;
  /** → accent. */
  primary: string;
  /** → signal. */
  danger: string;
  /** → signal. */
  signalRed: string;
  /** → fg. */
  foreground: string;
  /** → fg. */
  text: string;
  /** → bg. */
  background: string;
  /** → line. */
  border: string;
  /** → panel. */
  surface: string;
  /** → panel. */
  card: string;
  /** → accent. */
  accentLight: string;
  /** → muted (secondary/subdued text). */
  textSecondary: string;
  /** → muted. */
  secondaryText: string;
  /** → muted. */
  subtle: string;

  // --- PRINT accent set as real keys (semantic multi-color) ---
  red: string;
  blue: string;
  yellow: string;
  green: string;
  violet: string;
};

/**
 * The theme object. Besides the structured fields below, EVERY color token from
 * `ThemeColors` is ALSO readable directly off the theme (`theme.accent` as well
 * as `theme.colors.accent`). Models routinely write the flat form regardless of
 * which one the contract shows, so we accept both: the flat reads are declared
 * here via the `ThemeColors` intersection (typecheck passes) and resolved at
 * runtime by the same Proxy that backs `colors` (correct color, never
 * `undefined`). `colors` remains the canonical home; the flat tokens are a
 * cross-model convenience, not a second source of truth.
 */
export type Theme = ThemeColors & {
  id: string;
  name: string;
  /** The dominant hex this palette was derived from. */
  dominant: string;
  /** The resolved style-pack id (tool-productization R1). */
  stylePackId: string;
  /** Pack-driven chrome tokens; blocks read these instead of hard-coding chrome. */
  chrome: ChromeLevel;
  colors: ThemeColors;
  fonts: { display: string; body: string; mono: string };
  radius: typeof RADIUS;
  space: (n: number) => number;
  canvas: typeof CANVAS;
};

/**
 * Derive a LIGHT editorial palette for a given dominant hue and style pack. The
 * base (paper/ink/borders philosophy) is fixed and high-contrast; only
 * `accent`/`signal` follow the dominant, and the selected style pack supplies
 * the `chrome` tokens + `fonts`. Pure + deterministic — same
 * `(dominant, stylePackId)` ⇒ identical tokens (R1.8). No `stylePackId` ⇒ the
 * default `bold-editorial` pack (R1.5); an UNREGISTERED id throws (callers
 * surface a friendly hard error before render — R1.6).
 */
export function makeTheme(dominant: string = DEFAULT_DOMINANT, stylePackId?: string): Theme {
  const hex = normalizeHex(dominant) ?? DEFAULT_DOMINANT;
  const [h, s] = hexToHsl(hex);
  const pack = resolveStylePack(stylePackId);

  // Accent: vivid, dark enough to carry paper-colored text on a solid chip and
  // to read against the cream base.
  const accent = hslToHex(h, clamp(Math.max(s, 70), 55, 95), 50);
  // Companion: a strong split-complement so compares/segments are distinct.
  const signal = hslToHex((h + 150) % 360, clamp(Math.max(s, 60), 55, 92), 47);

  // The 8 canonical tokens.
  const bg = PRINT.paper; // warm cream
  const panel = "#FCF9F1"; // near-white card
  const fg = PRINT.ink; // near-black ink
  const line = PRINT.ink; // bold ink borders
  const muted = "#6E6757"; // warm grey

  const colors: ThemeColors = {
    bg,
    bgElevated: "#EAE2CE", // a touch deeper cream
    panel,
    fg,
    muted,
    accent,
    signal,
    line,

    // Layer 1 — cross-model alias tokens mapped to the right canonical color, so
    // a scene using a standard name renders correctly (not `undefined`).
    ink: fg,
    paper: bg,
    primary: accent,
    danger: signal,
    signalRed: signal,
    foreground: fg,
    text: fg,
    textSecondary: muted,
    secondaryText: muted,
    subtle: muted,
    background: bg,
    border: line,
    surface: panel,
    card: panel,
    accentLight: accent,

    // PRINT semantic accents (fixed, deterministic).
    red: PRINT.red,
    blue: PRINT.blue,
    yellow: PRINT.yellow,
    green: PRINT.green,
    violet: PRINT.violet,
  };

  const wrappedColors = wrapColors(colors);
  const base = {
    id: "editorial-light",
    name: "Editorial Light",
    dominant: hex,
    stylePackId: pack.id,
    chrome: pack.chrome,
    colors: wrappedColors,
    fonts: { ...pack.chrome.fontFamily },
    radius: RADIUS,
    space: (n: number) => n * 8,
    canvas: CANVAS,
  };
  return wrapTheme(base, wrappedColors);
}

/**
 * Layer 2 — runtime safety net for color tokens. Authored scenes are written by
 * whichever 9router model the user picked, so they WILL occasionally reach for a
 * token name we haven't aliased (`accentMuted`, `highlight`, …). Without this, a
 * `theme.colors.<unknown>` read returns `undefined`, the style is silently
 * dropped, and the scene renders mis-colored. The Proxy makes any unknown string
 * key resolve to a safe, on-brand color (`fg`) instead — the render NEVER breaks
 * on a color name — and logs the miss ONCE per key so we can add a precise alias
 * to Layer 1 later (self-healing now, self-improving over time).
 *
 * Declared keys pass straight through. Symbols and a small denylist of
 * JS/React/serialization probes (`then`, `toJSON`, …) return undefined so the
 * object still behaves like a normal object across Promise/JSON/React-devtools
 * boundaries — only genuine string color reads get the fallback.
 */
const COLOR_PROBE_KEYS = new Set<string>([
  "then",
  "toJSON",
  "toString",
  "valueOf",
  "constructor",
  "$$typeof",
  "@@iterator",
  "asymmetricMatch",
  "nodeType",
  "hasOwnProperty",
]);
const loggedUnknownColors = new Set<string>();

function wrapColors(colors: ThemeColors): ThemeColors {
  return new Proxy(colors, {
    get(target, key, receiver) {
      if (typeof key !== "string" || key in target || COLOR_PROBE_KEYS.has(key)) {
        return Reflect.get(target, key, receiver);
      }
      if (!loggedUnknownColors.has(key)) {
        loggedUnknownColors.add(key);
        // eslint-disable-next-line no-console
        console.warn(
          `[theme] authored scene read unknown color token "colors.${key}" — falling back to colors.fg. ` +
            `Add an alias in @news/design ThemeColors if this token is common.`,
        );
      }
      return target.fg;
    },
  });
}

const loggedFlatColorReads = new Set<string>();

/**
 * Wrap the theme object so a FLAT color read (`theme.accent`, `theme.text`, …)
 * resolves through the already-wrapped `colors` Proxy. Models frequently treat
 * the theme itself as the color bag and skip `.colors`, regardless of which form
 * the contract shows. Rather than let `theme.accent` be `undefined` (silent
 * color loss) or hard-block the render, we forward any string key that is NOT a
 * real structured field (id/name/colors/fonts/…) into `colors` — which supplies
 * the canonical value, an alias, or the safe `fg` fallback. `colors` stays the
 * single source of truth; this is a read-through convenience, not a second copy.
 */
function wrapTheme(base: Omit<Theme, keyof ThemeColors>, colors: ThemeColors): Theme {
  return new Proxy(base as Theme, {
    get(target, key, receiver) {
      // A real structured field (or any non-string/probe key) wins outright.
      if (typeof key !== "string" || key in target || COLOR_PROBE_KEYS.has(key)) {
        return Reflect.get(target, key, receiver);
      }
      // Otherwise treat it as a flat color token and resolve via `colors`
      // (which itself aliases + falls back). Log once so a common flat token can
      // be promoted to a real alias later.
      if (!loggedFlatColorReads.has(key)) {
        loggedFlatColorReads.add(key);
        // eslint-disable-next-line no-console
        console.warn(
          `[theme] authored scene read color token "theme.${key}" directly off the theme — ` +
            `resolving via theme.colors.${key}. Prefer theme.colors.* in authored scenes.`,
        );
      }
      return (colors as unknown as Record<string, string>)[key];
    },
  });
}

/**
 * Resolve a style pack: no id ⇒ the default pack; a registered id ⇒ that pack;
 * an UNREGISTERED id throws (never silently defaults), so a typo can't quietly
 * ship the wrong look. The spec-build / static grid catches this earlier with a
 * friendlier `PipelineError`; this throw is the safety net at render time.
 */
function resolveStylePack(stylePackId?: string): StylePack {
  if (stylePackId === undefined) return getStylePack(DEFAULT_STYLE_PACK_ID)!;
  const pack = getStylePack(stylePackId);
  if (!pack) {
    throw new Error(`Unknown stylePackId "${stylePackId}". Registered packs: ${listStylePackIds().join(", ")}.`);
  }
  return pack;
}

/** Default theme (used by Studio / tests / any consumer with no project palette). */
export const theme: Theme = makeTheme(DEFAULT_DOMINANT);

export * from "./style-packs.js";

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
