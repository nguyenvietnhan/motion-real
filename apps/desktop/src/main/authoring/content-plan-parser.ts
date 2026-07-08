import { ContentPlanSchema, type ContentPlan } from "./content-plan-schema.js";
import { normalizeContentPlanCandidate, type ContentPlanNormalizationDiagnostic } from "./content-plan-normalize.js";

export type ContentPlanParseResult =
  | { ok: true; plan: ContentPlan; diagnostics: ContentPlanNormalizationDiagnostic[] }
  | { ok: false; reason: "no-json" | "invalid"; detail: string };

function extractJsonObject(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < body.length; index += 1) {
    const char = body[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
    } else if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return body.slice(start, index + 1);
    }
  }
  return null;
}

export function parseContentPlan(text: string): ContentPlanParseResult {
  const json = extractJsonObject(text);
  if (!json) return { ok: false, reason: "no-json", detail: "no JSON object found in content-plan reply" };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    return { ok: false, reason: "no-json", detail: error instanceof Error ? error.message : String(error) };
  }

  const normalized = normalizeContentPlanCandidate(raw);
  const parsed = ContentPlanSchema.safeParse(normalized.value);
  if (!parsed.success) {
    return { ok: false, reason: "invalid", detail: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  }
  return { ok: true, plan: parsed.data, diagnostics: normalized.diagnostics };
}
