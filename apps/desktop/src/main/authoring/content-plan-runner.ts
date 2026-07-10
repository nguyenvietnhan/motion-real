import type { AuthorInput } from "../agent/agent-worker.js";
import type { ChatMessage } from "../gateway/ninerouter-client.js";
import {
  buildContentPlanMessages,
  buildContentPlanRepairMessages,
  contentPlanForAuthoring,
  evaluateContentPlanQuality,
  parseContentPlan,
  type ContentPlan,
  type ContentPlanQualityIssue,
  type ContentPlanQualityResult,
} from "./content-plan.js";
import { logAuthoringFailure } from "./authoring-failure.js";
import { rawAiReplyLogFields } from "./authoring-log-policy.js";
import { computePacingBudget, type PacingBudget } from "./pacing-policy.js";
import type { AuthorImageInput } from "./prompt.js";
import { excerptMatchesSource, type ResearchSource } from "./content-evidence.js";

export const CONTENT_PLAN_PARSE_FAILURE =
  "AI chưa lập được kế hoạch nội dung hợp lệ. Hãy thử lại hoặc mô tả rõ nguồn/ý chính hơn.";

export const CONTENT_PLAN_QUALITY_FAILURE =
  "AI lập kế hoạch nội dung chưa đủ hook/căn cứ/nhịp cảnh. Hãy thử lại hoặc mô tả rõ nguồn/ý chính hơn.";

type ContentPlanRunnerLogger = {
  info: (meta: unknown, message: string) => void;
  warn: (meta: unknown, message: string) => void;
  error: (meta: unknown, message: string) => void;
};

export type RunContentPlanInput = {
  model: string;
  projectId: string;
  input: AuthorInput;
  research?: string;
  /** Readable sources for claim-provenance; pass [] when URL ingest produced none. */
  researchSources?: readonly ResearchSource[];
  offeredImages?: AuthorImageInput[];
  wordsPerSecond?: number;
  chat: (model: string, messages: ChatMessage[]) => Promise<string>;
  callErrorMessage: (error: unknown) => string;
  logger: ContentPlanRunnerLogger;
};

export type RunContentPlanResult =
  | { ok: true; contentPlan: ContentPlan; advisories: ContentPlanQualityIssue[] }
  | { ok: false; message: string };

export async function runContentPlan(args: RunContentPlanInput): Promise<RunContentPlanResult> {
  const pacing = computePacingBudget(args.input, args.wordsPerSecond);
  const messages = buildContentPlanMessages(
    args.input,
    args.research,
    args.offeredImages,
    args.wordsPerSecond,
    args.researchSources,
  );
  try {
    args.logger.info({ model: args.model, projectId: args.projectId }, "calling AI model for content planning");
    const planReply = await args.chat(args.model, messages);
    args.logger.info({ projectId: args.projectId, replyChars: planReply.length }, "AI content plan replied");
    const parsedPlan = parseContentPlan(planReply);
    if (!parsedPlan.ok) {
      logAuthoringFailure(
        args.logger,
        {
          class: "content-plan-parse",
          projectId: args.projectId,
          reason: parsedPlan.reason,
          detail: parsedPlan.detail,
          ...rawAiReplyLogFields(planReply),
        },
        "content-plan parse invalid; content-plan parse failed",
      );
      return { ok: false, message: CONTENT_PLAN_PARSE_FAILURE };
    }
    logContentPlanNormalizations(args.logger, args.projectId, parsedPlan.diagnostics);

    let planned = parsedPlan.plan;
    const sources = args.researchSources;
    let quality = evaluateContentPlanQuality(planned, pacing, sources);
    if (quality.blockingIssues.length > 0) {
      const repaired = await repairContentPlanIfPossible({
        model: args.model,
        projectId: args.projectId,
        plan: planned,
        blockingIssues: quality.blockingIssues,
        pacing,
        sources,
        chat: args.chat,
        logger: args.logger,
      });
      if (repaired) {
        planned = repaired.plan;
        quality = repaired.quality;
      }
    }
    if (quality.blockingIssues.length > 0) {
      logAuthoringFailure(
        args.logger,
        { class: "content-plan-quality", projectId: args.projectId, qualityIssues: quality.blockingIssues },
        "content-plan blocking quality checks failed",
      );
      return { ok: false, message: CONTENT_PLAN_QUALITY_FAILURE };
    }
    if (quality.advisoryIssues.length > 0) {
      args.logger.warn(
        { projectId: args.projectId, qualityIssues: quality.advisoryIssues },
        "content-plan advisories passed to authoring",
      );
    }
    return { ok: true, contentPlan: contentPlanForAuthoring(planned), advisories: quality.advisoryIssues };
  } catch (error) {
    logAuthoringFailure(
      args.logger,
      { class: "content-plan-provider", projectId: args.projectId, err: error },
      "AI content-plan call failed",
    );
    return { ok: false, message: args.callErrorMessage(error) };
  }
}

