import { describe, expect, it } from "vitest";
import ts from "typescript";
import {
  normalizeAuthoredSource,
  normalizeSvgJsxAttributes,
  stripReactNativeStyleKeys,
} from "./normalize-authored-source.js";
// stripReactNativeStyleKeys used for layout expand tests; full normalize covers fonts.

function parseErrors(source: string): number {
  const sf = ts.createSourceFile("t.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diags =
    (sf as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diags.filter((d) => d.category === ts.DiagnosticCategory.Error).length;
}

/** Realistic authored-shaped snippet (object in const / JSX style prop). */
function asModule(objectBody: string): string {
  return `import React from "react";\nexport const C = () => <div style={{ ${objectBody} }} />;\n`;
}

describe("stripReactNativeStyleKeys", () => {
  it("removes shadowColor from a JSX style object (the N10 TS2353 case)", () => {
    const src = asModule(`shadowColor: ballColor, color: "#fff"`);
    const out = stripReactNativeStyleKeys(src);
    expect(out).not.toMatch(/\bshadowColor\b/);
    expect(out).toContain("color");
    expect(parseErrors(out)).toBe(0);
  });

  it("keeps valid CSS shadow props", () => {
    const src = asModule(`boxShadow: "0 0 8px #000", textShadow: "0 1px 2px #000"`);
    expect(stripReactNativeStyleKeys(src)).toBe(src);
  });

  it("strips shadowColor while keeping sibling textShadow", () => {
    const src = asModule(`
      textShadow: "0px 2px 8px rgba(0,0,0,0.8)",
      shadowColor: ballColor,
      fontFamily: "monospace"
    `);
    const out = stripReactNativeStyleKeys(src);
    expect(out).toContain("textShadow");
    expect(out).toContain("fontFamily");
    expect(out).not.toMatch(/\bshadowColor\b/);
    expect(parseErrors(out)).toBe(0);
  });

  it("strips the full RN shadow set including nested shadowOffset", () => {
    const src = asModule(
      `shadowColor: c, shadowOffset: {width:1,height:1}, shadowOpacity: 0.5, shadowRadius: 4, elevation: 2, color: "#fff"`,
    );
    const out = stripReactNativeStyleKeys(src);
    expect(out).not.toMatch(/shadowColor|shadowOffset|shadowOpacity|shadowRadius|elevation/);
    expect(out).toContain("color");
    // Must remain valid TSX — the old regex left `height:1}, }}`.
    expect(parseErrors(out)).toBe(0);
  });

  it("strips multiline nested shadowOffset without leaving orphan keys", () => {
    const src = asModule(`
  shadowOffset: {
    width: 1,
    height: 1,
  },
  color: "red"
`);
    const out = stripReactNativeStyleKeys(src);
    expect(out).not.toMatch(/\bshadowOffset\b/);
    expect(out).toContain("color");
    // width/height only lived inside shadowOffset — should be gone with the property.
    expect(out).not.toMatch(/\bwidth\b/);
    expect(parseErrors(out)).toBe(0);
  });

  it("does not mutate string literals that mention RN key names", () => {
    const src = `const msg = "shadowColor: red";\nexport const C = () => <div style={{ color: 1 }} />;\n`;
    expect(stripReactNativeStyleKeys(src)).toBe(src);
  });

  it("handles call-expression values without truncating siblings", () => {
    const src = asModule(`shadowColor: foo(a, b), color: 1`);
    const out = stripReactNativeStyleKeys(src);
    expect(out).not.toMatch(/\bshadowColor\b/);
    expect(out).toContain("color: 1");
    expect(out).not.toMatch(/\bfoo\b/);
    expect(parseErrors(out)).toBe(0);
  });

  it("is idempotent", () => {
    const src = asModule(`shadowColor: c, elevation: 2, color: 1`);
    const once = stripReactNativeStyleKeys(src);
    expect(stripReactNativeStyleKeys(once)).toBe(once);
    expect(parseErrors(once)).toBe(0);
  });

  it("does not strip RN keys on plain (non-style) object literals", () => {
    const src = `const o = { shadowColor: ballColor, color: 1 };\n`;
    const out = stripReactNativeStyleKeys(src);
    // Not a JSX/CSS style object — left alone (may be data or dead code).
    expect(out).toBe(src);
  });
});

describe("normalizeAuthoredSource", () => {
  it("is the pipeline entry for pre-write rewrites", () => {
    const out = normalizeAuthoredSource(asModule(`shadowColor: "red"`));
    expect(out).not.toMatch(/\bshadowColor\b/);
    expect(parseErrors(out)).toBe(0);
  });

  it("expands paddingHorizontal into left/right", () => {
    const src = asModule(`paddingHorizontal: 24, color: "#fff"`);
    const out = stripReactNativeStyleKeys(src);
    expect(out).toContain("paddingLeft");
    expect(out).toContain("paddingRight");
    expect(out).not.toMatch(/\bpaddingHorizontal\b/);
    expect(parseErrors(out)).toBe(0);
  });

  it("rewrites system-ui fontFamily to brand stack", () => {
    const src = asModule(`fontFamily: "system-ui, sans-serif", color: 1`);
    const out = normalizeAuthoredSource(src);
    expect(out).toMatch(/Inter/);
    expect(out).not.toMatch(/system-ui/);
    expect(parseErrors(out)).toBe(0);
  });

  it("does not rewrite system-ui inside string content", () => {
    const src = `const msg = "system-ui is an OS font";\nexport const C = () => <div style={{ color: 1 }} />;\n`;
    expect(normalizeAuthoredSource(src)).toContain("system-ui is an OS font");
  });

  it("does not strip elevation on non-style data objects", () => {
    const src = `const card = { elevation: 8, title: "Card" };\nexport const C = () => <div style={{ color: 1 }} />;\n`;
    const out = stripReactNativeStyleKeys(src);
    expect(out).toContain("elevation: 8");
    expect(out).toContain('title: "Card"');
  });

  it("integrates normalizeSvgJsxAttributes in normalizeAuthoredSource", () => {
    const src = `<svg><path stroke-width="4" stroke-dasharray="6 6" stop-color="#fff" stop-opacity="0.5" /></svg>`;
    const out = normalizeAuthoredSource(src);
    expect(out).toContain('strokeWidth="4"');
    expect(out).toContain('strokeDasharray="6 6"');
    expect(out).toContain('stopColor="#fff"');
    expect(out).toContain('stopOpacity="0.5"');
    expect(out).not.toContain("stroke-width");
  });
});

describe("normalizeSvgJsxAttributes", () => {
  it("rewrites kebab-case SVG attributes to React camelCase", () => {
    const input = `<svg><path stroke-width="4" stroke-dasharray="600" stop-color="#fff" stop-opacity="0.5" stroke-linecap="round" fill-opacity="0.8" clip-path="url(#c)" /></svg>`;
    const output = normalizeSvgJsxAttributes(input);
    expect(output).toContain('strokeWidth="4"');
    expect(output).toContain('strokeDasharray="600"');
    expect(output).toContain('stopColor="#fff"');
    expect(output).toContain('stopOpacity="0.5"');
    expect(output).toContain('strokeLinecap="round"');
    expect(output).toContain('fillOpacity="0.8"');
    expect(output).toContain('clipPath="url(#c)"');
    expect(output).not.toContain("stroke-width");
    expect(output).not.toContain("stop-color");
    expect(parseErrors(output)).toBe(0);
  });

  it("is idempotent on already camelCase attributes", () => {
    const input = `<path strokeWidth={4} strokeDashoffset={20} />`;
    expect(normalizeSvgJsxAttributes(input)).toBe(input);
  });

  it("handles JSX expressions as attribute values", () => {
    const input = `<path stroke-width={strokeWidth} stroke-dashoffset={600 * (1 - progress)} />`;
    const output = normalizeSvgJsxAttributes(input);
    expect(output).toContain("strokeWidth={strokeWidth}");
    expect(output).toContain("strokeDashoffset={600 * (1 - progress)}");
    expect(output).not.toContain("stroke-width");
    expect(output).not.toContain("stroke-dashoffset");
  });
});

