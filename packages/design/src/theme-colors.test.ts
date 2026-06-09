import { describe, expect, it, vi } from "vitest";
import { makeTheme, PRINT, DEFAULT_DOMINANT } from "./index.js";

/**
 * Cross-model color-token resolution (Layer 1 aliases + Layer 2 Proxy fallback).
 *
 * Authored scenes are written by whichever 9router model the user picks, and
 * models reach for industry-standard token names (`ink`, `paper`, `primary`,
 * `border`, …) that differ from this system's canonical 8 (`fg`/`bg`/`accent`/…).
 * Layer 1 declares those standard names as REAL keys mapped to the right color,
 * so a scene using them both typechecks (N10) and renders correctly. Layer 2 is
 * the runtime net: any UNFORESEEN token resolves to a safe on-brand color
 * instead of `undefined`, so a color name can never break a render.
 */

describe("ThemeColors — Layer 1 cross-model aliases", () => {
  const t = makeTheme(DEFAULT_DOMINANT);
  const c = t.colors;

  it("maps standard ink/paper/foreground/text to the canonical fg/bg", () => {
    expect(c.ink).toBe(c.fg);
    expect(c.foreground).toBe(c.fg);
    expect(c.text).toBe(c.fg);
    expect(c.paper).toBe(c.bg);
    expect(c.background).toBe(c.bg);
  });

  it("maps primary→accent, danger/signalRed→signal, border→line, surface/card→panel", () => {
    expect(c.primary).toBe(c.accent);
    expect(c.accentLight).toBe(c.accent);
    expect(c.danger).toBe(c.signal);
    expect(c.signalRed).toBe(c.signal);
    expect(c.border).toBe(c.line);
    expect(c.surface).toBe(c.panel);
    expect(c.card).toBe(c.panel);
  });

  it("exposes the PRINT semantic accents as real keys", () => {
    expect(c.red).toBe(PRINT.red);
    expect(c.blue).toBe(PRINT.blue);
    expect(c.yellow).toBe(PRINT.yellow);
    expect(c.green).toBe(PRINT.green);
    expect(c.violet).toBe(PRINT.violet);
  });

  it("every declared token is a non-empty hex-ish string (no undefined holes)", () => {
    for (const key of Object.keys(c) as (keyof typeof c)[]) {
      expect(typeof c[key]).toBe("string");
      expect((c[key] as string).length).toBeGreaterThan(0);
    }
  });
});

describe("ThemeColors — Layer 2 runtime fallback", () => {
  it("an unforeseen color token resolves to fg instead of undefined", () => {
    const c = makeTheme(DEFAULT_DOMINANT).colors as unknown as Record<string, string>;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // A token we deliberately did NOT alias (mirrors a future model's habit).
      expect(c["highlightMuted"]).toBe(c.fg);
      expect(c["highlightMuted"]).not.toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it("warns at most once per unknown key (no per-frame log spam)", () => {
    const c = makeTheme(DEFAULT_DOMINANT).colors as unknown as Record<string, string>;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Unique key so the module-level dedupe set hasn't seen it before.
      const key = `unseenToken_${Date.now()}`;
      void c[key];
      void c[key];
      void c[key];
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("JS/serialization probes (then, toJSON) are NOT colorized — object stays well-behaved", () => {
    const c = makeTheme(DEFAULT_DOMINANT).colors as unknown as Record<string, unknown>;
    // `then` must be undefined so the object is not mistaken for a thenable.
    expect(c["then"]).toBeUndefined();
    expect(c["toJSON"]).toBeUndefined();
  });
});

describe("Theme — flat color reads (theme.accent, theme.text, …)", () => {
  // Models frequently treat the theme itself as the color bag and skip `.colors`
  // (`theme.accent` instead of `theme.colors.accent`), regardless of which form
  // the contract shows. The theme Proxy forwards those reads into `colors` so
  // they resolve to the right color instead of `undefined` (silent color loss).
  const t = makeTheme(DEFAULT_DOMINANT);
  const flat = t as unknown as Record<string, string>;

  it("a flat canonical token reads through to colors (theme.accent === colors.accent)", () => {
    expect(flat["accent"]).toBe(t.colors.accent);
    expect(flat["bg"]).toBe(t.colors.bg);
    expect(flat["signal"]).toBe(t.colors.signal);
  });

  it("a flat alias token resolves the same as via colors (theme.text === colors.fg)", () => {
    expect(flat["text"]).toBe(t.colors.fg);
    expect(flat["textSecondary"]).toBe(t.colors.muted);
  });

  it("an unforeseen flat token falls back to fg, never undefined", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(flat["highlightFlat"]).toBe(t.colors.fg);
      expect(flat["highlightFlat"]).not.toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it("real structured fields are NOT shadowed by the color forwarder", () => {
    // `colors`, `fonts`, `chrome`, `space` must keep their real values — the
    // forwarder only handles keys that are NOT real fields.
    expect(typeof t.space).toBe("function");
    expect(t.colors).toBeTruthy();
    expect(t.fonts.display).toBeTruthy();
    expect(t.chrome).toBeTruthy();
    expect(t.id).toBe("editorial-light");
  });

  it("the theme stays a well-behaved object (then/toJSON not colorized)", () => {
    expect(flat["then"]).toBeUndefined();
    expect(flat["toJSON"]).toBeUndefined();
  });
});
