import { authorManifestSchema, extractJsonObject, type AuthorManifest } from "./manifest-schema.js";

/**
 * AI_Output_Contract parser (desktop-author-mode, pure AUTHOR). In a SINGLE
 * reply the model returns:
 *   1. exactly one ```json block — the manifest (metadata only, no code);
 *   2. one ```tsx block per UNIQUE component id, each starting with a marker
 *      comment `// component: <id>` and exporting a full authored module.
 *
 * `.tsx` code is kept OUT of the JSON (embedding multi-line code in a JSON
 * string is fragile to escape) so the two concerns parse independently. This
 * module is PURE (no fs/registry) so it is unit/property testable.
 */

export type AuthoredModule = { id: string; code: string };

export type ParseReason =
  | "no-manifest" // không tìm thấy/parse được manifest JSON
  | "manifest-invalid" // manifest có nhưng không qua schema
  | "no-code" // không có khối .tsx nào
  | "missing-code" // một scene tham chiếu id chưa có khối code
  | "id-mismatch"; // marker ≠ id literal trong registerComponent (hoặc thiếu id)

export type ParsedAuthorReply =
  | { ok: true; manifest: AuthorManifest; modules: AuthoredModule[] }
  | { ok: false; reason: ParseReason; detail: string };

export type ParsedReauthorReply =
  | { ok: true; module: AuthoredModule }
  | { ok: false; reason: ParseReason; detail: string };

type Fence = { lang: string; body: string };

/** Pull every fenced code block (```lang\n…\n```), with its lowercased lang tag. */
export function extractFences(text: string): Fence[] {
  const re = /```([a-zA-Z0-9_-]*)[ \t]*\r?\n([\s\S]*?)```/g;
  const out: Fence[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ lang: (m[1] ?? "").toLowerCase(), body: m[2] ?? "" });
  }
  return out;
}

const TSX_LANGS = new Set(["tsx", "ts", "jsx", "typescript", "javascript", ""]);

/** First `// component: <id>` marker line in a code block, if present. */
function markerId(code: string): string | null {
  const m = /^\s*\/\/\s*component:\s*([a-z][a-z0-9-]*)\s*$/im.exec(code);
  return m ? m[1]! : null;
}

/** The literal id passed to `registerComponent({ ... id: "x" ... })`. */
function registeredId(code: string): string | null {
  const m = /registerComponent\s*(?:<[^>]*>)?\s*\(\s*\{[\s\S]*?\bid\s*:\s*["']([^"']+)["']/.exec(code);
  return m ? m[1]! : null;
}

/**
 * Resolve a code block's component id from its marker + its `registerComponent`
 * literal. Returns `{ id }` when they agree (or only one is present), or an
 * `error` describing the mismatch / missing id.
 */
function resolveModuleId(code: string): { id: string } | { error: string } {
  const marker = markerId(code);
  const literal = registeredId(code);
  if (!literal) return { error: "khối code thiếu registerComponent({ id: \"…\" }) literal" };
  if (marker && marker !== literal) return { error: `marker "${marker}" ≠ id literal "${literal}"` };
  return { id: literal };
}

/** The manifest JSON string: prefer a ```json fence, else first balanced object. */
function manifestJson(text: string, fences: Fence[]): string | null {
  const jsonFence = fences.find((f) => f.lang === "json");
  if (jsonFence) {
    const obj = extractJsonObject(jsonFence.body) ?? jsonFence.body;
    return obj;
  }
  // Fallback: a balanced object somewhere in the prose (not inside a tsx fence).
  return extractJsonObject(text);
}

/** Parse a full author reply (manifest + per-scene .tsx) per AI_Output_Contract. */
export function parseAuthorReply(text: string): ParsedAuthorReply {
  const fences = extractFences(text);

  // --- (1) manifest ---
  const json = manifestJson(text, fences);
  if (!json) return { ok: false, reason: "no-manifest", detail: "không tìm thấy manifest JSON trong reply" };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { ok: false, reason: "no-manifest", detail: e instanceof Error ? e.message : String(e) };
  }
  const parsed = authorManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "manifest-invalid",
      detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }
  const manifest = parsed.data;

  // --- (2) code blocks ---
  const codeFences = fences.filter((f) => TSX_LANGS.has(f.lang) && /registerComponent\s*[<(]/.test(f.body));
  if (codeFences.length === 0) return { ok: false, reason: "no-code", detail: "không có khối .tsx nào trong reply" };

  const byId = new Map<string, string>();
  for (const f of codeFences) {
    const r = resolveModuleId(f.body);
    if ("error" in r) return { ok: false, reason: "id-mismatch", detail: r.error };
    // Reuse the same module if an id repeats (one visual used by several beats).
    if (!byId.has(r.id)) byId.set(r.id, f.body);
  }

  // --- (3) coverage: every scene's component must have a code block ---
  const needed = new Set(manifest.scenes.map((s) => s.component));
  const missing = [...needed].filter((id) => !byId.has(id));
  if (missing.length > 0) {
    return { ok: false, reason: "missing-code", detail: `thiếu code cho: ${missing.join(", ")}` };
  }

  const modules: AuthoredModule[] = [...byId.entries()].map(([id, code]) => ({ id, code }));
  return { ok: true, manifest, modules };
}

/** Parse a reauthor reply: exactly one .tsx block whose id literal === expectId. */
export function parseReauthorReply(text: string, expectId: string): ParsedReauthorReply {
  const codeFences = extractFences(text).filter(
    (f) => TSX_LANGS.has(f.lang) && /registerComponent\s*[<(]/.test(f.body),
  );
  if (codeFences.length === 0) return { ok: false, reason: "no-code", detail: "reply không có khối .tsx" };
  if (codeFences.length > 1) {
    return { ok: false, reason: "id-mismatch", detail: `reply có ${codeFences.length} khối code, cần đúng 1` };
  }
  const r = resolveModuleId(codeFences[0]!.body);
  if ("error" in r) return { ok: false, reason: "id-mismatch", detail: r.error };
  if (r.id !== expectId) {
    return { ok: false, reason: "id-mismatch", detail: `id "${r.id}" ≠ cảnh cần sửa "${expectId}"` };
  }
  return { ok: true, module: { id: r.id, code: codeFences[0]!.body } };
}
