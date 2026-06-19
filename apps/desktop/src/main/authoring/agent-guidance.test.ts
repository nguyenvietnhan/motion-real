import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rootFile = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../../../${path}`, import.meta.url)), "utf8");

const guidanceFiles = [
  ".claude/commands/news-video.md",
  ".claude/agents/scene-author.md",
] as const;

describe("Claude video-authoring guidance", () => {
  it.each(guidanceFiles)("keeps %s aligned with the freeform authored surface", (path) => {
    const text = rootFile(path);

    expect(text).toMatch(/raw JSX\/SVG|raw <div>\/<svg>/);
    expect(text).toContain("@news/compositions");
    expect(text).toMatch(/never import `@news\/blocks`|Do not use `Frame`/i);
    expect(text).not.toMatch(/compose `@news\/blocks`|Set `manifest\.theme\.stylePackId`/i);
    expect(text).not.toMatch(/bold-editorial|galaxy look|never hard-code/i);
  });

  it.each(guidanceFiles)("keeps %s aligned with settling motion guidance", (path) => {
    const text = rootFile(path);

    expect(text).toMatch(/clamped `interpolate`\/`spring`|clamped `interpolate`\/`spring` phases/);
    expect(text).toMatch(/resolve|settle/);
    expect(text).not.toMatch(/use Math\.sin|interpolate \+ Math\.sin/i);
  });
});
