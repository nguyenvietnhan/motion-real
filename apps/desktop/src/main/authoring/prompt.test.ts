import { describe, expect, it } from "vitest";
import { buildAuthorMessages, buildImageFilterMessages, buildReauthorMessages, buildVisualQaMessages, type ContentPart } from "./prompt.js";
import { contentPlanForAuthoring, type ContentPlan } from "./content-plan.js";

/**
 * Feature: desktop-author-mode — prompt builders carry the full Authoring_Contract
 * + AI_Output_Contract (author) and a single-scene repair request (reauthor,
 * optionally multimodal).
 */

function contentShape(content: string | ContentPart[]): { kind: "text" | "parts"; chars: number; textParts: number; imageParts: number } {
  if (typeof content === "string") return { kind: "text", chars: content.length, textParts: 0, imageParts: 0 };
  return {
    kind: "parts",
    chars: content.filter((p): p is { type: "text"; text: string } => p.type === "text").reduce((sum, p) => sum + p.text.length, 0),
    textParts: content.filter((p) => p.type === "text").length,
    imageParts: content.filter((p) => p.type === "image_url").length,
  };
}

function promptShape(messages: { role: string; content: string | ContentPart[] }[]): Array<ReturnType<typeof contentShape> & { role: string }> {
  return messages.map((m) => ({ role: m.role, ...contentShape(m.content) }));
}

