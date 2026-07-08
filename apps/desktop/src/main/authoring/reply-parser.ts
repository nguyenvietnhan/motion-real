import { authorManifestSchema, componentId, extractJsonObject, type AuthorManifest } from "./manifest-schema.js";

/**
 * author-reply contract parser (pure AUTHOR). In a SINGLE
 * reply the model returns:
 * 1. exactly one ```json block — the manifest (metadata only, no code);
 * 2. one ```tsx block per UNIQUE component id, each starting with a marker
 * comment `// component: <id>` and exporting a full authored module.
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

export type ParsedAuthorModuleBatchReply =
  | { ok: true; modules: AuthoredModule[] }
  | { ok: false; reason: "no-code" | "missing-code" | "id-mismatch"; detail: string };

export type AuthorReplyManifestInspection =
  | { ok: true; manifest: AuthorManifest; sceneCount: number; componentIds: string[] }
  | { ok: false; reason: "no-manifest" | "manifest-invalid"; detail: string };

export type AuthorReplyInspection = {
  manifest: AuthorReplyManifestInspection;
  codeBlockCount: number;
  validModules: AuthoredModule[];
  validModuleIds: string[];
  missingComponentIds: string[];
  idMismatchDetails: string[];
  complete: boolean;
};

export type AuthorReplyParseSummary = {
  manifestFound: boolean;
  manifestValid: boolean;
  sceneCount: number;
  tsxModuleCount: number;
  missingComponentIdsCount: number;
  idMismatchCount: number;
  complete: boolean;
  recoveryAttempted: boolean;
};

type Fence = { lang: string; body: string };

/** Pull every fenced code block (```lang\n…\n```), with its lowercased lang tag. */
export function extractFences(text: string): Fence[] {
  const re = /```([a-zA-Z0-9_-]*)[ \t]*\r?\n([\s\S]*?)```/g;
  const out: Fence[] = [];
  let m: RegExpExecArray | null;
  let lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    out.push({ lang: (m[1] ?? "").toLowerCase(), body: m[2] ?? "" });
    lastIndex = re.lastIndex;
  }
  // Recover a final UNCLOSED fence . A reply truncated
  // mid-code-block — the model hit the provider's output-token cap and the
  // gateway's finish_reason:"length" stitching couldn't fully close it (passes
  // exhausted, or the provider never reported "length") — leaves an opening ```
  // with no closing ```. The closed-fence regex above sees ZERO blocks, so the
  // whole reply parses as "no-code" and a reauthor silently keeps the old scene
  // (the `scene-03` symptom in the wild). Since the loop consumed every COMPLETE
  // fence, any opener after `lastIndex` provably has no closing delimiter, so the
  // remainder to EOF is the (truncated) block body. A module whose
  // `registerComponent` survived the cut is thereby recovered instead of dropped;
  // one cut before `registerComponent` still fails the caller's filter → no-code
  // (correctly keeping the prior scene, never accepting half a module).
  const opener = /```([a-zA-Z0-9_-]*)[ \t]*\r?\n/g;
  opener.lastIndex = lastIndex;
  const o = opener.exec(text);
  if (o) {
    out.push({ lang: (o[1] ?? "").toLowerCase(), body: text.slice(opener.lastIndex) });
  }
  return out;
}

const TSX_LANGS = new Set(["tsx", "ts", "jsx", "typescript", "javascript", ""]);

/** A fenced code block carrying an authored module (right lang + a registerComponent call). */
function isCodeFence(f: Fence): boolean {
  return TSX_LANGS.has(f.lang) && /registerComponent\s*[<(]/.test(f.body);
}

/**
 * Recover authored modules a model returned WITHOUT any ```tsx fence (it emitted
 * the raw code straight, e.g. a reauthor reply that began `// component: …` with
 * no code fence at all — the `scene-13` symptom in the wild). The unclosed-fence
 * recovery in `extractFences` only fires when an OPENING ``` exists; with no fence
 * at all it sees zero blocks → "no-code" → the scene silently keeps its old code.
 *
 * Each `// component: <id>` marker (on its own line) starts a bare module that
 * runs to the next marker (or EOF). The manifest (which carries no marker) sits
 * before the first marker and is excluded. Returned blocks still pass through
 * `isCodeFence` + `resolveModuleId`, so a fragment cut before its
 * `registerComponent` literal is still rejected — we never accept half a module.
 */
function extractBareModules(text: string): Fence[] {
  const markerRe = /^[ \t]*\/\/[ \t]*component:[ \t]*[a-z][a-z0-9-]*[ \t]*$/gim;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(text)) !== null) starts.push(m.index);
  if (starts.length === 0) return [];
  return starts.map((start, i) => ({ lang: "tsx", body: text.slice(start, starts[i + 1] ?? text.length) }));
}

