import { getDesignTokens } from "./contract-text.js";

export function outputFormat(dominant = "#38BDF8"): string {
  const tokens = getDesignTokens(dominant);
  return `ĐỊNH DẠNG TRẢ VỀ (AI_Output_Contract) — trả về TRONG MỘT REPLY:
1) Đúng MỘT khối \`\`\`json là manifest (KHÔNG chứa code):
\`\`\`json
{
  "title": "tiêu đề video (KHÔNG chứa hashtag)",
  "hashtags": ["#chu_de", "#tu_khoa"],
  "theme": { "dominant": "${tokens.ACCENT_PRIMARY}" },
  "scenes": [
    { "component": "id-canh", "eyebrow": "NHÃN", "headline": "tiêu đề cảnh", "narration": "lời đọc", "props": { }, "transitionToNext": "slide|fade|wipe|clockWipe|zoom" }
  ]
}
\`\`\`
Mỗi scene trong manifest BẮT BUỘC có field "component". KHÔNG dùng "sceneId" thay cho "component"; nếu bám content plan có sceneId thì đặt component id trùng sceneId, ví dụ { "component": "scene-01", ... }.
2) Với MỖI component id duy nhất, MỘT khối \`\`\`tsx, DÒNG ĐẦU là marker "// component: <id>", thân là module .tsx đầy đủ theo hợp đồng.
   ⚠ Khối mẫu DƯỚI ĐÂY chỉ minh hoạ CẤU TRÚC export bắt buộc + cách tự dựng bằng JSX/SVG trần — KHÔNG phải mẫu thẩm mỹ để chép cho mọi cảnh. KHÔNG còn thư viện block: mỗi cảnh TỰ DỰNG nền + bố cục + đồ hoạ bằng <div>/<svg> theo nội dung (xem QUY TẮC NỘI DUNG về sự táo bạo). KHÔNG import "@motionreal/blocks"/"@motionreal/theme":
   TUYỆT ĐỐI TRÁNH FROSTED GLASS CARD TRAP (không bọc text vào hộp kính mờ). Áp dụng các Geometric Archetypes (Pipeline Dataflow, Dual Split-Core, Metric Gauge, Architecture Stack) với SVG trần và bảng màu Palette Token Contract.
\`\`\`tsx
// component: id-canh
import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@motionreal/compositions";
export const schema = z.object({ /* props */ });
type Props = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<Props>> = () => {
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", backgroundColor: "#0B0F17" }}>
      {/* Nền bối cảnh: BG tối sâu + SPOTLIGHT radial mềm */}
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 50% 40%, ${tokens.SPOTLIGHT} 0%, rgba(11, 15, 23, 0.6) 50%, #0B0F17 90%)", pointerEvents: "none" }} />
      {/* Tự dựng Geometric Archetype và motion bằng JSX/SVG theo Palette Token Contract */}
      {/* Nội dung thật phải do presentation profile + content plan quyết định. */}
    </div>
  );
};
// CỰC KỲ QUAN TRỌNG: example PHẢI chứa dữ liệu mẫu khớp hoàn toàn với định nghĩa schema ở trên.
export const example: Props = {
  // Điền các trường dữ liệu mẫu hợp lệ ở đây
};
export default registerComponent<Props>({ id: "id-canh", displayName: "...", promptGuide: "...", schema, Component: Scene, example });
\`\`\`
id trong manifest phải KHỚP id literal trong registerComponent. KHÔNG kèm văn bản thừa ngoài các khối trên.`;
}

export const OUTPUT_FORMAT = outputFormat("#38BDF8");

export function tsxBatchOutputFormat(dominant = "#38BDF8"): string {
  const tokens = getDesignTokens(dominant);
  return `ĐỊNH DẠNG TRẢ VỀ CHO TSX BATCH:
- KHÔNG trả manifest JSON. Manifest đã được hệ thống chốt.
- KHÔNG thêm văn bản ngoài code fences.
- Trả đúng các khối \`\`\`tsx được yêu cầu trong batch, mỗi component id đúng MỘT khối.
- Mỗi khối có dòng đầu "// component: <id>" và registerComponent id khớp chính xác.
- Module phải đầy đủ, tự render raw JSX/SVG/CSS theo AUTHORING_CONTRACT, không import block/theme.
- Áp dụng các Geometric Archetypes (Pipeline Dataflow, Dual Split-Core, Metric Gauge, Architecture Stack) với Design Tokens (${tokens.ACCENT_PRIMARY}), KHÔNG dùng card kính mờ.

Khung module tối thiểu:
\`\`\`tsx
// component: id-canh
import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@motionreal/compositions";
export const schema = z.object({});
type Props = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<Props>> = () => (
  <div style={{ position: "absolute", inset: 0, overflow: "hidden", backgroundColor: "#0B0F17" }}>
    <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 50% 40%, ${tokens.SPOTLIGHT} 0%, rgba(11, 15, 23, 0.6) 50%, #0B0F17 90%)", pointerEvents: "none" }} />
    {/* Tự dựng Geometric Archetype và motion bằng JSX/SVG theo Palette Token Contract */}
    {/* Nội dung thật phải do presentation profile + scene plan quyết định. */}
  </div>
);
export const example: Props = {};
export default registerComponent<Props>({ id: "id-canh", displayName: "Scene", promptGuide: "Fresh authored scene", schema, Component: Scene, example });
\`\`\``;
}

export const TSX_BATCH_OUTPUT_FORMAT = tsxBatchOutputFormat("#38BDF8");
