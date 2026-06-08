import type { AuthorInput } from "../agent/agent-worker.js";
import type { SafetyIssue } from "@news/pipeline";
import { AUTHORING_CONTRACT } from "./contract-text.js";

/**
 * Author + reauthor prompt builders (desktop-author-mode, pure AUTHOR). The
 * model acts as a Vietnamese short-form NEWS author and WRITES fresh `.tsx` per
 * scene per the Authoring_Contract, returning a manifest JSON + one ```tsx block
 * per component id (the AI_Output_Contract). Reauthor sends ONE flagged scene's
 * current code + the issue (and, for layout/contrast defects, its rendered still
 * as an image part) and asks for a single corrected ```tsx block.
 */

/** A text part or an inline image (data URL) — OpenAI multimodal content shape. */
export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

/** Plain author message (text-only content) — compatible with the gateway today. */
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Reauthor message: content may carry image parts (vision-guided repair). */
export type VisionMessage = { role: "system" | "user" | "assistant"; content: string | ContentPart[] };

const CONTENT_RULES = `QUY TẮC NỘI DUNG (bắt buộc):
- Hiển thị + lời đọc: tiếng Việt. Giữ tên thương hiệu/model bằng tiếng Anh.
- Viết SỐ bằng CHỮ SỐ ở cả headline lẫn narration (vd 92%, 2026, 110.000, 920 triệu). KHÔNG đánh vần số, KHÔNG ghép năm kiểu tiếng Anh.
- KHÔNG bịa số liệu/nguồn/ngày/giá/phần trăm. Không chắc một con số thì đừng nêu.
- scene-01 mở bằng HOOK trực diện (không chào hỏi/định nghĩa). Cảnh CUỐI là CTA/câu hỏi gắn chủ đề (không "like/share/subscribe" chung chung).
- Mỗi cảnh MỘT ý; narration 1–3 câu cô đọng (khoảng 18–40 từ). Tự do nhịp: 8–12 cảnh, đa dạng form.`;

const OUTPUT_FORMAT = `ĐỊNH DẠNG TRẢ VỀ (AI_Output_Contract) — trả về TRONG MỘT REPLY:
1) Đúng MỘT khối \`\`\`json là manifest (KHÔNG chứa code):
\`\`\`json
{
  "title": "tiêu đề video",
  "theme": { "dominant": "#RRGGBB", "mood": "mô tả ngắn tông màu" },
  "scenes": [
    { "component": "id-canh", "eyebrow": "NHÃN", "headline": "tiêu đề cảnh", "narration": "lời đọc", "props": { }, "transitionToNext": "slide|fade|wipe|clockWipe|zoom" }
  ]
}
\`\`\`
2) Với MỖI component id duy nhất, MỘT khối \`\`\`tsx, DÒNG ĐẦU là marker "// component: <id>", thân là module .tsx đầy đủ theo hợp đồng:
\`\`\`tsx
// component: id-canh
import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock } from "@news/blocks";
export const schema = z.object({ /* props */ });
type Props = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<Props>> = ({ headline, eyebrow, props }) => (
  <Frame><Story eyebrow={eyebrow ?? "TIN"}><TitleBlock headline={headline} /></Story></Frame>
);
export const example: Props = { /* hợp lệ với schema */ };
export default registerComponent<Props>({ id: "id-canh", displayName: "...", promptGuide: "...", schema, Component: Scene, example });
\`\`\`
id trong manifest phải KHỚP id literal trong registerComponent. KHÔNG kèm văn bản thừa ngoài các khối trên.`;

const AUTHOR_SYSTEM = `Bạn là biên tập viên video tin tức ngắn 9:16 tiếng Việt, kiêm lập trình viên Remotion. Bạn TỰ VIẾT MỚI mã .tsx cho từng cảnh (KHÔNG chọn từ tập component có sẵn).

${CONTENT_RULES}

${AUTHORING_CONTRACT}

${OUTPUT_FORMAT}`;

export function buildAuthorMessages(input: AuthorInput, research?: string): ChatMessage[] {
  const source =
    input.kind === "url"
      ? `Nguồn (đường dẫn): ${input.url}\n\nTư liệu đã trích xuất:\n${research ?? "(không có — dựa trên hiểu biết đáng tin về chủ đề của đường dẫn)"}`
      : `Chủ đề: ${input.text}${research ? `\n\nTư liệu tham khảo:\n${research}` : ""}`;
  return [
    { role: "system", content: AUTHOR_SYSTEM },
    { role: "user", content: `${source}\n\nHãy soạn kịch bản + VIẾT MÃ .tsx cho từng cảnh, trả về đúng định dạng AI_Output_Contract.` },
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
};

const REAUTHOR_SYSTEM = `Bạn đang SỬA một cảnh video (module .tsx Remotion) cho đúng hợp đồng AUTHOR mode. Giữ ý/nội dung của cảnh, chỉ sửa lỗi được nêu.

${AUTHORING_CONTRACT}

TRẢ VỀ: DUY NHẤT MỘT khối \`\`\`tsx (dòng đầu "// component: <id>", cùng id cũ), không kèm văn bản nào khác.`;

export function buildReauthorMessages(input: ReauthorPromptInput): VisionMessage[] {
  const issueLines = (input.issues ?? [])
    .map((i) => `- ${i.check}${i.sceneId ? ` @${i.sceneId}` : ""}: ${i.message}`)
    .join("\n");
  const problem = issueLines || input.intent || "Cảnh cần chỉnh lại bố cục/hình ảnh.";
  const text = `Cảnh "${input.sceneId}" (component id "${input.componentId}") đang lỗi:\n${problem}\n\nMÃ HIỆN TẠI:\n\`\`\`tsx\n${input.currentCode}\n\`\`\`\n\nVIẾT LẠI cảnh này (giữ id "${input.componentId}") để sửa lỗi trên, trả về đúng một khối \`\`\`tsx.`;

  if (input.stillDataUrl) {
    return [
      { role: "system", content: REAUTHOR_SYSTEM },
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
    { role: "system", content: REAUTHOR_SYSTEM },
    { role: "user", content: text },
  ];
}
