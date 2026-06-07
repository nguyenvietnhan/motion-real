import { z } from "zod";

/**
 * The manifest the authoring model must emit (web-dashboard A1). The AI does the
 * JOURNALISM — Vietnamese script + structure + which scene-kit component each
 * beat uses + its props — and returns ONLY this JSON. The .tsx code comes from a
 * proven scene kit (starter-kit.ts), so output is reliably admissible. Parsing
 * is defensive: the model often wraps JSON in prose / code fences.
 */

export const KIT_COMPONENT_IDS = ["ns-statement", "ns-stat", "ns-points", "ns-compare", "ns-cards", "ns-meter"] as const;
export type KitComponentId = (typeof KIT_COMPONENT_IDS)[number];

const transition = z.enum(["slide", "fade", "wipe", "clockWipe", "zoom"]);

export const authorSceneSchema = z.object({
  component: z.enum(KIT_COMPONENT_IDS),
  eyebrow: z.string().min(1).max(24),
  headline: z.string().min(1).max(120),
  narration: z.string().min(1).max(600),
  body: z.string().max(200).optional(),
  props: z.record(z.string(), z.unknown()).default({}),
  transitionToNext: transition.optional(),
});
export type AuthorScene = z.infer<typeof authorSceneSchema>;

export const authorManifestSchema = z.object({
  title: z.string().min(1).max(160),
  theme: z.object({ dominant: z.string().min(1), mood: z.string().min(1) }),
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
