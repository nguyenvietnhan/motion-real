import { tierSeconds, titleMaxChars, type DurationTier, type VideoFormat, type VideoLanguage } from "@motionreal/schema";
import { z } from "zod";
import type { AuthorInput } from "../agent/agent-worker.js";
import { DEFAULT_ENGLISH_WORDS_PER_SECOND, DEFAULT_WORDS_PER_SECOND } from "../../shared/settings-model.js";
import type { AuthorImageInput, ContentPart, VisionMessage } from "./prompt.js";

const HookTypeSchema = z.enum(["surprise", "number", "contradiction", "question", "visual-shock", "stakes"]);
const ClaimSupportSchema = z.enum(["user_brief", "source_material", "common_knowledge"]);
const ClaimConfidenceSchema = z.enum(["supported", "uncertain"]);
const ClaimActionSchema = z.enum(["use", "omit"]);
const ScenePurposeSchema = z.enum(["hook", "context", "turn", "proof", "contrast", "payoff", "cta"]);
const LayoutFamilySchema = z.enum(["big-number", "two-column", "timeline", "diagram", "list", "signature-visual", "statement"]);

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

export type ContentPlanParseResult =
  | { ok: true; plan: ContentPlan }
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

  const parsed = ContentPlanSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: "invalid", detail: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  }
  return { ok: true, plan: parsed.data };
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
      "purpose": "hook|context|turn|proof|contrast|payoff|cta",
      "beat": "...",
      "narration": "...",
      "onScreenText": "...",
      "visualMetaphor": "...",
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
Strong:
  viewerPromise: "By the end, the viewer understands the one bottleneck making AI hardware feel impossibly expensive."
  first3SecondsLine: "The chip is not expensive because it is small. It is expensive because almost nobody can make it."
  beat: "Reveal scarcity before specs."
  visualMetaphor: "A tiny glowing chip behind a huge locked factory gate."

Weak:
  beat: "Talk about coffee productivity."
  onScreenText: "Coffee helps people work."
  visualMetaphor: "Text on a background."
Strong:
  viewerPromise: "The viewer learns the exact tradeoff hidden inside a second cup of coffee."
  first3SecondsLine: "The second cup does not give you more focus. It borrows focus from later."
  beat: "Turn a familiar habit into a visible tradeoff."
  visualMetaphor: "A glowing battery split into morning gain and afternoon debt."`;

function systemPrompt(format: VideoFormat, tier: DurationTier, language: VideoLanguage, wordsPerSecond: number): string {
  const seconds = tierSeconds(format, tier);
  const words = Math.round(seconds * wordsPerSecond);
  const titleCap = titleMaxChars(format);
  return `You are MotionReal's CONTENT PLANNER, not the Remotion code author.
Plan a short-form video before any TSX is written. Return only valid JSON. Do not include markdown fences, commentary, JSX, imports, or component code.

TASK:
- Choose a clear story angle, hook, viewer promise, open loop, payoff, and scene-by-scene progression.
- Make Scene 1 deliver a concrete content proposition in the first 3 seconds.
- Keep the opening aligned with the title and the payoff.
- Use specific visual metaphors and layout families so later code authoring does not collapse into generic title cards.
- Every scene advances exactly one viewer-facing idea.

DELIVERY LOCKS (already chosen by the app; do not change them):
- Format: ${geometryLabel(format)}.
- Duration tier: ${seconds} seconds target, around ${words} spoken words at ~${roundRate(wordsPerSecond)} words/second.
- Video language: ${languageLabel(language)} for title, narration, on-screen text, and final viewer-facing wording.
- Publish title cap: under ${titleCap} characters.

CLAIM LEDGER RULES:
- Any number, date, price, benchmark, quote, source claim, or factual comparison must appear in "claims".
- "support" is only one of: user_brief, source_material, common_knowledge.
- "confidence" is only supported or uncertain.
- "action" is only use or omit.
- If a claim is uncertain, unsupported, or merely tempting, set confidence:"uncertain" and action:"omit".
- Scenes may reference only claims with confidence:"supported" and action:"use".
- Omitted claims are notes for safety only; do not rely on them in narration, on-screen text, title, open loop, payoff, or evidenceClaimIds.
- If no reliable claim supports a number/date/price, rewrite the beat without that detail.

STORY RUBRIC:
- Prefer a sharp hook, concrete viewer promise, and resolved payoff over a flat topic summary.
- Use narration to add meaning, not duplicate on-screen text word-for-word.
- On-screen text must be short enough to scan quickly.
- Avoid scenes that are only "headline + body text" unless purpose is deliberately "statement".
- Vary layoutFamily across scenes when the story needs contrast.

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
  const effectiveWordsPerSecond = wordsPerSecond
    ?? (language === "en" ? DEFAULT_ENGLISH_WORDS_PER_SECOND : DEFAULT_WORDS_PER_SECOND);
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
