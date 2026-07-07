import type { AuthorInput } from "../agent/agent-worker.js";
import type { ChatMessage } from "../gateway/ninerouter-client.js";
import type { ContentPlan, ContentPlanQualityIssue } from "./content-plan.js";
import { rawAiReplyLogFields } from "./authoring-log-policy.js";
import type { AuthorManifest } from "./manifest-schema.js";
import {
  buildAuthorMessages,
  buildAuthorModuleBatchMessages,
  buildMissingTsxRecoveryMessages,
  type AuthorImageInput,
} from "./prompt.js";
import {
  type AuthorReplyParseSummary,
  authorReplyParseSummary,
  inspectAuthorReply,
  parseAuthorModuleBatchReply,
  parseAuthorReply,
  type AuthoredModule,
  type ParsedAuthorReply,
} from "./reply-parser.js";

export const AUTHOR_REPLY_PARSE_FAILURE =
  "AI chưa trả về kịch bản hợp lệ. Hãy thử lại hoặc mô tả rõ hơn.";

export type SuccessfulAuthorReply = Extract<ParsedAuthorReply, { ok: true }>;

type AuthorReplyLogger = {
  info: (meta: unknown, message: string) => void;
  warn: (meta: unknown, message: string) => void;
  error: (meta: unknown, message: string) => void;
};

export type AuthorReplyRunResult =
  | { ok: true; parsed: SuccessfulAuthorReply }
  | { ok: false; message: string };

export type AuthorReplyRunnerBase = {
  model: string;
  projectId: string;
  input: AuthorInput;
  research?: string;
  wordsPerSecond?: number;
  contentPlan: ContentPlan;
  contentPlanAdvisories: readonly ContentPlanQualityIssue[];
  chat: (model: string, messages: ChatMessage[]) => Promise<string>;
  callErrorMessage: (error: unknown) => string;
  callLogger: AuthorReplyLogger;
  logger: AuthorReplyLogger;
};

export async function runSingleAuthorReply(
  args: AuthorReplyRunnerBase & { offeredImages?: AuthorImageInput[] },
): Promise<AuthorReplyRunResult> {
  const messages = buildAuthorMessages(
    args.input,
    args.research,
    args.offeredImages,
    args.wordsPerSecond,
    args.contentPlan,
    args.contentPlanAdvisories,
  );
  let reply: string;
  try {
    args.callLogger.info({ model: args.model, projectId: args.projectId }, "calling AI model for authoring");
    reply = await args.chat(args.model, messages);
    args.logger.info(
      { projectId: args.projectId, replyChars: reply.length, parseSummary: authorReplyParseSummary(reply) },
      "AI replied",
    );
  } catch (error) {
    args.callLogger.error({ err: error, projectId: args.projectId }, "AI call failed");
    return { ok: false, message: args.callErrorMessage(error) };
  }

  let parsed = parseAuthorReply(reply);
  let recoveryAttempted = false;
  if (!parsed.ok) {
    const recovery = await recoverMissingTsxIfPossible({
      model: args.model,
      projectId: args.projectId,
      initialFailure: parsed,
      initialReply: reply,
      chat: args.chat,
      logger: args.logger,
    });
    parsed = recovery.parsed;
    recoveryAttempted = recovery.attempted;
  }
  if (!parsed.ok) {
    args.logger.error(
      {
        projectId: args.projectId,
        reason: parsed.reason,
        detail: parsed.detail,
        parseSummary: authorReplyParseSummary(reply, { recoveryAttempted }),
        ...rawAiReplyLogFields(reply),
      },
      "author-reply parse failed",
    );
    return { ok: false, message: AUTHOR_REPLY_PARSE_FAILURE };
  }
  return { ok: true, parsed };
}

