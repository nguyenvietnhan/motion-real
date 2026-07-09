import { describe, expect, it } from "vitest";
import {
  buildProjectEvidence,
  excerptMatchesSource,
  isValidExcerpt,
  normalizedEvidenceText,
  researchSourcesFromIngest,
} from "./content-evidence.js";

describe("content-evidence helpers", () => {
  it("normalizes whitespace/case for exact containment", () => {
    expect(normalizedEvidenceText("  Hello\nWorld  ")).toBe("hello world");
  });

  it("matches exact excerpts and rejects hallucinated quotes", () => {
    const body = "The company reported revenue of 12 billion dollars in 2024.";
    expect(excerptMatchesSource("reported revenue of 12 billion dollars", body)).toBe(true);
    expect(excerptMatchesSource("reported revenue of 50 billion dollars", body)).toBe(false);
    expect(excerptMatchesSource("short", body)).toBe(false);
  });

  it("assigns sequential source ids in URL order", () => {
    const sources = researchSourcesFromIngest([
      { metadata: { sourceUrl: "https://a.example/1" }, body: "aaa" },
      { metadata: { sourceUrl: "https://b.example/2" }, body: "bbb" },
    ]);
    expect(sources.map((s) => s.id)).toEqual(["source-01", "source-02"]);
  });

  it("builds evidence without research bodies", () => {
    const sources = researchSourcesFromIngest([
      {
        metadata: { sourceUrl: "https://a.example", title: "A", fetchedAt: "2026-01-01T00:00:00.000Z" },
        body: "SECRET FULL RESEARCH BODY CONTENT THAT MUST STAY TRANSIENT AND NEVER BE PERSISTED AS BODY",
      },
    ]);
    const evidence = buildProjectEvidence({
      sources,
      claims: [
        {
          id: "claim-01",
          text: "Revenue grew.",
          support: "source_material",
          sourceRef: {
            sourceId: "source-01",
            excerpt: "a short validated excerpt from the article!",
          },
        },
      ],
      scenes: [{ sceneId: "scene-01", evidenceClaimIds: ["claim-01"] }],
    });
    const blob = JSON.stringify(evidence);
    expect(blob).not.toContain("SECRET FULL RESEARCH BODY");
    expect(blob).not.toContain("NEVER BE PERSISTED AS BODY");
    expect(evidence.sources[0]?.sourceUrl).toBe("https://a.example");
    expect(isValidExcerpt("x".repeat(19))).toBe(false);
    expect(isValidExcerpt("x".repeat(20))).toBe(true);
  });
});
