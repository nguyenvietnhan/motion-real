import type { CreateInput } from "./types.js";

/**
 * Create-input validation (free-form brief). The Create box
 * behaves like a chat prompt: the user types a natural-language brief that MAY
 * contain one or more links. We never force an either/or "URL vs topic" split —
 * the whole text is the brief, and any links found in it are extracted so the
 * authoring step can fetch them for grounding (best-effort). PURE + TOTAL over
 * arbitrary strings (shared by the renderer's live validation and the main
 * create controller, so it stays in `shared/`).
 *
 * - empty / whitespace-only ⇒ { ok:false, reason:"empty" }
 * - over 20000 chars ⇒ { ok:false, reason:"too-long" }
 * - otherwise ⇒ { ok:true, brief:{ text, urls } }
 */

export const MAX_TOPIC_LEN = 20000;
export const MAX_URL_LEN = 2048;
/** Max source URLs the authoring pipeline will attempt (first N in prompt order). */
export const MAX_AUTHORING_SOURCE_URLS = 5;
/** Concurrent article fetches during fresh authoring. */
export const RESEARCH_INGEST_CONCURRENCY = 2;
/** Soft cap on retained characters per source body after extraction. */
export const MAX_RESEARCH_CHARS_PER_SOURCE = 40_000;
/** Soft cap on total retained research characters across all sources. */
export const MAX_RESEARCH_CHARS_TOTAL = 100_000;

/** The free-form brief: the full user text + any http(s) links found in it. */
export type CreateBrief = { text: string; urls: string[] };

export type CreateValidation = { ok: true; brief: CreateBrief } | { ok: false; reason: "empty" | "too-long" };

/** Matches a URL-ish token (scheme:// or a leading www.) up to the next space. */
const URL_TOKEN = /(?:https?:\/\/|www\.)[^\s]+/gi;

/**
 * Extract the valid http(s) URLs mentioned anywhere in the text (deduped, in
 * order). Trailing prose punctuation is trimmed; `www.` is normalized to https.
 * Anything that isn't a well-formed dotted-host http(s) URL is ignored — the
 * brief is still authored, just without that link as grounding.
 */
export function extractUrls(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(URL_TOKEN)) {
    const raw = m[0].replace(/[.,;:!?)\]}'"»…]+$/u, ""); // drop trailing prose punctuation
    const candidate = /^www\./i.test(raw) ? `https://${raw}` : raw;
    if (candidate.length > MAX_URL_LEN) continue;
    try {
      const u = new URL(candidate);
      const isHttp = u.protocol === "http:" || u.protocol === "https:";
      if (isHttp && u.hostname.includes(".") && !seen.has(candidate)) {
        seen.add(candidate);
        out.push(candidate);
      }
    } catch {
      /* not a usable URL — ignore */
    }
  }
  return out;
}

export function validateCreateInput(input: CreateInput): CreateValidation {
  const trimmed = input.raw.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };
  if (trimmed.length > MAX_TOPIC_LEN) return { ok: false, reason: "too-long" };
  return { ok: true, brief: { text: trimmed, urls: extractUrls(trimmed) } };
}
