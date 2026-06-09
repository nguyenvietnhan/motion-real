import { describe, expect, it } from "vitest";
import { buildAuthorMessages, buildReauthorMessages, type ContentPart } from "./prompt.js";

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

  it("carries a duration→word-budget instruction so a requested length isn't undershot", () => {
    // The user's requested length lives in the free-text brief; the system prompt
    // must tell the model how to turn seconds into a total word budget (the signal
    // that was missing when a 90s request rendered as 54s).
    const [sys] = buildAuthorMessages({ text: "Làm video 1p30s về chủ đề X", urls: [] });
    expect(sys!.content).toContain("2.7");
    expect(sys!.content).toMatch(/TỔNG lời đọc/i);
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
});
