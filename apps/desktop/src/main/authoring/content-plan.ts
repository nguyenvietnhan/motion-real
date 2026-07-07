import { titleMaxChars, type DurationTier, type VideoFormat, type VideoLanguage } from "@motionreal/schema";
import { z } from "zod";
import type { AuthorInput } from "../agent/agent-worker.js";
import type { AuthorImageInput, ContentPart, VisionMessage } from "./prompt.js";
import { computePacingBudget, countWords, type PacingBudget } from "./pacing-policy.js";

const HookTypeSchema = z.enum(["surprise", "number", "contradiction", "question", "visual-shock", "stakes"]);
const ClaimSupportSchema = z.enum(["user_brief", "source_material", "common_knowledge"]);
const ClaimConfidenceSchema = z.enum(["supported", "uncertain"]);
const ClaimActionSchema = z.enum(["use", "omit"]);
const SCENE_PURPOSE_VALUES = ["hook", "context", "turn", "proof", "contrast", "payoff", "cta"] as const;
const ScenePurposeSchema = z.enum(SCENE_PURPOSE_VALUES);
const LayoutFamilySchema = z.enum(["big-number", "two-column", "timeline", "diagram", "list", "signature-visual", "statement"]);
const DEFAULT_MOTION_PROGRESSION = "Quick entrance, then readable hold.";

export const ContentPlanClaimSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    support: ClaimSupportSchema,
    confidence: ClaimConfidenceSchema,
    action: ClaimActionSchema,
  })
  .strict();

export const ContentPlanSceneSchema = z
  .object({
    sceneId: z.string().regex(/^scene-[0-9]{2}$/),
    purpose: ScenePurposeSchema,
    beat: z.string().min(1),
    narration: z.string().min(1),
    onScreenText: z.string().min(1),
    visualMetaphor: z.string().min(1),
    motionProgression: z.string().min(1),
    layoutFamily: LayoutFamilySchema,
    evidenceClaimIds: z.array(z.string()),
  })
  .strict();

export const ContentPlanSchema = z
  .object({
    title: z.string().min(1),
    viewerPromise: z.string().min(1),
    hookType: HookTypeSchema,
    first3SecondsLine: z.string().min(1),
    openLoop: z.string().min(1),
    payoff: z.string().min(1),
    claims: z.array(ContentPlanClaimSchema),
    scenes: z.array(ContentPlanSceneSchema).min(1),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const seenClaims = new Set<string>();
    const usableClaims = new Set<string>();
    for (const [index, claim] of plan.claims.entries()) {
      if (seenClaims.has(claim.id)) {
        ctx.addIssue({ code: "custom", path: ["claims", index, "id"], message: `Duplicate claim id: ${claim.id}` });
      }
      seenClaims.add(claim.id);
      if (claim.confidence === "supported" && claim.action === "use") {
        usableClaims.add(claim.id);
      }
    }

    const seenScenes = new Set<string>();
    for (const [sceneIndex, scene] of plan.scenes.entries()) {
      if (seenScenes.has(scene.sceneId)) {
        ctx.addIssue({ code: "custom", path: ["scenes", sceneIndex, "sceneId"], message: `Duplicate scene id: ${scene.sceneId}` });
      }
      seenScenes.add(scene.sceneId);
      for (const [claimIndex, claimId] of scene.evidenceClaimIds.entries()) {
        if (!seenClaims.has(claimId)) {
          ctx.addIssue({
            code: "custom",
            path: ["scenes", sceneIndex, "evidenceClaimIds", claimIndex],
            message: `Unknown claim id: ${claimId}`,
          });
        } else if (!usableClaims.has(claimId)) {
          ctx.addIssue({
            code: "custom",
            path: ["scenes", sceneIndex, "evidenceClaimIds", claimIndex],
            message: `Scene evidence may reference only supported/use claims: ${claimId}`,
          });
        }
      }
    }
  });

export type ContentPlanClaim = z.infer<typeof ContentPlanClaimSchema>;
export type ContentPlanScene = z.infer<typeof ContentPlanSceneSchema>;
export type ContentPlan = z.infer<typeof ContentPlanSchema>;
export type ScenePurpose = z.infer<typeof ScenePurposeSchema>;

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
  };

export type ContentPlanParseResult =
  | { ok: true; plan: ContentPlan; diagnostics: ContentPlanNormalizationDiagnostic[] }
  | { ok: false; reason: "no-json" | "invalid"; detail: string };