function isRepairableClaimIssue(check: ContentPlanQualityIssue["check"]): boolean {
  return check === "claim-ledger" || check === "claim-provenance";
}

async function repairContentPlanIfPossible(args: {
  model: string;
  projectId: string;
  plan: ContentPlan;
  blockingIssues: readonly ContentPlanQualityIssue[];
  pacing: PacingBudget;
  sources?: readonly ResearchSource[];
  chat: (model: string, messages: ChatMessage[]) => Promise<string>;
  logger: ContentPlanRunnerLogger;
}): Promise<{ plan: ContentPlan; quality: ContentPlanQualityResult } | null> {
  if (args.blockingIssues.length === 0 || !args.blockingIssues.every((issue) => isRepairableClaimIssue(issue.check))) {
    return null;
  }

  args.logger.warn(
    {
      projectId: args.projectId,
      qualityIssues: args.blockingIssues,
      repairAttempt: 1,
    },
    "content-plan claim-ledger repair requested",
  );

  const reply = await args.chat(
    args.model,
    buildContentPlanRepairMessages(args.plan, args.blockingIssues, args.sources),
  );
  args.logger.info({ projectId: args.projectId, replyChars: reply.length, repairAttempt: 1 }, "AI content-plan repair replied");
  const parsed = parseContentPlan(reply);
  if (!parsed.ok) {
    logAuthoringFailure(
      args.logger,
      {
        class: "content-plan-repair",
        projectId: args.projectId,
        reason: parsed.reason,
        detail: parsed.detail,
        ...rawAiReplyLogFields(reply),
      },
      "content-plan repair parse invalid; content-plan repair parse failed",
    );
    return null;
  }
  logContentPlanNormalizations(args.logger, args.projectId, parsed.diagnostics);

  let plan = parsed.plan;
  let quality = evaluateContentPlanQuality(plan, args.pacing, args.sources);
  // Deterministic recovery after repair: demote unusable source_material claims
  // whenever provenance still fails (not only when it is the sole blocker).
  // Models often paraphrase arXiv/HTML text so excerpts never match exactly.
  if (
    args.sources !== undefined &&
    quality.blockingIssues.some((issue) => issue.check === "claim-provenance")
  ) {
    const recovered = recoverAfterInvalidProvenance(plan, args.sources, args.pacing);
    if (recovered.demotedClaimIds.length > 0) {
      args.logger.warn(
        {
          projectId: args.projectId,
          demotedClaimIds: recovered.demotedClaimIds,
          softenedClaimLedger: recovered.softenedClaimLedger,
        },
        "content-plan demoted unusable source_material claims after repair",
      );
      plan = recovered.plan;
      quality = recovered.quality;
    }
  }
  if (quality.blockingIssues.length > 0) {
    args.logger.error(
      { projectId: args.projectId, qualityIssues: quality.blockingIssues },
      "content-plan repair still has blocking quality checks",
    );
    return null;
  }
  return { plan, quality };
}

/**
 * After repair: demote bad source_material claims, then soften residual claim-ledger
 * blockers caused by emptied evidenceClaimIds (numbers remain in narration but we
 * refuse to invent matching excerpts). Other blockers stay hard.
 */
