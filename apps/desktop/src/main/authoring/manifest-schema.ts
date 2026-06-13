import { z } from "zod";

/**
 * The manifest the authoring model must emit (desktop-author-mode, pure AUTHOR).
 * The AI does the JOURNALISM — Vietnamese script + structure — AND authors fresh
 * `.tsx` per scene; this manifest only carries the per-scene metadata. `component`
 * is an OPEN, AI-chosen id (no fixed kit enum); the actual `.tsx` code is parsed
 * separately by `reply-parser.ts` and matched to these ids. Parsing is defensive:
 * the model often wraps JSON in prose / code fences.
 */

/** Open component id (AI-chosen): lowercase, digits, dashes; 2–41 chars. */
export const componentId = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,40}$/, "component id phải là chữ thường/số/gạch-ngang, bắt đầu bằng chữ");

const transition = z.enum(["slide", "fade", "wipe", "clockWipe", "zoom"]);

/**
 * Truncate an over-long string BEFORE validation instead of rejecting it. The
 * model occasionally overshoots a length cap on ONE field of ONE scene (a 601-char
 * narration, a 25-char eyebrow); without this, Zod's strict `.max()` fails the
 * whole `safeParse` and the ENTIRE reply — manifest + every authored .tsx, up to
 * 14 scenes — is discarded, forcing a full re-author. Clamping the offending field
 * to its cap keeps the other 13 scenes (and the just-written code) alive. Pairs
 * with the per-field `.catch()` on enums below: a single bad field degrades to a
 * safe default rather than nuking the batch.
 */
const clampStr = (max: number) => (v: unknown) => (typeof v === "string" && v.length > max ? v.slice(0, max) : v);

/**
 * Optional per-scene image the AI may place (Phase 2 Block A). `ref` is a fixed,
 * provided project-relative local path (`assets/<sha>.<ext>`); the AI never
 * invents it (the backend strips any ref not in the provided pool). Singular by
 * schema ⇒ ≤1 image per scene. `alt` is optional accessibility/review text.
 */
const authorImageSchema = z.object({
  ref: z.string().min(1).max(512),
  alt: z.string().max(160).optional(),
});

export const authorSceneSchema = z.object({
  component: componentId,
  eyebrow: z.preprocess(clampStr(24), z.string().min(1).max(24)),
  headline: z.preprocess(clampStr(120), z.string().min(1).max(120)),
  narration: z.preprocess(clampStr(600), z.string().min(1).max(600)),
  body: z.preprocess(clampStr(200), z.string().max(200).optional()),
  props: z.record(z.string(), z.unknown()).default({}),
  image: authorImageSchema.optional(),
  // An out-of-enum value (the model occasionally invents a transition name)
  // degrades to undefined (the composition's default) instead of failing the
  // whole reply — see clampStr above for why one bad field must not nuke 14 scenes.
  transitionToNext: transition.optional().catch(undefined),
});
export type AuthorScene = z.infer<typeof authorSceneSchema>;

export const authorManifestSchema = z.object({
  title: z.preprocess(clampStr(160), z.string().min(1).max(160)),
  // mood is advisory (clamped to 40 downstream); an empty/over-long mood must not
  // discard the whole reply, so default empty and clamp rather than reject.
  theme: z.object({
    dominant: z.string().min(1),
    mood: z.preprocess((v) => (typeof v === "string" ? v.slice(0, 200) : v), z.string().catch("")),
  }),
  scenes: z.array(authorSceneSchema).min(3).max(14),
});
export type AuthorManifest = z.infer<typeof authorManifestSchema>;

export type ParseResult =
  | { ok: true; manifest: AuthorManifest }
  | { ok: false; reason: "no-json" | "invalid"; detail: string };

/** Pull the first balanced top-level JSON object out of a model reply. */
export function extractJsonObject(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return null;
}

/** Parse + validate a model reply into an `AuthorManifest`. */
export function parseAuthorManifest(text: string): ParseResult {
  const json = extractJsonObject(text);
  if (!json) return { ok: false, reason: "no-json", detail: "no JSON object found in model reply" };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { ok: false, reason: "no-json", detail: e instanceof Error ? e.message : String(e) };
  }
  const parsed = authorManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: "invalid", detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  return { ok: true, manifest: parsed.data };
}
