import { describe, expect, it } from "vitest";
import { evaluateContentPlanQuality, type ContentPlan } from "./content-plan.js";
import {
  demoteInvalidProvenanceClaims,
  finalizeAfterClaimRepair,
  provenanceVerdict,
  shouldDemoteForProvenance,
} from "./content-plan-claim-policy.js";

function validPlan(overrides: Partial<ContentPlan> = {}): ContentPlan {
  return {
    title: "Chiếc bottleneck đắt nhất của AI",
    viewerPromise: "Người xem hiểu vì sao phần khó nhất không nằm ở con chip.",
    hookType: "contradiction",
    first3SecondsLine: "Con chip nhỏ xíu không đắt vì nó nhỏ. Nó đắt vì gần như không ai làm nổi.",
    openLoop: "Điểm nghẽn thật sự nằm ở nơi ít người nhìn thấy.",
    payoff: "Giá trị nằm ở năng lực sản xuất khan hiếm, không phải kích thước con chip.",
    claims: [
      {
        id: "claim-01",
        text: "Năng lực sản xuất chip tiên tiến tập trung vào rất ít nhà máy.",
        support: "source_material",
        confidence: "supported",
        action: "use",
      },
      {
        id: "claim-02",
        text: "Một con số chi phí chưa được nguồn xác nhận.",
        support: "source_material",
        confidence: "uncertain",
        action: "omit",
      },
    ],
    scenes: [
      {
        sceneId: "scene-01",
        purpose: "hook",
        beat: "Reveal scarcity before specs.",
        narration: "Con chip nhỏ xíu không đắt vì nó nhỏ. Nó đắt vì gần như không ai làm nổi.",
        onScreenText: "Đắt vì khan hiếm",
        visualMetaphor: "A tiny glowing chip behind a locked factory gate.",
        motionProgression:
          "Quick entrance: chip pops in under a second; semantic: the factory gate closes around it; living: the lock keeps a small warning pulse; final hold on the bottleneck.",
        layoutFamily: "signature-visual",
        evidenceClaimIds: ["claim-01"],
      },
      {
        sceneId: "scene-02",
        purpose: "payoff",
        beat: "Turn scarcity into the final takeaway.",
        narration:
          "Khi năng lực sản xuất là cổ chai, thứ được định giá không phải vật liệu mà là quyền bước qua cánh cổng.",
        onScreenText: "Cổ chai là nhà máy",
        visualMetaphor: "A queue of chips waiting outside one narrow production door.",
        motionProgression:
          "Quick entrance: the chip queue slides in; semantic: the doorway narrows as one finished chip exits; final hold as the takeaway lands.",
        layoutFamily: "diagram",
        evidenceClaimIds: ["claim-01"],
      },
    ],
    ...overrides,
  };
}

const sourceBody =
  "The company reported revenue of twelve billion dollars last year according to its annual filing.";
const sources = [
  {
    id: "source-01",
    metadata: { sourceUrl: "https://example.com/filing" },
    body: sourceBody,
  },
] as const;

function provenancePlan(claimOverrides: Partial<ContentPlan["claims"][number]> = {}): ContentPlan {
  return validPlan({
    claims: [
      {
        id: "claim-01",
        text: "Revenue was twelve billion dollars last year.",
        support: "source_material",
        confidence: "supported",
        action: "use",
        ...claimOverrides,
      },
    ],
    scenes: validPlan().scenes.map((scene) => ({
      ...scene,
      // Avoid claim-ledger noise: no bare numbers/dates outside the claim ledger path.
      narration: "A soft overview of capacity without inventing figures.",
      onScreenText: "Overview",
      beat: "context without concrete figures",
      evidenceClaimIds: claimOverrides.action === "omit" ? [] : ["claim-01"],
    })),
  });
}

