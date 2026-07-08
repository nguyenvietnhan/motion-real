import { describe, expect, it } from "vitest";
import { extractJsonObject, parseAuthorManifest } from "./manifest-schema.js";

/**
 * — author-manifest parsing. The model's reply is
 * parsed defensively (prose/code-fence wrapped) and validated against the
 * manifest schema. `component` is now an OPEN id (any valid format the AI
 * chooses); the actual `.tsx` code is matched separately by `reply-parser`.
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
  it("accepts an arbitrary (AI-chosen) component id in valid format", () => {
    const open = { ...valid, scenes: [{ ...valid.scenes[0], component: "bespoke-hook-eye" }, valid.scenes[1], valid.scenes[2]] };
    const r = parseAuthorManifest(JSON.stringify(open));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.scenes[0]!.component).toBe("bespoke-hook-eye");
  });
  it("rejects an invalid component id format (uppercase/spaces)", () => {
    const bad = { ...valid, scenes: [{ ...valid.scenes[0], component: "NS Bogus!" }, valid.scenes[1], valid.scenes[2]] };
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
