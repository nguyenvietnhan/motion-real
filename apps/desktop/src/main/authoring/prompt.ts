import type { AuthorInput } from "../agent/agent-worker.js";
import type { SafetyIssue } from "@news/pipeline";
import { getStylePack, DEFAULT_STYLE_PACK_ID } from "@news/design";
import { AUTHORING_CONTRACT } from "./contract-text.js";

/**
 * The chosen design language's authoring contract — the visual grammar slice the
 * model must follow when writing `.tsx` for THIS look (cream/squared for
 * editorial, dark/rounded for galaxy, …). The BASE `AUTHORING_CONTRACT` is the
 * invariant layout law shared by all languages; this is appended per chosen
 * language so the AI writes genuinely on-language code, not one frozen look. An
 * unknown/absent id falls back to the default language's contract.
 */
function languageContract(stylePackId?: string): string {
  const lang = getStylePack(stylePackId) ?? getStylePack(DEFAULT_STYLE_PACK_ID)!;
  return lang.contract;
}

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
- TÁO BẠO NGAY TỪ BẢN ĐẦU (đừng "chơi an toàn" rồi đợi sửa): bản nháp ĐẦU TIÊN đã phải hấp dẫn, KHÔNG được để mọi cảnh chỉ là "một tiêu đề + một panel chữ ở giữa". Mỗi video PHẢI có: ≥1 cảnh số liệu RẤT lớn (StatBlock/CountUp 80–160px) nếu có số thật; ≥1 cảnh bố cục khác thường (HAI CỘT so sánh, danh sách KeyPoints, hoặc BarChart); ≥1 "beat chữ ký" có đồ hoạ SVG/CSS bespoke tự vẽ (không chỉ card chữ). Hình dung cụ thể cho cảnh mở đầu + cảnh điểm nhấn TRƯỚC khi viết — coi như bản cuối, không phải bản tạm.
- THỜI LƯỢNG: nếu yêu cầu nêu thời lượng (vd "90 giây", "1p30s", "1 phút rưỡi"), hãy ước TỔNG lời đọc toàn video ≈ thời_lượng_giây × 4.7 từ (giọng đọc tiếng Việt thực tế ~4.7 từ/giây — đo từ audio thật, KHÔNG phải 2.7) và viết ĐỦ số cảnh để đạt tổng đó — thà hơi DƯ còn hơn hụt (vd 90 giây → khoảng 420–460 từ tổng, thường 12–16 cảnh; 60 giây → khoảng 280–300 từ, thường 9–11 cảnh). Không nêu thời lượng thì 8–12 cảnh.`;

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
2) Với MỖI component id duy nhất, MỘT khối \`\`\`tsx, DÒNG ĐẦU là marker "// component: <id>", thân là module .tsx đầy đủ theo hợp đồng.
   ⚠ Khối mẫu DƯỚI ĐÂY chỉ minh hoạ CẤU TRÚC export bắt buộc — KHÔNG phải mẫu thẩm mỹ để chép cho mọi cảnh. ĐỪNG để các cảnh đều là "Frame > Story > TitleBlock" như mẫu; mỗi cảnh tự chọn blocks + bố cục giàu hình theo nội dung (xem QUY TẮC NỘI DUNG về sự táo bạo):
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

/**
 * Build the AUTHOR system prompt for a chosen design language. The contract is no
 * longer one frozen constant: BASE (invariant) + the chosen language's slice, so
 * a galaxy project gets galaxy authoring rules and an editorial project gets
 * editorial ones — from the SAME builder.
 */
function authorSystem(stylePackId?: string): string {
  return `Bạn là biên tập viên video tin tức ngắn 9:16 tiếng Việt, kiêm lập trình viên Remotion. Bạn TỰ VIẾT MỚI mã .tsx cho từng cảnh (KHÔNG chọn từ tập component có sẵn).

${CONTENT_RULES}

${AUTHORING_CONTRACT}

${languageContract(stylePackId)}

${OUTPUT_FORMAT}`;
}

/** One provided image the AI may place: a fixed local `ref`, its pixel size, and a data URL to "see" it. */
export type AuthorImageInput = { ref: string; width: number; height: number; dataUrl: string };

/**
 * Extra system rule appended ONLY when images are provided, so a no-image
 * authoring call stays byte-identical to today. Tells the model the images each
 * have a FIXED `ref`, that it may place at most one per scene (via the scene's
 * `image` prop rendered through `<SceneImage>`), and that it must use only the
 * provided refs (never invent a path) — unfit images may simply go unused.
 */
const IMAGE_RULE = `

