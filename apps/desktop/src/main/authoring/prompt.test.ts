import { describe, expect, it } from "vitest";
import {
  buildAuthorMessages,
  buildAuthorModuleBatchMessages,
  buildImageFilterMessages,
  buildMissingTsxRecoveryMessages,
  buildReauthorMessages,
  buildVisualQaMessages,
  type ContentPart,
} from "./prompt.js";
import { contentPlanForAuthoring, type ContentPlan } from "./content-plan.js";

/**
 * — prompt builders carry the full Authoring_Contract
 * + author-reply contract (author) and a single-scene repair request (reauthor,
 * optionally multimodal).
 */

function contentShape(content: string | ContentPart[]): { kind: "text" | "parts"; textParts: number; imageParts: number } {
  if (typeof content === "string") return { kind: "text", textParts: 0, imageParts: 0 };
  return {
    kind: "parts",
    textParts: content.filter((p) => p.type === "text").length,
    imageParts: content.filter((p) => p.type === "image_url").length,
  };
}

function promptShape(messages: { role: string; content: string | ContentPart[] }[]): Array<ReturnType<typeof contentShape> & { role: string }> {
  return messages.map((m) => ({ role: m.role, ...contentShape(m.content) }));
}

function contentText(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join("\n");
}

function promptText(messages: { content: string | ContentPart[] }[]): string {
  return messages.map((m) => contentText(m.content)).join("\n");
}

function expectContainsInOrder(text: string, anchors: string[]): void {
  let previous = -1;
  for (const anchor of anchors) {
    const current = text.indexOf(anchor);
    expect(current, `Expected prompt to contain "${anchor}"`).toBeGreaterThanOrEqual(0);
    expect(current, `Expected "${anchor}" to appear after the previous section marker`).toBeGreaterThan(previous);
    previous = current;
  }
}

const PROMPT_SIZE_BASELINES = {
  mainAuthor: 19539,
  tsxBatch: 19056,
  missingTsxRecovery: 13483,
  reauthor: 13818,
  visualQa: 1305,
} as const;

function expectPromptSizeNearBaseline(name: keyof typeof PROMPT_SIZE_BASELINES, messages: { content: string | ContentPart[] }[]): void {
  const actual = promptText(messages).length;
  const baseline = PROMPT_SIZE_BASELINES[name];

  expect(actual, `${name} prompt should not accidentally disappear`).toBeGreaterThanOrEqual(Math.floor(baseline * 0.5));
  expect(actual, `${name} prompt grew more than 10% from the recorded baseline`).toBeLessThanOrEqual(Math.ceil(baseline * 1.1));
}

