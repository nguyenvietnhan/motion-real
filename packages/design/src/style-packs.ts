/**
 * Selectable design STYLE PACKS (tool-productization R1).
 *
 * A style pack is a pure data record describing the "chrome level" — everything
 * decorative that varies between looks (border weight, shadow style, the faint
 * grid + registration ticks, how many semantic accents, whitespace/density, and
 * the font family). The FIXED grammar (squared geometry, the light cream base,
 * canvas, motion) stays in the design system; only chrome + font vary per pack,
 * and the per-project dominant hue still drives accents on top of any pack.
 *
 * `makeTheme(dominant, stylePackId)` resolves a pack and folds its `ChromeLevel`
 * into the `Theme` so blocks read chrome tokens instead of hard-coding the
 * bold-editorial look. Pure + deterministic (no Math.random / Date / IO).
 */

/** The decorative "chrome level" a style pack applies. */
export type ChromeLevel = {
  /** Border treatment for delineated blocks. */
  border: { width: number; style: "solid" | "hairline" | "none" };
  /** Shadow treatment for floating blocks. */
  shadow: "hard-offset" | "soft-diffuse" | "none";
  /** Decorative full-frame grid behind content. */
  grid: boolean;
  /** Corner registration ticks (editorial print detail). */
  registrationTicks: boolean;
  /** How many semantic accents the pack leans on (1 = single accent; 7 = full PRINT set). */
  accentCount: 1 | 3 | 7;
  /** Whitespace/density bias for content spacing. */
  density: "compact" | "editorial" | "airy";
  /** Font family stacks. Family names MUST match the render-safe loaded fonts. */
  fontFamily: { display: string; body: string; mono: string };
};

export type StylePack = {
  id: string;
  name: string;
  description: string;
  chrome: ChromeLevel;
};

// Font stacks. The leading family in each stack is the one the render-safe font
// loader (`@news/blocks` fonts.ts) registers with the vietnamese subset; the
// rest are dev/Studio fallbacks. Aptos isn't on Google Fonts, so bold-editorial
// is re-backed by Inter (a neutral humanist sans with full Vietnamese coverage).
const BOLD_EDITORIAL_FONTS = {
  display: '"Inter", "Aptos Display", "Segoe UI", sans-serif',
  body: '"Inter", "Aptos", "Segoe UI", sans-serif',
  mono: '"Cascadia Mono", "Consolas", monospace',
} as const;

// Be Vietnam Pro is purpose-built for Vietnamese (complete, consistent
// diacritics), so the clean look never falls back mid-word ("nét to nét nhỏ").
const CLEAN_PREMIUM_FONTS = {
  display: '"Be Vietnam Pro", "Inter", "Segoe UI", sans-serif',
  body: '"Be Vietnam Pro", "Inter", "Segoe UI", sans-serif',
  mono: '"Cascadia Mono", "Consolas", monospace',
} as const;

export const DEFAULT_STYLE_PACK_ID = "bold-editorial";

/** The bundled style packs. Adding a pack is one entry here (or `registerStylePack`). */
export const STYLE_PACKS: Record<string, StylePack> = {
  "bold-editorial": {
    id: "bold-editorial",
    name: "Bold Editorial",
    description:
      "The signature risograph/print look: bold ink borders, hard offset shadows, a faint grid + corner registration ticks, and the full multi-color PRINT accent set on a warm cream base.",
    chrome: {
      border: { width: 4, style: "solid" },
      shadow: "hard-offset",
      grid: true,
      registrationTicks: true,
      accentCount: 7,
      density: "editorial",
      fontFamily: { ...BOLD_EDITORIAL_FONTS },
    },
  },
  "clean-premium": {
    id: "clean-premium",
    name: "Clean Premium",
    description:
      "A restrained, premium look: hairline borders, soft diffuse shadows, no grid or registration ticks, a single accent, generous whitespace, and a clean Vietnamese-complete sans (Be Vietnam Pro).",
    chrome: {
      border: { width: 1, style: "hairline" },
      shadow: "soft-diffuse",
      grid: false,
      registrationTicks: false,
      accentCount: 1,
      density: "airy",
      fontFamily: { ...CLEAN_PREMIUM_FONTS },
    },
  },
};

/** Resolve a pack by id. Returns undefined for an unknown id (callers decide). */
export function getStylePack(id?: string): StylePack | undefined {
  const key = id ?? DEFAULT_STYLE_PACK_ID;
  // Own-key check only: a plain-object index would resolve inherited members
  // ("constructor", "toString", "__proto__"), so guard against that.
  return Object.hasOwn(STYLE_PACKS, key) ? STYLE_PACKS[key] : undefined;
}

/** All registered style-pack ids (for error messages + the doctor check). */
export function listStylePackIds(): string[] {
  return Object.keys(STYLE_PACKS);
}

/**
 * Register (or override) a style pack. The extensibility seam (R1.4): adding a
 * look needs only this call — no edits to existing packs or block components.
 */
export function registerStylePack(pack: StylePack): void {
  STYLE_PACKS[pack.id] = pack;
}
