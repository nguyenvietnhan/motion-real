import type { AuthorInput } from "../agent/agent-worker.js";
import { AUTHORING_CONTRACT } from "./contract-text.js";
import type { ContentPlan, ContentPlanQualityIssue } from "./content-plan.js";
import type { AuthorManifest } from "./manifest-schema.js";
import { resolvedWordsPerSecond } from "./pacing-policy.js";
import { contentRules, formatBlock, languageBlock, tierBudgetBlock } from "./prompt-content-rules.js";
import type { VisionMessage } from "./prompt-message-types.js";
import { TSX_BATCH_OUTPUT_FORMAT } from "./prompt-output-format.js";
import { batchBriefBlock, contentPlanAdvisoryBlock } from "./prompt-plan-blocks.js";

function authorModuleBatchSystem(format: NonNullable<AuthorInput["format"]>, tier: NonNullable<AuthorInput["durationTier"]>, videoLanguage: NonNullable<AuthorInput["videoLanguage"]>, wps: number): string {
  const frame = format === "youtube" ? "16:9" : "9:16";
  return `Bạn là tác giả video ngắn ${frame} kiêm lập trình viên Remotion. Hệ thống đã chốt manifest; bạn chỉ viết một batch module .tsx mới cho các component id được chỉ định. Ưu tiên đầu tiên: trả lời đúng hợp đồng, parse được, build được, render được.

${formatBlock(format)}

${tierBudgetBlock(format, tier, videoLanguage, wps)}

${languageBlock(format, videoLanguage)}

${AUTHORING_CONTRACT}

${TSX_BATCH_OUTPUT_FORMAT}

${contentRules(wps, videoLanguage)}`;
}

export type AuthorModuleBatchMessagesInput = {
  input: AuthorInput;
  manifest: AuthorManifest;
  componentIds: string[];
  batchIndex: number;
  batchCount: number;
  contentPlan: ContentPlan;
  contentPlanAdvisories?: readonly ContentPlanQualityIssue[];
  research?: string;
  wordsPerSecond?: number;
};

export function buildAuthorModuleBatchMessages(batch: AuthorModuleBatchMessagesInput): VisionMessage[] {
  const videoLanguage = batch.input.videoLanguage ?? "vi";
  const effectiveWordsPerSecond = resolvedWordsPerSecond(videoLanguage, batch.wordsPerSecond);
  const system = authorModuleBatchSystem(batch.input.format ?? "tiktok", batch.input.durationTier ?? 1, videoLanguage, effectiveWordsPerSecond);
  const wanted = new Set(batch.componentIds);
  const selectedScenes = batch.manifest.scenes.filter((scene) => wanted.has(scene.component));
  const selectedPlanScenes = batch.contentPlan.scenes.filter((scene) => wanted.has(scene.sceneId));
  const selectedClaimIds = new Set(selectedPlanScenes.flatMap((scene) => scene.evidenceClaimIds));
  const selectedClaims = batch.contentPlan.claims.filter((claim) => selectedClaimIds.has(claim.id));
  const globalPlan = {
    title: batch.contentPlan.title,
    viewerPromise: batch.contentPlan.viewerPromise,
    hookType: batch.contentPlan.hookType,
    first3SecondsLine: batch.contentPlan.first3SecondsLine,
    openLoop: batch.contentPlan.openLoop,
    payoff: batch.contentPlan.payoff,
  };
  const instruction = `${batchBriefBlock(batch.input)}

GLOBAL CONTENT PLAN:
\`\`\`json
${JSON.stringify(globalPlan, null, 2)}
\`\`\`

MANIFEST SCENES CỦA BATCH NÀY - KHÔNG ĐƯỢC THAY ĐỔI:
\`\`\`json
${JSON.stringify(selectedScenes, null, 2)}
\`\`\`

CONTENT PLAN SCENES CỦA BATCH NÀY:
\`\`\`json
${JSON.stringify(selectedPlanScenes, null, 2)}
\`\`\`

USABLE CLAIMS CẦN CHO BATCH NÀY:
\`\`\`json
${JSON.stringify(selectedClaims, null, 2)}
\`\`\`
${contentPlanAdvisoryBlock(batch.contentPlanAdvisories)}

Batch ${batch.batchIndex}/${batch.batchCount}. Component ids cần viết trong batch này, CHỈ các id này:
${batch.componentIds.join("\n")}

Scene metadata tương ứng với batch:
${JSON.stringify(selectedScenes, null, 2)}

Các component khác sẽ được viết ở batch khác. KHÔNG viết lại chúng. KHÔNG trả manifest JSON.
Trả về đúng ${batch.componentIds.length} khối \`\`\`tsx, mỗi id đúng một khối.`;

  return [
    { role: "system", content: system },
    { role: "user", content: instruction },
  ];
}

export type MissingTsxRecoveryInput = {
  manifest: unknown;
  missingComponentIds: string[];
  existingComponentIds?: string[];
};

function missingTsxRecoverySystem(): string {
  return `Bạn đang sửa một reply authoring bị thiếu module .tsx. Manifest đã hợp lệ và KHÔNG được thay đổi.

${AUTHORING_CONTRACT}

TRẢ VỀ: chỉ các khối \`\`\`tsx còn thiếu, mỗi khối có dòng đầu "// component: <id>" và registerComponent id khớp. KHÔNG trả lại manifest JSON, KHÔNG thêm văn bản ngoài code fences.`;
}

export function buildMissingTsxRecoveryMessages(input: MissingTsxRecoveryInput): VisionMessage[] {
  const existing = input.existingComponentIds && input.existingComponentIds.length > 0
    ? `\n\nComponent ids đã có code hợp lệ, KHÔNG viết lại:\n${input.existingComponentIds.join("\n")}`
    : "";
  const text = `Dùng CHÍNH XÁC manifest này làm ngữ cảnh, không sửa manifest:
\`\`\`json
${JSON.stringify(input.manifest, null, 2)}
\`\`\`

Component ids còn thiếu code .tsx, CHỈ viết các id này:
${input.missingComponentIds.join("\n")}${existing}

Trả về đúng ${input.missingComponentIds.length} khối \`\`\`tsx cho các component id còn thiếu.`;
  return [
    { role: "system", content: missingTsxRecoverySystem() },
    { role: "user", content: text },
  ];
}