describe("claim-provenance quality (evaluateContentPlanQuality + sources)", () => {
  it("passes when usable source_material has matching source id and exact excerpt", () => {
    const plan = provenancePlan({
      sourceRef: {
        sourceId: "source-01",
        excerpt: "reported revenue of twelve billion dollars last year",
      },
    });
    const quality = evaluateContentPlanQuality(plan, undefined, sources);
    expect(quality.blockingIssues.filter((i) => i.check === "claim-provenance")).toEqual([]);
  });

  it("blocks usable source_material missing sourceRef when readable sources exist", () => {
    const quality = evaluateContentPlanQuality(provenancePlan(), undefined, sources);
    expect(quality.blockingIssues).toContainEqual(
      expect.objectContaining({
        check: "claim-provenance",
        severity: "blocking",
        message: expect.stringMatching(/requires sourceRef/i),
      }),
    );
  });

  it("blocks unknown source id and non-matching excerpt", () => {
    const unknown = evaluateContentPlanQuality(
      provenancePlan({
        sourceRef: {
          sourceId: "source-99",
          excerpt: "reported revenue of twelve billion dollars last year",
        },
      }),
      undefined,
      sources,
    );
    expect(unknown.blockingIssues).toContainEqual(
      expect.objectContaining({
        check: "claim-provenance",
        message: expect.stringMatching(/unknown source/i),
      }),
    );

    const badExcerpt = evaluateContentPlanQuality(
      provenancePlan({
        sourceRef: {
          sourceId: "source-01",
          excerpt: "hallucinated fifty billion nonsense quote here",
        },
      }),
      undefined,
      sources,
    );
    expect(badExcerpt.blockingIssues).toContainEqual(
      expect.objectContaining({
        check: "claim-provenance",
        message: expect.stringMatching(/does not match source/i),
      }),
    );
  });

  it("empty sources: usable source_material is blocked (with or without sourceRef)", () => {
    const withCite = evaluateContentPlanQuality(
      provenancePlan({
        sourceRef: {
          sourceId: "source-01",
          excerpt: "reported revenue of twelve billion dollars last year",
        },
      }),
      undefined,
      [],
    );
    expect(withCite.blockingIssues.some((i) => i.check === "claim-provenance")).toBe(true);

    const noCite = evaluateContentPlanQuality(provenancePlan(), undefined, []);
    expect(noCite.blockingIssues).toContainEqual(
      expect.objectContaining({
        check: "claim-provenance",
        message: expect.stringMatching(/no readable sources/i),
      }),
    );
  });

  it("blocks user_brief and common_knowledge claims that carry sourceRef", () => {
    const brief = evaluateContentPlanQuality(
      provenancePlan({
        support: "user_brief",
        sourceRef: {
          sourceId: "source-01",
          excerpt: "reported revenue of twelve billion dollars last year",
        },
      }),
      undefined,
      sources,
    );
    expect(brief.blockingIssues).toContainEqual(
      expect.objectContaining({
        check: "claim-provenance",
        message: expect.stringMatching(/user_brief.*must not carry sourceRef/i),
      }),
    );

    const common = evaluateContentPlanQuality(
      provenancePlan({
        support: "common_knowledge",
        sourceRef: {
          sourceId: "source-01",
          excerpt: "reported revenue of twelve billion dollars last year",
        },
      }),
      undefined,
      sources,
    );
    expect(common.blockingIssues).toContainEqual(
      expect.objectContaining({
        check: "claim-provenance",
        message: expect.stringMatching(/common_knowledge.*must not carry sourceRef/i),
      }),
    );
  });

  it("does not run claim-provenance when sources arg is omitted", () => {
    // Backward-compatible path for text-only / non-URL authoring tests.
    const quality = evaluateContentPlanQuality(provenancePlan());
    expect(quality.blockingIssues.filter((i) => i.check === "claim-provenance")).toEqual([]);
  });

  it("demotes unusable source_material claims instead of leaving mixed provenance", () => {
    const plan = provenancePlan({
      sourceRef: {
        sourceId: "source-01",
        excerpt: "hallucinated fifty billion nonsense quote here",
      },
    });
    const { plan: fixed, demotedClaimIds } = demoteInvalidProvenanceClaims(plan, sources);
    expect(demotedClaimIds).toEqual(["claim-01"]);
    expect(fixed.claims.find((c) => c.id === "claim-01")).toMatchObject({
      action: "omit",
      confidence: "uncertain",
    });
    expect(fixed.claims.find((c) => c.id === "claim-01")?.sourceRef).toBeUndefined();
    expect(fixed.scenes.every((s) => !s.evidenceClaimIds.includes("claim-01"))).toBe(true);
    expect(
      evaluateContentPlanQuality(fixed, undefined, sources).blockingIssues.filter(
        (i) => i.check === "claim-provenance",
      ),
    ).toEqual([]);
  });

  it("after demote, residual claim-ledger from emptied evidence becomes advisory so create can continue", () => {
    // Mirrors arXiv-style paraphrase failures: repair leaves bad excerpts + a scene
    // that still names a concrete figure after its only evidence claim is demoted.
    const plan = {
      ...provenancePlan({
        sourceRef: {
          sourceId: "source-01",
          excerpt: "this paraphrased excerpt never appears in the body at all",
        },
      }),
      scenes: [
        {
          ...provenancePlan().scenes[0]!,
          narration: "Paper reports 42.7% accuracy on the held-out set.",
          onScreenText: "42.7%",
          evidenceClaimIds: ["claim-01"],
        },
      ],
    };
    const recovered = finalizeAfterClaimRepair(plan, sources);
    expect(recovered.demotedClaimIds).toEqual(["claim-01"]);
    expect(recovered.softenedClaimLedger).toBe(true);
    expect(recovered.quality.blockingIssues.filter((i) => i.check === "claim-provenance")).toEqual([]);
    expect(recovered.quality.blockingIssues.filter((i) => i.check === "claim-ledger")).toEqual([]);
    expect(recovered.quality.advisoryIssues.some((i) => i.check === "claim-ledger")).toBe(true);
  });

  it("after repair with only claim-ledger left (no provenance), softens ledger without inventing evidence", () => {
    // Real incident c3c0f440: repair fixed/dropped provenance but left numbers in
    // scene-01 with empty evidenceClaimIds — previous recovery required provenance
    // to demote first and never ran, hard-failing create.
    const plan = {
      ...provenancePlan({
        support: "user_brief" as const,
        sourceRef: undefined,
      }),
      scenes: [
        {
          ...provenancePlan().scenes[0]!,
          narration: "Accuracy reaches 42.7 percent on the held-out benchmark.",
          onScreenText: "42.7%",
          evidenceClaimIds: [],
        },
      ],
    };
    // No provenance blockers (user_brief), only claim-ledger.
    const pre = evaluateContentPlanQuality(plan, undefined, sources);
    expect(pre.blockingIssues.every((i) => i.check === "claim-ledger")).toBe(true);

    const finalized = finalizeAfterClaimRepair(plan, sources);
    expect(finalized.demotedClaimIds).toEqual([]);
    expect(finalized.softenedClaimLedger).toBe(true);
    expect(finalized.quality.blockingIssues).toEqual([]);
    expect(finalized.quality.advisoryIssues.some((i) => i.check === "claim-ledger")).toBe(true);
  });

  it("does not soften claim-ledger on text-only plans (sources omitted)", () => {
    const plan = {
      ...provenancePlan({ support: "user_brief" as const, sourceRef: undefined }),
      scenes: [
        {
          ...provenancePlan().scenes[0]!,
          narration: "Costs rose 42.7 percent year over year.",
          onScreenText: "42.7%",
          evidenceClaimIds: [],
        },
      ],
    };
    const finalized = finalizeAfterClaimRepair(plan, undefined);
    expect(finalized.softenedClaimLedger).toBe(false);
    expect(finalized.quality.blockingIssues.some((i) => i.check === "claim-ledger")).toBe(true);
  });

  it("keeps non-ledger blockers hard after demote (no blanket soften)", () => {
    const plan = {
      ...provenancePlan({
        sourceRef: {
          sourceId: "source-01",
          excerpt: "paraphrase that never appears in source body text here",
        },
      }),
      viewerPromise: "", // also trip viewer-promise blocking
      scenes: [
        {
          ...provenancePlan().scenes[0]!,
          narration: "Score is 42.7 percent.",
          evidenceClaimIds: ["claim-01"],
        },
      ],
    };
    const finalized = finalizeAfterClaimRepair(plan, sources);
    expect(finalized.demotedClaimIds).toEqual(["claim-01"]);
    // claim-ledger may be present but must NOT be the only class — viewer-promise stays hard
    expect(finalized.quality.blockingIssues.some((i) => i.check === "viewer-promise")).toBe(true);
    // Must not soften ledger when other hard blockers remain
    expect(finalized.softenedClaimLedger).toBe(false);
  });

  it("with zero readable sources, demotes all usable source_material (with or without sourceRef)", () => {
    const withRef = provenancePlan({
      sourceRef: { sourceId: "source-01", excerpt: "twelve billion dollars last year according" },
    });
    const withoutRef = provenancePlan(); // usable source_material, no sourceRef
    const demotedWith = demoteInvalidProvenanceClaims(withRef, []);
    const demotedWithout = demoteInvalidProvenanceClaims(withoutRef, []);
    expect(demotedWith.demotedClaimIds).toEqual(["claim-01"]);
    expect(demotedWithout.demotedClaimIds).toEqual(["claim-01"]);
    // finalize with [] must clear provenance and may soften residual ledger
    const finalized = finalizeAfterClaimRepair(withRef, []);
    expect(finalized.quality.blockingIssues.filter((i) => i.check === "claim-provenance")).toEqual([]);
  });

  it("finalize without a prior AI repair still demotes bad provenance (repair-parse independence)", () => {
    // Hidden bug: recovery used to run only after successful repair parse.
    const plan = provenancePlan({
      sourceRef: {
        sourceId: "source-01",
        excerpt: "completely made up excerpt that is not in the filing body",
      },
    });
    const finalized = finalizeAfterClaimRepair(plan, sources);
    expect(finalized.demotedClaimIds).toEqual(["claim-01"]);
    expect(finalized.quality.blockingIssues.filter((i) => i.check === "claim-provenance")).toEqual([]);
  });
});

