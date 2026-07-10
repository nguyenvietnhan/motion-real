import { SCENE_PURPOSE_VALUES, type ScenePurpose } from "./content-plan-schema.js";

const DEFAULT_MOTION_PROGRESSION = "Quick entrance, then readable hold.";

const HIGH_RISK_FACT_PATTERNS = [
  /\b(?:19|20)\d{2}\b/,
  /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/,
  /\b\d+(?:[.,]\d+)?\s*%/,
  /(?:\$|€|£|₫|\bUSD\b|\bVND\b|\bEUR\b|\bGBP\b|\bdollars?\b|\bđồng\b)/i,
  /\b\d+(?:[.,]\d+)?\s*(?:nghìn|triệu|tỷ|million|billion|trillion|bn)\b/i,
  /\b\d+(?:[.,]\d+)?\s*(?:cycles?|chu\s*kỳ|lần\s*sạc|fps|tokens?|parameters?|tham\s*số|users?|người\s*dùng|customers?|khách\s*hàng|orders?|đơn\s+hàng|requests?|GB|MB|TB|kWh|mAh|km|kg)\b/i,
  /\b(?:according\s+to|study|studies|survey|report|research|benchmark|data\s+shows)\b/i,
  /\b(?:theo\s+(?:báo\s+cáo|nghiên\s+cứu|khảo\s+sát|dữ\s+liệu|thống\s+kê|nguồn)|nghiên\s+cứu|khảo\s+sát|báo\s+cáo|dữ\s+liệu\s+cho\s+thấy|thống\s+kê|benchmark)\b/i,
] as const;
const GENERIC_MOTION_PATTERN =
  /\b(?:text|title|headline|copy|content|card|words?)\s+(?:appears?|fades?\s+in|shows?\s+up|is\s+shown)\b|\b(?:chữ|tiêu đề|nội dung|thẻ)\s+(?:hiện ra|xuất hiện|fade\s+in)\b/i;

export type ContentPlanNormalizationDiagnostic =
  | {
    kind: "purpose-normalized";
    sceneId?: string;
    original: string;
    normalized: ScenePurpose;
  }
  | {
    kind: "motion-defaulted";
    sceneId?: string;
    reason: "missing" | "generic";
    original?: string;
  }
  | {
    kind: "source-ref-normalized";
    claimId?: string;
    reason: "snake-case" | "string-dropped" | "invalid-dropped";
  };

export function hasConcreteFact(value: string): boolean {
  return HIGH_RISK_FACT_PATTERNS.some((pattern) => pattern.test(value));
}

