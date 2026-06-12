/**
 * Design-language registry + theme assembly.
 *
 * A "style pack" (the user-facing term; `stylePackId` in the spec/lock) is a
 * self-contained DESIGN LANGUAGE — see `StyleLanguage` in `core.ts`. Each lives
 * in its own file under `languages/` and knows how to derive its full palette,
 * surface grammar, backdrop, fonts, picker thumbnail, and AI authoring contract
 * from a single dominant hue. This module just holds the registry and folds the
 * resolved language into the `Theme` blocks consume.
 *
 * Adding a look = one new file in `languages/` + one line in `BUNDLED` below (or
 * a `registerStylePack(...)` call). No edits to blocks, the contract, or other
 * languages — that's the Open/Closed win over the old "chrome level" model,
 * where a new look meant editing hard-coded block chrome.
 *
 * Pure + deterministic (no Math.random / Date / IO): same `(dominant,
 * stylePackId)` ⇒ identical tokens.
 */

import {
  CANVAS,
  DEFAULT_DOMINANT,
  normalizeHex,
  type CoreColors,
  type StyleLanguage,
  type Theme,
  type ThemeColors,
} from "./core.js";
import { editorialLanguage } from "./languages/editorial.js";
import { galaxyLanguage } from "./languages/galaxy.js";

/**
 * Back-compat view of a registered language as a "style pack". A handful of
 * consumers (the create-screen picker VM, the doctor font check) and the test
 * suite read `pack.preview` / `pack.fonts` off the registry; this is just the
 * `StyleLanguage` itself, aliased so those call sites read naturally.
 */
export type StylePack = StyleLanguage;

/** Re-export the language token types so consumers import them from one place. */
export type { StyleLanguage, StylePreview } from "./core.js";

/** The bundled design languages. Adding one is a single entry here. */
const BUNDLED: readonly StyleLanguage[] = [editorialLanguage, galaxyLanguage];

const LANGUAGES: Record<string, StyleLanguage> = {};
for (const lang of BUNDLED) LANGUAGES[lang.id] = lang;

/** The id `makeTheme` falls back to when a spec carries no `stylePackId`. */
export const DEFAULT_STYLE_PACK_ID: string =
  BUNDLED.find((l) => l.isDefault)?.id ?? BUNDLED[0]!.id;

/** Resolve a language by id. Returns undefined for an unknown id (callers decide). */
export function getStylePack(id?: string): StyleLanguage | undefined {
  const key = id ?? DEFAULT_STYLE_PACK_ID;
  // Own-key check only: a plain-object index would resolve inherited members
  // ("constructor", "toString", "__proto__"), so guard against that.
  return Object.hasOwn(LANGUAGES, key) ? LANGUAGES[key] : undefined;
}

/** All registered language ids (for error messages + the doctor check). */
export function listStylePackIds(): string[] {
  return Object.keys(LANGUAGES);
}

/**
 * Register (or override) a design language. The extensibility seam (R1.4):
 * adding a look needs only this call — no edits to existing languages or blocks.
 */
export function registerStylePack(lang: StyleLanguage): void {
  LANGUAGES[lang.id] = lang;
}

// --- Theme assembly -------------------------------------------------------

/**
 * Resolve a language: no id ⇒ the default; a registered id ⇒ that language; an
 * UNREGISTERED id throws (never silently defaults), so a typo can't quietly ship
 * the wrong look. The spec-build / static grid catches this earlier with a
 * friendlier `PipelineError`; this throw is the render-time safety net.
 */
function resolveLanguage(stylePackId?: string): StyleLanguage {
  if (stylePackId === undefined) return getStylePack(DEFAULT_STYLE_PACK_ID)!;
  const lang = getStylePack(stylePackId);
  if (!lang) {
    throw new Error(
      `Unknown stylePackId "${stylePackId}". Registered packs: ${listStylePackIds().join(", ")}.`,
    );
  }
  return lang;
}

/**
 * Build the full cross-model `ThemeColors` from a language's `CoreColors`: the
 * canonical 8 + semantic series pass through, and the industry-standard alias
 * names (Layer 1) map onto the right canonical color so an authored scene using
 * a standard token both typechecks and renders correctly.
 */
function buildThemeColors(c: CoreColors): ThemeColors {
  return {
    ...c,
    // Layer 1 — cross-model aliases mapped to the right canonical color.
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

/**
 * Derive a theme for a dominant hue + design language. The language owns ALL
 * visual decisions (palette polarity, surface grammar, radius, backdrop, fonts);
 * this just folds them into the `Theme` shape blocks consume and wraps the color
 * bags in the cross-model resolution Proxies.
 *
 * No `stylePackId` ⇒ the default language (existing projects unchanged); an
 * UNREGISTERED id throws (callers surface a friendly hard error before render).
 */
export function makeTheme(dominant: string = DEFAULT_DOMINANT, stylePackId?: string): Theme {
  const hex = normalizeHex(dominant) ?? DEFAULT_DOMINANT;
  const lang = resolveLanguage(stylePackId);
  const derived = lang.derive(hex);
  const colors = buildThemeColors(derived.colors);
  const wrappedColors = wrapColors(colors);

  const base = {
    id: lang.id,
    name: lang.name,
    dominant: hex,
    stylePackId: lang.id,
    dark: isDark(derived.colors.bg),
    colors: wrappedColors,
    fonts: { ...lang.fonts },
    radius: derived.radius,
    surface: derived.surface,
    backdrop: derived.backdrop,
    // Always set the key (even when undefined) so it counts as a real structured
    // field — otherwise the theme Proxy below would treat `theme.captionScrim` as
    // an unknown flat color read and return `fg` instead of undefined.
    captionScrim: derived.captionScrim,
    space: (n: number) => n * 8,
    canvas: CANVAS,
  };
  return wrapTheme(base, wrappedColors);
}

/** Luminance test for the `dark` flag (kept local; core has the math). */
function isDark(hex: string): boolean {
  const v = (normalizeHex(hex) ?? "#000000").slice(1);
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.4;
}

// --- Cross-model color resolution (Layers 1 + 2) --------------------------

/**
 * Layer 2 — runtime safety net for color tokens. Authored scenes are written by
 * whichever model the user picked, so they WILL occasionally reach for a token
 * name we haven't aliased. Without this, a `theme.colors.<unknown>` read returns
 * `undefined`, the style is silently dropped, and the scene renders mis-colored.
 * The Proxy makes any unknown string key resolve to a safe on-brand color (`fg`)
 * and logs the miss ONCE per key. Symbols + a denylist of JS/React/serialization
 * probes pass through so the object stays well-behaved across Promise/JSON/
 * devtools boundaries.
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
 * Wrap the theme so a FLAT color read (`theme.accent`, `theme.text`, …) resolves
 * through the already-wrapped `colors` Proxy. Models frequently treat the theme
 * itself as the color bag and skip `.colors`. A real structured field always
 * wins; any other string key forwards into `colors` (canonical value, alias, or
 * the safe `fg` fallback). `colors` stays the single source of truth.
 */
function wrapTheme(base: Omit<Theme, keyof ThemeColors>, colors: ThemeColors): Theme {
  return new Proxy(base as Theme, {
    get(target, key, receiver) {
      if (typeof key !== "string" || key in target || COLOR_PROBE_KEYS.has(key)) {
        return Reflect.get(target, key, receiver);
      }
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