describe("provenanceVerdict matrix", () => {
  const goodExcerpt = "reported revenue of twelve billion dollars last year";
  const claimBase = {
    id: "claim-01",
    text: "Revenue was twelve billion dollars last year.",
    support: "source_material" as const,
    confidence: "supported" as const,
    action: "use" as const,
  };

  it.each([
    {
      name: "ok with matching excerpt",
      claim: { ...claimBase, sourceRef: { sourceId: "source-01", excerpt: goodExcerpt } },
      sources: [...sources],
      kind: "ok" as const,
      demote: false,
    },
    {
      name: "missing sourceRef",
      claim: { ...claimBase },
      sources: [...sources],
      kind: "missing-source-ref" as const,
      demote: true,
    },
    {
      name: "unknown source",
      claim: {
        ...claimBase,
        sourceRef: { sourceId: "source-99", excerpt: goodExcerpt },
      },
      sources: [...sources],
      kind: "unknown-source" as const,
      demote: true,
    },
    {
      name: "excerpt mismatch",
      claim: {
        ...claimBase,
        sourceRef: { sourceId: "source-01", excerpt: "hallucinated fifty billion nonsense quote here" },
      },
      sources: [...sources],
      kind: "excerpt-mismatch" as const,
      demote: true,
    },
    {
      name: "no readable sources",
      claim: { ...claimBase },
      sources: [] as const,
      kind: "no-readable-sources" as const,
      demote: true,
    },
    {
      name: "spurious sourceRef on user_brief",
      claim: {
        ...claimBase,
        support: "user_brief" as const,
        sourceRef: { sourceId: "source-01", excerpt: goodExcerpt },
      },
      sources: [...sources],
      kind: "spurious-source-ref" as const,
      demote: false,
    },
    {
      name: "sources omitted → ok",
      claim: { ...claimBase },
      sources: undefined,
      kind: "ok" as const,
      demote: false,
    },
  ])("$name", ({ claim, sources: src, kind, demote }) => {
    const problem = provenanceVerdict(claim, src);
    expect(problem.kind).toBe(kind);
    expect(shouldDemoteForProvenance(problem)).toBe(demote);
  });
});