/**
 * Code blocks carrying an authored module: fenced first, and — only when the
 * model emitted NO fenced code at all — bare `// component:`-marked modules as a
 * fallback. Keeping the fence path first means a normal reply is unaffected.
 */
function codeBlocks(text: string, fences: Fence[]): Fence[] {
  const fenced = fences.filter(isCodeFence);
  if (fenced.length > 0) return fenced;
  return extractBareModules(text).filter(isCodeFence);
}

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
    // The fenced body can be truncated if a manifest STRING value itself
    // contains ``` (which closes the fence early). Only trust the fence when its
    // extracted object actually parses; otherwise fall through to the robust
    // whole-text balanced-brace scan (which tracks string state, so ``` and {}
    // inside string values are handled correctly).
    const fromFence = extractJsonObject(jsonFence.body);
    if (fromFence && parseJsonProbe(fromFence).ok) return fromFence;
  }
  // Robust fallback: the FIRST balanced, string-aware {…} in the RAW reply that
  // parses as JSON. Scanning the raw text (not a fence-sliced body) means a
  // manifest string value containing ``` no longer truncates extraction (the
  // backticks sit inside a JSON string, which the scanner skips). The manifest
  // precedes the tsx blocks in the contract, so this lands on the manifest.
  return firstParseableObject(text);
}

/**
 * Scan `text` for the first balanced `{…}` (tracking JSON string state) that
 * JSON-parses. Tries each `{` in turn, so a stray brace in prose before the
 * manifest is skipped rather than derailing extraction.
 */
function firstParseableObject(text: string): string | null {
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i]!;
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') {
        inStr = true;
      } else if (c === "{") {
        depth++;
      } else if (c === "}") {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          if (parseJsonProbe(candidate).ok) return candidate;
          break; // balanced but not valid JSON → try the next `{`
        }
      }
    }
  }
  return null;
}

type JsonParseProbe = { ok: true } | { ok: false; error: unknown };

