/**
 * @news/design core — the LEAF layer: pure color math, the token-model types
 * every design language fills in, and the fixed constants (canvas, easing,
 * springs, curated dominants).
 *
 * This module imports nothing from its siblings, so the dependency graph is a
 * clean line with no cycles:
 *
 *     core.ts  ←  languages/*.ts  ←  style-packs.ts  ←  index.ts
 *
 * The big idea (the thing that makes the system SOLID): a "style" is no longer a
 * thin chrome layer bolted onto one frozen look. A style is a **design
 * language** — a self-contained module that knows how to derive its OWN full
 * palette + surface grammar + backdrop from a single dominant hue, and carries
 * its OWN slice of the AI authoring contract. Blocks read every visual decision
 * from the resolved `Theme` (never hard-code a color, a radius, or a border), so
 * ONE set of blocks renders EVERY language. Adding a language is one new file +
 * one registry line — no edits to blocks, contract, or existing languages
 * (Open/Closed).
 *
 * What stays invariant across ALL languages (the "physics", not the "look"):
 * layout zones, the caption band, the content/caption divider, determinism, and
 * the minimum type sizes. Those live in `@news/schema` + the BASE contract, and
 * no language may move them. Everything else — base polarity, corner geometry,
 * fonts, how a block draws its border/fill/shadow, the semantic color series,
 * the frame backdrop — is the language's to decide.
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
 * provided "ends" (a near-black ink and a near-white paper) by luminance, so it
 * works on BOTH light and dark languages (each passes its own ink/paper).
 */
export function readableOn(fillHex: string, dark: string, light: string): string {
  return luminance(fillHex) > 0.62 ? dark : light;
}

// --- Fixed constants ------------------------------------------------------

/** The 9:16 canvas every video renders at. Invariant across languages. */
export const CANVAS = { width: 1080, height: 1920 } as const;

/** Fallback dominant when a spec carries no palette (a punchy editorial blue). */
export const DEFAULT_DOMINANT = "#2F5FF0";

/**
 * Fixed "print" accents — the editorial language's semantic multi-color set
 * (compare sides, chart series, danger). Kept here (not inside the editorial
 * language) because `onColor` + a few back-compat consumers reference the ink /
 * paper base, and it is the historical public export of this package.
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

/** Pick ink or paper text so it reads on a given solid fill (editorial base). */
export function onColor(hex: string): string {
  return readableOn(hex, PRINT.ink, PRINT.paper);
}

/**
 * A curated set of dominant colors that read well across languages. The
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

// --- Token model: what a design language produces -------------------------

/** Corner radius scale (px). Read by blocks instead of hard-coding 0. */
export type RadiusScale = {
  /** Small elements: chips, tags, number tiles. */
  sm: number;
  /** Standard blocks: panels, cards, stat boxes. */
  md: number;
  /** Large elements: the frame, hero title card. */
  lg: number;
};

/**
 * How a block draws itself — the surface grammar. Blocks read THESE instead of
 * hard-coding `4px solid #17150F` / `border-radius: 0` / a fixed shadow. The
 * blocks' chrome-kit (`@news/blocks/chrome`) turns these data tokens into CSS
 * (e.g. maps `shadowStyle` + an accent color into a `box-shadow` string), so the
 * language stays pure data and the React/CSS concerns stay in blocks.
 */
export type SurfaceTokens = {
  /** Block border width in px. 0 ⇒ borderless (the language leans on fill/shadow). */
  borderWidth: number;
  /** Block border color (already resolved to a concrete value). */
  borderColor: string;
  /** Standard block surface fill (opaque or translucent). */
  panelFill: string;
  /** A nested/elevated surface fill (e.g. a number tile inside a panel). */
  panelFillElevated: string;
  /**
   * Shadow model for a floating block. The chrome-kit maps this + an accent
   * color to a concrete `box-shadow`:
   *  - "hard-offset" → editorial print drop (`Npx Npx 0 accent`)
   *  - "glow"        → galaxy neon glow + soft depth
   *  - "soft"        → gentle diffuse shadow
   *  - "none"        → no shadow
   */
  shadowStyle: "hard-offset" | "glow" | "soft" | "none";
  /**
   * Does a block lead with a SOLID accent top-rule bar (the editorial print
   * detail)? Languages that express accent another way (galaxy = glow + tint)
   * set this false.
   */
  topRule: boolean;
  /** Top-rule bar height in px (when `topRule`). */
  topRuleHeight: number;
  /**
   * Eyebrow / label chip style: a solid accent fill (editorial) vs an outlined
   * translucent chip (galaxy). Drives `Tag`, eyebrows, number tiles.
   */
  chipStyle: "solid" | "outline";
  /** Letter-spacing for mono labels/eyebrows (em). Languages may run tighter/looser. */
  labelTracking: string;
  /** Uppercase mono labels (editorial print) or keep natural case (softer looks)? */
  labelUppercase: boolean;
};

/** The full-frame backdrop a language paints behind content (the `Frame`). */
export type BackdropTokens = {
  /** Base background paint: "flat" solid bg, or a deep "radial" wash. */
  fill: "flat" | "radial";
  /** Faint full-frame grid behind content (editorial print). */
  grid: boolean;
  /** Corner registration ticks (editorial print). */
  registrationTicks: boolean;
  /** Decorative deterministic starfield (galaxy). */
  starfield: boolean;
  /** Does the frame draw an outer border? */
  frameBorder: boolean;
};

