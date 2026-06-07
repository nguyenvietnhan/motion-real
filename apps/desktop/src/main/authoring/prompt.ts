import { SCENE_KIT } from "./starter-kit.js";
import type { AuthorInput } from "../agent/agent-worker.js";

/**
 * Author prompt builder (web-dashboard A1). Assembles the system + user messages
 * that ask the model to act as a Vietnamese short-form NEWS author and return a
 * manifest JSON selecting scene-kit components + content. The hard content rules
 * mirror the engine contract (digits, no fabrication, direct hook, topic CTA).
 */

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

const KIT_SPECS = SCENE_KIT.map((k) => `- ${k.spec}`).join("\n");

const SYSTEM = `Bạn là biên tập viên video tin tức ngắn 9:16 tiếng Việt. Nhiệm vụ: biến nội dung được cung cấp thành một KỊCH BẢN video gồm nhiều cảnh, trả về DUY NHẤT một object JSON (không kèm giải thích).

QUY TẮC NỘI DUNG (bắt buộc):
- Ngôn ngữ hiển thị + lời đọc: tiếng Việt. Giữ tên thương hiệu/model bằng tiếng Anh.
- Viết SỐ bằng CHỮ SỐ ở cả headline lẫn narration (vd 92%, 2026, 110.000, 920 triệu). KHÔNG đánh vần số, KHÔNG ghép năm kiểu tiếng Anh.
- KHÔNG bịa số liệu/nguồn/ngày/giá/phần trăm. Nếu không chắc một con số, đừng nêu con số.
- scene-01 mở bằng HOOK trực diện (không chào hỏi, không định nghĩa). Cảnh CUỐI là CTA/câu hỏi gắn với chủ đề (không "like/share/subscribe" chung chung).
- Mỗi cảnh MỘT ý. narration là 1–3 câu cô đọng, đủ để đọc tự nhiên (khoảng 18–40 từ).
- Tự do nhịp: dùng 8–12 cảnh; ĐA DẠNG loại cảnh (đừng lặp một loại liên tục). Chọn loại cảnh theo nội dung: có số → ns-stat hoặc ns-meter; so sánh → ns-compare; liệt kê → ns-points hoặc ns-cards; ý/định nghĩa/hook/CTA → ns-statement.

CÁC LOẠI CẢNH CÓ SẴN (chỉ được dùng các id này):
${KIT_SPECS}

ĐỊNH DẠNG TRẢ VỀ (JSON):
{
  "title": "tiêu đề video",
  "theme": { "dominant": "#RRGGBB màu nhấn", "mood": "mô tả ngắn tông màu" },
  "scenes": [
    { "component": "ns-...", "eyebrow": "NHÃN NGẮN", "headline": "tiêu đề cảnh", "narration": "lời đọc tiếng Việt", "props": { ...theo loại cảnh... }, "transitionToNext": "slide|fade|wipe|clockWipe|zoom" }
  ]
}
Chỉ trả về JSON hợp lệ, không bọc thêm văn bản nào khác ngoài JSON.`;

export function buildAuthorMessages(input: AuthorInput, research?: string): ChatMessage[] {
  const source =
    input.kind === "url"
      ? `Nguồn (đường dẫn): ${input.url}\n\nTư liệu đã trích xuất:\n${research ?? "(không có — hãy dựa trên hiểu biết đáng tin về chủ đề của đường dẫn)"}`
      : `Chủ đề: ${input.text}${research ? `\n\nTư liệu tham khảo:\n${research}` : ""}`;
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: `${source}\n\nHãy soạn kịch bản video và trả về JSON theo đúng định dạng.` },
  ];
}
