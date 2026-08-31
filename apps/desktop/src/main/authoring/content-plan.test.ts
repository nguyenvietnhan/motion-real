import { describe, expect, it } from "vitest";
import {
  buildContentPlanMessages,
  buildContentPlanRepairMessages,
  ContentPlanSchema,
  contentPlanForAuthoring,
  evaluateContentPlanQuality,
  parseContentPlan,
  semanticMotionSceneIds,
  usableClaims,
  type ContentPlan,
} from "./content-plan.js";
import type { ContentPart } from "./prompt.js";
import { computePacingBudget } from "./pacing-policy.js";
import {
  ANTHROPIC_FABLE_SAFEGUARDS_SNAPSHOT,
  INVALID_PURPOSE_CONTENT_PLAN_REPLY,
  CLAIM_LEDGER_MISSING_EVIDENCE_PLAN,
} from "./__fixtures__/authoring-failure-incidents.js";

const image = { ref: "assets/product.png", width: 1200, height: 800, dataUrl: "data:image/png;base64,AAA" };

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
        motionProgression: "Quick entrance: chip pops in under a second; semantic: the factory gate closes around it; living: the lock keeps a small warning pulse; final hold on the bottleneck.",
        motionBeats: [
          { id: "show-chip", anchor: "Con chip nhỏ xíu", action: "Reveal the chip" },
          { id: "close-gate", anchor: "gần như không ai", action: "Close the factory gate" },
        ],
        layoutFamily: "signature-visual",
        evidenceClaimIds: ["claim-01"],
      },
      {
        sceneId: "scene-02",
        purpose: "payoff",
        beat: "Turn scarcity into the final takeaway.",
        narration: "Khi năng lực sản xuất là cổ chai, thứ được định giá không phải vật liệu mà là quyền bước qua cánh cổng.",
        onScreenText: "Cổ chai là nhà máy",
        visualMetaphor: "A queue of chips waiting outside one narrow production door.",
        motionProgression: "Quick entrance: the chip queue slides in; semantic: the doorway narrows as one finished chip exits; final hold as the takeaway lands.",
        motionBeats: [
          { id: "show-bottleneck", anchor: "năng lực sản xuất", action: "Narrow the production path" },
          { id: "cross-gate", anchor: "bước qua cánh cổng", action: "Move one chip through the gate" },
        ],
        layoutFamily: "diagram",
        evidenceClaimIds: ["claim-01"],
      },
    ],
    ...overrides,
  };
}

function textOf(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content.filter((part): part is { type: "text"; text: string } => part.type === "text").map((part) => part.text).join("\n");
}

function words(n: number): string {
  return Array.from({ length: n }, () => "nhịp").join(" ");
}

function pacingScene(index: number, total: number, narrationWords: number): ContentPlan["scenes"][number] {
  const base = index === 1 ? validPlan().scenes[0]! : validPlan().scenes[1]!;
  const sceneId = `scene-${String(index).padStart(2, "0")}`;
  return {
    ...base,
    sceneId,
    purpose: index === 1 ? "hook" : index === total ? "payoff" : "context",
    narration: words(narrationWords),
    onScreenText: `Ý ${index}`,
    layoutFamily: index % 2 === 0 ? "diagram" : "timeline",
  };
}

