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
- Mỗi cảnh MỘT ý; narration 1–3 câu cô đọng (khoảng 18–40 từ). Đa dạng form.
- THỜI LƯỢNG: nếu yêu cầu nêu thời lượng (vd "90 giây", "1p30s", "1 phút rưỡi"), hãy ước TỔNG lời đọc toàn video ≈ thời_lượng_giây × 2.7 từ (tiếng Việt đọc ~2.7 từ/giây) và viết ĐỦ số cảnh để đạt tổng đó — thà hơi DƯ còn hơn hụt (vd 90 giây → khoảng 230–260 từ tổng, thường 9–13 cảnh). Không nêu thời lượng thì 8–12 cảnh.`;

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
  const links = input.urls.length > 0 ? `\n\nLink trong yêu cầu: ${input.urls.join(", ")}` : "";
  const grounding = research
    ? `\n\nTư liệu đã đọc từ link (dùng làm căn cứ, không bịa thêm):\n${research}`
    : input.urls.length > 0
      ? "\n\n(Không đọc được nội dung link. Chỉ dùng thông tin trong yêu cầu + kiến thức chắc chắn về chủ đề. KHÔNG bịa số liệu, ngày tháng, giá, phần trăm hay tên sản phẩm/phiên bản mới — thiếu căn cứ thì đừng nêu.)"
      : "";
  const source = `Yêu cầu của người dùng:\n${input.text}${links}${grounding}`;
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

// --- AI visual-QA (vision critique over rendered stills) --------------------

const VISUAL_QA_SYSTEM = `Bạn là QA BỐ CỤC cho video tin tức dọc 9:16 (nền kem sáng, chữ mực gần đen, viền vuông).
Bạn được xem ảnh render (khung giữa) của từng cảnh và chỉ tìm LỖI BỐ CỤC RÕ RÀNG — KHÔNG nhận xét về "gu"/thẩm mỹ:
- chữ/khối ĐÈ LÊN NHAU hoặc chồng chéo;
- chữ bị CẮT/tràn ra ngoài khung hoặc ra mép;
- nội dung tràn xuống đáy (vùng phụ đề) hoặc lố vùng an toàn;
- phần tử lệch hẳn/mất cân đối nặng, hoặc khoảng trống lớn bất thường;
- chữ quá nhỏ/khó đọc rõ rệt.
KHÔNG báo lỗi nếu cảnh trông ổn. KHÔNG bịa. Bỏ qua khác biệt phong cách/màu sắc/sở thích.

TRẢ VỀ DUY NHẤT một khối JSON, không kèm văn bản khác:
\`\`\`json
{ "issues": [ { "sceneId": "scene-03", "issue": "mô tả ngắn lỗi bố cục", "severity": "high" } ] }
\`\`\`
severity = "high" chỉ khi lỗi rõ ràng cần sửa; "low" cho nghi ngờ nhẹ. Cảnh không lỗi thì KHÔNG liệt kê.`;

/** Build a multimodal visual-QA request: each scene's still + its id, one batched call. */
export function buildVisualQaMessages(scenes: { sceneId: string; stillDataUrl: string }[]): VisionMessage[] {
  const parts: ContentPart[] = [
    { type: "text", text: `Soát ${scenes.length} cảnh dưới đây. Mỗi ảnh kèm id của cảnh ngay trước nó.` },
  ];
  for (const s of scenes) {
    parts.push({ type: "text", text: `Cảnh "${s.sceneId}":` });
    parts.push({ type: "image_url", image_url: { url: s.stillDataUrl } });
  }
  parts.push({ type: "text", text: "Trả về đúng một khối JSON theo định dạng đã nêu." });
  return [
    { role: "system", content: VISUAL_QA_SYSTEM },
    { role: "user", content: parts },
  ];
}