export function usableClaims(plan: ContentPlan): ContentPlanClaim[] {
  return plan.claims.filter((claim) => claim.confidence === "supported" && claim.action === "use");
}

export function contentPlanForAuthoring(plan: ContentPlan): ContentPlan {
  const usableIds = new Set(usableClaims(plan).map((claim) => claim.id));
  return {
    ...plan,
    claims: usableClaims(plan),
    scenes: plan.scenes.map((scene) => ({
      ...scene,
      evidenceClaimIds: scene.evidenceClaimIds.filter((claimId) => usableIds.has(claimId)),
    })),
  };
}

export type ContentPlanQualityCheck =
  | "hook"
  | "viewer-promise"
  | "payoff"
  | "claim-ledger"
  | "pacing"
  | "layout-diversity"
  | "motion-progression";
export type ContentPlanQualitySeverity = "blocking" | "advisory";
export type ContentPlanQualityIssue = {
  check: ContentPlanQualityCheck;
  severity: ContentPlanQualitySeverity;
  message: string;
  sceneId?: string;
};
export type ContentPlanQualityResult = {
  issues: ContentPlanQualityIssue[];
  blockingIssues: ContentPlanQualityIssue[];
  advisoryIssues: ContentPlanQualityIssue[];
};

const HIGH_RISK_FACT_PATTERNS = [
  /\b(?:19|20)\d{2}\b/,
  /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/,
  /\b\d+(?:[.,]\d+)?\s*%/,
  /(?:\$|€|£|₫|\bUSD\b|\bVND\b|\bEUR\b|\bGBP\b|\bdollars?\b|\bđồng\b)/i,
  /\b\d+(?:[.,]\d+)?\s*(?:nghìn|triệu|tỷ|million|billion|trillion|bn)\b/i,
  /\b\d+(?:[.,]\d+)?\s*(?:cycles?|chu\s*kỳ|lần\s*sạc|fps|tokens?|parameters?|tham\s*số|users?|người\s*dùng|customers?|khách\s*hàng|orders?|đơn\s*hàng|requests?|GB|MB|TB|kWh|mAh|km|kg)\b/i,
  /\b(?:according\s+to|study|studies|survey|report|research|benchmark|data\s+shows)\b/i,
  /\b(?:theo\s+(?:báo\s+cáo|nghiên\s+cứu|khảo\s+sát|dữ\s+liệu|thống\s+kê|nguồn)|nghiên\s+cứu|khảo\s+sát|báo\s+cáo|dữ\s+liệu\s+cho\s+thấy|thống\s+kê|benchmark)\b/i,
] as const;
const GENERIC_MOTION_PATTERN =
  /\b(?:text|title|headline|copy|content|card|words?)\s+(?:appears?|fades?\s+in|shows?\s+up|is\s+shown)\b|\b(?:chữ|tiêu đề|nội dung|thẻ)\s+(?:hiện ra|xuất hiện|fade\s+in)\b/i;

function hasConcreteFact(value: string): boolean {
  return HIGH_RISK_FACT_PATTERNS.some((pattern) => pattern.test(value));
}

