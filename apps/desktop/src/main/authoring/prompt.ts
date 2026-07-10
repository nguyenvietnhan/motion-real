import type { AuthorInput } from "../agent/agent-worker.js";
import type { SafetyIssue } from "@motionreal/pipeline";
import type { DurationTier, VideoFormat, VideoLanguage } from "@motionreal/schema";
import { AUTHORING_CONTRACT } from "./contract-text.js";
import type { ContentPlan, ContentPlanQualityIssue } from "./content-plan.js";
import { resolvedWordsPerSecond } from "./pacing-policy.js";
import { contentRules, formatBlock, languageBlock, tierBudgetBlock } from "./prompt-content-rules.js";
import type { ContentPart, VisionMessage } from "./prompt-message-types.js";
import { OUTPUT_FORMAT } from "./prompt-output-format.js";
import { contentPlanAdvisoryBlock, contentPlanBlock, sourceBlock } from "./prompt-plan-blocks.js";

export type { ContentPart, ChatMessage, VisionMessage } from "./prompt-message-types.js";
export { buildAuthorModuleBatchMessages, buildMissingTsxRecoveryMessages } from "./prompt-batch.js";
export type { AuthorModuleBatchMessagesInput, MissingTsxRecoveryInput } from "./prompt-batch.js";
export { buildImageFilterMessages } from "./prompt-image-filter.js";
export type { ImageFilterInput } from "./prompt-image-filter.js";
export { buildVisualQaMessages } from "./prompt-visual-qa.js";

/**
 * Author + reauthor prompt builders (pure AUTHOR). The
 * model acts as a short-form author for any supported topic and WRITES fresh
 * `.tsx` per scene per the Authoring_Contract, returning a manifest JSON + one
 * ```tsx block per component id (the author-reply contract). Reauthor sends ONE flagged scene's
 * current code + the issue (and, for layout/contrast defects, its rendered still
 * as an image part) and asks for a single corrected ```tsx block.
 */

/**
 * Build the AUTHOR system prompt for short-form 9:16. The format block fixes the
 * canvas + caption band, the tier block sets the word budget, and the language
 * block steers viewer-facing text language.
 */
function authorSystem(format: VideoFormat, tier: DurationTier, videoLanguage: VideoLanguage, wps: number): string {
  return `Bạn là tác giả video ngắn 9:16 cho MỌI chủ đề người dùng muốn (giải thích, kể chuyện, quảng bá, giáo dục, giải trí…), kiêm lập trình viên Remotion. Bạn TỰ VIẾT MỚI mã .tsx cho từng cảnh (KHÔNG chọn từ tập component có sẵn). Ưu tiên đầu tiên: trả lời đúng hợp đồng, parse được, build được, render được.

${formatBlock(format)}

${tierBudgetBlock(format, tier, videoLanguage, wps)}

${languageBlock(format, videoLanguage)}

${AUTHORING_CONTRACT}

${OUTPUT_FORMAT}

${contentRules(wps, videoLanguage)}`;
}

/** One provided image the AI may place: a fixed local `ref`, its pixel size, and a data URL to "see" it. */
export type AuthorImageInput = { ref: string; width: number; height: number; dataUrl: string };

/**
 * Extra system rule appended ONLY when images are provided, so a no-image
 * authoring call stays byte-identical to today. Tells the model the images each
 * have a FIXED `ref`, that it may place at most one per scene (via the scene's
 * `image` prop rendered through `<SceneImage>`), that it must use only the
 * provided refs (never invent a path), and that — since the user deliberately
 * picked these — it must place them (at least one), not skip them all.
 */