describe("quality ↔ demote drift invariant (source_material only)", () => {
  const fixtures: Array<{ name: string; plan: ContentPlan; sources: readonly (typeof sources)[number][] }> = [
    {
      name: "missing sourceRef",
      plan: provenancePlan(),
      sources: [...sources],
    },
    {
      name: "bad excerpt",
      plan: provenancePlan({
        sourceRef: {
          sourceId: "source-01",
          excerpt: "hallucinated fifty billion nonsense quote here",
        },
      }),
      sources: [...sources],
    },
    {
      name: "good excerpt",
      plan: provenancePlan({
        sourceRef: {
          sourceId: "source-01",
          excerpt: "reported revenue of twelve billion dollars last year",
        },
      }),
      sources: [...sources],
    },
    {
      name: "empty sources",
      plan: provenancePlan(),
      sources: [],
    },
  ];

  for (const fixture of fixtures) {
    it(`${fixture.name}: provenance block iff demote includes claim`, () => {
      const q = evaluateContentPlanQuality(fixture.plan, undefined, fixture.sources);
      const { demotedClaimIds } = demoteInvalidProvenanceClaims(fixture.plan, fixture.sources);
      const provenanceBlocked = q.blockingIssues.some((i) => i.check === "claim-provenance");
      expect(demotedClaimIds.length > 0).toBe(provenanceBlocked);
      if (provenanceBlocked) {
        expect(demotedClaimIds).toContain("claim-01");
      }
    });
  }

  it("spurious user_brief sourceRef blocks quality but does not demote", () => {
    const plan = provenancePlan({
      support: "user_brief",
      sourceRef: {
        sourceId: "source-01",
        excerpt: "reported revenue of twelve billion dollars last year",
      },
    });
    const q = evaluateContentPlanQuality(plan, undefined, sources);
    const { demotedClaimIds } = demoteInvalidProvenanceClaims(plan, sources);
    expect(q.blockingIssues.some((i) => i.check === "claim-provenance")).toBe(true);
    expect(demotedClaimIds).toEqual([]);
  });
});
