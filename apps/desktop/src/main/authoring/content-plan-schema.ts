import { z } from "zod";
import {
  resolveSceneMotionBeatAnchors,
  SceneMotionBeatSchema,
} from "@motionreal/schema";

const HookTypeSchema = z.enum(["surprise", "number", "contradiction", "question", "visual-shock", "stakes"]);
const ClaimSupportSchema = z.enum(["user_brief", "source_material", "common_knowledge"]);
const ClaimConfidenceSchema = z.enum(["supported", "uncertain"]);
const ClaimActionSchema = z.enum(["use", "omit"]);
export const SCENE_PURPOSE_VALUES = ["hook", "context", "turn", "proof", "contrast", "payoff", "cta"] as const;
export const ScenePurposeSchema = z.enum(SCENE_PURPOSE_VALUES);
const LayoutFamilySchema = z.enum(["big-number", "two-column", "timeline", "diagram", "list", "signature-visual", "statement"]);

export const SourceRefSchema = z
  .object({
    sourceId: z.string().regex(/^source-[0-9]{2}$/),
    excerpt: z.string().min(20).max(320),
  })
  .strict();

export const ContentPlanClaimSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    support: ClaimSupportSchema,
    confidence: ClaimConfidenceSchema,
    action: ClaimActionSchema,
    /** Optional; required by quality for usable source_material claims when sources exist. */
    sourceRef: SourceRefSchema.optional(),
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
    motionBeats: z.array(SceneMotionBeatSchema).min(2).max(4).optional(),
    layoutFamily: LayoutFamilySchema,
    evidenceClaimIds: z.array(z.string()),
  })
  .strict()
  .superRefine((scene, ctx) => {
    if (!scene.motionBeats) return;
    const resolved = resolveSceneMotionBeatAnchors(scene.narration, scene.motionBeats);
    if (resolved.ok) return;
    for (const message of resolved.errors) {
      ctx.addIssue({ code: "custom", path: ["motionBeats"], message });
    }
  });

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

/** Scenes whose approved motion intent explicitly requires ordered visual change. */
export function semanticMotionSceneIds(plan: ContentPlan, scope?: readonly string[]): string[] {
  const allowed = scope ? new Set(scope) : undefined;
  return plan.scenes
    .filter((scene) => (!allowed || allowed.has(scene.sceneId)) && (
      (scene.motionBeats?.length ?? 0) >= 2
      || (!scene.motionBeats && /\bsemantic\s*:/i.test(scene.motionProgression))
    ))
    .map((scene) => scene.sceneId);
}

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
