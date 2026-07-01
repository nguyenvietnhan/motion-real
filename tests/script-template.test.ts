import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { admitAuthoredComponent } from "@news/pipeline";
import { describe, expect, it } from "vitest";

const rootFile = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

const forbiddenTemplatePatterns = [
  /from\s+["']@news\/blocks["']/,
  /from\s+["']@news\/theme["']/,
  /\bFrame\b/,
  /\bStory\b/,
  /\bTitleBlock\b/,
  /\bKeyPoints\b/,
  /\bPanel\b/,
  /\bCountUp\b/,
  /\buseTheme\b/,
  /\bstylePackId\b/,
] as const;

function template(): string {
  return rootFile("scripts/_video-template.txt");
}

function extractSceneConstant(name: "STATEMENT" | "METRIC"): string {
  const match = new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`).exec(template());
  if (!match?.[1]) throw new Error(`Missing ${name} scene constant in script template`);
  return match[1];
}

describe("scripts/new-video template", () => {
  it("stays aligned with the current AUTHOR surface", () => {
    const text = template();

    expect(text).toContain("AI_CONTRACT.md");
    expect(text).toContain("docs/current/authoring-contract.md");
    expect(text).toContain('from "@news/compositions"');
    expect(text).toContain('from "remotion"');
    expect(text).toContain('id: "vt-statement"');
    expect(text).toContain('id: "vt-metric"');
    for (const pattern of forbiddenTemplatePatterns) {
      expect(text).not.toMatch(pattern);
    }
  });

  it("keeps scaffolded component ids project-local", () => {
    const generated = template()
      .split("__ID__").join("daily-brief")
      .split("__TITLE__").join("Daily Brief")
      .split("vt-").join("daily-brief-");

    expect(generated).not.toContain("__ID__");
    expect(generated).not.toContain("__TITLE__");
    expect(generated).not.toContain("vt-");
    expect(generated).toContain('id: "daily-brief-statement"');
    expect(generated).toContain('id: "daily-brief-metric"');
    expect(generated).toContain('"daily-brief-statement"');
    expect(generated).toContain('"daily-brief-metric"');
  });

  it("ships starter scenes that pass the admission gate", () => {
    const dir = mkdtempSync(join(tmpdir(), "motionreal-template-"));
    try {
      const cases = [
        ["STATEMENT", "statement.tsx", "vt-statement"],
        ["METRIC", "metric.tsx", "vt-metric"],
      ] as const;

      for (const [constantName, fileName, componentId] of cases) {
        const file = join(dir, fileName);
        writeFileSync(file, extractSceneConstant(constantName), "utf8");
        const result = admitAuthoredComponent(file);

        expect(result).toEqual({ admitted: true, componentId });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