/** Typed probe: invalid balanced candidates are expected and routed to the next scan position. */
function parseJsonProbe(s: string): JsonParseProbe {
  try {
    JSON.parse(s);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Some authoring replies leak the content-plan shape into the manifest: scenes
 * carry `sceneId` but omit the required authored `component`. Recover only when
 * the same id is also present as an authored module, so we never invent a
 * component that has no code coverage.
 */
function recoverComponentsFromSceneIds(raw: unknown, moduleIds: ReadonlySet<string>): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const manifest = raw as Record<string, unknown>;
  if (!Array.isArray(manifest.scenes)) return raw;

  let changed = false;
  const scenes = manifest.scenes.map((scene) => {
    if (!scene || typeof scene !== "object" || Array.isArray(scene)) return scene;
    const s = scene as Record<string, unknown>;
    if (s.component !== undefined) return scene;
    if (typeof s.sceneId !== "string") return scene;
    if (!componentId.safeParse(s.sceneId).success) return scene;
    if (!moduleIds.has(s.sceneId)) return scene;
    changed = true;
    return { ...s, component: s.sceneId };
  });

  return changed ? { ...manifest, scenes } : raw;
}

export function inspectAuthorReply(text: string): AuthorReplyInspection {
  const fences = extractFences(text);
  const codeFences = codeBlocks(text, fences);
  const byId = new Map<string, string>();
  const idMismatchDetails: string[] = [];
  for (const f of codeFences) {
    const r = resolveModuleId(f.body);
    if ("id" in r) {
      if (!byId.has(r.id)) byId.set(r.id, f.body);
    } else {
      idMismatchDetails.push(r.error);
    }
  }
  const moduleIds = new Set(byId.keys());
  const validModules: AuthoredModule[] = [...byId.entries()].map(([id, code]) => ({ id, code }));

  // --- (1) manifest ---
  const json = manifestJson(text, fences);
  if (!json) {
    return {
      manifest: { ok: false, reason: "no-manifest", detail: "không tìm thấy manifest JSON trong reply" },
      codeBlockCount: codeFences.length,
      validModules,
      validModuleIds: [...moduleIds],
      missingComponentIds: [],
      idMismatchDetails,
      complete: false,
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return {
      manifest: { ok: false, reason: "no-manifest", detail: e instanceof Error ? e.message : String(e) },
      codeBlockCount: codeFences.length,
      validModules,
      validModuleIds: [...moduleIds],
      missingComponentIds: [],
      idMismatchDetails,
      complete: false,
    };
  }
  const parsed = authorManifestSchema.safeParse(raw);
  const recovered = parsed.success ? parsed : authorManifestSchema.safeParse(recoverComponentsFromSceneIds(raw, moduleIds));
  if (!parsed.success) {
    if (recovered.success) {
      raw = recovered.data;
    } else {
      return {
        manifest: {
          ok: false,
          reason: "manifest-invalid",
          detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        },
        codeBlockCount: codeFences.length,
        validModules,
        validModuleIds: [...moduleIds],
        missingComponentIds: [],
        idMismatchDetails,
        complete: false,
      };
    }
  }
  const manifest = parsed.success ? parsed.data : (raw as AuthorManifest);
  const needed = new Set(manifest.scenes.map((s) => s.component));
  const missingComponentIds = [...needed].filter((id) => !byId.has(id));

  return {
    manifest: {
      ok: true,
      manifest,
      sceneCount: manifest.scenes.length,
      componentIds: [...needed],
    },
    codeBlockCount: codeFences.length,
    validModules,
    validModuleIds: [...moduleIds],
    missingComponentIds,
    idMismatchDetails,
    complete: codeFences.length > 0 && idMismatchDetails.length === 0 && missingComponentIds.length === 0,
  };
}

export function summarizeAuthorReplyInspection(
  inspection: AuthorReplyInspection,
  options: { recoveryAttempted?: boolean } = {},
): AuthorReplyParseSummary {
  return {
    manifestFound: inspection.manifest.ok || inspection.manifest.reason === "manifest-invalid",
    manifestValid: inspection.manifest.ok,
    sceneCount: inspection.manifest.ok ? inspection.manifest.sceneCount : 0,
    tsxModuleCount: inspection.validModuleIds.length,
    missingComponentIdsCount: inspection.missingComponentIds.length,
    idMismatchCount: inspection.idMismatchDetails.length,
    complete: inspection.complete,
    recoveryAttempted: options.recoveryAttempted ?? false,
  };
}

export function authorReplyParseSummary(
  text: string,
  options: { recoveryAttempted?: boolean } = {},
): AuthorReplyParseSummary {
  return summarizeAuthorReplyInspection(inspectAuthorReply(text), options);
}

/** Parse a full author reply (manifest + per-scene .tsx) per author-reply contract. */
export function parseAuthorReply(text: string): ParsedAuthorReply {
  const inspected = inspectAuthorReply(text);

  if (!inspected.manifest.ok) {
    return { ok: false, reason: inspected.manifest.reason, detail: inspected.manifest.detail };
  }

  // --- (2) code blocks ---
  if (inspected.codeBlockCount === 0) return { ok: false, reason: "no-code", detail: "không có khối .tsx nào trong reply" };
  if (inspected.idMismatchDetails.length > 0) {
    return { ok: false, reason: "id-mismatch", detail: inspected.idMismatchDetails[0]! };
  }

  // --- (3) coverage: every scene's component must have a code block ---
  if (inspected.missingComponentIds.length > 0) {
    return { ok: false, reason: "missing-code", detail: `thiếu code cho: ${inspected.missingComponentIds.join(", ")}` };
  }

  return { ok: true, manifest: inspected.manifest.manifest, modules: inspected.validModules };
}

/** Parse one batched authoring reply: TSX modules only, all ids must be expected. */
export function parseAuthorModuleBatchReply(text: string, expectedIds: readonly string[]): ParsedAuthorModuleBatchReply {
  const expected = new Set(expectedIds);
  const codeFences = codeBlocks(text, extractFences(text));
  if (codeFences.length === 0) return { ok: false, reason: "no-code", detail: "reply không có khối .tsx" };

  const byId = new Map<string, string>();
  for (const f of codeFences) {
    const r = resolveModuleId(f.body);
    if ("error" in r) return { ok: false, reason: "id-mismatch", detail: r.error };
    if (!expected.has(r.id)) {
      return { ok: false, reason: "id-mismatch", detail: `component id ngoài batch: ${r.id}` };
    }
    if (!byId.has(r.id)) byId.set(r.id, f.body);
  }

  const missing = expectedIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    return { ok: false, reason: "missing-code", detail: `thiếu code cho: ${missing.join(", ")}` };
  }

  return { ok: true, modules: expectedIds.map((id) => ({ id, code: byId.get(id)! })) };
}

/** Parse a reauthor reply: exactly one .tsx block whose id literal === expectId. */
export function parseReauthorReply(text: string, expectId: string): ParsedReauthorReply {
  const codeFences = codeBlocks(text, extractFences(text));
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
