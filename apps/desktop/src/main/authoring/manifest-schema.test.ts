import { describe, expect, it } from "vitest";
import { extractJsonObject, parseAuthorManifest } from "./manifest-schema.js";

/**
 * Feature: web-dashboard A1 — author-manifest parsing. The model's reply is
 * parsed defensively (prose/code-fence wrapped) and validated against the kit
 * component contract.
 */

const valid = {
  title: "Gemma 3 QAT: LLM mạnh chạy trên máy nhà",
  theme: { dominant: "#1E9CB0", mood: "editorial teal" },
  scenes: [
    { component: "ns-statement", eyebrow: "GEMMA", headline: "LLM 27B chạy trên máy nhà", narration: "Câu mở đầu trực diện về chủ đề.", props: { callout: "Mô hình lớn không còn là đặc quyền của server" }, transitionToNext: "slide" },
    { component: "ns-stat", eyebrow: "DỮ LIỆU", headline: "54GB còn 14GB", narration: "Con số gây sốc về bộ nhớ.", props: { to: 14.1, suffix: " GB", statLabel: "VRAM" } },
    { component: "ns-points", eyebrow: "TÓM LẠI", headline: "Ba điều cần nhớ", narration: "Tóm tắt ba ý chính của video.", props: { points: ["A", "B", "C"] } },
  ],
};

describe("extractJsonObject", () => {
  it("extracts JSON from a fenced block", () => {
    const text = "Đây là manifest:\n```json\n{\"a\":1}\n```\nHết.";
    expect(extractJsonObject(text)).toBe('{"a":1}');
  });
  it("extracts a bare balanced object ignoring trailing prose", () => {
    expect(extractJsonObject('{"a":{"b":2}} thêm chữ thừa')).toBe('{"a":{"b":2}}');
  });
  it("handles braces inside strings", () => {
    expect(extractJsonObject('{"s":"a}b{c"}')).toBe('{"s":"a}b{c"}');
  });
  it("returns null when there is no object", () => {
    expect(extractJsonObject("không có json ở đây")).toBeNull();
  });
});

describe("parseAuthorManifest", () => {
  it("accepts a valid manifest (fenced + prose)", () => {
    const reply = "Tôi đã soạn:\n```json\n" + JSON.stringify(valid) + "\n```";
    const r = parseAuthorManifest(reply);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.scenes).toHaveLength(3);
      expect(r.manifest.scenes[0]!.component).toBe("ns-statement");
    }
  });
  it("rejects an unknown component id", () => {
    const bad = { ...valid, scenes: [{ ...valid.scenes[0], component: "ns-bogus" }, valid.scenes[1], valid.scenes[2]] };
    const r = parseAuthorManifest(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid");
  });
  it("rejects too few scenes", () => {
    const r = parseAuthorManifest(JSON.stringify({ ...valid, scenes: valid.scenes.slice(0, 1) }));
    expect(r.ok).toBe(false);
  });
  it("reports no-json when the reply has no object", () => {
    const r = parseAuthorManifest("xin lỗi tôi không thể");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no-json");
  });
});