function hasGenericMotionIntent(value: string): boolean {
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

function normalizeContentPlanCandidate(raw: unknown): { value: unknown; diagnostics: ContentPlanNormalizationDiagnostic[] } {
  if (!isRecord(raw) || !Array.isArray(raw.scenes)) return { value: raw, diagnostics: [] };
  const diagnostics: ContentPlanNormalizationDiagnostic[] = [];
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
  return { value: { ...raw, scenes }, diagnostics };
}

function contentPlanQualitySeverity(check: ContentPlanQualityCheck): ContentPlanQualitySeverity {
  return check === "layout-diversity" || check === "motion-progression" ? "advisory" : "blocking";
}

/**
 * Deterministic local review for content planning. Blocking issues protect
 * factual safety and pacing; advisory issues are fed into TSX authoring instead
 * of stopping creative plans before visual code exists.
 */
export function evaluateContentPlanQuality(plan: ContentPlan, pacing?: PacingBudget): ContentPlanQualityResult {
  const issues: ContentPlanQualityIssue[] = [];
  const addIssue = (issue: Omit<ContentPlanQualityIssue, "severity">) => {
    issues.push({ ...issue, severity: contentPlanQualitySeverity(issue.check) });
  };
  if (plan.scenes[0]?.purpose !== "hook") {
    addIssue({ check: "hook", sceneId: plan.scenes[0]?.sceneId, message: "scene-01 must be the hook beat" });
  }
  if (plan.viewerPromise.trim().length === 0) {
    addIssue({ check: "viewer-promise", message: "viewerPromise is required" });
  }
  if (plan.payoff.trim().length === 0) {
    addIssue({ check: "payoff", message: "payoff is required" });
  }

  for (const scene of plan.scenes) {
    const sceneText = `${scene.beat}\n${scene.narration}\n${scene.onScreenText}`;
    if (hasConcreteFact(sceneText) && scene.evidenceClaimIds.length === 0) {
      addIssue({
        check: "claim-ledger",
        sceneId: scene.sceneId,
        message: "number/date/price/source-like claims must reference usable evidenceClaimIds",
      });
    }
    if (hasGenericMotionIntent(scene.motionProgression)) {
      addIssue({
        check: "motion-progression",
        sceneId: scene.sceneId,
        message: "motionProgression must describe a specific motion intent, not generic text/card appearance",
      });
    }
  }

  if (pacing?.enforceScenePacing && plan.scenes.length > 0) {
    const narrationWords = plan.scenes.map((scene) => ({ sceneId: scene.sceneId, words: countWords(scene.narration) }));
    const totalNarrationWords = narrationWords.reduce((sum, scene) => sum + scene.words, 0);
    const avgNarrationWords = totalNarrationWords / plan.scenes.length;

    if (plan.scenes.length < pacing.minScenes) {
      addIssue({
        check: "pacing",
        message: `${pacing.targetSeconds}s/${pacing.targetWords} words needs at least ${pacing.minScenes} scenes; got ${plan.scenes.length}`,
      });
    }
    if (avgNarrationWords > pacing.maxAvgWordsPerScene) {
      addIssue({
        check: "pacing",
        message: `average narration is ${Math.round(avgNarrationWords)} words/scene; keep it at or below ${pacing.maxAvgWordsPerScene} by splitting beats`,
      });
    }
    for (const scene of narrationWords) {
      if (scene.words > pacing.maxSceneNarrationWords) {
        addIssue({
          check: "pacing",
          sceneId: scene.sceneId,
          message: `scene narration is ${scene.words} words; split or tighten scenes above ${pacing.maxSceneNarrationWords} words`,
        });
      }
    }
  }

  const layoutFamilies = new Set(plan.scenes.map((scene) => scene.layoutFamily));
  if (plan.scenes.length >= 3 && layoutFamilies.size < 2) {
    addIssue({ check: "layout-diversity", message: "plans with 3+ scenes should use at least 2 layout families unless intentionally formal" });
  }
  return {
    issues,
    blockingIssues: issues.filter((issue) => issue.severity === "blocking"),
    advisoryIssues: issues.filter((issue) => issue.severity === "advisory"),
  };
}

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

function roundRate(wordsPerSecond: number): number {
  return Math.round(wordsPerSecond * 10) / 10;
}

function geometryLabel(format: VideoFormat): string {
  return format === "youtube"
    ? "YouTube 16:9 horizontal, no burned caption band"
    : "TikTok/Reels/Shorts 9:16 vertical, reserve the bottom burned-caption band";
}

function languageLabel(language: VideoLanguage): string {
  return language === "en" ? "English" : "Vietnamese";
}

function outputShape(): string {
  return `{
  "title": "...",
  "viewerPromise": "...",
  "hookType": "surprise|number|contradiction|question|visual-shock|stakes",
  "first3SecondsLine": "...",
  "openLoop": "...",
  "payoff": "...",
  "claims": [
    {
      "id": "claim-01",
      "text": "...",
      "support": "user_brief|source_material|common_knowledge",
      "confidence": "supported|uncertain",
      "action": "use|omit"
    }
  ],
  "scenes": [
    {
      "sceneId": "scene-01",
      "purpose": "hook",
      "beat": "...",
      "narration": "...",
      "onScreenText": "...",
      "visualMetaphor": "...",
      "motionProgression": "...",
      "layoutFamily": "big-number|two-column|timeline|diagram|list|signature-visual|statement",
      "evidenceClaimIds": ["claim-01"]
    }
  ]
}`;
}

const POSITIVE_BEAT_EXAMPLES = `GOOD BEAT EXAMPLES (copy the reasoning quality, not the topic):
Weak:
  beat: "Explain why AI chips are expensive."
  narration: "AI chips are becoming more expensive and important."
  visualMetaphor: "A card with text."
  motionProgression: "Text appears."
Strong:
  viewerPromise: "By the end, the viewer understands the one bottleneck making AI hardware feel impossibly expensive."
  first3SecondsLine: "The chip is not expensive because it is small. It is expensive because almost nobody can make it."
  beat: "Reveal scarcity before specs."
  visualMetaphor: "A tiny glowing chip behind a huge locked factory gate."
  motionProgression: "Quick entrance: chip pops in under a second; semantic: the factory gate closes around it; living: a small warning pulse continues on the lock; final hold on the bottleneck."

Weak:
  beat: "Talk about coffee productivity."
  onScreenText: "Coffee helps people work."
  visualMetaphor: "Text on a background."
  motionProgression: "Title fades in."
Strong:
  viewerPromise: "The viewer learns the exact tradeoff hidden inside a second cup of coffee."
  first3SecondsLine: "The second cup does not give you more focus. It borrows focus from later."
  beat: "Turn a familiar habit into a visible tradeoff."
  visualMetaphor: "A glowing battery split into morning gain and afternoon debt."
  motionProgression: "Quick entrance: the split battery snaps into view; semantic: morning gain fills while an afternoon debt line grows; final hold once the tradeoff balances."`;

function systemPrompt(format: VideoFormat, tier: DurationTier, language: VideoLanguage, wordsPerSecond: number): string {
  const pacing = computePacingBudget({ format, durationTier: tier, videoLanguage: language }, wordsPerSecond);
  const titleCap = titleMaxChars(format);
  return `You are MotionReal's CONTENT PLANNER, not the Remotion code author.
Plan a short-form video before any TSX is written. Return only valid JSON. Do not include markdown fences, commentary, JSX, imports, or component code.

TASK:
- Choose a clear story angle, hook, viewer promise, open loop, payoff, and scene-by-scene progression.
- Make Scene 1 deliver a concrete content proposition in the first 3 seconds.
- Keep the opening aligned with the title and the payoff.
- Use specific visual metaphors and layout families so later code authoring does not collapse into generic title cards.
- For each scene, prefer a short motionProgression as non-code motion intent. A simple "quick entrance, then readable hold" is valid when the beat is mostly a statement; use semantic progression only when the idea truly changes over time.
- Every scene advances exactly one viewer-facing idea.

DELIVERY LOCKS (already chosen by the app; do not change them):
- Format: ${geometryLabel(format)}.
- Duration tier: ${pacing.targetSeconds} seconds target, around ${pacing.targetWords} spoken words at ~${roundRate(wordsPerSecond)} words/second.
- Pacing: plan ${pacing.minScenes}-${pacing.maxScenes} scenes, aim around ${pacing.targetScenes}; keep average narration at or below ${pacing.maxAvgWordsPerScene} words/scene and split any scene that grows past ${pacing.maxSceneNarrationWords} words.
- Video language: ${languageLabel(language)} for title, narration, on-screen text, and final viewer-facing wording.
- Publish title cap: under ${titleCap} characters.

CLAIM LEDGER RULES:
- Any statistical number, date, price, benchmark, quote, source claim, or factual comparison must appear in "claims".
- Small structural/example counts used to explain a concept (for example "2 bước", "3 yếu tố", or "100 cây" in a Random Forest metaphor) do not need a claim unless they present a real-world measurement, benchmark, date, price, or sourced claim.
- "support" is only one of: user_brief, source_material, common_knowledge.
- "confidence" is only supported or uncertain.
- "action" is only use or omit.
- If a claim is uncertain, unsupported, or merely tempting, set confidence:"uncertain" and action:"omit".
- Scenes may reference only claims with confidence:"supported" and action:"use".
- Omitted claims are notes for safety only; do not rely on them in narration, on-screen text, title, open loop, payoff, or evidenceClaimIds.
- If no reliable claim supports a statistical number/date/price/benchmark, rewrite the beat without that detail.

STORY RUBRIC:
- Prefer a sharp hook, concrete viewer promise, and resolved payoff over a flat topic summary.
- Use narration to add meaning, not duplicate on-screen text word-for-word.
- On-screen text must be short enough to scan quickly.
- Avoid scenes that are only "headline + body text" unless purpose is deliberately "statement".
- Vary layoutFamily across scenes when the story needs contrast.
- motionProgression must describe how motion should serve the beat without stretching every transition.
  Good: quick title/card entrance, line/path/chart drawing when the content evolves,
  focus shifts, small bounded wave/pulse/signal loops, or a deliberate static hold
  after the main beat lands. Bad: "text appears", "title fades in", or generic card movement.

QUALITY SELF-CHECK BEFORE FINAL JSON:
- scene-01 purpose must be "hook", and first3SecondsLine must make the viewer promise or tension concrete.
- For "purpose", use exactly one literal value: hook, context, turn, proof, contrast, payoff, cta. If unsure after scene-01, use "context" or "turn".
- viewerPromise and payoff are mandatory; payoff must answer or resolve the openLoop.
- The plan must satisfy the pacing line above; do not collapse a long target into a few long narration blocks.
- For 3+ scenes, prefer at least 2 distinct layoutFamily values unless the whole video is intentionally one formal statement.
- Any scene with a statistical number/date/price/benchmark/source-like factual detail must include evidenceClaimIds pointing only to supported/use claims.
- Every scene should have a useful motionProgression. It may be a quick reveal
  + readable hold, semantic progression, living motion, or an intentional
  mostly-static statement beat. Avoid generic "text appears".
- action:"omit" claims are safety notes only; never use them in title, narration, on-screen text, payoff, or evidenceClaimIds.

${POSITIVE_BEAT_EXAMPLES}

OUTPUT JSON SHAPE:
${outputShape()}`;
}

function userBriefBlock(input: AuthorInput, research?: string): string {
  const links = input.urls.length > 0 ? `\n\nUser-provided URLs:\n${input.urls.join("\n")}` : "";
  const grounding = research?.trim()
    ? `\n\nReadable source material. Use this as evidence; do not invent beyond it:\n${research.trim()}`
    : input.urls.length > 0
      ? "\n\nURL content could not be read. Use only the user's brief and safe common knowledge. Do not invent numbers, dates, prices, versions, quotes, or fresh claims."
      : "\n\nNo external source material was provided. Use the user's brief and safe common knowledge only; omit unsupported specifics.";
  return `User brief:\n${input.text}${links}${grounding}`;
}

function imageInstruction(images: AuthorImageInput[]): string {
  if (images.length === 0) return "";
  return `\n\nApproved image refs are fixed. You may plan how to use them, but do not invent new refs. Mention image use only when it naturally supports a scene:\n${images
    .map((image) => `- ${image.ref} (${image.width}x${image.height})`)
    .join("\n")}`;
}

export function buildContentPlanMessages(
  input: AuthorInput,
  research?: string,
  images?: AuthorImageInput[],
  wordsPerSecond?: number,
): VisionMessage[] {
  const format = input.format ?? "tiktok";
  const tier = input.durationTier ?? 1;
  const language = input.videoLanguage ?? "vi";
  const effectiveWordsPerSecond = computePacingBudget({ format, durationTier: tier, videoLanguage: language }, wordsPerSecond).wordsPerSecond;
  const imageList = images ?? [];
  const system = systemPrompt(format, tier, language, effectiveWordsPerSecond);
  const text = `${userBriefBlock(input, research)}${imageInstruction(imageList)}\n\nReturn only the content-plan JSON object.`;

  if (imageList.length === 0) {
    return [
      { role: "system", content: system },
      { role: "user", content: text },
    ];
  }

  const parts: ContentPart[] = [{ type: "text", text }];
  for (const image of imageList) {
    parts.push({ type: "text", text: `Approved image ref="${image.ref}" (${image.width}x${image.height}):` });
    parts.push({ type: "image_url", image_url: { url: image.dataUrl } });
  }
  return [
    { role: "system", content: system },
    { role: "user", content: parts },
  ];
}

export function buildContentPlanRepairMessages(plan: ContentPlan, issues: readonly ContentPlanQualityIssue[]): VisionMessage[] {
  const issueLines = issues
    .map((issue) => `- ${issue.check}${issue.sceneId ? ` @${issue.sceneId}` : ""}: ${issue.message}`)
    .join("\n");
  return [
    {
      role: "system",
      content: `You are MotionReal's CONTENT PLAN REPAIR pass. Return only the full repaired content-plan JSON object.

Keep the existing schema and story. Do not write TSX, markdown, commentary, or partial JSON.

For claim-ledger failures:
- A scene may reference only claims that already have confidence:"supported" and action:"use".
- If a concrete number/date/price/benchmark/source-like detail has no usable claim id, rewrite that scene to remove the concrete detail.
- Do not make uncertain/omit claims supported just to pass the gate.
- Do not invent new facts, sources, dates, prices, percentages, benchmarks, or quotes.`,
    },
    {
      role: "user",
      content: `Blocking content-plan issues:
${issueLines}

Original content plan:
${JSON.stringify(plan, null, 2)}

Return the full repaired content-plan JSON object only.`,
    },
  ];
}
