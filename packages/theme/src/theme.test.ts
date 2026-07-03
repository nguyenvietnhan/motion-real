import { describe, expect, it, vi } from "vitest";
import { makeTheme, DEFAULT_DOMINANT, PRINT, NEUTRAL_THEME_ID } from "./index.js";

/**
 * @motionreal/theme self-tests — the single neutral theme + the proven 2-layer
 * cross-model defense ported from the deleted design system. A token name an
 * AI-authored scene reaches for must never break a render: Layer 1 declares the
 * cross-model alias vocabulary as real keys; Layer 2 (Proxy) catches anything
 * unforeseen. The neutral theme is dark (near-black base, near-white ink) with
 * medium (never-zero) corners.
 */

describe("neutral theme — shape + polarity", () => {
  const t = makeTheme(DEFAULT_DOMINANT);

  it("is the single neutral theme, dark, with render-safe fonts", () => {
    expect(t.id).toBe(NEUTRAL_THEME_ID);
    expect(t.dark).toBe(true);
    expect(t.fonts.display).toBe("Inter");
    expect(t.fonts.mono).toBe("Cascadia Mono");
  });

  it("medium corners — never square, never undefined", () => {
    expect(t.radius.sm).toBeGreaterThan(0);
    expect(t.radius.md).toBeGreaterThan(t.radius.sm);
    expect(t.radius.lg).toBeGreaterThan(t.radius.md);
  });

  it("the accent follows the dominant hue (palette is a function of it)", () => {
    const blue = makeTheme("#2F5FF0").colors.accent;
    const red = makeTheme("#E8412E").colors.accent;
    expect(blue).not.toBe(red);
  });
});

describe("ThemeColors — Layer 1 cross-model aliases", () => {
  const c = makeTheme(DEFAULT_DOMINANT).colors;

  it("maps ink/paper/foreground/text/background to the canonical fg/bg", () => {
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

  it("exposes the semantic accents (red/blue/yellow/green/violet)", () => {
    expect(c.red).toBe(PRINT.red);
    expect(c.blue).toBe(PRINT.blue);
    expect(c.yellow).toBe(PRINT.yellow);
    expect(c.green).toBe(PRINT.green);
    expect(c.violet).toBe(PRINT.violet);
  });

  it("every declared token is a non-empty string (no undefined holes)", () => {
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
      expect(c["highlightMuted"]).toBe(c.fg);
      expect(c["highlightMuted"]).not.toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it("warns at most once per unknown key", () => {
    const c = makeTheme(DEFAULT_DOMINANT).colors as unknown as Record<string, string>;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const key = `unseenToken_${Date.now()}`;
      void c[key];
      void c[key];
      void c[key];
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("JS/serialization probes (then, toJSON) pass through untouched", () => {
    const c = makeTheme(DEFAULT_DOMINANT).colors as unknown as Record<string, unknown>;
    expect(c["then"]).toBeUndefined();
    expect(c["toJSON"]).toBeUndefined();
  });
});

describe("ThemeRadius — Layer 1 aliases + Layer 2 fallback", () => {
  const r = makeTheme(DEFAULT_DOMINANT).radius;

  it("maps the sm/md/lg-group aliases to their canonical radius", () => {
    expect(r.none).toBe(r.sm);
    expect(r.square).toBe(r.sm);
    expect(r.card).toBe(r.md);
    expect(r.regular).toBe(r.md);
    expect(r.large).toBe(r.lg);
    expect(r.full).toBe(r.lg);
    expect(r.pill).toBe(r.lg);
  });

  it("every declared radius key is a number (no undefined holes)", () => {
    for (const key of Object.keys(r) as (keyof typeof r)[]) {
      expect(typeof r[key]).toBe("number");
    }
  });

  it("an unforeseen radius token resolves to md instead of undefined", () => {
    const rr = makeTheme(DEFAULT_DOMINANT).radius as unknown as Record<string, number>;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(rr["someFutureKey"]).toBe(rr.md);
      expect(rr["someFutureKey"]).not.toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("Theme — flat color reads forward into colors", () => {
  const t = makeTheme(DEFAULT_DOMINANT);
  const flat = t as unknown as Record<string, string>;

  it("a flat canonical/alias token reads through to colors", () => {
    expect(flat["accent"]).toBe(t.colors.accent);
    expect(flat["text"]).toBe(t.colors.fg);
  });

  it("real structured fields are NOT shadowed by the color forwarder", () => {
    expect(typeof t.space).toBe("function");
    expect(t.colors).toBeTruthy();
    expect(t.surface).toBeTruthy();
    expect(t.id).toBe(NEUTRAL_THEME_ID);
  });
});
