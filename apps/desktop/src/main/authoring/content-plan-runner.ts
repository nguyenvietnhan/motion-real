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
import type { ResearchSource } from "./content-evidence.js";

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

  const quality = evaluateContentPlanQuality(parsed.plan, args.pacing, args.sources);
  if (quality.blockingIssues.length > 0) {
    args.logger.error(
      { projectId: args.projectId, qualityIssues: quality.blockingIssues },
      "content-plan repair still has blocking quality checks",
    );
    return null;
  }
  return { plan: parsed.plan, quality };
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
