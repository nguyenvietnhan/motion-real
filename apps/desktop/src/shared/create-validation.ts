import type { CreateInput } from "./types.js";

/**
 * Create-input validation (web-dashboard Task 4.3, design §Create flow,
 * Req 3.1/3.7/3.8). PURE and TOTAL over arbitrary strings (Property 1), and
 * shared by BOTH the renderer (live form validation) and the main-process
 * create controller — so it lives in `shared/` rather than `main/`, keeping the
 * renderer free of any import that reaches across the process boundary.
 *
 *   - empty / whitespace-only             ⇒ { ok:false, reason:"empty" }
 *   - URL-shaped but over 2048 chars      ⇒ { ok:false, reason:"too-long" }
 *   - topic/content over 20000 chars      ⇒ { ok:false, reason:"too-long" }
 *   - URL-shaped but malformed            ⇒ { ok:false, reason:"malformed-url" }
 *   - otherwise classified as url | topic ⇒ { ok:true, classified }
 */

export const MAX_TOPIC_LEN = 20000;
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