ẢNH (tuỳ chọn): Người dùng đính kèm một số ẢNH, mỗi ảnh có một "ref" CỐ ĐỊNH (vd "assets/<hash>.png") kèm kích thước. Bạn ĐƯỢC XEM các ảnh này. Nếu một ảnh phù hợp nội dung, hãy:
- thêm "image": { "ref": "<ref đã cho>" } vào ĐÚNG MỘT cảnh phù hợp trong manifest (tối đa 1 ảnh/cảnh; cảnh khác không có ảnh thì bỏ field này);
- trong .tsx của cảnh đó, render ảnh qua block <SceneImage imageRef={image.ref} alt={image.alt} /> (image đến từ SceneComponentProps), đặt trong <Content>/<Story> để ảnh nằm trong vùng an toàn;
- import { SceneImage } from "@news/blocks".
QUAN TRỌNG VỀ KÍCH THƯỚC: <SceneImage> TỰ canh theo đúng tỉ lệ thật của ảnh (khung ôm khít ảnh). TUYỆT ĐỐI KHÔNG bọc nó trong khung có chiều cao/rộng cố định, không dùng overflow:"hidden", height:"...px", aspectRatio hay objectFit ép quanh nó — làm vậy sẽ CẮT hoặc BÓP MÉO ảnh. Cứ đặt <SceneImage> trực tiếp trong cột nội dung; muốn giới hạn chiều cao thì truyền prop maxHeight (số px), đừng tự dựng khung.
CHỈ dùng ref đã được cung cấp, TUYỆT ĐỐI KHÔNG bịa đường dẫn/URL ảnh. Viết nội dung sao cho ảnh khớp tổng thể.
BẮT BUỘC DÙNG ẢNH: những ảnh này do NGƯỜI DÙNG chủ động chọn/đính kèm, nên PHẢI được đưa vào video — KHÔNG được bỏ hết. Hãy đặt MỖI ảnh đã cho vào một cảnh phù hợp (mỗi cảnh tối đa 1 ảnh, nên trải ảnh ra nhiều cảnh); nếu có nhiều ảnh hơn số cảnh hợp, hãy ưu tiên những ảnh khớp nội dung nhất, nhưng TỐI THIỂU phải dùng một ảnh. Soạn nội dung/kịch bản bám theo ảnh để chúng khớp tự nhiên.`;

export function buildAuthorMessages(input: AuthorInput, research?: string, images?: AuthorImageInput[]): VisionMessage[] {
  const links = input.urls.length > 0 ? `\n\nLink trong yêu cầu: ${input.urls.join(", ")}` : "";
  const grounding = research
    ? `\n\nTư liệu đã đọc từ link (dùng làm căn cứ, không bịa thêm):\n${research}`
    : input.urls.length > 0
      ? "\n\n(Không đọc được nội dung link. Chỉ dùng thông tin trong yêu cầu + kiến thức chắc chắn về chủ đề. KHÔNG bịa số liệu, ngày tháng, giá, phần trăm hay tên sản phẩm/phiên bản mới — thiếu căn cứ thì đừng nêu.)"
      : "";
  const source = `Yêu cầu của người dùng:\n${input.text}${links}${grounding}`;
  const instruction = `${source}\n\nHãy soạn kịch bản + VIẾT MÃ .tsx cho từng cảnh, trả về đúng định dạng AI_Output_Contract.`;
  // System prompt carries the chosen design language's contract slice, so a
  // galaxy project gets galaxy authoring rules (dark/rounded/glow), an editorial
  // project gets editorial ones — same builder, per-language output.
  const system = authorSystem(input.stylePackId);

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
  /** The project's design language, so the repair stays on-language (not the default look). */
  stylePackId?: string;
  /**
   * This scene carries an image (its manifest `image.ref` is set). The reauthor
   * is a free rewrite, so without this the model "creatively" drops the image on
   * a vague edit like "make it more creative" — the manifest still references it
   * but the .tsx no longer renders it. When set, the prompt hard-requires keeping
   * the `<SceneImage imageRef={image.ref} />` block.
   */
  hasImage?: boolean;
};

/**
 * Reauthor system prompt for a chosen design language. Like the author prompt, it
 * carries BASE (invariant) + the chosen language's contract slice, so a galaxy
 * scene is repaired back to the galaxy look — not silently "fixed" toward the
 * cream/squared default.
 */
function reauthorSystem(stylePackId?: string): string {
  return `Bạn đang SỬA một cảnh video (module .tsx Remotion) cho đúng hợp đồng AUTHOR mode. Giữ ý/nội dung của cảnh, chỉ sửa lỗi được nêu.

