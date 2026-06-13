import { describe, expect, it } from "vitest";
import { normalizeAuthoredImports } from "./normalize-imports.js";

describe("normalizeAuthoredImports", () => {
  it("moves a misplaced useTheme from @news/design to @news/blocks", () => {
    const out = normalizeAuthoredImports(`import { useTheme } from "@news/design";`);
    expect(out).toBe(`import { useTheme } from "@news/blocks";`);
  });

  it("splits a mixed import, keeping real @news/design symbols there", () => {
    const out = normalizeAuthoredImports(`import { useTheme, PRINT, onColor, frameRamp } from "@news/design";`);
    expect(out).toContain(`import { useTheme, frameRamp } from "@news/blocks";`);
    expect(out).toContain(`import { PRINT, onColor } from "@news/design";`);
  });

  it("leaves a correct @news/design import untouched", () => {
    const code = `import { PRINT, withAlpha } from "@news/design";`;
    expect(normalizeAuthoredImports(code)).toBe(code);
  });

  it("leaves a correct @news/blocks import untouched", () => {
    const code = `import { Frame, Story, useTheme } from "@news/blocks";`;
    expect(normalizeAuthoredImports(code)).toBe(code);
  });

  it("handles `type` clauses and aliases", () => {
    const out = normalizeAuthoredImports(`import { type Tone, withAlpha } from "@news/design";`);
    expect(out).toContain(`import { type Tone } from "@news/blocks";`);
    expect(out).toContain(`import { withAlpha } from "@news/design";`);
  });

  // The model trained on an old Remotion API keeps importing `Extrapolate` (an
  // enum that no longer exists) and using `Extrapolate.CLAMP`; current Remotion
  // takes the bare string "clamp". Without a fix the scene fails N4 admission
  // ("No matching export in remotion for import Extrapolate") and rolls back.
  it("rewrites Extrapolate.CLAMP to \"clamp\" and drops the dead remotion import", () => {
    const code = [
      `import { interpolate, Extrapolate } from "remotion";`,
      `const x = interpolate(f, [0, 1], [0, 1], { extrapolateRight: Extrapolate.CLAMP });`,
    ].join("\n");
    const out = normalizeAuthoredImports(code);
    expect(out).toContain(`import { interpolate } from "remotion";`);
    expect(out).not.toContain("Extrapolate");
    expect(out).toContain(`extrapolateRight: "clamp"`);
  });

  it("drops the remotion import line entirely when only Extrapolate was imported", () => {
    const out = normalizeAuthoredImports(`import { Extrapolate } from "remotion";\nconst a = Extrapolate.EXTEND;`);
    expect(out).not.toContain(`from "remotion"`);
    expect(out).toContain(`const a = "extend";`);
  });

  it("leaves a correct remotion import untouched", () => {
    const code = `import { interpolate, useCurrentFrame } from "remotion";`;
    expect(normalizeAuthoredImports(code)).toBe(code);
  });

  it("does NOT mangle a same-named member of another object (foo.Extrapolate.CLAMP)", () => {
    // The standalone-identifier guard: a member access whose `Extrapolate` is
    // itself a property of something else must be left alone — only a top-level
    // `Extrapolate.X` (the removed remotion enum) is rewritten.
    const code = `const a = cfg.Extrapolate.CLAMP;`;
    expect(normalizeAuthoredImports(code)).toBe(code);
  });
});

describe("normalizeAuthoredImports — color interpolation", () => {
  // The bug this guards: the model reaches for `interpolate` to cross-fade a
  // COLOR. Remotion's interpolate has a string[] output overload, so it
  // type-checks clean (N10 can't catch it) but throws at RENDER time:
  // `Cannot interpolate "#6177e5" because … is not a supported … value`. The
  // correct API is interpolateColors (identical signature). We swap the callee
  // for color-valued calls and ensure the import exists.
  it("rewrites a hex-literal interpolate to interpolateColors + adds the import", () => {
    const code = [
      `import { interpolate } from "remotion";`,
      `const c = interpolate(t, [0, 1], ["#fff", "#000"]);`,
    ].join("\n");
    const out = normalizeAuthoredImports(code);
    expect(out).toContain(`const c = interpolateColors(t, [0, 1], ["#fff", "#000"]);`);
    expect(out).toContain(`import { interpolate, interpolateColors } from "remotion";`);
  });

  it("rewrites a theme.colors output range (the real crash) and keeps options arg", () => {
    const code = `const f = interpolate(progress, [0.4, 0.8], [theme.colors.accent, theme.colors.signal], { extrapolateRight: "clamp" });`;
    const out = normalizeAuthoredImports(code);
    expect(out).toContain(`interpolateColors(progress, [0.4, 0.8], [theme.colors.accent, theme.colors.signal], { extrapolateRight: "clamp" })`);
    expect(out).not.toMatch(/\binterpolate\(progress/); // the bare interpolate( call is gone
    expect(out).toContain(`import { interpolateColors } from "remotion";`); // prepended (no prior import)
  });

  it("leaves a NUMERIC interpolate untouched (must never become interpolateColors)", () => {
    const code = `const y = interpolate(frame, [0, 15], [40, 0], { extrapolateRight: "clamp" });`;
    expect(normalizeAuthoredImports(code)).toBe(code);
  });

  it("does not double-import interpolateColors when already present", () => {
    const code = [
      `import { interpolate, interpolateColors } from "remotion";`,
      `const c = interpolate(t, [0, 1], ["#fff", "#000"]);`,
    ].join("\n");
    const out = normalizeAuthoredImports(code);
    expect(out).toContain(`interpolateColors(t, [0, 1], ["#fff", "#000"])`);
    // exactly one interpolateColors in the import clause (no duplicate appended)
    expect(out.match(/import \{ interpolate, interpolateColors \} from "remotion";/g)).toHaveLength(1);
  });

  it("does NOT touch obj.interpolate(... colors) — only the standalone remotion call", () => {
    const code = `const c = anim.interpolate(t, [0, 1], ["#fff", "#000"]);`;
    expect(normalizeAuthoredImports(code)).toBe(code);
  });

  it("handles a nested call inside the output range without mis-slicing", () => {
    const code = `const c = interpolate(t, [0, 1], [withAlpha(theme.colors.accent, 0.5), "#000"]);`;
    const out = normalizeAuthoredImports(code);
    expect(out).toContain(`interpolateColors(t, [0, 1], [withAlpha(theme.colors.accent, 0.5), "#000"])`);
  });
});
