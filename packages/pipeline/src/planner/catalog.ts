import { listComponents } from "@news/compositions";
import { SCENE_PACING, type DurationPreset } from "@news/schema";

/**
 * Build the planner's component catalog and system prompt. The catalog is the
 * open surface that replaces news_video_tool's closed template enum: the planner
 * is told every registered component's id, when to use it, and a valid example
 * payload, then must satisfy each component's Zod schema (enforced by N3).
 */

export type PlannerCatalogEntry = {
  id: string;
  displayName: string;
  promptGuide: string;
  example: unknown;
};

export function buildPlannerCatalog(): PlannerCatalogEntry[] {
  return listComponents().map((d) => ({
    id: d.id,
    displayName: d.displayName,
    promptGuide: d.promptGuide,
    example: d.example,
  }));
}

function catalogText(): string {
  return buildPlannerCatalog()
    .map(
      (c) =>
        `- "${c.id}" (${c.displayName}): ${c.promptGuide}\n  Example props: ${JSON.stringify(c.example)}`,
    )
    .join("\n");
}

/**
 * The full planner system prompt. Embeds the pacing ruler, the open component
 * catalog, the content contract (Vietnamese/TTS/evidence/hook/CTA), and the
 * exact JSON shape. Kept close to news_video_tool's proven prompt, adapted to
 * the open `component` + `props` schema.
 */
export function buildPlannerPrompt(prompt: string, duration: DurationPreset): string {
  const pacing = SCENE_PACING[duration];
  const components = buildPlannerCatalog().map((c) => c.id);
  const firstId = "hero-announcement";
  const lastId = "final-cta";

  return `Bạn là một biên kịch video ngắn tiếng Việt cấp cao, một người kể chuyện và đạo diễn sáng tạo. Chỉ xuất ra JSON, không markdown, không giải thích.

PROMPT CHỦ ĐỀ:
${prompt}

HỢP ĐỒNG ĐẦU RA (video-spec.json):
- "version": 1, "styleId": "clean-luxury-tech", "ratio": "9:16", "language": "vi", "duration": ${duration}.
- Mỗi scene có: "id" (scene-01, scene-02, ... tuần tự), "component", "durationInSeconds", "headline", "body", "eyebrow" (tùy chọn), "narration", "props", "sfx" (tùy chọn).
- Tổng "durationInSeconds" của các scene PHẢI đúng bằng ${duration}.

NHỊP (pacing) cho ${duration}s:
- Số cảnh: ${pacing.min}-${pacing.max}, mục tiêu ${pacing.target}.
- Mỗi cảnh khoảng ${pacing.sceneSeconds} giây, narration khoảng ${pacing.sceneNarrationWords} từ tiếng Việt.
- Tổng narration khoảng ${pacing.totalNarrationWords} từ.

COMPONENT ĐƯỢC PHÉP (chỉ dùng đúng các id này, props phải khớp ví dụ):
${catalogText()}

QUY TẮC BẮT BUỘC:
- Cảnh đầu (scene-01) PHẢI dùng component "${firstId}"; cảnh cuối PHẢI dùng "${lastId}".
- Chỉ dùng component trong danh sách: ${components.join(", ")}.
- props của mỗi cảnh phải đúng shape ví dụ của component đó.
- KHÔNG bịa nguồn tin, ngày tháng, giá, phần trăm, benchmark, hay quote không có trong prompt/ngữ cảnh.
- KHÔNG viết phụ đề/caption/transcript; KHÔNG media (assetRef, ảnh, logo, screenshot).
- Nội dung hiển thị và narration bằng tiếng Việt; giữ tên thương hiệu/thuật ngữ tiếng Anh đúng chính tả (AI, API, GPT, LLM) — KHÔNG tách "A I", KHÔNG phiên âm kiểu "Ô pân A I", "Gút gồ".
- Số trong field hiển thị giữ gọn ("2026", "92%"); trong narration viết số bằng chữ tiếng Việt cho TTS đọc.
- KHÔNG đánh số thủ công trong các item danh sách (component tự đánh số).

KỂ CHUYỆN:
- Mở đầu bằng hook 3 giây mạnh: cảnh báo, nghịch lý, hệ quả bất ngờ. KHÔNG chào hỏi, KHÔNG định nghĩa, KHÔNG hỏi chung chung.
- headline scene-01 phải khác câu narration đầu tiên.
- Xây cung kịch: hook → bối cảnh/đánh đổi → twist/insight → takeaway.
- CTA cuối bám đúng chủ đề (câu hỏi quyết định/đánh đổi), KHÔNG "đăng ký/like/theo dõi/bình luận/Bạn nghĩ sao".
- "narration" là câu nói hoàn chỉnh, tự nhiên, có chiều sâu; KHÔNG chỉ đọc lại headline.
- "body" là một dòng phụ ngắn dưới headline, không để trống.

Hãy trả về DUY NHẤT một object JSON đúng shape:
{
  "version": 1,
  "title": "...",
  "styleId": "clean-luxury-tech",
  "duration": ${duration},
  "ratio": "9:16",
  "language": "vi",
  "scenes": [
    { "id": "scene-01", "component": "${firstId}", "durationInSeconds": 0, "eyebrow": "...", "headline": "...", "body": "...", "narration": "...", "props": { }, "sfx": "transition" }
  ]
}`;
}