export async function runBatchedAuthorReply(
  args: AuthorReplyRunnerBase & { batches: string[][]; batchSize: number },
): Promise<AuthorReplyRunResult> {
  const manifest = authorManifestFromContentPlan(args.contentPlan);
  const modules: AuthoredModule[] = [];
  args.logger.info(
    {
      projectId: args.projectId,
      batchCount: args.batches.length,
      batchSize: args.batchSize,
      componentCount: args.batches.reduce((sum, batch) => sum + batch.length, 0),
    },
    "authoring batch selected; authoring will use compact TSX batches",
  );

  for (const [index, componentIds] of args.batches.entries()) {
    let reply: string;
    try {
      args.callLogger.info(
        { model: args.model, projectId: args.projectId, batchIndex: index + 1, batchCount: args.batches.length, componentIds },
        "calling AI model for authoring batch",
      );
      reply = await args.chat(
        args.model,
        buildAuthorModuleBatchMessages({
          input: args.input,
          manifest,
          componentIds,
          batchIndex: index + 1,
          batchCount: args.batches.length,
          contentPlan: args.contentPlan,
          contentPlanAdvisories: args.contentPlanAdvisories,
          research: args.research,
          wordsPerSecond: args.wordsPerSecond,
        }),
      );
    } catch (error) {
      args.callLogger.error({ err: error, projectId: args.projectId, batchIndex: index + 1 }, "AI authoring batch call failed");
      return { ok: false, message: args.callErrorMessage(error) };
    }

    const parsedBatch = parseAuthorModuleBatchReply(reply, componentIds);
    if (!parsedBatch.ok) {
      args.logger.error(
        {
          projectId: args.projectId,
          batchIndex: index + 1,
          batchCount: args.batches.length,
          componentIds,
          reason: parsedBatch.reason,
          detail: parsedBatch.detail,
          ...rawAiReplyLogFields(reply),
        },
        "authoring batch parse failed",
      );
      return { ok: false, message: AUTHOR_REPLY_PARSE_FAILURE };
    }

    modules.push(...parsedBatch.modules);
    args.logger.info(
      {
        projectId: args.projectId,
        batchIndex: index + 1,
        batchCount: args.batches.length,
        replyChars: reply.length,
        tsxModuleCount: parsedBatch.modules.length,
        componentIds: parsedBatch.modules.map((module) => module.id),
      },
      "AI authoring batch replied",
    );
  }

  const structured = parseStructuredAuthorParts(manifest, modules);
  if (!structured.ok) {
    args.logger.error(
      {
        projectId: args.projectId,
        reason: structured.reason,
        detail: structured.detail,
        parseSummary: authorReplyParseSummaryFromParts(manifest, modules),
      },
      "batched author reply failed final structured validation",
    );
    return { ok: false, message: AUTHOR_REPLY_PARSE_FAILURE };
  }
  return { ok: true, parsed: structured };
}

