import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rootFile = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../../../${path}`, import.meta.url)), "utf8");

describe("AI video-authoring guidance", () => {
  it("keeps the canonical contract aligned with pure AUTHOR mode", () => {
    const text = rootFile("AI_CONTRACT.md");

    expect(text).toMatch(/raw JSX\/SVG|raw <div>\/<svg>/);
    expect(text).toContain("@motionreal/compositions");
    expect(text).toMatch(/Do not import `@motionreal\/blocks`|Do not reintroduce `Frame`/i);
    expect(text).not.toMatch(/compose `@motionreal\/blocks`|pick a style/i);
    expect(text).not.toMatch(/bold-editorial|galaxy look|never hard-code/i);
  });

  it("keeps the canonical content guidance aligned with motion tempo guidance", () => {
    const text = `${rootFile("AI_CONTRACT.md")}\n${rootFile("docs/current/content-guide.md")}`;

    expect(text).toMatch(/Quick entrance\/reveal\/pop/);
    expect(text).toMatch(/Semantic progression/);
    expect(text).toMatch(/Continuous living motion/);
    expect(text).toMatch(/deterministic phase\/period motion/);
    expect(text).toMatch(/settling|final hold|idea lands/);
    expect(text).not.toMatch(/use Math\.sin|interpolate \+ Math\.sin/i);
  });

  it("keeps repo-level AI entry points vendor-neutral", () => {
    const text = rootFile("AGENTS.md");

    expect(text).toContain("AI_CONTRACT.md");
    expect(text).toMatch(/not a separate contract/i);
    expect(text).not.toMatch(/raw JSX\/SVG|raw <div>\/<svg>/);
    expect(text).not.toMatch(/clamped `interpolate`\/`spring`/);
    expect(text).not.toMatch(/Frame|TitleBlock|KeyPoints|pick a style/);
  });
});
