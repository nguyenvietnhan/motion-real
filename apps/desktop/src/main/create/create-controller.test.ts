import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { MAX_TOPIC_LEN, validateCreateInput } from "./create-controller.js";

/**
 * — Create input is a free-form brief. validateCreateInput
 * is total over arbitrary strings: empty/whitespace and over-length are rejected;
 * everything else is a brief carrying the full text + any links found in it.
 */

const v = (raw: string) => validateCreateInput({ raw });

describe("create input validation (free-form brief)", () => {
  it("empty / whitespace-only ⇒ empty", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(" ", "\t", "\n", "\r"), { maxLength: 12 }), (parts) => {
        expect(v(parts.join(""))).toEqual({ ok: false, reason: "empty" });
      }),
      { numRuns: 200 },
    );
  });

  it("over 20000 chars ⇒ too-long", () => {
    fc.assert(
      fc.property(fc.integer({ min: MAX_TOPIC_LEN + 1, max: MAX_TOPIC_LEN + 400 }), (n) => {
        expect(v("k".repeat(n))).toEqual({ ok: false, reason: "too-long" });
      }),
      { numRuns: 100 },
    );
  });

  it("any non-empty in-range text ⇒ ok brief with the trimmed text", () => {
    const textArb = fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim() !== "" && s.trim().length <= MAX_TOPIC_LEN);
    fc.assert(
      fc.property(textArb, (s) => {
        const r = v(s);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.brief.text).toBe(s.trim());
      }),
      { numRuns: 200 },
    );
  });

  it("a bare URL ⇒ brief whose text is the URL and urls = [that url]", () => {
    const r = v("https://example.com/a");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.brief.text).toBe("https://example.com/a");
      expect(r.brief.urls).toEqual(["https://example.com/a"]);
    }
  });

  it("a chat-style brief with a link mid-sentence ⇒ full text + extracted link", () => {
    const r = v("Làm video 1p30s có voice từ link này https://www.theguardian.com/tech/anti-ai nhé");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.brief.text).toContain("Làm video 1p30s có voice");
      expect(r.brief.urls).toEqual(["https://www.theguardian.com/tech/anti-ai"]);
    }
  });

  it("a www. link is normalized to https and trailing punctuation trimmed", () => {
    const r = v("Tóm tắt www.example.com/a, ngắn gọn");
    expect(r.ok && r.brief.urls).toEqual(["https://www.example.com/a"]);
  });

  it("multiple links ⇒ all extracted (deduped, in order); non-URLs ignored", () => {
    const r = v("So sánh https://a.com/x và https://b.com/y và https://a.com/x lại");
    expect(r.ok && r.brief.urls).toEqual(["https://a.com/x", "https://b.com/y"]);
  });

  it("plain text with no link ⇒ urls is empty", () => {
    const r = v("tin công nghệ hôm nay");
    expect(r.ok && r.brief.urls).toEqual([]);
  });
});