async function recoverMissingTsxIfPossible(args: {
  model: string;
  projectId: string;
  initialFailure: Extract<ParsedAuthorReply, { ok: false }>;
  initialReply: string;
  chat: (model: string, messages: ChatMessage[]) => Promise<string>;
  logger: AuthorReplyLogger;
}): Promise<{ parsed: ParsedAuthorReply; attempted: boolean }> {
  if (args.initialFailure.reason !== "no-code" && args.initialFailure.reason !== "missing-code") {
    return { parsed: args.initialFailure, attempted: false };
  }

  const inspected = inspectAuthorReply(args.initialReply);
  if (!inspected.manifest.ok || inspected.missingComponentIds.length === 0) return { parsed: args.initialFailure, attempted: false };

  args.logger.warn(
    {
      projectId: args.projectId,
      missingComponentIds: inspected.missingComponentIds,
      existingComponentIds: inspected.validModuleIds,
      parseSummary: authorReplyParseSummary(args.initialReply),
      recoveryAttempt: 1,
    },
    "author-reply missing TSX recovery attempted; author-reply missing TSX modules; requesting bounded recovery",
  );

  let recoveryReply: string;
  try {
    recoveryReply = await args.chat(
      args.model,
      buildMissingTsxRecoveryMessages({
        manifest: inspected.manifest.manifest,
        missingComponentIds: inspected.missingComponentIds,
        existingComponentIds: inspected.validModuleIds,
      }),
    );
  } catch (error) {
    args.logger.error({ err: error, projectId: args.projectId }, "author-reply missing TSX recovery call failed");
    return { parsed: args.initialFailure, attempted: true };
  }

  const missing = new Set(inspected.missingComponentIds);
  const recoveredInspection = inspectAuthorReply(recoveryReply);
  const recoveredModules = recoveredInspection.validModules.filter((module) => missing.has(module.id));
  const combinedModules = [...inspected.validModules, ...recoveredModules];
  const strict = parseStructuredAuthorParts(inspected.manifest.manifest, combinedModules);

  if (strict.ok) {
    args.logger.info(
      {
        projectId: args.projectId,
        recoveredComponentIds: recoveredModules.map((module) => module.id),
        parseSummary: authorReplyParseSummaryFromParts(inspected.manifest.manifest, combinedModules, { recoveryAttempted: true }),
        recoveryAttempt: 1,
      },
      "author-reply missing TSX recovery succeeded",
    );
    return { parsed: strict, attempted: true };
  }

  args.logger.error(
    {
      projectId: args.projectId,
      reason: strict.reason,
      detail: strict.detail,
      missingComponentIds: inspected.missingComponentIds,
      recoveredComponentIds: recoveredModules.map((module) => module.id),
      idMismatchDetails: recoveredInspection.idMismatchDetails,
      parseSummary: authorReplyParseSummaryFromParts(inspected.manifest.manifest, combinedModules, { recoveryAttempted: true }),
      ...rawAiReplyLogFields(recoveryReply),
    },
    "author-reply missing TSX recovery failed",
  );
  return { parsed: strict, attempted: true };
}

function parseStructuredAuthorParts(manifest: AuthorManifest, modules: readonly AuthoredModule[]): ParsedAuthorReply {
  const byId = new Map<string, AuthoredModule>();
  for (const module of modules) {
    if (!byId.has(module.id)) byId.set(module.id, module);
  }
  if (byId.size === 0) return { ok: false, reason: "no-code", detail: "không có khối .tsx nào trong reply" };

  const needed = [...new Set(manifest.scenes.map((scene) => scene.component))];
  const missing = needed.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    return { ok: false, reason: "missing-code", detail: `thiếu code cho: ${missing.join(", ")}` };
  }

  return { ok: true, manifest, modules: [...byId.values()] };
}

function authorReplyParseSummaryFromParts(
  manifest: AuthorManifest,
  modules: readonly AuthoredModule[],
  options: { recoveryAttempted?: boolean } = {},
): AuthorReplyParseSummary {
  const moduleIds = new Set(modules.map((module) => module.id));
  const needed = [...new Set(manifest.scenes.map((scene) => scene.component))];
  const missing = needed.filter((id) => !moduleIds.has(id));
  return {
    manifestFound: true,
    manifestValid: true,
    sceneCount: manifest.scenes.length,
    tsxModuleCount: moduleIds.size,
    missingComponentIdsCount: missing.length,
    idMismatchCount: 0,
    complete: moduleIds.size > 0 && missing.length === 0,
    recoveryAttempted: options.recoveryAttempted ?? false,
  };
}

function clipNonEmpty(value: string, max: number, fallback: string): string {
  const trimmed = value.trim();
  const safe = trimmed.length > 0 ? trimmed : fallback;
  return safe.length > max ? safe.slice(0, max) : safe;
}

function authorManifestFromContentPlan(plan: ContentPlan): AuthorManifest {
  return {
    title: clipNonEmpty(plan.title, 160, "MotionReal draft"),
    theme: {
      dominant: "#1E9CB0",
      mood: clipNonEmpty(plan.hookType.replace(/-/g, " "), 200, "authored"),
    },
    scenes: plan.scenes.map((scene) => ({
      component: scene.sceneId,
      eyebrow: clipNonEmpty(scene.purpose.toUpperCase(), 24, "BEAT"),
      headline: clipNonEmpty(scene.onScreenText, 120, scene.beat),
      narration: clipNonEmpty(scene.narration, 600, scene.beat),
      body: clipNonEmpty(scene.beat, 200, scene.onScreenText),
      props: {},
    })),
  };
}