describe("ContentPlanSchema", () => {
  it("accepts legacy plans without review modes and parses generated review intent", () => {
    expect(ContentPlanSchema.safeParse(validPlan()).success).toBe(true);
    const generated = validPlan({
      scenes: validPlan().scenes.map((scene, index) => ({
        ...scene,
        temporalMode: index === 0 ? "stepped" as const : "continuous" as const,
        detailMode: index === 0 ? "normal" as const : "fine" as const,
      })),
    });
    expect(ContentPlanSchema.safeParse(generated).success).toBe(true);
  });

  it("accepts ordered Vietnamese anchors after NFC/case/punctuation normalization", () => {
    const parsed = ContentPlanSchema.safeParse(validPlan({
      scenes: [{
        ...validPlan().scenes[0]!,
        narration: "ĐẦU TIÊN, hệ thống nhận yêu cầu. Sau đó, dữ liệu được xử lý!",
        motionBeats: [
          { id: "receive-request", anchor: "hệ thống nhận yêu cầu", action: "Reveal node one" },
          { id: "process-data", anchor: "DỮ LIỆU ĐƯỢC XỬ LÝ", action: "Activate node two" },
        ],
      }],
    }));
    expect(parsed.success).toBe(true);
  });

  it.each([
    ["missing", "không có trong lời đọc", "xuất hiện đúng một lần"],
    ["ambiguous", "lặp lại hai từ", "xuất hiện đúng một lần"],
  ])("rejects %s motion anchors", (_label, anchor, expected) => {
    const narration = "Cụm lặp lại hai từ rồi cụm lặp lại hai từ xuất hiện lần nữa.";
    const parsed = ContentPlanSchema.safeParse(validPlan({
      scenes: [{
        ...validPlan().scenes[0]!,
        narration,
        motionBeats: [
          { id: "first", anchor, action: "Reveal first state" },
          { id: "second", anchor: "xuất hiện lần nữa", action: "Reveal second state" },
        ],
      }],
    }));
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message).join(" ")).toContain(expected);
  });

  it("rejects duplicate ids and out-of-order anchors", () => {
    const parsed = ContentPlanSchema.safeParse(validPlan({
      scenes: [{
        ...validPlan().scenes[0]!,
        narration: "Bước đầu nhận dữ liệu rồi bước sau trả kết quả.",
        motionBeats: [
          { id: "same-id", anchor: "bước sau trả kết quả", action: "Show result" },
          { id: "same-id", anchor: "Bước đầu nhận dữ liệu", action: "Show input" },
        ],
      }],
    }));
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message).join(" ")).toMatch(/id trùng.*theo thứ tự narration/s);
  });

  it("selects only explicitly semantic motion scenes within the requested scope", () => {
    const plan = validPlan({
      scenes: [
        { ...validPlan().scenes[0]!, sceneId: "scene-01", motionBeats: undefined, motionProgression: "Quick entrance, then hold." },
        { ...validPlan().scenes[0]!, sceneId: "scene-02", motionBeats: undefined, motionProgression: "Quick entrance; semantic: reveal step one, then step two; final hold." },
      ],
    });
    expect(semanticMotionSceneIds(plan)).toEqual(["scene-02"]);
    expect(semanticMotionSceneIds(plan, ["scene-01"])).toEqual([]);
  });

  it("prefers structured beats and falls back to semantic labels only for legacy scenes", () => {
    const base = validPlan().scenes[0]!;
    const plan = validPlan({
      scenes: [
        { ...base, sceneId: "scene-01", motionProgression: "Quick entrance, then hold." },
        { ...base, sceneId: "scene-02", motionBeats: undefined, motionProgression: "semantic: reveal one, then two" },
        { ...base, sceneId: "scene-03", motionBeats: undefined, motionProgression: "Quick entrance, then hold." },
      ],
    });
    expect(semanticMotionSceneIds(plan)).toEqual(["scene-01", "scene-02"]);
  });

  it("uses temporalMode instead of regex for plans with explicit review intent", () => {
    const base = validPlan().scenes[0]!;
    const plan = validPlan({
      scenes: [
        { ...base, sceneId: "scene-01", temporalMode: "static", detailMode: "normal" },
        { ...base, sceneId: "scene-02", temporalMode: "continuous", detailMode: "fine" },
      ],
    });
    expect(semanticMotionSceneIds(plan)).toEqual(["scene-02"]);
  });

  it("accepts the content-plan contract shape", () => {
    const parsed = ContentPlanSchema.safeParse(validPlan());
    expect(parsed.success).toBe(true);
  });

  it("keeps legacy and single-state plans valid without structured beats", () => {
    const legacy = validPlan({
      scenes: validPlan().scenes.map((scene) => ({ ...scene, motionBeats: undefined })),
    });
    expect(ContentPlanSchema.safeParse(legacy).success).toBe(true);
    const statement = validPlan({
      scenes: [{
        ...validPlan().scenes[0]!,
        motionBeats: undefined,
        motionProgression: "Quick entrance, then readable hold.",
      }],
    });
    expect(ContentPlanSchema.safeParse(statement).success).toBe(true);
    expect(evaluateContentPlanQuality(statement).blockingIssues).toEqual([]);
  });

  it("requires viewer promise and payoff fields", () => {
    const withoutPromise = { ...validPlan(), viewerPromise: undefined };
    const withoutPayoff = { ...validPlan(), payoff: undefined };
    expect(ContentPlanSchema.safeParse(withoutPromise).success).toBe(false);
    expect(ContentPlanSchema.safeParse(withoutPayoff).success).toBe(false);
  });

  it("requires each scene to carry a motion progression intent", () => {
    const base = validPlan();
    const parsed = ContentPlanSchema.safeParse({
      ...base,
      scenes: [{ ...base.scenes[0]!, motionProgression: undefined }],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path.join(".")).join(" ")).toMatch(/motionProgression/);
  });

  it("rejects scenes that reference omitted or uncertain claims", () => {
    const parsed = ContentPlanSchema.safeParse(
      validPlan({
        scenes: [
          {
            ...validPlan().scenes[0]!,
            evidenceClaimIds: ["claim-02"],
          },
        ],
      }),
    );
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message).join(" ")).toMatch(/supported\/use claims/);
  });

  it("rejects duplicate claim and scene ids", () => {
    const base = validPlan();
    const parsed = ContentPlanSchema.safeParse({
      ...base,
      claims: [base.claims[0], { ...base.claims[0] }],
      scenes: [base.scenes[0], { ...base.scenes[0] }],
    });
    expect(parsed.success).toBe(false);
    const messages = parsed.error?.issues.map((issue) => issue.message).join(" ");
    expect(messages).toMatch(/Duplicate claim id/);
    expect(messages).toMatch(/Duplicate scene id/);
  });

  it("is strict about unknown fields", () => {
    const parsed = ContentPlanSchema.safeParse({ ...validPlan(), extra: true });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message).join(" ")).toMatch(/Unrecognized key/);
  });
});