describe("prompt surface baseline", () => {
  it("records stable message/part shapes and semantic anchors for every prompt builder", () => {
    const image = { ref: "assets/a.png", width: 800, height: 600, dataUrl: "data:image/png;base64,AAA" };
    const stills = [
      { sceneId: "scene-01", stillDataUrl: "data:image/png;base64,AAA" },
      { sceneId: "scene-02", stillDataUrl: "data:image/png;base64,BBB" },
    ];
    const authorTextOnly = buildAuthorMessages({ text: "Chủ đề baseline", urls: [] });
    const authorWithResearch = buildAuthorMessages({ text: "Tóm tắt link", urls: ["https://example.com/a"] }, "tư liệu baseline");
    const authorWithImages = buildAuthorMessages({ text: "Chủ đề có ảnh", urls: [] }, undefined, [image]);
    const reauthorTextOnly = buildReauthorMessages({
      sceneId: "scene-01",
      componentId: "alpha",
      currentCode: "// component: alpha\nexport default 1;",
      intent: "sửa nhẹ",
    });
    const reauthorWithStill = buildReauthorMessages({
      sceneId: "scene-01",
      componentId: "alpha",
      currentCode: "// component: alpha\nexport default 1;",
      issues: [{ check: "N14", severity: "error", message: "tràn chữ" }],
      stillDataUrl: "data:image/png;base64,AAA",
    });
    const missingTsxRecovery = buildMissingTsxRecoveryMessages({
      manifest: { title: "T", theme: { dominant: "#1E9CB0" }, scenes: [{ component: "beta", headline: "B", narration: "N" }] },
      missingComponentIds: ["beta"],
      existingComponentIds: ["alpha"],
    });
    const moduleBatch = buildAuthorModuleBatchMessages({
      input: { text: "Chủ đề batch", urls: [], format: "tiktok", durationTier: 3 },
      manifest: {
        title: "Batch",
        theme: { dominant: "#1E9CB0" },
        scenes: [
          { component: "scene-01", eyebrow: "HOOK", headline: "Một", narration: "Câu một.", props: {} },
          { component: "scene-02", eyebrow: "PAYOFF", headline: "Hai", narration: "Câu hai.", props: {} },
        ],
      },
      componentIds: ["scene-02"],
      batchIndex: 1,
      batchCount: 2,
      contentPlan: {
        title: "Batch",
        viewerPromise: "Promise",
        hookType: "surprise",
        first3SecondsLine: "Hook",
        openLoop: "Loop",
        payoff: "Payoff",
        claims: [],
        scenes: [
          {
            sceneId: "scene-01",
            purpose: "hook",
            beat: "Beat one",
            narration: "Câu một.",
            onScreenText: "Một",
            visualMetaphor: "Signal",
            motionProgression: "Quick entrance then hold.",
            layoutFamily: "statement",
            evidenceClaimIds: [],
          },
          {
            sceneId: "scene-02",
            purpose: "payoff",
            beat: "Beat two",
            narration: "Câu hai.",
            onScreenText: "Hai",
            visualMetaphor: "Gate",
            motionProgression: "Quick entrance then hold.",
            layoutFamily: "diagram",
            evidenceClaimIds: [],
          },
        ],
      },
    });
    const visualQa = buildVisualQaMessages(stills);
    const imageFilter = buildImageFilterMessages("Bài nói về sự kiện X", [image]);

    expect({
      authorTextOnly: promptShape(authorTextOnly),
      authorWithResearch: promptShape(authorWithResearch),
      authorWithImages: promptShape(authorWithImages),
      reauthorTextOnly: promptShape(reauthorTextOnly),
      reauthorWithStill: promptShape(reauthorWithStill),
      missingTsxRecovery: promptShape(missingTsxRecovery),
      moduleBatch: promptShape(moduleBatch),
      visualQa: promptShape(visualQa),
      imageFilter: promptShape(imageFilter),
    }).toEqual({
      authorTextOnly: [
        { role: "system", kind: "text", textParts: 0, imageParts: 0 },
        { role: "user", kind: "text", textParts: 0, imageParts: 0 },
      ],
      authorWithResearch: [
        { role: "system", kind: "text", textParts: 0, imageParts: 0 },
        { role: "user", kind: "text", textParts: 0, imageParts: 0 },
      ],
      authorWithImages: [
        { role: "system", kind: "text", textParts: 0, imageParts: 0 },
        { role: "user", kind: "parts", textParts: 2, imageParts: 1 },
      ],
      reauthorTextOnly: [
        { role: "system", kind: "text", textParts: 0, imageParts: 0 },
        { role: "user", kind: "text", textParts: 0, imageParts: 0 },
      ],
      reauthorWithStill: [
        { role: "system", kind: "text", textParts: 0, imageParts: 0 },
        { role: "user", kind: "parts", textParts: 1, imageParts: 1 },
      ],
      missingTsxRecovery: [
        { role: "system", kind: "text", textParts: 0, imageParts: 0 },
        { role: "user", kind: "text", textParts: 0, imageParts: 0 },
      ],
      moduleBatch: [
        { role: "system", kind: "text", textParts: 0, imageParts: 0 },
        { role: "user", kind: "text", textParts: 0, imageParts: 0 },
      ],
      visualQa: [
        { role: "system", kind: "text", textParts: 0, imageParts: 0 },
        { role: "user", kind: "parts", textParts: 4, imageParts: 2 },
      ],
      imageFilter: [
        { role: "system", kind: "text", textParts: 0, imageParts: 0 },
        { role: "user", kind: "parts", textParts: 3, imageParts: 1 },
      ],
    });
    expect(promptText(authorTextOnly)).toEqual(expect.stringContaining("AI_Output_Contract"));
    expect(promptText(authorTextOnly)).toEqual(expect.stringContaining("registerComponent"));
    // Code authoring must not embed raw research bodies.
    expect(promptText(authorWithResearch)).toEqual(expect.stringContaining("CONTENT PLAN"));
    expect(promptText(authorWithResearch)).not.toEqual(expect.stringContaining("tư liệu baseline"));
    expect(promptText(authorWithImages)).toEqual(expect.stringContaining("chỉ dùng subset thực sự đóng góp nội dung"));
    expect(promptText(authorWithImages)).toEqual(expect.stringContaining('ref="assets/a.png"'));
    expect(promptText(reauthorTextOnly)).toEqual(expect.stringContaining("BẢO TOÀN"));
    expect(promptText(reauthorTextOnly)).toEqual(expect.stringContaining("sửa nhẹ"));
    expect(promptText(reauthorWithStill)).toEqual(expect.stringContaining("tràn chữ"));
    expect(promptText(reauthorWithStill)).toEqual(expect.stringContaining("Ảnh render hiện tại"));
    expect(promptText(missingTsxRecovery)).toEqual(expect.stringContaining("Manifest đã hợp lệ"));
    expect(promptText(missingTsxRecovery)).toEqual(expect.stringContaining("CHỈ viết các id này"));
    expect(promptText(moduleBatch)).toEqual(expect.stringContaining("MANIFEST SCENES CỦA BATCH NÀY"));
    expect(promptText(moduleBatch)).toEqual(expect.stringContaining("Batch 1/2"));
    expect(promptText(visualQa)).toEqual(expect.stringContaining("LỖI BỐ CỤC RÕ RÀNG"));
    expect(promptText(visualQa)).toEqual(expect.stringContaining('Cảnh "scene-02"'));
    expect(promptText(imageFilter)).toEqual(expect.stringContaining("video ngắn đa chủ đề"));
    expect(promptText(imageFilter)).toEqual(expect.stringContaining("assets/a.png"));
    expect(promptText(imageFilter)).toEqual(expect.stringContaining('"keep"'));
  });
});

describe("prompt size budget snapshots", () => {
  it("records approximate text budgets for authoring prompt builders", () => {
    const manifest = {
      title: "Batch",
      theme: { dominant: "#1E9CB0" },
      scenes: [
        { component: "scene-01", eyebrow: "HOOK", headline: "Một", narration: "Câu một.", props: {} },
        { component: "scene-02", eyebrow: "POINT", headline: "Hai", narration: "Câu hai.", props: {} },
        { component: "scene-03", eyebrow: "PAYOFF", headline: "Ba", narration: "Câu ba.", props: {} },
      ],
    };
    const contentPlan: ContentPlan = {
      title: "Batch",
      viewerPromise: "Promise",
      hookType: "surprise",
      first3SecondsLine: "Hook",
      openLoop: "Loop",
      payoff: "Payoff",
      claims: [
        { id: "claim-01", text: "Claim for scene one only.", support: "source_material", confidence: "supported", action: "use" },
        { id: "claim-02", text: "Claim for selected scene two.", support: "source_material", confidence: "supported", action: "use" },
        { id: "claim-03", text: "Claim for selected scene three.", support: "source_material", confidence: "supported", action: "use" },
      ],
      scenes: [
        {
          sceneId: "scene-01",
          purpose: "hook",
          beat: "Beat one",
          narration: "Câu một.",
          onScreenText: "Một",
          visualMetaphor: "One visual",
          motionProgression: "Quick entrance then hold.",
          layoutFamily: "statement",
          evidenceClaimIds: ["claim-01"],
        },
        {
          sceneId: "scene-02",
          purpose: "context",
          beat: "Beat two",
          narration: "Câu hai.",
          onScreenText: "Hai",
          visualMetaphor: "Two visual",
          motionProgression: "Quick entrance then hold.",
          layoutFamily: "diagram",
          evidenceClaimIds: ["claim-02"],
        },
        {
          sceneId: "scene-03",
          purpose: "payoff",
          beat: "Beat three",
          narration: "Câu ba.",
          onScreenText: "Ba",
          visualMetaphor: "Three visual",
          motionProgression: "Quick entrance then hold.",
          layoutFamily: "timeline",
          evidenceClaimIds: ["claim-03"],
        },
      ],
    };

    expectPromptSizeNearBaseline(
      "mainAuthor",
      buildAuthorMessages({ text: "Chủ đề baseline", urls: [], format: "tiktok", durationTier: 2, videoLanguage: "vi" }),
    );
    expectPromptSizeNearBaseline(
      "tsxBatch",
      buildAuthorModuleBatchMessages({
        input: { text: "Chủ đề batch", urls: [], format: "tiktok", durationTier: 3, videoLanguage: "vi" },
        manifest,
        componentIds: ["scene-02", "scene-03"],
        batchIndex: 2,
        batchCount: 3,
        contentPlan,
      }),
    );
    expectPromptSizeNearBaseline(
      "missingTsxRecovery",
      buildMissingTsxRecoveryMessages({
        manifest,
        missingComponentIds: ["scene-02", "scene-03"],
        existingComponentIds: ["scene-01"],
      }),
    );
    expectPromptSizeNearBaseline(
      "reauthor",
      buildReauthorMessages({
        sceneId: "scene-01",
        componentId: "scene-01",
        currentCode: "// component: scene-01\nexport default function Scene() { return null; }",
        issues: [{ check: "N14", severity: "error", message: "tràn vùng" }],
      }),
    );
    expectPromptSizeNearBaseline(
      "visualQa",
      buildVisualQaMessages([
        { sceneId: "scene-01", stillDataUrl: "data:image/png;base64,AAA" },
        { sceneId: "scene-02", stillDataUrl: "data:image/png;base64,BBB" },
      ]),
    );
  });
});

