import { describe, expect, it } from "vitest";
import "@news/compositions"; // register components
import { DURATION_PRESETS, VideoSpecSchema, type DurationPreset } from "@news/schema";
import { runStaticGrid } from "../safety/static-grid.js";
import { buildMockSpec } from "./mock.js";
import { buildPlannerCatalog, buildPlannerPrompt } from "./catalog.js";
import { planVideoSpec } from "./index.js";

describe("mock planner", () => {
  for (const duration of DURATION_PRESETS) {
    it(`produces an evidence-safe, structurally valid spec for ${duration}s`, () => {
      const spec = buildMockSpec("Vì sao chip AI đang đắt đỏ", duration as DurationPreset);
      // Schema-valid
      expect(VideoSpecSchema.safeParse(spec).success).toBe(true);
      // Durations sum exactly to the preset
      const total = spec.scenes.reduce((s, sc) => s + sc.durationInSeconds, 0);
      expect(Math.round(total)).toBe(duration);
      // No hard errors from the static grid
      const report = runStaticGrid(spec);
      const errors = report.issues.filter((i) => i.severity === "error");
      expect(errors).toEqual([]);
      // Opens with hero, ends with final-cta
      expect(spec.scenes[0]!.component).toBe("hero-announcement");
      expect(spec.scenes.at(-1)!.component).toBe("final-cta");
    });
  }

  it("planVideoSpec in mock mode returns a valid spec", async () => {
    const result = await planVideoSpec({ prompt: "Tương lai của xe điện", duration: 60, aiProvider: "mock" });
    expect(result.spec.scenes.length).toBeGreaterThanOrEqual(10);
    expect(runStaticGrid(result.spec).ok).toBe(true);
  });
});

describe("planner prompt + catalog", () => {
  it("lists registered components and pins hero/final-cta", () => {
    const catalog = buildPlannerCatalog();
    const ids = catalog.map((c) => c.id);
    expect(ids).toContain("hero-announcement");
    expect(ids).toContain("final-cta");
    const prompt = buildPlannerPrompt("chủ đề bất kỳ", 60);
    expect(prompt).toContain("hero-announcement");
    expect(prompt).toContain("final-cta");
    expect(prompt).toContain("9:16");
  });
});

describe("external planner config", () => {
  it("throws a clear error when an external provider has no API key", async () => {
    const prev = process.env.AI_API_KEY;
    delete process.env.AI_API_KEY;
    const prevDeep = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    await expect(
      planVideoSpec({ prompt: "x", duration: 60, aiProvider: "deepseek" }),
    ).rejects.toThrow(/AI_API_KEY is missing/);
    if (prev !== undefined) process.env.AI_API_KEY = prev;
    if (prevDeep !== undefined) process.env.DEEPSEEK_API_KEY = prevDeep;
  });
});