describe("parseContentPlan", () => {
  it("parses fenced JSON into a content plan", () => {
    const result = parseContentPlan(`\`\`\`json\n${JSON.stringify(validPlan())}\n\`\`\``);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.title).toBe(validPlan().title);
  });

  it("returns a no-json error for replies without a JSON object", () => {
    const result = parseContentPlan("I cannot plan this.");
    expect(result).toMatchObject({ ok: false, reason: "no-json" });
  });

  it("returns an invalid error for malformed content plans", () => {
    const result = parseContentPlan(JSON.stringify({ ...validPlan(), hookType: "generic" }));
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("normalizes bare-string sourceRef by dropping it so parse can continue", () => {
    // Live failure: repair returned sourceRef as a string → schema invalid.
    const base = validPlan();
    const result = parseContentPlan(
      JSON.stringify({
        ...base,
        claims: base.claims.map((claim) =>
          claim.id === "claim-01" ? { ...claim, sourceRef: "source-01" } : claim,
        ),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.claims.find((c) => c.id === "claim-01")?.sourceRef).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ kind: "source-ref-normalized", claimId: "claim-01", reason: "string-dropped" }),
    );
  });

  it("normalizes snake_case source_id/quote into sourceRef object", () => {
    const base = validPlan();
    const result = parseContentPlan(
      JSON.stringify({
        ...base,
        claims: base.claims.map((claim) =>
          claim.id === "claim-01"
            ? {
                ...claim,
                sourceRef: {
                  source_id: "source-01",
                  excerpt: "Năng lực sản xuất chip tiên tiến tập trung vào rất ít nhà máy.",
                },
              }
            : claim,
        ),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.claims.find((c) => c.id === "claim-01")?.sourceRef).toEqual({
      sourceId: "source-01",
      excerpt: "Năng lực sản xuất chip tiên tiến tập trung vào rất ít nhà máy.",
    });
  });

  it("defaults missing evidenceClaimIds to [] so parse does not hard-fail (arXiv model omission)", () => {
    // Live failure 896dc49d: scenes.0/6/11/12 omitted evidenceClaimIds → expected array, received undefined.
    const base = validPlan();
    const scenes = base.scenes.map((scene, index) => {
      if (index === 0 || index === 1) {
        const { evidenceClaimIds: _drop, ...rest } = scene;
        return rest;
      }
      return scene;
    });
    const result = parseContentPlan(JSON.stringify({ ...base, scenes }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.scenes[0]!.evidenceClaimIds).toEqual([]);
    expect(result.plan.scenes[1]!.evidenceClaimIds).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ kind: "evidence-claim-ids-defaulted", reason: "missing" }),
    );
  });

  it("does not normalize hookType or layoutFamily drift without evidence", () => {
    const base = validPlan();
    const result = parseContentPlan(
      JSON.stringify({
        ...base,
        hookType: "statement",
        scenes: [{ ...base.scenes[0]!, layoutFamily: "split-screen" }],
      }),
    );

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    if (!result.ok) {
      expect(result.detail).toMatch(/hookType/);
      expect(result.detail).toMatch(/layoutFamily/);
    }
  });

  it("normalizes non-safety purpose drift instead of failing the content plan", () => {
    const result = parseContentPlan(INVALID_PURPOSE_CONTENT_PLAN_REPLY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.scenes.map((scene) => scene.purpose)).toEqual(["hook", "context", "turn"]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ kind: "purpose-normalized", sceneId: "scene-02", original: "definition", normalized: "context" }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ kind: "purpose-normalized", sceneId: "scene-03", original: "mechanism", normalized: "turn" }),
    );
  });

  it("defaults missing or generic motion intent with non-blocking diagnostics", () => {
    const result = parseContentPlan(INVALID_PURPOSE_CONTENT_PLAN_REPLY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.scenes[1]!.motionProgression).toBe("Quick entrance, then readable hold.");
    expect(result.plan.scenes[2]!.motionProgression).toBe("Quick entrance, then readable hold.");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ kind: "motion-defaulted", sceneId: "scene-02", reason: "generic", original: "Text appears." }),
    );
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ kind: "motion-defaulted", sceneId: "scene-03", reason: "missing" }));
  });

  it("still rejects content plans that violate evidence safety after normalization", () => {
    const unsafe = JSON.parse(INVALID_PURPOSE_CONTENT_PLAN_REPLY) as Record<string, unknown>;
    unsafe.claims = [{ id: "claim-01", text: "Unsupported 500-cycle claim.", support: "source_material", confidence: "uncertain", action: "omit" }];
    unsafe.scenes = [
      {
        ...((unsafe.scenes as Record<string, unknown>[])[0] ?? {}),
        narration: "The prototype reached 500 cycles in 2026.",
        onScreenText: "500 cycles",
        evidenceClaimIds: ["claim-01"],
      },
    ];

    const result = parseContentPlan(JSON.stringify(unsafe));

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    if (!result.ok) expect(result.detail).toMatch(/supported\/use claims/);
  });
});