describe("buildAuthorModuleBatchMessages", () => {
  it("asks for only the requested TSX batch against a fixed manifest", () => {
    const manifest = {
      title: "Video batch",
      theme: { dominant: "#1E9CB0" },
      scenes: [
        { component: "scene-01", eyebrow: "HOOK", headline: "One", narration: "First.", props: {} },
        { component: "scene-02", eyebrow: "TURN", headline: "Two", narration: "Second.", props: {} },
        { component: "scene-03", eyebrow: "PAYOFF", headline: "Three", narration: "Third.", props: {} },
      ],
    };
    const plan: ContentPlan = {
      title: "Video batch",
      viewerPromise: "Promise",
      hookType: "surprise",
      first3SecondsLine: "Hook",
      openLoop: "Loop",
      payoff: "Payoff",
      claims: [
        { id: "claim-01", text: "Claim for scene one only.", support: "source_material", confidence: "supported", action: "use" },
        { id: "claim-02", text: "Claim for selected scene two.", support: "source_material", confidence: "supported", action: "use" },
        { id: "claim-03", text: "Claim for selected scene three.", support: "source_material", confidence: "supported", action: "use" },
      ],
      scenes: [
        {
          sceneId: "scene-01",
          purpose: "hook",
          beat: "Beat one",
          narration: "First.",
          onScreenText: "One",
          visualMetaphor: "One visual",
          motionProgression: "Quick entrance then hold.",
          layoutFamily: "statement",
          evidenceClaimIds: ["claim-01"],
        },
        {
          sceneId: "scene-02",
          purpose: "turn",
          beat: "Beat two",
          narration: "Second.",
          onScreenText: "Two",
          visualMetaphor: "Two visual",
          motionProgression: "Quick entrance then hold.",
          layoutFamily: "diagram",
          evidenceClaimIds: ["claim-02"],
        },
        {
          sceneId: "scene-03",
          purpose: "payoff",
          beat: "Beat three",
          narration: "Third.",
          onScreenText: "Three",
          visualMetaphor: "Three visual",
          motionProgression: "Quick entrance then hold.",
          layoutFamily: "timeline",
          evidenceClaimIds: ["claim-03"],
        },
      ],
    };

    const messages = buildAuthorModuleBatchMessages({
      input: { text: "Topic", urls: [], format: "tiktok", durationTier: 3, videoLanguage: "en" },
      manifest,
      componentIds: ["scene-02", "scene-03"],
      batchIndex: 2,
      batchCount: 3,
      contentPlan: plan,
      contentPlanAdvisories: [{ check: "layout-diversity", severity: "advisory", message: "vary layouts" }],
      research: "source text",
    });
    const text = promptText(messages);

    expectContainsInOrder(text, [
      "Bạn là tác giả video ngắn",
      "HỢP ĐỒNG VIẾT CẢNH",
      "ĐỊNH DẠNG TRẢ VỀ CHO TSX BATCH",
      "QUY TẮC NỘI DUNG",
      "TÁO BẠO NGAY TỪ BẢN ĐẦU",
    ]);
    expect(text).toContain("KHÔNG trả manifest JSON");
    expect(text).not.toContain(JSON.stringify(manifest, null, 2));
    expect(text).toContain(JSON.stringify(manifest.scenes.slice(1), null, 2));
    expect(text).toContain("CONTENT PLAN SCENES CỦA BATCH NÀY");
    expect(text).not.toContain(JSON.stringify(plan, null, 2));
    expect(text).toContain(JSON.stringify(plan.scenes.slice(1), null, 2));
    expect(text).toContain("Batch 2/3");
    expect(text).toContain("scene-02\nscene-03");
    expect(text).not.toContain('"component": "scene-01"');
    expect(text).not.toContain('"sceneId": "scene-01"');
    expect(text).not.toContain("Beat one");
    expect(text).not.toContain("One visual");
    expect(text).not.toContain("Claim for scene one only.");
    expect(text).toContain("Claim for selected scene two.");
    expect(text).toContain("Claim for selected scene three.");
    expect(text).toContain("Các component khác sẽ được viết ở batch khác");
    expect(text).toContain("CONTENT PLAN ADVISORIES TO RESOLVE IN TSX");
    expect(text).not.toContain("source text");
  });
});

