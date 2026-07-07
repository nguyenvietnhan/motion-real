import type { ContentPart, VisionMessage } from "./prompt-message-types.js";

const VISUAL_QA_SYSTEM = `Bạn là QA BỐ CỤC cho video dọc 9:16 (bất kỳ chủ đề nào). Video có thể theo BẤT KỲ ngôn ngữ thiết kế nào (nền sáng hoặc tối, vuông hoặc bo tròn) — ĐỪNG giả định một look cố định.
Bạn được xem ảnh render (khung giữa) của từng cảnh và chỉ tìm LỖI BỐ CỤC RÕ RÀNG — KHÔNG nhận xét về "gu"/thẩm mỹ/màu sắc/phong cách:
- chữ/khối ĐÈ LÊN NHAU hoặc chồng chéo;
- chữ bị CẮT/tràn ra ngoài khung hoặc ra mép;
- nội dung tràn xuống đáy (vùng phụ đề) hoặc lố vùng an toàn;
- phần tử lệch hẳn/mất cân đối nặng, hoặc khoảng trống lớn bất thường;
- chữ quá nhỏ/khó đọc rõ rệt.
KHÔNG báo lỗi nếu cảnh trông ổn. KHÔNG bịa. Bỏ qua khác biệt phong cách/màu sắc/sở thích.
KHÔNG biến nhận xét gu như "chưa đẹp", "màu chưa hợp", "ít sáng tạo", "thiếu cao cấp" thành defect. Chỉ báo khi có lỗi bố cục khách quan nhìn thấy trong ảnh. Nếu không chắc, bỏ qua hoặc dùng severity "low".

TRẢ VỀ DUY NHẤT một khối JSON, không kèm văn bản khác:
\`\`\`json
{ "issues": [ { "sceneId": "scene-03", "issue": "mô tả ngắn lỗi bố cục", "severity": "high" } ] }
\`\`\`
severity = "high" chỉ khi lỗi rõ ràng cần sửa; "low" cho nghi ngờ nhẹ và low sẽ không tự kích hoạt sửa. Cảnh không lỗi thì KHÔNG liệt kê.`;

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