${AUTHORING_CONTRACT}

${languageContract(stylePackId)}

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
    ? `\n\nBẮT BUỘC GIỮ ẢNH: cảnh này CÓ ảnh — phải giữ nguyên block <SceneImage imageRef={image.ref} alt={image.alt} /> (image đến từ SceneComponentProps), KHÔNG được bỏ ảnh đi dù yêu cầu là "sáng tạo hơn"/"đẹp hơn". Đặt nó trong <Content>/<Story> như cũ; chỉ đổi cách trình bày xung quanh, đừng xoá ảnh.`
    : "";
  const text = `Cảnh "${input.sceneId}" (component id "${input.componentId}") đang lỗi:\n${problem}\n\nMÃ HIỆN TẠI:\n\`\`\`tsx\n${input.currentCode}\n\`\`\`${keepImage}\n\nVIẾT LẠI cảnh này (giữ id "${input.componentId}") để sửa lỗi trên, trả về đúng một khối \`\`\`tsx.`;
  const system = reauthorSystem(input.stylePackId);

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

// --- AI visual-QA (vision critique over rendered stills) --------------------

const VISUAL_QA_SYSTEM = `Bạn là QA BỐ CỤC cho video tin tức dọc 9:16. Video có thể theo BẤT KỲ ngôn ngữ thiết kế nào (nền sáng hoặc tối, vuông hoặc bo tròn) — ĐỪNG giả định một look cố định.
Bạn được xem ảnh render (khung giữa) của từng cảnh và chỉ tìm LỖI BỐ CỤC RÕ RÀNG — KHÔNG nhận xét về "gu"/thẩm mỹ/màu sắc/phong cách:
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

// --- AI image-filter (pre-select crawled article images that fit) -----------

const IMAGE_FILTER_SYSTEM = `Bạn là biên tập ảnh cho video tin tức ngắn. Bạn được xem các ẢNH cào từ một bài báo, mỗi ảnh có một "ref" cố định, kèm tóm tắt nội dung bài. Nhiệm vụ: chọn các ảnh THỰC SỰ minh hoạ nội dung bài (ảnh chụp sự kiện/nhân vật/sản phẩm/biểu đồ liên quan).
LOẠI BỎ: logo, banner/quảng cáo, avatar tác giả, icon mạng xã hội, ảnh trang trí chung chung, ảnh không liên quan nội dung.
KHÔNG bịa ref. Chỉ trả ref có trong danh sách được cung cấp. Không có ảnh nào phù hợp thì trả mảng rỗng.

TRẢ VỀ DUY NHẤT một khối JSON, không kèm văn bản khác:
\`\`\`json
{ "keep": ["assets/<hash>.jpg", "assets/<hash>.png"] }
\`\`\``;

/** One crawled image offered to the AI-filter: its fixed local ref + a data URL to "see" it. */
export type ImageFilterInput = { ref: string; width: number; height: number; dataUrl: string };

/**
 * Build a multimodal image-filter request (Phase 2 Block B): the article summary
 * + each crawled image (its ref label, then the image) so the model can keep only
 * the ones that fit the content. Mirrors the visual-QA builder's one-batched-call
 * shape. The returned `keep` refs are intersected with the provided set by the
 * caller (defense-in-depth, same spirit as the manifest `allowedRefs` strip).
 */
export function buildImageFilterMessages(articleText: string, images: ImageFilterInput[]): VisionMessage[] {
  const summary = articleText.trim().slice(0, 4000);
  const parts: ContentPart[] = [
    { type: "text", text: `Tóm tắt nội dung bài:\n${summary || "(không có tóm tắt)"}\n\nDưới đây là ${images.length} ảnh cào từ bài. Mỗi ảnh kèm "ref" ngay trước nó. Chọn ảnh phù hợp nội dung.` },
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