describe("buildMissingTsxRecoveryMessages", () => {
  it("asks for only the missing TSX modules while preserving the exact manifest", () => {
    const manifest = {
      title: "Video kiểm thử",
      theme: { dominant: "#1E9CB0" },
      scenes: [
        { component: "alpha", eyebrow: "A", headline: "One", narration: "First." },
        { component: "beta", eyebrow: "B", headline: "Two", narration: "Second." },
        { component: "gamma", eyebrow: "C", headline: "Three", narration: "Third." },
      ],
    };

    const messages = buildMissingTsxRecoveryMessages({
      manifest,
      missingComponentIds: ["beta", "gamma"],
      existingComponentIds: ["alpha"],
    });
    const text = promptText(messages);

    expect(text).toContain("KHÔNG được thay đổi");
    expect(text).toContain(JSON.stringify(manifest, null, 2));
    expect(text).toContain("beta\ngamma");
    expect(text).toContain("alpha");
    expect(text).toContain("KHÔNG viết lại");
    expect(text).toContain("KHÔNG trả lại manifest JSON");
    expect(text).toContain("registerComponent id khớp");
    expect(text).not.toContain("CONTENT PLAN ĐÃ DUYỆT");
    expect(text).not.toContain("Yêu cầu gốc của người dùng");
    expect(text).not.toMatch(/ART DIRECTION CẢ VIDEO|VISUALIZE SÁNG TẠO|DÁM VẼ ẨN DỤ/);
  });
});

