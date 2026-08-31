export const OUTPUT_FORMAT = `ĐỊNH DẠNG TRẢ VỀ (AI_Output_Contract) — trả về TRONG MỘT REPLY:
1) Đúng MỘT khối \`\`\`json là manifest (KHÔNG chứa code):
\`\`\`json
{
  "title": "tiêu đề video (KHÔNG chứa hashtag)",
  "hashtags": ["#chu_de", "#tu_khoa"],
  "theme": { "dominant": "#RRGGBB" },
  "scenes": [
    { "component": "id-canh", "eyebrow": "NHÃN", "headline": "tiêu đề cảnh", "narration": "lời đọc", "props": { }, "transitionToNext": "slide|fade|wipe|clockWipe|zoom" }
  ]
}
\`\`\`
Mỗi scene trong manifest BẮT BUỘC có field "component". KHÔNG dùng "sceneId" thay cho "component"; nếu bám content plan có sceneId thì đặt component id trùng sceneId, ví dụ { "component": "scene-01", ... }.
2) Với MỖI component id duy nhất, MỘT khối \`\`\`tsx, DÒNG ĐẦU là marker "// component: <id>", thân là module .tsx đầy đủ theo hợp đồng.
   ⚠ Khối mẫu DƯỚI ĐÂY chỉ minh hoạ CẤU TRÚC export bắt buộc + cách tự dựng bằng JSX/SVG trần — KHÔNG phải mẫu thẩm mỹ để chép cho mọi cảnh. KHÔNG còn thư viện block: mỗi cảnh TỰ DỰNG nền + bố cục + đồ hoạ bằng <div>/<svg> theo nội dung (xem QUY TẮC NỘI DUNG về sự táo bạo). KHÔNG import "@motionreal/blocks"/"@motionreal/theme":
\`\`\`tsx
// component: id-canh
import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@motionreal/compositions";
export const schema = z.object({ /* props */ });
type Props = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<Props>> = ({ headline }) => {
  return (
    <div style={{ position: "absolute", inset: 0, background: "transparent" }}>
      {/* Tự dựng bố cục, typography, đồ hoạ và motion phù hợp riêng với beat này. */}
      <div>{headline}</div>
    </div>
  );
};
// CỰC KỲ QUAN TRỌNG: example PHẢI chứa dữ liệu mẫu khớp hoàn toàn với định nghĩa schema ở trên.
// Ví dụ nếu ở trên schema có trường percentage thì ở đây example bắt buộc phải có percentage.
export const example: Props = {
  // Điền các trường dữ liệu mẫu hợp lệ ở đây
};
export default registerComponent<Props>({ id: "id-canh", displayName: "...", promptGuide: "...", schema, Component: Scene, example });
\`\`\`
id trong manifest phải KHỚP id literal trong registerComponent. KHÔNG kèm văn bản thừa ngoài các khối trên.`;

export const TSX_BATCH_OUTPUT_FORMAT = `ĐỊNH DẠNG TRẢ VỀ CHO TSX BATCH:
- KHÔNG trả manifest JSON. Manifest đã được hệ thống chốt.
- KHÔNG thêm văn bản ngoài code fences.
- Trả đúng các khối \`\`\`tsx được yêu cầu trong batch, mỗi component id đúng MỘT khối.
- Mỗi khối có dòng đầu "// component: <id>" và registerComponent id khớp chính xác.
- Module phải đầy đủ, tự render raw JSX/SVG/CSS theo AUTHORING_CONTRACT, không import block/theme.

Khung module tối thiểu:
\`\`\`tsx
// component: id-canh
import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@motionreal/compositions";
export const schema = z.object({});
type Props = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<Props>> = ({ headline }) => (
  <div style={{ position: "absolute", inset: 0, background: "transparent" }}>
    {/* Tự dựng hình thức riêng cho scene trong batch này. */}
    <div>{headline}</div>
  </div>
);
export const example: Props = {};
export default registerComponent<Props>({ id: "id-canh", displayName: "Scene", promptGuide: "Fresh authored scene", schema, Component: Scene, example });
\`\`\``;
