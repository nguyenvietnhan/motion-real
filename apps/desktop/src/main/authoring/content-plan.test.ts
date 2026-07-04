import { describe, expect, it } from "vitest";
import {
  buildContentPlanMessages,
  ContentPlanSchema,
  contentPlanForAuthoring,
  evaluateContentPlanQuality,
  parseContentPlan,
  usableClaims,
  type ContentPlan,
} from "./content-plan.js";
import type { ContentPart } from "./prompt.js";

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

describe("ContentPlanSchema", () => {
  it("accepts the content-plan contract shape", () => {
    const parsed = ContentPlanSchema.safeParse(validPlan());
    expect(parsed.success).toBe(true);
  });

  it("requires viewer promise and payoff fields", () => {
    const withoutPromise = { ...validPlan(), viewerPromise: undefined };
    const withoutPayoff = { ...validPlan(), payoff: undefined };
    expect(ContentPlanSchema.safeParse(withoutPromise).success).toBe(false);
    expect(ContentPlanSchema.safeParse(withoutPayoff).success).toBe(false);
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
    expect(JSON.stringify(filtered)).not.toContain("claim-02");
    expect(JSON.stringify(filtered)).not.toContain("500-cycle");
  });
});

describe("content quality eval fixtures", () => {
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
          layoutFamily: "diagram",
          evidenceClaimIds: ["claim-01"],
        },
      ],
    });
    const parsed = parseContentPlan(JSON.stringify(plan));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(evaluateContentPlanQuality(parsed.plan)).toEqual([]);
    }
  });

  it("flags schema-valid but weak plans missing hook, evidence, and layout diversity", () => {
    const weak = validPlan({
      scenes: [
        {
          ...validPlan().scenes[0]!,
          purpose: "context",
          narration: "The prototype reached 500 cycles, which changes the whole battery race.",
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
    const checks = evaluateContentPlanQuality(weak).map((issue) => issue.check);
    expect(checks).toContain("hook");
    expect(checks).toContain("claim-ledger");
    expect(checks).toContain("layout-diversity");
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
    expect(system).toMatch(/Weak:[\s\S]*Strong:/);
    expect(system).toMatch(/visualMetaphor/);
    expect(system).toMatch(/QUALITY GATE BEFORE FINAL JSON/);
    expect(system).toMatch(/at least 2 distinct layoutFamily/);
    expect(system).toMatch(/action:"omit" claims are safety notes only/);
    expect(system).not.toMatch(/registerComponent|@motionreal\/compositions|```tsx/);
    expect(user).toContain("No external source material was provided");
    expect(user).toContain("Giải thích vì sao cà phê");
  });

  it("builds a YouTube English prompt with readable source material", () => {
    const messages = buildContentPlanMessages(
      { text: "Make a video about the battery breakthrough", urls: ["https://example.com/research"], format: "youtube", videoLanguage: "en" },
      "The source says the prototype reached 500 cycles in lab tests.",
    );
    const system = messages[0]!.content as string;
    const user = messages[1]!.content as string;
    expect(system).toMatch(/YouTube 16:9 horizontal/);
    expect(system).toMatch(/English/);
    expect(system).toMatch(/300 seconds/);
    expect(system).toMatch(/under 200 characters/);
    expect(user).toContain("https://example.com/research");
    expect(user).toContain("Readable source material");
    expect(user).toContain("500 cycles");
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
  });
});