describe("content-plan helpers", () => {
  it("keeps only supported/use claims for later code-authoring input", () => {
    const plan = validPlan({
      claims: [
        ...validPlan().claims,
        {
          id: "claim-03",
          text: "Unverified 500-cycle breakthrough.",
          support: "source_material",
          confidence: "uncertain",
          action: "omit",
        },
      ],
    });
    expect(usableClaims(plan).map((claim) => claim.id)).toEqual(["claim-01"]);
    const filtered = contentPlanForAuthoring(plan);
    expect(filtered.claims.map((claim) => claim.id)).toEqual(["claim-01"]);
    expect(filtered.scenes[0]!.motionProgression).toContain("factory gate closes");
    expect(JSON.stringify(filtered)).not.toContain("claim-02");
    expect(JSON.stringify(filtered)).not.toContain("500-cycle");
  });
});

describe("content quality eval fixtures", () => {
  it.each([
    ["missing modes", (scene: ContentPlan["scenes"][number]) => ({ ...scene, temporalMode: "stepped" as const, detailMode: undefined })],
    ["static with beats", (scene: ContentPlan["scenes"][number]) => ({ ...scene, temporalMode: "static" as const, detailMode: "normal" as const })],
    ["stepped without beats", (scene: ContentPlan["scenes"][number]) => ({ ...scene, temporalMode: "stepped" as const, detailMode: "normal" as const, motionBeats: undefined, motionProgression: "Quick entrance, then hold." })],
  ])("blocks generated review intent with %s", (_label, mutate) => {
    const plan = validPlan({ scenes: [mutate(validPlan().scenes[0]!)] });
    expect(evaluateContentPlanQuality(plan).blockingIssues).toContainEqual(
      expect.objectContaining({ check: "review-intent", sceneId: "scene-01" }),
    );
  });

  it("accepts valid static, stepped and continuous review intent", () => {
    const base = validPlan().scenes[0]!;
    const plan = validPlan({
      scenes: [
        { ...base, sceneId: "scene-01", temporalMode: "static", detailMode: "normal", motionBeats: undefined, motionProgression: "Quick entrance, then hold." },
        { ...base, sceneId: "scene-02", purpose: "context", temporalMode: "stepped", detailMode: "normal" },
        { ...base, sceneId: "scene-03", purpose: "payoff", temporalMode: "continuous", detailMode: "fine" },
      ],
    });
    expect(evaluateContentPlanQuality(plan).blockingIssues.filter((issue) => issue.check === "review-intent")).toEqual([]);
  });

  it("incident fixture: concrete facts without usable evidence claim ids stay claim-ledger blocking", () => {
    const parsed = ContentPlanSchema.safeParse(CLAIM_LEDGER_MISSING_EVIDENCE_PLAN);
    expect(parsed.success).toBe(true);

    const quality = evaluateContentPlanQuality(CLAIM_LEDGER_MISSING_EVIDENCE_PLAN);

    expect(quality.blockingIssues).toContainEqual(
      expect.objectContaining({ check: "claim-ledger", severity: "blocking", sceneId: "scene-01" }),
    );
  });

  it("accepts a parsed strong plan with hook, payoff, evidence, and layout variety", () => {
    const plan = validPlan({
      scenes: [
        validPlan().scenes[0]!,
        {
          sceneId: "scene-02",
          purpose: "context",
          beat: "Show why capacity, not hype, is the bottleneck.",
          narration: "Khi chỉ vài nơi có thể sản xuất ở cấp này, mỗi đơn hàng phải xếp hàng trước một cánh cửa hẹp.",
          onScreenText: "Năng lực mới là cổ chai",
          visualMetaphor: "A narrowing timeline of chips waiting at one production gate.",
          motionProgression: "Quick entrance: one chip enters the timeline; semantic: the path narrows into a gate; final hold when the queue stalls at the narrowest point.",
          motionBeats: [
            { id: "show-capacity", anchor: "vài nơi có thể sản xuất", action: "Reveal the limited factories" },
            { id: "narrow-gate", anchor: "một cánh cửa hẹp", action: "Narrow the production gate" },
          ],
          layoutFamily: "timeline",
          evidenceClaimIds: ["claim-01"],
        },
        {
          sceneId: "scene-03",
          purpose: "payoff",
          beat: "Resolve the open loop with the scarcity takeaway.",
          narration: "Vì vậy thứ đắt nhất không phải miếng silicon, mà là năng lực biến thiết kế thành hàng thật.",
          onScreenText: "Đắt vì biến ý tưởng thành hàng thật",
          visualMetaphor: "Blueprint lines turning into one finished glowing chip.",
          motionProgression: "Quick entrance: blueprint frame appears; semantic: traces brighten into one finished chip; living: a small glow pulse continues through the payoff.",
          motionBeats: [
            { id: "show-silicon", anchor: "không phải miếng silicon", action: "Dim the raw silicon" },
            { id: "finish-chip", anchor: "thiết kế thành hàng thật", action: "Turn the blueprint into a finished chip" },
          ],
          layoutFamily: "diagram",
          evidenceClaimIds: ["claim-01"],
        },
      ],
    });
    const parsed = parseContentPlan(JSON.stringify(plan));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const quality = evaluateContentPlanQuality(parsed.plan);
      expect(quality.issues).toEqual([]);
      expect(quality.blockingIssues).toEqual([]);
      expect(quality.advisoryIssues).toEqual([]);
    }
  });

  it("splits schema-valid weak plans into blocking and advisory issues", () => {
    const weak = validPlan({
      scenes: [
        {
          ...validPlan().scenes[0]!,
          purpose: "context",
          narration: "The prototype reached 500 cycles, which changes the whole battery race.",
          motionBeats: undefined,
          motionProgression: "Quick entrance, then readable hold.",
          onScreenText: "500 cycles",
          layoutFamily: "statement",
          evidenceClaimIds: [],
        },
        {
          ...validPlan().scenes[1]!,
          sceneId: "scene-02",
          layoutFamily: "statement",
          evidenceClaimIds: [],
        },
        {
          ...validPlan().scenes[1]!,
          sceneId: "scene-03",
          layoutFamily: "statement",
          evidenceClaimIds: [],
        },
      ],
    });
    const parsed = ContentPlanSchema.safeParse(weak);
    expect(parsed.success).toBe(true);
    const quality = evaluateContentPlanQuality(weak);
    const blockingChecks = quality.blockingIssues.map((issue) => issue.check);
    const advisoryChecks = quality.advisoryIssues.map((issue) => issue.check);

    expect(blockingChecks).toContain("hook");
    expect(blockingChecks).toContain("claim-ledger");
    expect(blockingChecks).not.toContain("layout-diversity");
    expect(advisoryChecks).toContain("layout-diversity");
    expect(quality.issues.every((issue) => issue.severity === "blocking" || issue.severity === "advisory")).toBe(true);
  });

  it("does not block concept-explainer structural numbers that are not source-like measurements", () => {
    const plan = validPlan({
      claims: [],
      scenes: [
        {
          ...validPlan().scenes[0]!,
          narration: "Một cây có thể học vẹt; 100 cây cùng bỏ phiếu thì ổn định hơn.",
          onScreenText: "100 cây bỏ phiếu",
          visualMetaphor: "A forest of simple decision trees casting small votes.",
          layoutFamily: "signature-visual",
          evidenceClaimIds: [],
        },
        {
          ...validPlan().scenes[1]!,
          sceneId: "scene-02",
          purpose: "context",
          narration: "Mỗi cây học theo 2 lát cắt ngẫu nhiên: một phần dữ liệu và một phần đặc trưng.",
          onScreenText: "2 lát cắt",
          visualMetaphor: "Two shuffled decks feeding different trees.",
          layoutFamily: "diagram",
          evidenceClaimIds: [],
        },
        {
          ...validPlan().scenes[1]!,
          sceneId: "scene-03",
          purpose: "payoff",
          narration: "Khi các cây không giống hệt nhau, lá phiếu chung thường bớt lệch hơn một cây đơn lẻ.",
          onScreenText: "Đa số làm mượt sai lệch",
          visualMetaphor: "Votes collecting into one calmer final answer.",
          layoutFamily: "timeline",
          evidenceClaimIds: [],
        },
      ],
    });

    const quality = evaluateContentPlanQuality(plan);

    expect(quality.blockingIssues).toEqual([]);
    expect(quality.issues).not.toContainEqual(expect.objectContaining({ check: "claim-ledger" }));
  });

  it("still blocks benchmark/source-like measurements without evidence", () => {
    const plan = validPlan({
      scenes: [
        {
          ...validPlan().scenes[0]!,
          narration: "The prototype reached 500 cycles, according to early lab notes.",
          onScreenText: "500 cycles",
          evidenceClaimIds: [],
        },
        validPlan().scenes[1]!,
      ],
    });

    const quality = evaluateContentPlanQuality(plan);

    expect(quality.blockingIssues).toContainEqual(
      expect.objectContaining({ check: "claim-ledger", severity: "blocking", sceneId: "scene-01" }),
    );
  });

  it("treats layout diversity as authoring guidance, not a blocking plan failure", () => {
    const plan = validPlan({
      scenes: [
        { ...validPlan().scenes[0]!, layoutFamily: "statement" },
        { ...validPlan().scenes[1]!, layoutFamily: "statement" },
        { ...validPlan().scenes[1]!, sceneId: "scene-03", purpose: "payoff", layoutFamily: "statement" },
      ],
    });
    const quality = evaluateContentPlanQuality(plan);

    expect(quality.blockingIssues).toEqual([]);
    expect(quality.advisoryIssues).toContainEqual(expect.objectContaining({ check: "layout-diversity", severity: "advisory" }));
  });

  it("flags generic motion intent that would become an intro-only text reveal", () => {
    const weak = validPlan({
      scenes: [
        {
          ...validPlan().scenes[0]!,
          motionProgression: "Text appears.",
        },
      ],
    });
    expect(ContentPlanSchema.safeParse(weak).success).toBe(true);
    expect(evaluateContentPlanQuality(weak).advisoryIssues).toContainEqual(
      expect.objectContaining({ check: "motion-progression", severity: "advisory", sceneId: "scene-01" }),
    );
  });

  it("blocks fresh semantic plans that omit structured motion beats", () => {
    const plan = validPlan({
      scenes: [{
        ...validPlan().scenes[0]!,
        motionBeats: undefined,
        motionProgression: "Quick entrance; semantic: reveal step one, then step two; final hold.",
      }],
    });
    expect(ContentPlanSchema.safeParse(plan).success).toBe(true);
    expect(evaluateContentPlanQuality(plan).blockingIssues).toContainEqual(
      expect.objectContaining({ check: "motion-beats", severity: "blocking", sceneId: "scene-01" }),
    );
  });

  it("accepts quick reveal, living motion, and final hold as specific motion intent", () => {
    const plan = validPlan({
      scenes: [
        {
          ...validPlan().scenes[0]!,
          motionProgression:
            "Quick entrance: title pops in under half a second; living: a small signal pulse continues behind the icon; final hold once the claim lands.",
        },
      ],
    });

    const quality = evaluateContentPlanQuality(plan);

    expect(quality.advisoryIssues).not.toContainEqual(expect.objectContaining({ check: "motion-progression" }));
    expect(quality.blockingIssues).toEqual([]);
  });

  it("flags a tier-3 TikTok plan that collapses 2m30s into six long scenes", () => {
    const plan = validPlan({
      scenes: Array.from({ length: 6 }, (_, index) => pacingScene(index + 1, 6, 110)),
    });
    const issues = evaluateContentPlanQuality(
      plan,
      computePacingBudget({ format: "tiktok", durationTier: 3, videoLanguage: "vi" }),
    );
    const pacingIssues = issues.blockingIssues.filter((issue) => issue.check === "pacing");

    expect(pacingIssues.map((issue) => issue.message).join(" ")).toMatch(/at least 10 scenes/);
    expect(pacingIssues.map((issue) => issue.message).join(" ")).toMatch(/average narration/);
    expect(pacingIssues).toContainEqual(expect.objectContaining({ sceneId: "scene-01" }));
  });
});