export function hasGenericMotionIntent(value: string): boolean {
  const normalized = value.trim();
  return normalized.length <= 80 && GENERIC_MOTION_PATTERN.test(normalized);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScenePurpose(value: string): value is ScenePurpose {
  return (SCENE_PURPOSE_VALUES as readonly string[]).includes(value);
}

function normalizedScenePurpose(value: unknown, sceneId: string | undefined, index: number): { purpose: ScenePurpose; original: string } | null {
  if (typeof value !== "string") return null;
  const original = value.trim();
  const normalized = original.toLowerCase().replace(/[_\s]+/g, "-");
  if (isScenePurpose(normalized)) return null;

  if (index === 0 || sceneId === "scene-01") return { original, purpose: "hook" };
  if (/^(setup|background|definition|define|intro|explain|overview|problem)$/.test(normalized)) return { original, purpose: "context" };
  if (/^(mechanism|how|how-it-works|process|step|bridge|development|turning-point|example|demo)$/.test(normalized)) {
    return { original, purpose: "turn" };
  }
  if (/^(evidence|data|source|fact|validation)$/.test(normalized)) return { original, purpose: "proof" };
  if (/^(compare|comparison|before-after|tradeoff|risk|tension)$/.test(normalized)) return { original, purpose: "contrast" };
  if (/^(conclusion|resolution|takeaway|answer|ending)$/.test(normalized)) return { original, purpose: "payoff" };
  if (/^(action|next-step|subscribe|follow)$/.test(normalized)) return { original, purpose: "cta" };
  return { original, purpose: "turn" };
}

/**
 * Coerce common model mistakes on sourceRef so parse does not fail on shape alone.
 * - snake_case keys → camelCase object
 * - bare string / unusable shape → drop (quality/repair can still enforce provenance)
 */
function normalizeClaimSourceRef(
  claim: Record<string, unknown>,
  claimId: string | undefined,
  diagnostics: ContentPlanNormalizationDiagnostic[],
): Record<string, unknown> {
  if (!("sourceRef" in claim)) return claim;
  const ref = claim.sourceRef;

  if (typeof ref === "string") {
    // Models often set sourceRef: "source-01" after repair; that is never valid schema.
    const next = { ...claim };
    delete next.sourceRef;
    diagnostics.push({
      kind: "source-ref-normalized",
      ...(claimId ? { claimId } : {}),
      reason: "string-dropped",
    });
    return next;
  }

  if (!isRecord(ref)) {
    const next = { ...claim };
    delete next.sourceRef;
    diagnostics.push({
      kind: "source-ref-normalized",
      ...(claimId ? { claimId } : {}),
      reason: "invalid-dropped",
    });
    return next;
  }

  const sourceId =
    typeof ref.sourceId === "string"
      ? ref.sourceId
      : typeof ref.source_id === "string"
        ? ref.source_id
        : undefined;
  const excerpt =
    typeof ref.excerpt === "string"
      ? ref.excerpt
      : typeof ref.quote === "string"
        ? ref.quote
        : undefined;

  if (!sourceId || !excerpt) {
    const next = { ...claim };
    delete next.sourceRef;
    diagnostics.push({
      kind: "source-ref-normalized",
      ...(claimId ? { claimId } : {}),
      reason: "invalid-dropped",
    });
    return next;
  }

  const alreadyCanonical =
    ref.sourceId === sourceId && ref.excerpt === excerpt && Object.keys(ref).every((k) => k === "sourceId" || k === "excerpt");
  if (!alreadyCanonical) {
    diagnostics.push({
      kind: "source-ref-normalized",
      ...(claimId ? { claimId } : {}),
      reason: "snake-case",
    });
  }

  return {
    ...claim,
    sourceRef: { sourceId, excerpt },
  };
}

export function normalizeContentPlanCandidate(raw: unknown): { value: unknown; diagnostics: ContentPlanNormalizationDiagnostic[] } {
  if (!isRecord(raw)) return { value: raw, diagnostics: [] };
  const diagnostics: ContentPlanNormalizationDiagnostic[] = [];

  let claims = raw.claims;
  if (Array.isArray(raw.claims)) {
    claims = raw.claims.map((claim) => {
      if (!isRecord(claim)) return claim;
      const claimId = typeof claim.id === "string" ? claim.id : undefined;
      return normalizeClaimSourceRef(claim, claimId, diagnostics);
    });
  }

  if (!Array.isArray(raw.scenes)) {
    return { value: claims === raw.claims ? raw : { ...raw, claims }, diagnostics };
  }

  const scenes = raw.scenes.map((scene, index) => {
    if (!isRecord(scene)) return scene;
    const next: Record<string, unknown> = { ...scene };
    const sceneId = typeof next.sceneId === "string" ? next.sceneId : undefined;
    const purpose = normalizedScenePurpose(next.purpose, sceneId, index);
    if (purpose) {
      next.purpose = purpose.purpose;
      diagnostics.push({ kind: "purpose-normalized", ...(sceneId ? { sceneId } : {}), original: purpose.original, normalized: purpose.purpose });
    }

    const motion = typeof next.motionProgression === "string" ? next.motionProgression.trim() : "";
    if (!motion) {
      next.motionProgression = DEFAULT_MOTION_PROGRESSION;
      diagnostics.push({ kind: "motion-defaulted", ...(sceneId ? { sceneId } : {}), reason: "missing" });
    } else if (hasGenericMotionIntent(motion)) {
      next.motionProgression = DEFAULT_MOTION_PROGRESSION;
      diagnostics.push({ kind: "motion-defaulted", ...(sceneId ? { sceneId } : {}), reason: "generic", original: motion });
    }
    return next;
  });

  return {
    value: {
      ...raw,
      ...(claims !== raw.claims ? { claims } : {}),
      scenes,
    },
    diagnostics,
  };
}
