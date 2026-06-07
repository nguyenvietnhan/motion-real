import type { CreateInput } from "../../shared/types.js";

/**
 * Create-input validation (web-dashboard Task 4.3, design §Create flow,
 * Req 3.1/3.7/3.8). `validateCreateInput` is PURE and TOTAL over arbitrary
 * strings (Property 1):
 *   - empty / whitespace-only            ⇒ { ok:false, reason:"empty" }
 *   - URL-shaped but over 2048 chars     ⇒ { ok:false, reason:"too-long" }
 *   - topic over 500 chars               ⇒ { ok:false, reason:"too-long" }
 *   - URL-shaped but malformed           ⇒ { ok:false, reason:"malformed-url" }
 *   - otherwise classified as url | topic ⇒ { ok:true, classified }
 * Creation must never start for an `ok:false` result and the entered text is
 * retained by the caller.
 */

export const MAX_TOPIC_LEN = 500;
export const MAX_URL_LEN = 2048;

export type CreateClassified = { kind: "url"; url: string } | { kind: "topic"; text: string };

export type CreateValidation =
  | { ok: true; classified: CreateClassified }
  | { ok: false; reason: "empty" | "too-long" | "malformed-url" };

/** Looks like the user intends a URL (a scheme:// prefix or a leading `www.`). */
const URL_SHAPED = /^([a-z][a-z\d+.-]*:\/\/|www\.)/i;

function classifyUrl(trimmed: string): CreateValidation {
  const candidate = /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, reason: "malformed-url" };
  }
  const isHttp = parsed.protocol === "http:" || parsed.protocol === "https:";
  // A real article URL has a dotted public host; reject schemes/hosts we cannot ingest.
  if (!isHttp || !parsed.hostname.includes(".")) {
    return { ok: false, reason: "malformed-url" };
  }
  return { ok: true, classified: { kind: "url", url: candidate } };
}

export function validateCreateInput(input: CreateInput): CreateValidation {
  const trimmed = input.raw.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };

  if (URL_SHAPED.test(trimmed)) {
    if (trimmed.length > MAX_URL_LEN) return { ok: false, reason: "too-long" };
    return classifyUrl(trimmed);
  }

  if (trimmed.length > MAX_TOPIC_LEN) return { ok: false, reason: "too-long" };
  return { ok: true, classified: { kind: "topic", text: trimmed } };
}