/**
 * Optional translucent plate behind the burned-in caption. CHROME (the
 * "outfit"), not layout: a language whose look sits over busy/dark video uses a
 * faint scrim so the caption text stays legible. Omitted ⇒ caption drawn
 * directly on the base.
 */
export type CaptionScrim = {
  /** Plate opacity (0–1) behind the caption text. */
  opacity: number;
  /** Backdrop blur radius in px (0 ⇒ no blur). */
  blur: number;
  /** Corner radius in px. */
  radius: number;
  /** Plate fill base ("light" paper scrim vs "dark" ink scrim) — matches polarity. */
  tone: "light" | "dark";
};

/** The canonical color palette a language derives from a dominant hue. */
export type CoreColors = {
  /** Page background base. */
  bg: string;
  /** A shifted base for elevated/recessed areas. */
  bgElevated: string;
  /** Standard panel/card surface. */
  panel: string;
  /** Primary text/ink. */
  fg: string;
  /** Muted/secondary text + labels. */
  muted: string;
  /** Primary project color (from the dominant). */
  accent: string;
  /** Companion (split-complement) for compares/segments. */
  signal: string;
  /** Border/line color. */
  line: string;
  // Semantic multi-color series (language-tuned — editorial=PRINT, galaxy=neon).
  red: string;
  blue: string;
  yellow: string;
  green: string;
  violet: string;
};

/** Preview hints the create-screen picker uses to draw a CSS thumbnail. */
export type StylePreview = {
  /** Dark base (vs light) — thumbnail paints a dark canvas. */
  dark: boolean;
  /** Rounded corners (vs squared) — thumbnail rounds its blocks. */
  rounded: boolean;
  /** Starfield backdrop — thumbnail sprinkles faint stars. */
  starfield: boolean;
  /** Faint grid behind content. */
  grid: boolean;
  /** Corner registration ticks. */
  registrationTicks: boolean;
  /** Block border weight in px (0 ⇒ frameless). */
  borderWidth: number;
  /** Whitespace/density bias — how "busy" the sketch reads. */
  density: "compact" | "editorial" | "airy";
};

/** What `StyleLanguage.derive` returns: a language's full resolved grammar for one dominant. */
export type DerivedLanguage = {
  colors: CoreColors;
  surface: SurfaceTokens;
  radius: RadiusScale;
  backdrop: BackdropTokens;
  captionScrim?: CaptionScrim;
};

/**
 * A self-contained DESIGN LANGUAGE. This is the extensibility seam: implement
 * this interface in one file under `languages/`, register it, and a brand-new
 * coherent look exists end-to-end — palette, surfaces, backdrop, fonts, the
 * picker thumbnail, AND the AI authoring instructions — with ZERO edits to
 * blocks or other languages.
 */
export type StyleLanguage = {
  /** Stable id stored in the spec/lock (`theme.stylePackId`). */
  id: string;
  /** Human name shown in the picker. */
  name: string;
  /** One-line description (picker + doctor). */
  description: string;
  /** True for the language `makeTheme` falls back to when no id is given. */
  isDefault?: boolean;
  /**
   * Font stacks. The LEADING family MUST be one the render-safe loader vendors
   * with the Vietnamese subset (`@news/blocks/fonts`) — today: Inter,
   * "Be Vietnam Pro", "Cascadia Mono" — so a diacritic never falls back.
   */
  fonts: { display: string; body: string; mono: string };
  /** Derive the full palette + surface grammar from a dominant hue. Pure. */
  derive: (dominant: string) => DerivedLanguage;
  /** Picker thumbnail hints. */
  preview: StylePreview;
  /**
   * This language's slice of the AI authoring contract (Vietnamese) — the visual
   * grammar the model must follow when writing `.tsx` for THIS look. The BASE
   * contract (invariant layout law) is shared; this is appended per chosen
   * language so the AI writes genuinely on-language code, not one frozen look.
   */
  contract: string;
};

// --- The resolved Theme (what blocks consume) -----------------------------

export type ThemeColors = CoreColors & {
  // Cross-model alias tokens (Layer 1): AI-authored scenes reach for
  // industry-standard names regardless of which model wrote them. Declared as
  // REAL keys mapped to the right canonical color in theme assembly, so an
  // authored scene using a standard name BOTH typechecks (N10) AND renders the
  // right color instead of `undefined`. Any UNFORESEEN key is caught at runtime
  // by the Proxy fallback (see style-packs `wrapColors`).
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
 * The resolved theme object blocks + authored scenes consume. Besides the
 * structured fields, EVERY color token is ALSO readable directly off the theme
 * (`theme.accent` as well as `theme.colors.accent`) via a Proxy — models write
 * both forms. `colors` stays the canonical home.
 */
export type Theme = ThemeColors & {
  id: string;
  name: string;
  /** Dominant hex this palette was derived from. */
  dominant: string;
  /** Resolved design-language id. */
  stylePackId: string;
  /** Whether this language uses a dark base (blocks/frame adjust ambient detail). */
  dark: boolean;
  colors: ThemeColors;
  fonts: { display: string; body: string; mono: string };
  radius: RadiusScale;
  /** Surface grammar — blocks read this for border/fill/shadow/chip decisions. */
  surface: SurfaceTokens;
  /** Frame backdrop grammar. */
  backdrop: BackdropTokens;
  /** Optional caption plate (chrome). */
  captionScrim?: CaptionScrim;
  space: (n: number) => number;
  canvas: typeof CANVAS;
};