describe("prompt surface baseline", () => {
  it("records current message counts, part counts, and text lengths for every prompt builder", () => {
    const image = { ref: "assets/a.png", width: 800, height: 600, dataUrl: "data:image/png;base64,AAA" };
    const stills = [
      { sceneId: "scene-01", stillDataUrl: "data:image/png;base64,AAA" },
      { sceneId: "scene-02", stillDataUrl: "data:image/png;base64,BBB" },
    ];

    expect({
      authorTextOnly: promptShape(buildAuthorMessages({ text: "Chủ đề baseline", urls: [] })),
      authorWithResearch: promptShape(buildAuthorMessages({ text: "Tóm tắt link", urls: ["https://example.com/a"] }, "tư liệu baseline")),
      authorWithImages: promptShape(buildAuthorMessages({ text: "Chủ đề có ảnh", urls: [] }, undefined, [image])),
      reauthorTextOnly: promptShape(buildReauthorMessages({ sceneId: "scene-01", componentId: "alpha", currentCode: "// component: alpha\nexport default 1;", intent: "sửa nhẹ" })),
      reauthorWithStill: promptShape(buildReauthorMessages({
        sceneId: "scene-01",
        componentId: "alpha",
        currentCode: "// component: alpha\nexport default 1;",
        issues: [{ check: "N14", severity: "error", message: "tràn chữ" }],
        stillDataUrl: "data:image/png;base64,AAA",
      })),
      visualQa: promptShape(buildVisualQaMessages(stills)),
      imageFilter: promptShape(buildImageFilterMessages("Bài nói về sự kiện X", [image])),
    }).toEqual({
      authorTextOnly: [
        { role: "system", kind: "text", chars: 16763, textParts: 0, imageParts: 0 },
        { role: "user", kind: "text", chars: 130, textParts: 0, imageParts: 0 },
      ],
      authorWithResearch: [
        { role: "system", kind: "text", chars: 16763, textParts: 0, imageParts: 0 },
        { role: "user", kind: "text", chars: 246, textParts: 0, imageParts: 0 },
      ],
      authorWithImages: [
        { role: "system", kind: "text", chars: 18545, textParts: 0, imageParts: 0 },
        { role: "user", kind: "parts", chars: 163, textParts: 2, imageParts: 1 },
      ],
      reauthorTextOnly: [
        { role: "system", kind: "text", chars: 10887, textParts: 0, imageParts: 0 },
        { role: "user", kind: "text", chars: 201, textParts: 0, imageParts: 0 },
      ],
      reauthorWithStill: [
        { role: "system", kind: "text", chars: 10887, textParts: 0, imageParts: 0 },
        { role: "user", kind: "parts", chars: 275, textParts: 1, imageParts: 1 },
      ],
      visualQa: [
        { role: "system", kind: "text", chars: 1161, textParts: 0, imageParts: 0 },
        { role: "user", kind: "parts", chars: 140, textParts: 4, imageParts: 2 },
      ],
      imageFilter: [
        { role: "system", kind: "text", chars: 632, textParts: 0, imageParts: 0 },
        { role: "user", kind: "parts", chars: 237, textParts: 3, imageParts: 1 },
      ],
    });
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
    expect(user!.content).toContain("Chủ đề thử");
  });

  it("embeds research + links for a brief with a link", () => {
    const [sys, user] = buildAuthorMessages({ text: "Tóm tắt bài này https://example.com/x", urls: ["https://example.com/x"] }, "tư liệu ABC");
    for (const token of required) expect(sys!.content).toContain(token);
    expect(user!.content).toContain("https://example.com/x");
    expect(user!.content).toContain("tư liệu ABC");
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
    expect(text).not.toContain("Unsupported $999 launch price");
    expect(text).not.toContain("claim-02");
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

  it("uses the CALIBRATED rate when one is injected (overrides the baked default)", () => {
    // freeform-engine K1/R5.4/D13: the backend reads a per-voice measured rate from
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

  it("demands a bold FIRST draft (not 'play safe then wait for the user to ask')", () => {
    // The observed behavior: the first draft came out timid (every scene a plain
    // title card); only a manual "be more creative" reauthor produced something
    // engaging. The contract must require boldness on the FIRST pass — concrete
    // must-haves (a big stat, an unusual layout, a bespoke signature beat).
    const [sys] = buildAuthorMessages({ text: "Chủ đề bất kỳ", urls: [] });
    const text = sys!.content;
    expect(text).toMatch(/TÁO BẠO NGAY TỪ BẢN ĐẦU/);
    expect(text).toMatch(/beat chữ ký|bespoke/i);
  });

  it("encourages visual progression across a scene without forcing motion everywhere", () => {
    const [sys] = buildAuthorMessages({ text: "Chủ đề bất kỳ", urls: [] });
    const text = sys!.content;
    expect(text).toMatch(/DIỄN TIẾN qua phần lớn thời lượng/);
    expect(text).toMatch(/KHÔNG phải luật bắt buộc/);
    expect(text).toMatch(/cảnh tĩnh có chủ đích vẫn hoàn toàn hợp lệ/);
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

  it("forbids fabrication (not 'use your own knowledge') when a link could not be read", () => {
    // urls present but NO research → the unreadable-link branch. It must NOT invite
    // the model to fill gaps from memory; it must forbid inventing figures/dates.
    const [, user] = buildAuthorMessages({ text: "Tóm tắt https://example.com/x", urls: ["https://example.com/x"] });
    const text = user!.content as string;
    expect(text).toContain("Không đọc được");
    expect(text).toMatch(/KHÔNG bịa/);
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
    // User-attached/approved images MUST be used (not "optional, skip freely"):
    // they came through a deliberate pick/review, so a re-roll can't silently
    // drop them all. The rule mandates using them (at least one).
    expect(sys.content).toMatch(/BẮT BUỘC DÙNG ẢNH/);
    expect(sys.content).not.toMatch(/không bắt buộc dùng hết/);
    // One image_url per image, each preceded by a text line naming its ref + size.
    const imageParts = parts.filter((p) => p.type === "image_url");
    expect(imageParts).toHaveLength(2);
    expect(imageParts.some((p) => p.type === "image_url" && p.image_url.url === "data:image/png;base64,AAA")).toBe(true);
    const text = parts.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join(" ");
    expect(text).toContain("assets/aaa.png");
    expect(text).toContain("800×600");
  });

  // --- format / tier / video-language are prompt-driven ---

  it("is de-styled: no leftover design-language / style-selection wording in the prompt", () => {
    // The multi-style design system was deleted (D1). The prompt must no longer
    // tell the model to author "on a design language" or pick a style — there is
    // only the delivery format's geometry now.
    const [sys] = buildAuthorMessages({ text: "Chủ đề bất kỳ", urls: [] });
    const text = sys!.content;
    expect(text).not.toMatch(/style.?pack|design language|galaxy|editorial|ngôn ngữ thiết kế/i);
  });

  it("TikTok (default): vertical 9:16 framing + reserve the burned caption band", () => {
    const [sys] = buildAuthorMessages({ text: "Chủ đề", urls: [] });
    const text = sys!.content;
    expect(text).toMatch(/9:16/);
    expect(text).toMatch(/phụ đề/i); // caption band the author must keep clear of
  });

  it("YouTube: horizontal 16:9 framing + explicitly NO burned caption band", () => {
    const [sys] = buildAuthorMessages({ text: "Chủ đề", urls: [], format: "youtube" });
    const text = sys!.content;
    expect(text).toMatch(/16:9/);
    expect(text).toMatch(/KHÔNG.*phụ đề|không.*băng phụ đề/i);
  });

  it("word budget scales with the chosen duration tier (per-format seconds × measured rate)", () => {
    // Tier maps to per-format seconds (TikTok 45/90/150); the budget is seconds ×
    // 4.7 w/s. A higher tier ⇒ a visibly larger word target in the prompt.
    const [t1] = buildAuthorMessages({ text: "X", urls: [], format: "tiktok", durationTier: 1 });
    const [t3] = buildAuthorMessages({ text: "X", urls: [], format: "tiktok", durationTier: 3 });
    expect(t1!.content).toMatch(/45 giây/);
    expect(t3!.content).toMatch(/150 giây/);
    // 45s × 4.7 ≈ 212 words; 150s × 4.7 ≈ 705 words — the targets must differ.
    expect(t1!.content).toMatch(/212 từ/);
    expect(t3!.content).toMatch(/705 từ/);
  });

  it("video-language rule applies to title, display text, narration, and captions", () => {
    // vi (default) on TikTok: under 100 chars + a SEPARATE hashtags field (kept
    // out of the title so the title doubles as a clean project name, D9/H3).
    const [vi] = buildAuthorMessages({ text: "X", urls: [], format: "tiktok", videoLanguage: "vi" });
    expect(vi!.content).toMatch(/100 ký tự/);
    expect(vi!.content).toMatch(/hashtag/i);
    // The hashtags must NOT be baked into the title (separate "hashtags" field).
    expect(vi!.content).toMatch(/KHÔNG nhồi hashtag vào trong "title"|field RIÊNG "hashtags"/);
    expect(vi!.content).toMatch(/TOÀN BỘ.*TIẾNG VIỆT|Hiển thị \+ lời đọc: tiếng Việt/is);

    // en on YouTube: under 200 chars, no hashtag requirement, all video content English.
    const [en] = buildAuthorMessages({ text: "X", urls: [], format: "youtube", videoLanguage: "en" });
    expect(en!.content).toMatch(/200 ký tự/);
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
    expect(msgs[0]!.content as string).toMatch(/KHÔNG được thay cảnh bằng title-card/);
    expect(msgs[0]!.content as string).toMatch(/khai báo biến thiếu/);
    expect(msgs[0]!.content as string).toMatch(/KHÔNG coi sở thích màu\/gu\/thẩm mỹ là lỗi cứng/);
    const user = msgs[1]!;
    expect(typeof user.content).toBe("string");
    const text = user.content as string;
    expect(text).toContain("hook-eye");
    expect(text).toContain("bị cắt chữ");
    expect(text).toContain(base.currentCode);
  });

  it("carries the same soft motion direction into user-requested scene rewrites", () => {
    const msgs = buildReauthorMessages({ ...base, intent: "chỉnh lại cảnh theo ý người dùng" });
    const system = msgs[0]!.content as string;
    expect(system).toMatch(/DIỄN TIẾN qua phần lớn thời lượng/);
    expect(system).toMatch(/KHÔNG phải luật bắt buộc/);
    expect(system).toMatch(/cảnh tĩnh có chủ đích vẫn hoàn toàn hợp lệ/);
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
    // System prompt instructs keep-fitting / drop logo+ads, and the JSON shape.
    expect(sys.content).toMatch(/logo/i);
    expect(sys.content).toContain("keep");
    expect(sys.content).toMatch(/video ngắn đa chủ đề/);
    expect(sys.content).toMatch(/nguồn nội dung/);
    expect(sys.content).not.toMatch(/video tin tức ngắn|news short video/i);
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