const IMAGE_RULE = `

ẢNH (NGƯỜI DÙNG ĐÍNH KÈM — PHẢI DÙNG): Người dùng đính kèm một số ẢNH, mỗi ảnh có một "ref" CỐ ĐỊNH (vd "assets/<hash>.png") kèm kích thước. Bạn ĐƯỢC XEM các ảnh này. Cách đặt ảnh:
- thêm "image": { "ref": "<ref đã cho>" } vào MỘT cảnh phù hợp trong manifest (tối đa 1 ảnh/cảnh; cảnh KHÔNG mang ảnh thì bỏ field này — nhưng tổng thể KHÔNG được bỏ hết ảnh, xem luật bắt buộc bên dưới);
- trong .tsx của cảnh đó, render ảnh qua block <SceneImage imageRef={image.ref} alt={image.alt} /> (image đến từ SceneComponentProps), đặt trong vùng nội dung phía trên (tránh dải phụ đề đáy) để ảnh nằm trong vùng an toàn;
- import { SceneImage } from "@motionreal/compositions" (KHÔNG phải @motionreal/blocks — block layout đã bị gỡ; SceneImage là export DUY NHẤT cho ảnh, lấy từ @motionreal/compositions). Đây là NGOẠI LỆ DUY NHẤT được phép import ngoài react/remotion/zod cho phần hình.
QUAN TRỌNG VỀ KÍCH THƯỚC: <SceneImage> TỰ canh theo đúng tỉ lệ thật của ảnh (khung ôm khít ảnh). TUYỆT ĐỐI KHÔNG bọc nó trong khung có chiều cao/rộng cố định, không dùng overflow:"hidden", height:"...px", aspectRatio hay objectFit ép quanh nó — làm vậy sẽ CẮT hoặc BÓP MÉO ảnh. Cứ đặt <SceneImage> trực tiếp trong cột nội dung; muốn giới hạn chiều cao thì truyền prop maxHeight (số px), đừng tự dựng khung.
CHỈ dùng ref đã được cung cấp, TUYỆT ĐỐI KHÔNG bịa đường dẫn/URL ảnh. Viết nội dung sao cho ảnh khớp tổng thể.
BẮT BUỘC DÙNG ẢNH: những ảnh này do NGƯỜI DÙNG chủ động chọn/đính kèm, nên PHẢI được đưa vào video — KHÔNG được bỏ hết. Hãy đặt MỖI ảnh đã cho vào một cảnh phù hợp (mỗi cảnh tối đa 1 ảnh, nên trải ảnh ra nhiều cảnh); nếu có nhiều ảnh hơn số cảnh hợp, hãy ưu tiên những ảnh khớp nội dung nhất, nhưng TỐI THIỂU phải dùng một ảnh. Soạn nội dung/kịch bản bám theo ảnh để chúng khớp tự nhiên.`;

export function buildAuthorMessages(
  input: AuthorInput,
  research?: string,
  images?: AuthorImageInput[],
  wordsPerSecond?: number,
  contentPlan?: ContentPlan,
  contentPlanAdvisories?: readonly ContentPlanQualityIssue[],
): VisionMessage[] {
  const source = sourceBlock(input, research);
  const instruction = `${source}${contentPlanBlock(contentPlan)}${contentPlanAdvisoryBlock(contentPlanAdvisories)}\n\nHãy soạn kịch bản + VIẾT MÃ .tsx cho từng cảnh, trả về đúng định dạng AI_Output_Contract.`;
  // System prompt is driven by the chosen DELIVERY FORMAT (canvas + caption
  // presence), the duration tier (word budget), and the full video language — the
  // backend injects these from the user's create-screen choice; the model never
  // picks them. Absent ⇒ the historical defaults (tiktok / tier 1 / vi).
  const videoLanguage = input.videoLanguage ?? "vi";
  const effectiveWordsPerSecond = resolvedWordsPerSecond(videoLanguage, wordsPerSecond);
  const system = authorSystem(input.format ?? "tiktok", input.durationTier ?? 1, videoLanguage, effectiveWordsPerSecond);

  // No images → keep the exact text-only shape.
  if (!images || images.length === 0) {
    return [
      { role: "system", content: system },
      { role: "user", content: instruction },
    ];
  }

  // With images: append the image rule to the system prompt and attach each
  // image as a vision part preceded by a text line naming its ref + dimensions.
  const parts: ContentPart[] = [{ type: "text", text: instruction }];
  for (const img of images) {
    parts.push({ type: "text", text: `Ảnh ref="${img.ref}" (${img.width}×${img.height}px):` });
    parts.push({ type: "image_url", image_url: { url: img.dataUrl } });
  }
  return [
    { role: "system", content: `${system}${IMAGE_RULE}` },
    { role: "user", content: parts },
  ];
}

export type ReauthorPromptInput = {
  sceneId: string;
  componentId: string;
  currentCode: string;
  issues?: SafetyIssue[];
  intent?: string;
  /** Rendered still of the flagged scene as a data URL (for layout/contrast repair). */
  stillDataUrl?: string;
  /**
   * This scene carries an image (its manifest `image.ref` is set). The reauthor
   * is a free rewrite, so without this the model "creatively" drops the image on
   * a vague edit like "make it more creative" — the manifest still references it
   * but the.tsx no longer renders it. When set, the prompt hard-requires keeping
   * the `<SceneImage imageRef={image.ref} />` block.
   */
  hasImage?: boolean;
};

