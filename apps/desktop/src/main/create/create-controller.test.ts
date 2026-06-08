import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { MAX_TOPIC_LEN, MAX_URL_LEN, validateCreateInput } from "./create-controller.js";

/**
 * Feature: web-dashboard, Property 1: Create input validation is total and
 * correct. For any string, validateCreateInput classifies empty/whitespace,
 * over-length, malformed-URL, valid-URL, and plain-topic inputs per spec and
 * never starts creation for an ok:false result. (Req 3.1, 3.7, 3.8)
 */

const URL_SHAPED = /^([a-z][a-z\d+.-]*:\/\/|www\.)/i;
const v = (raw: string) => validateCreateInput({ raw });

describe("Property 1: create input validation", () => {
  it("empty / whitespace-only ⇒ empty", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(" ", "\t", "\n", "\r"), { maxLength: 12 }), (parts) => {
        expect(v(parts.join(""))).toEqual({ ok: false, reason: "empty" });
      }),
      { numRuns: 200 },
    );
  });

  it("non-URL topic within 500 chars ⇒ ok topic (trimmed)", () => {
    const topicArb = fc
      .string({ minLength: 1, maxLength: 200 })
      .filter((s) => s.trim() !== "" && !URL_SHAPED.test(s.trim()) && s.trim().length <= MAX_TOPIC_LEN);
    fc.assert(
      fc.property(topicArb, (s) => {
        expect(v(s)).toEqual({ ok: true, classified: { kind: "topic", text: s.trim() } });
      }),
      { numRuns: 200 },
    );
  });

  it("non-URL topic over 500 chars ⇒ too-long", () => {
    fc.assert(
      fc.property(fc.integer({ min: MAX_TOPIC_LEN + 1, max: MAX_TOPIC_LEN + 400 }), (n) => {
        expect(v("k".repeat(n))).toEqual({ ok: false, reason: "too-long" });
      }),
      { numRuns: 100 },
    );
  });

  it("valid http(s) URL with dotted host ⇒ ok url", () => {
    const urlArb = fc.webUrl().filter((u) => {
      try {
        return new URL(u).hostname.includes(".") && u.length <= MAX_URL_LEN;
      } catch {
        return false;
      }
    });
    fc.assert(
      fc.property(urlArb, (u) => {
        const r = v(u);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.classified.kind).toBe("url");
      }),
      { numRuns: 200 },
    );
  });

  it("URL-shaped but over 2048 chars ⇒ too-long", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 300 }), (extra) => {
        const u = `https://example.com/${"a".repeat(MAX_URL_LEN + extra)}`;
        expect(v(u)).toEqual({ ok: false, reason: "too-long" });
      }),
      { numRuns: 100 },
    );
  });

  it("URL-shaped but malformed (no dotted host) ⇒ malformed-url", () => {
    const hostArb = fc.stringMatching(/^[a-z]{1,12}$/);
    fc.assert(
      fc.property(fc.constantFrom("http://", "https://"), hostArb, (scheme, host) => {
        expect(v(`${scheme}${host}`)).toEqual({ ok: false, reason: "malformed-url" });
      }),
      { numRuns: 200 },
    );
  });

  it("a URL followed by an instruction ⇒ url is the first token, the rest is a note", () => {
    const r = v("https://www.theguardian.com/tech/anti-ai Làm video 1p30s có voice");
    expect(r.ok).toBe(true);
    if (r.ok && r.classified.kind === "url") {
      expect(r.classified.url).toBe("https://www.theguardian.com/tech/anti-ai");
      expect(r.classified.note).toBe("Làm video 1p30s có voice");
    }
  });

  it("a bare URL (no instruction) ⇒ url with no note", () => {
    const r = v("https://example.com/a");
    expect(r.ok).toBe(true);
    if (r.ok && r.classified.kind === "url") {
      expect(r.classified.url).toBe("https://example.com/a");
      expect(r.classified.note).toBeUndefined();
    }
  });

  it("www. URL + instruction ⇒ https-prefixed url + note", () => {
    const r = v("www.example.com/a tóm tắt ngắn");
    expect(r.ok && r.classified.kind === "url" ? r.classified.url : null).toBe("https://www.example.com/a");
  });
});
