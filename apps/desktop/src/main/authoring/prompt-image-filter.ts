import type { ContentPart, VisionMessage } from "./prompt-message-types.js";

const IMAGE_FILTER_SYSTEM = `Bạn là biên tập ảnh cho video ngắn đa chủ đề. Bạn được xem các ẢNH thu thập từ một nguồn nội dung, mỗi ảnh có một "ref" cố định, kèm tóm tắt nội dung nguồn. Nhiệm vụ: chọn các ảnh THỰC SỰ minh hoạ nội dung (ảnh chụp sự kiện/nhân vật/sản phẩm/biểu đồ/địa điểm/đối tượng liên quan).
LOẠI BỎ: logo, banner/quảng cáo, avatar tác giả, icon mạng xã hội, ảnh trang trí chung chung, ảnh không liên quan nội dung.
KHÔNG bịa ref. Chỉ trả ref có trong danh sách được cung cấp. Không có ảnh nào phù hợp thì trả mảng rỗng.

TRẢ VỀ DUY NHẤT một khối JSON, không kèm văn bản khác:
\`\`\`json
{ "keep": ["assets/<hash>.jpg", "assets/<hash>.png"] }
\`\`\``;

/** One crawled image offered to the AI-filter: its fixed local ref + a data URL to "see" it. */
export type ImageFilterInput = { ref: string; width: number; height: number; dataUrl: string };

/**
 * Build a multimodal image-filter request (Phase 2 Block B): the source summary
 * + each crawled image (its ref label, then the image) so the model can keep only
 * the ones that fit the content. Mirrors the visual-QA builder's one-batched-call
 * shape. The returned `keep` refs are intersected with the provided set by the
 * caller (defense-in-depth, same spirit as the manifest `allowedRefs` strip).
 */
export function buildImageFilterMessages(sourceText: string, images: ImageFilterInput[]): VisionMessage[] {
  const summary = sourceText.trim().slice(0, 4000);
  const parts: ContentPart[] = [
    { type: "text", text: `Tóm tắt nội dung nguồn:\n${summary || "(không có tóm tắt)"}\n\nDưới đây là ${images.length} ảnh thu thập từ nguồn. Mỗi ảnh kèm "ref" ngay trước nó. Chọn ảnh phù hợp nội dung.` },
  ];
  for (const img of images) {
    parts.push({ type: "text", text: `ref="${img.ref}" (${img.width}x${img.height}):` });
    parts.push({ type: "image_url", image_url: { url: img.dataUrl } });
  }
  parts.push({ type: "text", text: "Trả về đúng một khối JSON { \"keep\": [...] } theo định dạng đã nêu." });
  return [
    { role: "system", content: IMAGE_FILTER_SYSTEM },
    { role: "user", content: parts },
  ];
}