export function recoverAfterInvalidProvenance(
  plan: ContentPlan,
  sources: readonly ResearchSource[],
  pacing?: PacingBudget,
): {
  plan: ContentPlan;
  quality: ContentPlanQualityResult;
  demotedClaimIds: string[];
  softenedClaimLedger: boolean;
} {
  const demoted = demoteInvalidProvenanceClaims(plan, sources);
  if (demoted.demotedClaimIds.length === 0) {
    return {
      plan,
      quality: evaluateContentPlanQuality(plan, pacing, sources),
      demotedClaimIds: [],
      softenedClaimLedger: false,
    };
  }
  let quality = evaluateContentPlanQuality(demoted.plan, pacing, sources);
  let softenedClaimLedger = false;
  if (quality.blockingIssues.some((issue) => issue.check === "claim-ledger")) {
    quality = softenBlockingChecks(quality, "claim-ledger");
    softenedClaimLedger = true;
  }
  return {
    plan: demoted.plan,
    quality,
    demotedClaimIds: demoted.demotedClaimIds,
    softenedClaimLedger,
  };
}

function softenBlockingChecks(
  quality: ContentPlanQualityResult,
  check: ContentPlanQualityIssue["check"],
): ContentPlanQualityResult {
  const issues = quality.issues.map((issue) =>
    issue.check === check && issue.severity === "blocking"
      ? {
          ...issue,
          severity: "advisory" as const,
          message: `${issue.message} (advisory after demoting unusable source claims)`,
        }
      : issue,
  );
  return {
    issues,
    blockingIssues: issues.filter((issue) => issue.severity === "blocking"),
    advisoryIssues: issues.filter((issue) => issue.severity === "advisory"),
  };
}

/**
 * Deterministic recovery: unusable source_material claims become omit/uncertain
 * and are stripped from scene evidenceClaimIds. Does not invent excerpts.
 */
export function demoteInvalidProvenanceClaims(
  plan: ContentPlan,
  sources: readonly ResearchSource[],
): { plan: ContentPlan; demotedClaimIds: string[] } {
  const sourcesById = new Map(sources.map((s) => [s.id, s]));
  const demotedClaimIds: string[] = [];
  const claims = plan.claims.map((claim) => {
    const usable = claim.confidence === "supported" && claim.action === "use";
    if (!usable || claim.support !== "source_material") return claim;
    if (sources.length === 0) {
      if (claim.sourceRef) {
        demotedClaimIds.push(claim.id);
        return { ...claim, confidence: "uncertain" as const, action: "omit" as const, sourceRef: undefined };
      }
      return claim;
    }
    const ref = claim.sourceRef;
    const ok =
      ref &&
      sourcesById.has(ref.sourceId) &&
      excerptMatchesSource(ref.excerpt, sourcesById.get(ref.sourceId)!.body);
    if (ok) return claim;
    demotedClaimIds.push(claim.id);
    return { ...claim, confidence: "uncertain" as const, action: "omit" as const, sourceRef: undefined };
  });
  if (demotedClaimIds.length === 0) return { plan, demotedClaimIds };
  const demoted = new Set(demotedClaimIds);
  return {
    demotedClaimIds,
    plan: {
      ...plan,
      claims,
      scenes: plan.scenes.map((scene) => ({
        ...scene,
        evidenceClaimIds: scene.evidenceClaimIds.filter((id) => !demoted.has(id)),
      })),
    },
  };
}

function logContentPlanNormalizations(
  logger: ContentPlanRunnerLogger,
  projectId: string,
  diagnostics: readonly { kind: string }[],
): void {
  if (diagnostics.length === 0) return;
  const counts = countByKind(diagnostics);
  logger.warn(
    { projectId, diagnostics, counts },
    "content-plan tolerant normalizations applied",
  );
  if (counts["purpose-normalized"]) {
    logger.warn({ projectId, count: counts["purpose-normalized"] }, "content-plan purpose normalized");
  }
  if (counts["motion-defaulted"]) {
    logger.warn({ projectId, count: counts["motion-defaulted"] }, "content-plan motion defaulted");
  }
}

function countByKind(items: readonly { kind: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  }
  return counts;
}