/**
 * Reauthor system prompt. The multi-language design system was deleted, so a
 * repair carries only the invariant authoring contract — there is no per-style
 * slice to restore toward anymore.
 */
function reauthorSystem(): string {
  return `Bạn đang SỬA một cảnh video (module .tsx Remotion) cho đúng hợp đồng AUTHOR mode. Giữ ý/nội dung của cảnh, chỉ sửa lỗi được nêu.

NGUYÊN TẮC REWRITE: đây là sửa cục bộ, KHÔNG phải viết lại thành một cảnh an toàn/rỗng.
- BẢO TOÀN: giữ scene id/component id, ý chính, lời đọc, props dữ liệu, ảnh SceneImage, nền, bố cục, SVG/CSS tự vẽ, danh sách/số liệu, motion và visual anchor đang có.
- VÁ ĐÚNG LỖI: sửa đúng issue/intent được nêu bằng thay đổi nhỏ nhất đủ hiệu quả: reposition/scale/spacing/font/color/chia nhóm phần tử/khai báo biến thiếu. Không xoá toàn bộ đồ hoạ để né lỗi.
- TỰ KIỂM: trước khi trả code, tự kiểm rằng lỗi đã hết, không tạo lỗi bố cục mới, không mất ảnh/dữ liệu, không đổi ý cảnh, TSX vẫn parse được.
KHÔNG được thay cảnh bằng title-card đơn giản chỉ có eyebrow/headline/text. Nếu intent chỉ là "đẹp hơn"/"sáng tạo hơn", hãy biến nó thành cải thiện cụ thể về visual anchor, hierarchy, nhịp motion có mục đích hoặc bố cục đọc tốt hơn; KHÔNG coi sở thích màu/gu/thẩm mỹ là lỗi cứng.

${AUTHORING_CONTRACT}

TRẢ VỀ: DUY NHẤT MỘT khối \`\`\`tsx (dòng đầu "// component: <id>", cùng id cũ), không kèm văn bản nào khác.`;
}

export function buildReauthorMessages(input: ReauthorPromptInput): VisionMessage[] {
  const issueLines = (input.issues ?? [])
    .map((i) => `- ${i.check}${i.sceneId ? ` @${i.sceneId}` : ""}: ${i.message}`)
    .join("\n");
  const problem = issueLines || input.intent || "Cảnh cần chỉnh lại bố cục/hình ảnh.";
  // A scene that carries an image MUST keep rendering it: the reauthor is a free
  // rewrite, so a vague edit ("sáng tạo hơn") otherwise makes the model drop the
  // <SceneImage> while the manifest still references the image — the picture
  // silently vanishes from the draft. Hard-require keeping the block + its ref.
  const keepImage = input.hasImage
    ? `\n\nBẮT BUỘC GIỮ ẢNH: cảnh này CÓ ảnh — phải giữ nguyên block <SceneImage imageRef={image.ref} alt={image.alt} /> (image đến từ SceneComponentProps), KHÔNG được bỏ ảnh đi dù yêu cầu là "sáng tạo hơn"/"đẹp hơn". Đặt ảnh trong vùng nội dung an toàn như cũ; chỉ đổi cách trình bày xung quanh, đừng xoá ảnh.`
    : "";
  const text = `Cảnh "${input.sceneId}" (component id "${input.componentId}") đang lỗi:\n${problem}\n\nMÃ HIỆN TẠI:\n\`\`\`tsx\n${input.currentCode}\n\`\`\`${keepImage}\n\nVIẾT LẠI cảnh này (giữ id "${input.componentId}") để sửa lỗi trên, trả về đúng một khối \`\`\`tsx.`;
  const system = reauthorSystem();

  if (input.stillDataUrl) {
    return [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: `${text}\n\nẢnh render hiện tại của cảnh (tham chiếu lỗi bố cục/tương phản):` },
          { type: "image_url", image_url: { url: input.stillDataUrl } },
        ],
      },
    ];
  }
  return [
    { role: "system", content: system },
    { role: "user", content: text },
  ];
}