describe("buildAuthorMessages", () => {
  // Post-block-removal: the prompt no longer tells the model to import @motionreal/blocks
  // for layout; it authors raw JSX/SVG. The output contract still carries the
  // marker/json/tsx shape + registerComponent.
  const required = ["// component:", "```json", "```tsx", "registerComponent"];

  it("embeds the contract + output-format for a plain brief", () => {
    const [sys, user] = buildAuthorMessages({ text: "Chủ đề thử", urls: [] });
    expect(sys!.role).toBe("system");
    for (const token of required) expect(sys!.content).toContain(token);
    expect(sys!.content).toContain('KHÔNG dùng "sceneId" thay cho "component"');
    expect(user!.content).toContain("Chủ đề thử");
  });

  it("keeps the main author prompt render contract before creative guidance", () => {
    const [sys] = buildAuthorMessages({ text: "Chủ đề thử", urls: [], format: "tiktok", durationTier: 2, videoLanguage: "vi" });
    const text = contentText(sys!.content);

    expectContainsInOrder(text, [
      "Bạn là tác giả video ngắn",
      "KHUNG HÌNH",
      "MỤC TIÊU THỜI LƯỢNG",
      "NGÔN NGỮ VIDEO",
      "HỢP ĐỒNG VIẾT CẢNH",
      "ĐỊNH DẠNG TRẢ VỀ",
      "QUY TẮC NỘI DUNG",
      "TÁO BẠO NGAY TỪ BẢN ĐẦU",
    ]);
  });

  it("embeds links but not raw research for a brief with a link", () => {
    const [sys, user] = buildAuthorMessages({ text: "Tóm tắt bài này https://example.com/x", urls: ["https://example.com/x"] }, "tư liệu ABC");
    for (const token of required) expect(sys!.content).toContain(token);
    expect(user!.content).toContain("https://example.com/x");
    // Raw research must not reach code authoring — only plan/claims do.
    expect(user!.content).not.toContain("tư liệu ABC");
    expect(user!.content).toMatch(/CONTENT PLAN|claim ledger|KHÔNG bịa/i);
  });

  it("can receive a filtered content plan and excludes omitted claims from code-authoring input", () => {
    const plan: ContentPlan = {
      title: "Vì sao chip AI đắt",
      viewerPromise: "Người xem hiểu nút thắt sản xuất phía sau giá chip.",
      hookType: "contradiction",
      first3SecondsLine: "Con chip không đắt vì nó nhỏ. Nó đắt vì gần như không ai làm nổi.",
      openLoop: "Điểm nghẽn thật sự nằm sau cánh cửa nhà máy.",
      payoff: "Giá nằm ở năng lực sản xuất khan hiếm, không phải kích thước con chip.",
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
          text: "Unsupported $999 launch price.",
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
          narration: "Con chip không đắt vì nó nhỏ. Nó đắt vì gần như không ai làm nổi.",
          onScreenText: "Đắt vì khan hiếm",
          visualMetaphor: "A tiny glowing chip behind a locked factory gate.",
          motionProgression: "Quick entrance: chip pops in under a second; semantic: the gate closes; living: the lock keeps a small warning pulse.",
          layoutFamily: "signature-visual",
          evidenceClaimIds: ["claim-01"],
        },
      ],
    };
    const [, user] = buildAuthorMessages(
      { text: "Làm video về chip AI", urls: [] },
      undefined,
      undefined,
      undefined,
      contentPlanForAuthoring(plan),
    );
    const text = user!.content as string;
    expect(text).toContain("CONTENT PLAN ĐÃ DUYỆT");
    expect(text).toContain("viewerPromise");
    expect(text).toContain("claim-01");
    expect(text).toContain("Reveal scarcity before specs");
    expect(text).toContain("motionProgression");
    expect(text).toContain("gate closes");
    expect(text).toContain("motion intent");
    expect(text).toContain("quick entrance/reveal/pop");
    expect(text).toContain("0.2–0.8 giây");
    expect(text).toContain('motionProgression có nhãn "semantic:"');
    expect(text).toContain("2–4 thay đổi có thứ tự");
    expect(text).toContain("continuous living motion");
    expect(text).toContain("phase/period deterministic");
    expect(text).not.toContain("Unsupported $999 launch price");
    expect(text).not.toContain("claim-02");
  });

  it("passes content-plan advisories into authoring without turning them into blockers", () => {
    const plan: ContentPlan = {
      title: "Một thông điệp rõ",
      viewerPromise: "Người xem hiểu thông điệp chính qua một mạch kể gọn.",
      hookType: "stakes",
      first3SecondsLine: "Một câu đúng có thể đổi hướng cả quyết định.",
      openLoop: "Điều làm câu đó thuyết phục nằm ở cách nó được dựng lên.",
      payoff: "Thông điệp mạnh khi hình ảnh và nhịp chuyển động cùng phục vụ một ý.",
      claims: [],
      scenes: [
        {
          sceneId: "scene-01",
          purpose: "hook",
          beat: "Open with the stakes.",
          narration: "Một câu đúng có thể đổi hướng cả quyết định.",
          onScreenText: "Một câu đủ lực",
          visualMetaphor: "A statement pressing a switch on a dark control panel.",
          motionProgression: "Text appears.",
          layoutFamily: "statement",
          evidenceClaimIds: [],
        },
      ],
    };
    const [, user] = buildAuthorMessages(
      { text: "Làm video về thông điệp", urls: [] },
      undefined,
      undefined,
      undefined,
      contentPlanForAuthoring(plan),
      [
        {
          check: "motion-progression",
          severity: "advisory",
          sceneId: "scene-01",
          message: "motionProgression must describe a specific motion intent, not generic text/card appearance",
        },
      ],
    );
    const text = user!.content as string;

    expect(text).toContain("CONTENT PLAN ADVISORIES TO RESOLVE IN TSX");
    expect(text).toContain("motion-progression @scene-01");
    expect(text).toContain("không phải lý do xoá ý tưởng");
    expect(text).toContain("quick entrance");
    expect(text).toContain("semantic progression");
    expect(text).toContain("continuous living motion");
  });

  it("carries a duration→word-budget instruction using the MEASURED speech rate", () => {
    // The user's requested length lives in the free-text brief; the system prompt
    // must tell the model how to turn seconds into a total word budget. The rate
    // was 2.7 w/s but real Vivibe audio measured ~4.7 w/s — at 2.7 a "90s" request
    // rendered as ~60s. The budget must use the measured rate, not the old guess.
    const [sys] = buildAuthorMessages({ text: "Làm video 1p30s về chủ đề X", urls: [] });
    expect(sys!.content).toContain("4.7");
    expect(sys!.content).not.toMatch(/× 2\.7 từ/);
    expect(sys!.content).toMatch(/TỔNG lời đọc/i);
  });

  it("uses the 90s short-form anchor as 10-12 scenes", () => {
    const [sys] = buildAuthorMessages({ text: "Làm video về chủ đề X", urls: [], format: "tiktok", durationTier: 2 });
    const text = sys!.content;

    expect(text).toContain("90 giây");
    // Pacing budget copy: "chia thành 10–12 cảnh (nhắm 11)" + content-rules "thường 10–12 cảnh".
    expect(text).toMatch(/10–12 cảnh/);
    expect(text).toMatch(/90 giây[\s\S]*thường 10–12 cảnh/);
    expect(text).not.toContain("12–16 cảnh");
  });

  it("uses the CALIBRATED rate when one is injected (overrides the baked default)", () => {
    // the backend reads a per-voice measured rate from
    // settings and passes it in; the word budget + the prompt copy must reflect THAT
    // rate, not the baked ~4.7 (a slower/faster voice needs a different budget). The
    // tier-1 TikTok target is 45s, so a 6.0 w/s rate ⇒ ~270 words (45×6).
    const [sys] = buildAuthorMessages({ text: "Chủ đề X", urls: [] }, undefined, undefined, 6.0);
    expect(sys!.content).toContain("6 từ/giây");
    expect(sys!.content).toContain("270");
    expect(sys!.content).not.toContain("4.7");
  });

  it("carries concrete layout-variety recipes + a countable anti-repetition rule", () => {
    // The earlier abstract "đa dạng form" advice wasn't enough for a weaker model —
    // every scene came out the same. The contract must map content KINDS to layouts
    // and cap consecutive same-layout scenes with a countable rule. Post-block-
    // removal the recipes are raw-JSX shapes (two columns, a big self-drawn number),
    // not block names.
    const [sys] = buildAuthorMessages({ text: "Chủ đề bất kỳ", urls: [] });
    const text = sys!.content;
    // Content→form recipes (comparison→two columns, numbers→a big self-drawn figure).
    expect(text).toMatch(/HAI CỘT/);
    expect(text).toMatch(/TỰ VẼ|tự dựng|tự vẽ/);
    // A countable anti-repetition rule (not just "be diverse"): no >2 consecutive
    // scenes of the same layout, ≥3 distinct layouts across the video.
    expect(text).toMatch(/2 cảnh LIÊN TIẾP/);
    expect(text).toMatch(/ÍT NHẤT 3 dạng/);
  });

  it("sets one video-level editorial grammar without turning it into a fixed style", () => {
    const [sys] = buildAuthorMessages({ text: "Chủ đề bất kỳ", urls: [] });
    const text = sys!.content;
    expect(text).toMatch(/ART DIRECTION CẢ VIDEO/);
    expect(text).toMatch(/ngôn ngữ thị giác/);
    expect(text).toMatch(/MỘT bố cục biên tập.*focal structure/);
    expect(text).toMatch(/sao chép palette\/diện mạo/);
  });

  it("demands a bold FIRST draft (not 'play safe then wait for the user to ask')", () => {
    // The observed behavior: the first draft came out timid (every scene a plain
    // title card); only a manual "be more creative" reauthor produced something
    // engaging. The contract must require boldness on the FIRST pass, but it
    // should route the model into safe recipes instead of invented stats.
    const [sys] = buildAuthorMessages({ text: "Chủ đề bất kỳ", urls: [] });
    const text = sys!.content;
    expect(text).toMatch(/TÁO BẠO NGAY TỪ BẢN ĐẦU/);
    expect(text).toMatch(/beat chữ ký|bespoke/i);
    expect(text).toMatch(/số lớn.*CHỈ khi số đó có trong tư liệu/);
    expect(text).toMatch(/HAI CỘT.*so sánh\/tradeoff/);
    expect(text).toMatch(/statement beat.*typography mạnh.*readable hold/);
    expect(text).toMatch(/KHÔNG bịa số\/fact/);
  });

  it("separates quick entrances, semantic progression, and living motion without forcing motion everywhere", () => {
    const [sys] = buildAuthorMessages({ text: "Chủ đề bất kỳ", urls: [] });
    const text = sys!.content;
    expect(text).toMatch(/quick entrance\/reveal\/pop/);
    expect(text).toMatch(/0\.2–0\.8 giây/);
    expect(text).toMatch(/semantic progression/);
    expect(text).toMatch(/continuous living motion/);
    expect(text).toMatch(/phase = \(\(Math\.max\(0, frame - enterEnd\)\) % periodFrames\) \/ periodFrames/);
    expect(text).toMatch(/useVideoConfig/);
    expect(text).toMatch(/durationInFrames/);
    expect(text).toMatch(/frame \/ \(durationInFrames - 1\)/);
    expect(text).toMatch(/motionProgression/);
    expect(text).toMatch(/final hold.*beat chính/is);
    expect(text).toMatch(/Quick entrance \+ readable final hold luôn hợp lệ|readable final hold/);
    expect(text).not.toMatch(/DIỄN TIẾN qua phần lớn thời lượng/);
    expect(text).not.toMatch(/đừng dùng Math\.sin\(frame\), frame%n/);
    expect(text).not.toMatch(/\[0,\s*18\]/);
    expect(text).not.toMatch(/ANIMATION PHẢI|mọi cảnh phải chuyển động/);
  });

  it("demands SHARP narration voice with a hook + a banned-cliché list (not flat encyclopedic prose)", () => {
    // The observed defect: the prompt poured all its creative pressure into the
    // VISUAL ("TÁO BẠO" — big stats, two columns, SVG beats) but said nothing about
    // the NARRATION voice beyond a mechanical "1–3 câu, 18–40 từ" — so the model
    // wrote safe, neutral, encyclopedic lines ("nhạt như nước ốc"). The content
    // rules must steer the WRITING: a concrete hook on the first sentence, an
    // explicit list of banned filler openers, and concrete-over-generic guidance.
    const [sys] = buildAuthorMessages({ text: "Chủ đề bất kỳ", urls: [] });
    const text = sys!.content;
    expect(text).toMatch(/GIỌNG VĂN LỜI ĐỌC/);
    // Names at least one of the banned clichéd openers verbatim, so the model has a
    // concrete blacklist rather than vague "write better".
    expect(text).toMatch(/Trong thời đại ngày nay|Như chúng ta đã biết|Hãy cùng tìm hiểu/);
    // A worked nhạt→sắc example pair (the model copies concrete examples).
    expect(text).toMatch(/NHẠT:.*SẮC:|NHẠT.*→.*SẮC/s);
  });

  it("labels the .tsx example as STRUCTURE-only, not an aesthetic template to copy", () => {
    // The minimal Frame>Story>TitleBlock example was being cloned into every scene
    // (the model copies the concrete example over the abstract variety rule). The
    // output-format must flag the example as format-only so it isn't the template.
    const [sys] = buildAuthorMessages({ text: "Chủ đề bất kỳ", urls: [] });
    const text = sys!.content;
    expect(text).toMatch(/chỉ minh hoạ CẤU TRÚC|KHÔNG phải mẫu thẩm mỹ/);
  });

  it("keeps the main TSX example technical and aesthetically neutral", () => {
    const [sys] = buildAuthorMessages({ text: "Chủ đề bất kỳ", urls: [] });
    const text = sys!.content;

    expect(text).not.toMatch(/fontSize: 96|#7dd3fc|justifyContent: "center"|placeItems: "center"/);
    expect(text).not.toMatch(/const y = interpolate\(frame, \[0, enterEnd\]/);
    expect(text).not.toMatch(/const lineDraw =/);
    expect(text).not.toMatch(/const pulse =/);
  });

  it("carries a general parseable-TSX rule, including object-literal style syntax", () => {
    // A real model reply produced `justify("flex-start")` inside a style object.
    // The fix is a general syntax contract: parseable TSX + valid object-literal
    // properties, not a one-off blacklist for that token.
    const [sys] = buildAuthorMessages({ text: "Chủ đề bất kỳ", urls: [] });
    const text = sys!.content;
    expect(text).toMatch(/CÚ PHÁP TSX BẮT BUỘC/);
    expect(text).toMatch(/TypeScript\/TSX parse được/);
    expect(text).toMatch(/object literal/);
    expect(text).toMatch(/key: value/);
    expect(text).toMatch(/foo\("bar"\)/);
    expect(text).toMatch(/justifyContent: "flex-start"/);
  });

  it("forbids fabrication when a link was provided (code author uses plan, not article body)", () => {
    // Author prompt steers to plan/claim ledger and forbids inventing figures.
    const [, user] = buildAuthorMessages({ text: "Tóm tắt https://example.com/x", urls: ["https://example.com/x"] });
    const text = user!.content as string;
    expect(text).toMatch(/KHÔNG bịa/);
    expect(text).toContain("https://example.com/x");
    expect(text).not.toContain("hiểu biết đáng tin");
  });

  it("is byte-identical with no images vs an empty image list (no regression)", () => {
    const a = buildAuthorMessages({ text: "Chủ đề X", urls: [] });
    const b = buildAuthorMessages({ text: "Chủ đề X", urls: [] }, undefined, []);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // user content stays a plain string (the text-only shape), not parts.
    expect(typeof a[1]!.content).toBe("string");
  });

  it("attaches one image_url part per provided image + names its ref/dimensions", () => {
    const images = [
      { ref: "assets/aaa.png", width: 800, height: 600, dataUrl: "data:image/png;base64,AAA" },
      { ref: "assets/bbb.jpg", width: 1024, height: 768, dataUrl: "data:image/jpeg;base64,BBB" },
    ];
    const msgs = buildAuthorMessages({ text: "Chủ đề có ảnh", urls: [] }, undefined, images);
    const sys = msgs[0]!;
    const parts = msgs[1]!.content as ContentPart[];
    // The system prompt gains the image rule (use only provided refs via <SceneImage>).
    expect(sys.content).toContain("SceneImage");
    expect(sys.content).toMatch(/KHÔNG bịa đường dẫn/);
    // Approved images are a curated pool, not a checklist. Prefer at least one
    // suitable attachment, but never distort the story to consume an irrelevant image.
    expect(sys.content).toMatch(/chỉ dùng subset thực sự đóng góp nội dung/);
    expect(sys.content).toMatch(/Ưu tiên dùng ít nhất một ảnh phù hợp/);
    expect(sys.content).toMatch(/KHÔNG bẻ nội dung/);
    expect(sys.content).not.toMatch(/BẮT BUỘC DÙNG ẢNH/);
    // One image_url per image, each preceded by a text line naming its ref + size.
    const imageParts = parts.filter((p) => p.type === "image_url");
    expect(imageParts).toHaveLength(2);
    expect(imageParts.some((p) => p.type === "image_url" && p.image_url.url === "data:image/png;base64,AAA")).toBe(true);
    const text = parts.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join(" ");
    expect(text).toContain("assets/aaa.png");
    expect(text).toContain("800×600");
  });

  // --- format / tier / video-language are prompt-driven ---

  it("does not reintroduce a style menu or named visual treatment", () => {
    // The multi-style design system was deleted (D1). The prompt must no longer
    // tell the model to choose a named style pack. A video-level visual grammar
    // is intentional; a menu of branded visual treatments is not.
    const [sys] = buildAuthorMessages({ text: "Chủ đề bất kỳ", urls: [] });
    const text = sys!.content;
    expect(text).not.toMatch(/style.?pack|design language|galaxy|ngôn ngữ thiết kế/i);
  });

  it("TikTok (default): reserves captions and keeps the visual mass below FYP chrome", () => {
    const [sys] = buildAuthorMessages({ text: "Chủ đề", urls: [] });
    const text = sys!.content;
    expect(text).toMatch(/9:16/);
    expect(text).toMatch(/phụ đề/i); // caption band the author must keep clear of
    expect(text).toMatch(/FYP\/Shorts/i);
    expect(text).toMatch(/hướng dẫn bố cục mềm/i);
  });

  it("word budget scales with the chosen duration tier (seconds × measured rate)", () => {
    // Tier maps to short-form seconds (45/90/150); the budget is seconds × 4.7 w/s.
    const [t1] = buildAuthorMessages({ text: "X", urls: [], format: "tiktok", durationTier: 1 });
    const [t3] = buildAuthorMessages({ text: "X", urls: [], format: "tiktok", durationTier: 3 });
    expect(t1!.content).toMatch(/45 giây/);
    expect(t3!.content).toMatch(/150 giây/);
    // 45s × 4.7 ≈ 212 words; 150s × 4.7 ≈ 705 words — the targets must differ.
    expect(t1!.content).toMatch(/212 từ/);
    expect(t3!.content).toMatch(/705 từ/);
  });

  it("video-language rule applies to title, display text, narration, and captions", () => {
    // vi (default): under 100 chars + a SEPARATE hashtags field.
    const [vi] = buildAuthorMessages({ text: "X", urls: [], format: "tiktok", videoLanguage: "vi" });
    expect(vi!.content).toMatch(/100 ký tự/);
    expect(vi!.content).toMatch(/hashtag/i);
    expect(vi!.content).toMatch(/KHÔNG nhồi hashtag vào trong "title"|field RIÊNG "hashtags"/);
    expect(vi!.content).toMatch(/TOÀN BỘ.*TIẾNG VIỆT|Hiển thị \+ lời đọc: tiếng Việt/is);

    // en short-form: under 100 chars, all video content English.
    const [en] = buildAuthorMessages({ text: "X", urls: [], format: "tiktok", videoLanguage: "en" });
    expect(en!.content).toMatch(/100 ký tự/);
    expect(en!.content).toMatch(/TIẾNG ANH/);
    expect(en!.content).toMatch(/title.*hashtags.*eyebrow\/headline\/body.*narration.*CTA/is);
    expect(en!.content).toMatch(/KHÔNG xen câu tiếng Việt|Không để sót câu tiếng Việt/i);
    expect(en!.content).not.toMatch(/vẫn luôn TIẾNG VIỆT/i);
  });

  it("uses a conservative English word-rate default instead of the Vietnamese calibration", () => {
    const [en] = buildAuthorMessages({ text: "X", urls: [], format: "tiktok", durationTier: 1, videoLanguage: "en" });
    expect(en!.content).toMatch(/Giọng đọc tiếng Anh ~2.5 từ\/giây/);
    expect(en!.content).toMatch(/113 từ/);
  });

  it("demands a HOOKED publish title (a hook + banned empty-clickbait, not a flat description)", () => {
    // Same defect class as the narration voice: titleBlock only had MECHANICAL
    // rules (language, char cap, no inline hashtags) but nothing about pull — so
    // the model wrote flat "Tìm hiểu về X" titles. The rule must demand a hook,
    // forbid empty-clickbait (a title the video doesn't deliver), and keep tag
    // discipline (no generic "#fyp #viral" stuffing).
    const [sys] = buildAuthorMessages({ text: "Chủ đề bất kỳ", urls: [], format: "tiktok" });
    const text = sys!.content;
    expect(text).toMatch(/SỨC HÚT TIÊU ĐỀ/);
    // Names a flat-description anti-pattern verbatim so the model has a concrete
    // "don't do this", not just "make it catchy".
    expect(text).toMatch(/Tìm hiểu về|là gì|cần biết về/);
    // Forbids empty clickbait (title must match the video; no invented numbers).
    expect(text).toMatch(/clickbait/i);
    // Tag discipline: no generic #fyp/#viral stuffing.
    expect(text).toMatch(/#fyp|#viral|#xuhuong/);
  });

  it("the output-format JSON skeleton declares a separate hashtags array (not inlined in title)", () => {
    // H3/D9: the project display name = title, so the title must stay clean and
    // hashtags live in their own field. The skeleton must show both.
    const [sys] = buildAuthorMessages({ text: "X", urls: [], format: "tiktok" });
    const text = sys!.content;
    expect(text).toMatch(/"hashtags":\s*\[/);
    expect(text).toMatch(/"title":\s*"[^"]*KHÔNG chứa hashtag/);
  });
});

describe("buildReauthorMessages", () => {
  const base = { sceneId: "scene-03", componentId: "hook-eye", currentCode: "// component: hook-eye\nexport default 1;" };

  it("text-only when no still is provided; carries issue + current code + same id", () => {
    const msgs = buildReauthorMessages({ ...base, issues: [{ check: "N17", severity: "error", message: "bị cắt chữ" }] });
    expect(msgs[0]!.content as string).toMatch(/CÚ PHÁP TSX BẮT BUỘC/);
    expect(msgs[0]!.content as string).toMatch(/sửa cục bộ/);
    expect(msgs[0]!.content as string).toMatch(/BẢO TOÀN/);
    expect(msgs[0]!.content as string).toMatch(/VÁ ĐÚNG LỖI/);
    expect(msgs[0]!.content as string).toMatch(/TỰ KIỂM/);
    expect(msgs[0]!.content as string).toMatch(/KHÔNG thay cảnh bằng title-card/);
    expect(msgs[0]!.content as string).toMatch(/khai báo biến thiếu/);
    expect(msgs[0]!.content as string).toMatch(/Sở thích màu\/gu không phải lỗi kỹ thuật cứng/);
    const user = msgs[1]!;
    expect(typeof user.content).toBe("string");
    const text = user.content as string;
    expect(text).toContain("hook-eye");
    expect(text).toContain("bị cắt chữ");
    expect(text).toContain(base.currentCode);
  });

  it("keeps repair focused and at least 30% shorter than the pre-split baseline", () => {
    const messages = buildReauthorMessages({
      ...base,
      issues: [{ check: "N14", severity: "error", message: "tràn vùng" }],
    });
    const system = messages[0]!.content as string;
    expect(system).not.toMatch(/ART DIRECTION CẢ VIDEO|VISUALIZE SÁNG TẠO|DÁM VẼ ẨN DỤ/);
    expect(promptText(messages).length).toBeLessThanOrEqual(Math.floor(13_818 * 0.7));
  });

  it("carries the same soft motion direction into user-requested scene rewrites", () => {
    const msgs = buildReauthorMessages({ ...base, intent: "chỉnh lại cảnh theo ý người dùng" });
    const system = msgs[0]!.content as string;
    expect(system).toMatch(/quick entrance\/reveal\/pop/);
    expect(system).toMatch(/semantic progression/);
    expect(system).toMatch(/continuous living motion/);
    expect(system).toMatch(/durationInFrames/);
    expect(system).toMatch(/motionProgression/);
    expect(system).toMatch(/Quick entrance \+ readable final hold luôn hợp lệ|readable final hold/);
  });

  it("includes an image_url part when a still data URL is provided", () => {
    const msgs = buildReauthorMessages({ ...base, issues: [{ check: "N14", severity: "error", message: "tràn vùng" }], stillDataUrl: "data:image/png;base64,AAA" });
    const parts = msgs[1]!.content as ContentPart[];
    expect(Array.isArray(parts)).toBe(true);
    expect(parts.some((p) => p.type === "image_url" && p.image_url.url === "data:image/png;base64,AAA")).toBe(true);
    expect(parts.some((p) => p.type === "text")).toBe(true);
  });

  it("hard-requires keeping <SceneImage> when the scene carries an image (so a free rewrite can't drop it)", () => {
    // The bug: a vague edit ("sáng tạo hơn") made the model drop the image while
    // the manifest still referenced it → the picture vanished. With hasImage the
    // reauthor prompt must explicitly forbid removing the <SceneImage> block.
    const withImage = buildReauthorMessages({ ...base, intent: "sáng tạo hơn", hasImage: true });
    const text = withImage[1]!.content as string;
    expect(text).toContain("SceneImage");
    expect(text).toMatch(/GIỮ ẢNH|giữ.*ảnh/i);
    expect(text).not.toContain("<Content>/<Story>");

    // Without an image the instruction is absent (no spurious image talk).
    const noImage = buildReauthorMessages({ ...base, intent: "sáng tạo hơn" });
    expect(noImage[1]!.content as string).not.toContain("SceneImage");
  });
});

describe("buildImageFilterMessages", () => {
  const images = [
    { ref: "assets/aaa.png", width: 800, height: 600, dataUrl: "data:image/png;base64,AAA" },
    { ref: "assets/bbb.jpg", width: 1024, height: 768, dataUrl: "data:image/jpeg;base64,BBB" },
  ];

  it("carries the source summary + one image_url per candidate, each labeled by its ref", () => {
    const msgs = buildImageFilterMessages("Bài nói về sự kiện X", images);
    const sys = msgs[0]!;
    const parts = msgs[1]!.content as ContentPart[];
    const systemText = sys.content as string;
    // System prompt instructs keep-fitting / drop logo+ads, and the JSON shape.
    expect(systemText).toMatch(/logo/i);
    expect(systemText).toMatch(/GIỮ logo sản phẩm\/công ty/);
    expect(systemText).toMatch(/LOẠI BỎ watermark/);
    expect(systemText).toMatch(/role "logo"/);
    expect(systemText).toContain("keep");
    expect(systemText).toMatch(/video ngắn đa chủ đề/);
    expect(systemText).toMatch(/nguồn nội dung/);
    const retiredVietnamese = ["video", "tin", "tức", "ngắn"].join(" ");
    const retiredEnglish = ["news", "short", "video"].join(" ");
    expect(systemText.toLowerCase()).not.toContain(retiredVietnamese);
    expect(systemText.toLowerCase()).not.toContain(retiredEnglish);
    // One image_url per candidate; each ref appears in a text part.
    const imageParts = parts.filter((p) => p.type === "image_url");
    expect(imageParts).toHaveLength(2);
    const text = parts.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join(" ");
    expect(text).toContain("Bài nói về sự kiện X");
    expect(text).toContain("Tóm tắt nội dung nguồn");
    expect(text).toContain("assets/aaa.png");
    expect(text).toContain("assets/bbb.jpg");
  });
});

describe("narrative opening rules", () => {
  it("requires a hook only for scene-01 and lets later scenes follow their purpose", () => {
    const [system] = buildAuthorMessages({ text: "Một quy trình kỹ thuật", urls: [] });
    const text = system!.content as string;
    expect(text).toMatch(/Chỉ scene-01 bắt buộc có HOOK mạnh/);
    expect(text).toMatch(/context, turn, proof, contrast, payoff hoặc CTA/);
    expect(text).not.toMatch(/câu đầu mỗi cảnh.*hook/i);
    expect(text).not.toMatch(/AI vừa làm trong 4 giây|Trí tuệ nhân tạo đang thay đổi/i);
  });
});

describe("buildVisualQaMessages", () => {
  it("keeps visual QA scoped to objective layout defects, not taste", () => {
    const [system] = buildVisualQaMessages([{ sceneId: "scene-01", stillDataUrl: "data:image/png;base64,AAA" }]);
    const text = system!.content as string;
    expect(text).toMatch(/LỖI BỐ CỤC RÕ RÀNG/);
    expect(text).toMatch(/KHÔNG biến nhận xét gu/);
    expect(text).toMatch(/Chỉ báo khi có lỗi bố cục khách quan/);
    expect(text).toMatch(/low sẽ không tự kích hoạt sửa/);
    expect(text).toMatch(/"thiếu cao cấp" thành defect/);
    expect(text).toMatch(/severity = "high" chỉ khi lỗi rõ ràng cần sửa/);
  });
});