describe("buildContentPlanMessages", () => {
  it("builds a TikTok Vietnamese no-source planning prompt", () => {
    const messages = buildContentPlanMessages({ text: "Giải thích vì sao cà phê làm tôi tập trung", urls: [] });
    expect(messages).toHaveLength(2);
    expect(typeof messages[0]!.content).toBe("string");
    expect(typeof messages[1]!.content).toBe("string");

    const system = messages[0]!.content as string;
    const user = messages[1]!.content as string;
    expect(system).toMatch(/CONTENT PLANNER/);
    expect(system).toMatch(/TikTok\/Reels\/Shorts 9:16/);
    expect(system).toMatch(/Vietnamese/);
    expect(system).toMatch(/45 seconds/);
    expect(system).toMatch(/viewerPromise/);
    expect(system).toMatch(/first3SecondsLine/);
    expect(system).toMatch(/Claim|CLAIM LEDGER/);
    expect(system).toMatch(/Small structural\/example counts/);
    expect(system).toMatch(/Weak:[\s\S]*Strong:/);
    expect(system).toMatch(/visualMetaphor/);
    expect(system).toMatch(/motionProgression/);
    expect(system).toMatch(/motion intent/);
    expect(system).toMatch(/quick entrance/i);
    expect(system).toMatch(/semantic progression/);
    expect(system).toMatch(/2-4 motionBeats/);
    expect(system).toMatch(/single entrance, glow, ambient loop, or highlight is not semantic/);
    expect(system).toMatch(/temporalMode/);
    expect(system).toMatch(/static\|stepped\|continuous/);
    expect(system).toMatch(/detailMode/);
    expect(system).toMatch(/normal\|fine/);
    expect(system).toMatch(/Continuous terminal\/chart/);
    expect(system).toMatch(/Fine-detail evidence/);
    expect(system).toMatch(/living motion/);
    expect(system).toMatch(/schema-critical enum fields/);
    expect(system).toMatch(/Do not invent synonyms for hookType, purpose, support, confidence, action, or layoutFamily/);
    expect(system).toMatch(/use exactly one literal value/);
    expect(system).toMatch(/If unsure after scene-01/);
    expect(system).not.toMatch(/early\/mid\/late/);
    expect(system).toMatch(/Avoid generic "text appears"/);
    expect(system).toMatch(/QUALITY SELF-CHECK BEFORE FINAL JSON/);
    expect(system).toMatch(/at least 2 distinct layoutFamily/);
    expect(system).toMatch(/action:"omit" claims are safety notes only/);
    expect(system).not.toMatch(/registerComponent|@motionreal\/compositions|```tsx/);
    expect(user).toContain("No external source material was provided");
    expect(user).toContain("Giải thích vì sao cà phê");
  });

  it("gives 210-second plans a soft 14-16 scene preference", () => {
    const [system] = buildContentPlanMessages({
      text: "Giải thích một quy trình dài",
      urls: [],
      durationTier: 4,
      targetSeconds: 210,
    });
    expect(system!.content).toMatch(/prefer about 14-16 meaningful scenes/);
    expect(system!.content).toMatch(/soft target/);
    expect(system!.content).toMatch(/never split one coherent beat merely to hit a count/);
  });

  it("builds an English short-form prompt with readable source material", () => {
    const messages = buildContentPlanMessages(
      { text: "Make a video about the battery breakthrough", urls: ["https://example.com/research"], format: "tiktok", videoLanguage: "en" },
      "The source says the prototype reached 500 cycles in lab tests.",
    );
    const system = messages[0]!.content as string;
    const user = messages[1]!.content as string;
    expect(system).toMatch(/9:16 vertical|TikTok\/Reels\/Shorts 9:16/);
    expect(system).toMatch(/English/);
    expect(system).toMatch(/45 seconds/);
    expect(system).toMatch(/under 100 characters/);
    expect(user).toContain("https://example.com/research");
    expect(user).toContain("Readable source material");
    expect(user).toContain("500 cycles");
  });

  it("uses the local Anthropic article snapshot as repeatable source material", () => {
    const messages = buildContentPlanMessages(
      {
        text: "Summarize the Anthropic Fable safeguards article",
        urls: ["https://www.anthropic.com/news/fable-safeguards-jailbreak-framework"],
        format: "tiktok",
        durationTier: 3,
        videoLanguage: "en",
      },
      ANTHROPIC_FABLE_SAFEGUARDS_SNAPSHOT,
    );

    const user = messages[1]!.content as string;
    expect(user).toContain("Readable source material");
    expect(user).toContain("source_url: https://www.anthropic.com/news/fable-safeguards-jailbreak-framework");
    expect(user).toContain("Cyber Jailbreak Severity");
    expect(user).toContain("Return only the content-plan JSON object");
  });

  it("warns when URLs exist but no source material was readable", () => {
    const messages = buildContentPlanMessages({ text: "Summarize this", urls: ["https://example.com/missing"], videoLanguage: "en" });
    const user = messages[1]!.content as string;
    expect(user).toContain("URL content could not be read");
    expect(user).toMatch(/Do not invent numbers, dates, prices/);
  });

  it("carries approved image refs as multimodal parts without inventing image paths", () => {
    const messages = buildContentPlanMessages({ text: "Plan a launch video", urls: [] }, undefined, [image]);
    expect(messages).toHaveLength(2);
    const parts = messages[1]!.content as ContentPart[];
    expect(Array.isArray(parts)).toBe(true);
    expect(parts.filter((part) => part.type === "image_url")).toHaveLength(1);
    expect(parts.some((part) => part.type === "image_url" && part.image_url.url === image.dataUrl)).toBe(true);
    const text = textOf(parts);
    expect(text).toContain("Approved image refs are fixed");
    expect(text).toContain("assets/product.png");
    expect(text).toContain("1200x800");
    expect(text).toMatch(/do not invent new refs/i);
  });

  it("honors duration tier, language, and injected speech rate in the planning budget", () => {
    const messages = buildContentPlanMessages(
      { text: "Create a punchy explainer", urls: [], format: "tiktok", durationTier: 3, videoLanguage: "en" },
      undefined,
      undefined,
      3.2,
    );
    const system = messages[0]!.content as string;
    expect(system).toContain("150 seconds");
    expect(system).toContain("480 spoken words");
    expect(system).toContain("~3.2 words/second");
    expect(system).toContain("10-14 scenes");
    expect(system).toContain("average narration at or below 75 words/scene");
  });
});

describe("buildContentPlanRepairMessages", () => {
  it("targets claim-ledger repair without weakening evidence rules", () => {
    const messages = buildContentPlanRepairMessages(CLAIM_LEDGER_MISSING_EVIDENCE_PLAN, [
      {
        check: "claim-ledger",
        severity: "blocking",
        sceneId: "scene-01",
        message: "number/date/price/source-like claims must reference usable evidenceClaimIds",
      },
    ]);
    const text = messages.map((message) => message.content).join("\n");

    expect(text).toContain("CONTENT PLAN REPAIR");
    expect(text).toContain("claim-ledger @scene-01");
    expect(text).toContain("confidence:\"supported\" and action:\"use\"");
    expect(text).toContain("remove the concrete detail");
    expect(text).toContain("Do not make uncertain/omit claims supported");
    expect(text).toContain(JSON.stringify(CLAIM_LEDGER_MISSING_EVIDENCE_PLAN, null, 2));
    expect(text).toContain("Return the full repaired content-plan JSON object only");
  });

  it("teaches object sourceRef shape and includes labeled sources for claim-provenance repair", () => {
    const messages = buildContentPlanRepairMessages(
      validPlan(),
      [
        {
          check: "claim-provenance",
          severity: "blocking",
          message: "usable source_material claim claim-01 requires sourceRef",
        },
      ],
      [
        {
          id: "source-01",
          metadata: { sourceUrl: "https://example.com/a" },
          body: "The company reported revenue of twelve billion dollars last year according to its annual filing.",
        },
      ],
    );
    const text = messages.map((message) => (typeof message.content === "string" ? message.content : "")).join("\n");
    expect(text).toContain("sourceRef");
    expect(text).toContain("OBJECT");
    expect(text).toContain("Never set sourceRef to a bare string");
    expect(text).toContain('id="source-01"');
    expect(text).toContain("twelve billion dollars");
    expect(text).toContain("UNTRUSTED SOURCE MATERIAL");
  });
});

describe("buildContentPlanMessages provenance labeling", () => {
  it("includes labeled source ids and sourceRef object rules when sources exist", () => {
    const messages = buildContentPlanMessages(
      { text: "Summarize this launch", urls: ["https://example.com/a"], videoLanguage: "en" },
      undefined,
      undefined,
      undefined,
      [
        {
          id: "source-01",
          metadata: { sourceUrl: "https://example.com/a", title: "Launch" },
          body: "Reflect with Claude helps users review conversations over time with privacy controls.",
        },
      ],
    );
    const system = messages[0]!.content as string;
    const user = messages[1]!.content as string;
    expect(system).toContain("sourceRef");
    expect(system).toContain("sourceId");
    expect(system).toMatch(/never a bare string/i);
    expect(user).toContain('id="source-01"');
    expect(user).toContain("Reflect with Claude");
    expect(user).toContain("UNTRUSTED SOURCE MATERIAL");
  });
});
