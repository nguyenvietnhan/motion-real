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
});
