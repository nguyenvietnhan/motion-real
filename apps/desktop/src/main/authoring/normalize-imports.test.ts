import { describe, expect, it } from "vitest";
import { normalizeAuthoredImports } from "./normalize-imports.js";

describe("normalizeAuthoredImports — SceneImage re-home", () => {
  // Post-block-removal: @motionreal/blocks + @motionreal/theme are off the authored whitelist.
  // The ONE authored-facing survivor, SceneImage, lives behind @motionreal/compositions.
  // The model trained on the old contract still writes it from @motionreal/blocks, so
  // re-home ONLY SceneImage; every other (now-deleted) block symbol is left to
  // fail N4, which is correct — the model must rewrite it as raw JSX.
  it("re-homes a bare SceneImage import from @motionreal/blocks to @motionreal/compositions", () => {
    const out = normalizeAuthoredImports(`import { SceneImage } from "@motionreal/blocks";`);
    expect(out).toBe(`import { SceneImage } from "@motionreal/compositions";`);
  });

  it("re-homes SceneImage from @motionreal/theme too", () => {
    const out = normalizeAuthoredImports(`import { SceneImage } from "@motionreal/theme";`);
    expect(out).toBe(`import { SceneImage } from "@motionreal/compositions";`);
  });

  it("pulls SceneImage onto @motionreal/compositions but leaves the dead block symbols to fail N4", () => {
    // A mixed import: SceneImage is rescued; Frame/TitleBlock are NOT (those blocks
    // were deleted) — they stay on the now-dead @motionreal/blocks line so N4 still flags
    // them and the model is forced to drop them, rather than silently vanishing.
    const out = normalizeAuthoredImports(`import { Frame, SceneImage, TitleBlock } from "@motionreal/blocks";`);
    expect(out).toContain(`import { SceneImage } from "@motionreal/compositions";`);
    expect(out).toContain(`Frame`);
    expect(out).toContain(`TitleBlock`);
    expect(out).toContain(`"@motionreal/blocks"`); // the leftover (to-fail-N4) line is kept
  });

  it("leaves an import with no SceneImage untouched (nothing to rescue)", () => {
    const code = `import { Frame, Story, useTheme } from "@motionreal/blocks";`;
    expect(normalizeAuthoredImports(code)).toBe(code);
  });

  it("handles a `type`/alias clause when rescuing SceneImage", () => {
    const out = normalizeAuthoredImports(`import { SceneImage, type Foo } from "@motionreal/blocks";`);
    expect(out).toContain(`import { SceneImage } from "@motionreal/compositions";`);
    expect(out).toContain(`type Foo`);
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

  it("strips markdown fence delimiters left at the boundary of a recovered module", () => {
    const code = [
      "```tsx",
      "// component: scene-07",
      'import { z } from "zod";',
      'import { registerComponent } from "@motionreal/compositions";',
      "export const schema = z.object({});",
      "export const example = {};",
      'export default registerComponent({ id: "scene-07" });',
      "```",
      "",
      "```tsx",
    ].join("\n");

    const out = normalizeAuthoredImports(code);

    expect(out).toContain("// component: scene-07");
    expect(out).not.toMatch(/^```/m);
    expect(out).toContain('export default registerComponent({ id: "scene-07" });');
  });

  it("rewrites the exact zod typo import from zx to zod", () => {
    const out = normalizeAuthoredImports(`import { z } from "zx";\nexport const schema = z.object({});`);
    expect(out).toContain(`import { z } from "zod";`);
    expect(out).not.toContain(`from "zx"`);
  });

  it("leaves non-zod zx imports untouched so admission still blocks them", () => {
    const code = `import { $, fs } from "zx";`;
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
