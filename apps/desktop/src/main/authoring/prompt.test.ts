import { describe, expect, it } from "vitest";
import { buildAuthorMessages, buildImageFilterMessages, buildReauthorMessages, type ContentPart } from "./prompt.js";

/**
 * Feature: desktop-author-mode — prompt builders carry the full Authoring_Contract
 * + AI_Output_Contract (author) and a single-scene repair request (reauthor,
 * optionally multimodal).
 */

describe("buildAuthorMessages", () => {
  const required = ["@news/blocks", "Math.random", "// component:", "```json", "```tsx", "registerComponent"];

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

  it("carries concrete layout-variety recipes + a countable anti-repetition rule", () => {
    // The earlier abstract "đa dạng form" advice wasn't enough for a weaker model —
    // every scene came out as TitleBlock+Panel. The contract must now map content
    // KINDS to layouts and cap consecutive same-layout scenes with a countable rule.
    const [sys] = buildAuthorMessages({ text: "Chủ đề bất kỳ", urls: [] });
    const text = sys!.content;
    // Content→layout recipes (numbers→stat, comparison→two columns, list→KeyPoints).
    expect(text).toMatch(/HAI CỘT/);
    expect(text).toMatch(/StatBlock|CountUp/);
    // A countable anti-repetition rule (not just "be diverse"): no >2 consecutive
    // scenes of the same layout, ≥3 distinct layouts across the video.
    expect(text).toMatch(/2 cảnh LIÊN TIẾP/);
    expect(text).toMatch(/ÍT NHẤT 3 dạng/);
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
    // One image_url per image, each preceded by a text line naming its ref + size.
    const imageParts = parts.filter((p) => p.type === "image_url");
    expect(imageParts).toHaveLength(2);
    expect(imageParts.some((p) => p.type === "image_url" && p.image_url.url === "data:image/png;base64,AAA")).toBe(true);
    const text = parts.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join(" ");
    expect(text).toContain("assets/aaa.png");
    expect(text).toContain("800×600");
  });
});

describe("buildReauthorMessages", () => {
  const base = { sceneId: "scene-03", componentId: "hook-eye", currentCode: "// component: hook-eye\nexport default 1;" };

  it("text-only when no still is provided; carries issue + current code + same id", () => {
    const msgs = buildReauthorMessages({ ...base, issues: [{ check: "N17", severity: "error", message: "bị cắt chữ" }] });
    const user = msgs[1]!;
    expect(typeof user.content).toBe("string");
    const text = user.content as string;
    expect(text).toContain("hook-eye");
    expect(text).toContain("bị cắt chữ");
    expect(text).toContain(base.currentCode);
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

  it("carries the article summary + one image_url per candidate, each labeled by its ref", () => {
    const msgs = buildImageFilterMessages("Bài nói về sự kiện X", images);
    const sys = msgs[0]!;
    const parts = msgs[1]!.content as ContentPart[];
    // System prompt instructs keep-fitting / drop logo+ads, and the JSON shape.
    expect(sys.content).toMatch(/logo/i);
    expect(sys.content).toContain("keep");
    // One image_url per candidate; each ref appears in a text part.
    const imageParts = parts.filter((p) => p.type === "image_url");
    expect(imageParts).toHaveLength(2);
    const text = parts.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join(" ");
    expect(text).toContain("Bài nói về sự kiện X");
    expect(text).toContain("assets/aaa.png");
    expect(text).toContain("assets/bbb.jpg");
  });
});
