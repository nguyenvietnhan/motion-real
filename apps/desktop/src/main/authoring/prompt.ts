import type { AuthorInput } from "../agent/agent-worker.js";
import type { SafetyIssue } from "@news/pipeline";
import { tierSeconds, titleMaxChars, type DurationTier, type VideoFormat, type VideoLanguage } from "@news/schema";
import { AUTHORING_CONTRACT } from "./contract-text.js";
import { DEFAULT_ENGLISH_WORDS_PER_SECOND, DEFAULT_WORDS_PER_SECOND } from "../../shared/settings-model.js";

/**
 * Narration rate (words/second) used by the word-budget math. Vietnamese defaults
 * to the measured baseline; English uses a conservative provider baseline until
 * calibrations become language-aware.
 */
function roundRate(wps: number): number {
  // One decimal in the prompt copy — the model reads "≈4.7 từ/giây", not "4.7039".
  return Math.round(wps * 10) / 10;
}

/**
 * Format-specific framing the model must author to (freeform-engine R7/D8). This
 * REPLACES the deleted per-style "design language" slice: there is no style to
 * read anymore, only the delivery format's hard geometry + caption presence.
 *  - TikTok: vertical 9:16, a burned karaoke caption band lives at the bottom, so
 *    authored content must keep clear of the bottom strip.
 *  - YouTube: horizontal 16:9, NO burned caption (the platform supplies captions),
 *    so the scene uses the full frame with a landscape composition.
 */
function formatBlock(format: VideoFormat): string {
  if (format === "youtube") {
    return `KHUNG HÌNH (YouTube): NGANG 16:9 (1920×1080). KHÔNG có dải phụ đề cháy-chữ (nền tảng tự hiển thị phụ đề) — KHÔNG tự vẽ băng phụ đề ở đáy. Bố cục theo chiều NGANG, tận dụng cả bề ngang khung; tránh dồn mọi thứ vào một cột hẹp giữa màn hình.`;
  }
  return `KHUNG HÌNH (TikTok): DỌC 9:16 (1080×1920). Có dải phụ đề cháy-chữ (karaoke) ở ĐÁY khung do hệ thống tự chèn — CHỪA vùng đáy cho phụ đề, KHÔNG đặt nội dung quan trọng sát đáy. Bố cục theo chiều DỌC.`;
}

/**
 * Word-budget instruction from the user-chosen duration tier (R7.3/R7.4). The tier
 * maps to a per-format second target (`tierSeconds`); we turn that into a total
 * word budget at the selected language's rate so the model writes enough scenes to
 * hit the length (rather than guessing from the free-text brief). "Rather over
 * than under" — the pacing aim allows ±20s, never a hard cut.
 */
function tierBudgetBlock(format: VideoFormat, tier: DurationTier, language: VideoLanguage, wps: number): string {
  const seconds = tierSeconds(format, tier);
  const rate = roundRate(wps);
  const words = Math.round(seconds * wps);
  const low = Math.round((seconds - 20) * wps);
  const high = Math.round((seconds + 20) * wps);
  const languageLabel = language === "en" ? "tiếng Anh" : "tiếng Việt";
  return `MỤC TIÊU THỜI LƯỢNG: video nhắm khoảng ${seconds} giây. Giọng đọc ${languageLabel} ~${rate} từ/giây, nên hãy viết TỔNG lời đọc toàn video khoảng ${words} từ (chấp nhận ${low}–${high} từ — thà hơi DƯ còn hơn hụt), chia thành đủ số cảnh để đạt tổng đó. KHÔNG cắt câu để ép đúng giây.`;
}

/**
 * Video-language rule. The user's choice governs all viewer-facing content:
 * title, hashtags, authored display text, narration, and central captions.
 */
function languageBlock(format: VideoFormat, videoLanguage: VideoLanguage): string {
  const cap = titleMaxChars(format);
  const lang = videoLanguage === "en" ? "TIẾNG ANH" : "TIẾNG VIỆT";
  const contentRule = videoLanguage === "en"
    ? `TOÀN BỘ nội dung người xem đọc/nghe phải là TIẾNG ANH tự nhiên: "title", "hashtags", eyebrow/headline/body, narration, CTA và mọi chuỗi chữ tự viết trong JSX/SVG. Chỉ giữ nguyên tên riêng/thương hiệu. KHÔNG xen câu tiếng Việt.`
    : `TOÀN BỘ nội dung người xem đọc/nghe phải là TIẾNG VIỆT tự nhiên: "title", "hashtags", eyebrow/headline/body, narration, CTA và mọi chuỗi chữ tự viết trong JSX/SVG. Giữ tên riêng/thương hiệu/model bằng tiếng Anh khi cần.`;
  const hashtag =
    format === "tiktok"
      ? ` KÈM 3–6 hashtag phù hợp ở field RIÊNG "hashtags" (mảng, mỗi tag bắt đầu bằng "#") — KHÔNG nhồi hashtag vào trong "title" (title là tên dự án nên phải sạch). Hashtag bám ĐÚNG chủ đề (tên riêng, lĩnh vực, từ khoá thật), KHÔNG nhồi tag chung chung "#fyp #viral #xuhuong".`
      : ` KHÔNG cần hashtags (để mảng rỗng hoặc bỏ qua).`;
  return `NGÔN NGỮ VIDEO: ${contentRule}
TIÊU ĐỀ ĐĂNG TẢI ("title" trong manifest): viết bằng ${lang}, DƯỚI ${cap} ký tự, KHÔNG kèm hashtag trong title.${hashtag}
SỨC HÚT TIÊU ĐỀ (title là thứ quyết định người ta CÓ BẤM VÀO hay không — đừng viết mô tả phẳng): (a) phải có MÓC — một con số cụ thể, một nghịch lý, hoặc một khoảng-trống-tò-mò khiến người xem muốn biết tiếp; KHÔNG mô tả chung chung kiểu "Tìm hiểu về X" / "Những điều cần biết về Y" / "X là gì". (b) CỤ THỂ + động từ mạnh, không sáo rỗng. (c) CẤM clickbait rỗng: tiêu đề phải đúng với nội dung video, KHÔNG hứa điều video không trả lời, KHÔNG bịa số/chi tiết để câu view. Ví dụ — NHẠT: "Tìm hiểu về trí tuệ nhân tạo trong năm 2026." → SẮC: "AI vẽ xong trong 4 giây thứ hoạ sĩ mất cả tuần — và đây là cách."`;
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

/**
 * Content rules (the bulk are rate-independent; only the THỜI LƯỢNG line scales
 * with the measured words/second). Built as a function so the rate the model is
 * told matches the calibrated/measured rate the tier word-budget uses — a single
 * source of truth, never a stale baked "4.7" diverging from a recalibrated voice.
 */
function contentRules(wps: number, language: VideoLanguage): string {
  const rate = roundRate(wps);
  // Worked examples in the prompt, computed at the live rate (90s and 60s), so a
  // recalibrated voice shows consistent numbers instead of the old baked band.
  const w90 = Math.round(90 * wps);
  const w60 = Math.round(60 * wps);
  const languageRule = language === "en"
    ? `- Hiển thị + lời đọc: TIẾNG ANH tự nhiên. Không để sót câu tiếng Việt trong props hoặc JSX/SVG.
- Viết SỐ bằng CHỮ SỐ ở cả headline lẫn narration (vd 92%, 2026, 110,000, $920 million). KHÔNG đánh vần số thành chữ.`
    : `- Hiển thị + lời đọc: tiếng Việt. Giữ tên thương hiệu/model bằng tiếng Anh.
- Viết SỐ bằng CHỮ SỐ ở cả headline lẫn narration (vd 92%, 2026, 110.000, 920 triệu). KHÔNG đánh vần số, KHÔNG ghép năm kiểu tiếng Anh.`;
  const narrationRule = language === "en"
    ? `- GIỌNG VĂN LỜI ĐỌC: viết tiếng Anh sắc, tự nhiên, có chính kiến; KHÔNG phải giọng bách khoa trung tính. Câu đầu mỗi cảnh phải có móc cụ thể. CẤM mở đầu sáo rỗng như "In today's world…", "As we all know…", "Let's explore…", "It is undeniable that…". Dùng động từ mạnh, câu ngắn có nhịp. Ví dụ nhạt: "Artificial intelligence is developing rapidly and has many applications." → sắc: "AI just finished in 4 seconds what took an artist all week." Chỉ dùng số liệu khi có căn cứ.`
    : `- GIỌNG VĂN LỜI ĐỌC (narration phải SẮC — đừng viết "nhạt như nước ốc"): kể như một người có chính kiến, KHÔNG phải giọng bách khoa trung tính. (a) Câu ĐẦU mỗi cảnh phải có MÓC cụ thể — một con số gây sốc, một nghịch lý, một mệnh đề bất ngờ, hoặc một câu hỏi cứa — TUYỆT ĐỐI KHÔNG mở bằng định nghĩa/khái quát. (b) CẤM các mở đầu sáo rỗng: "Trong thời đại ngày nay…", "Như chúng ta đã biết…", "Hãy cùng tìm hiểu…", "Không thể phủ nhận rằng…", "Ngày nay,…", "Có thể nói…". (c) CỤ THỂ thắng chung chung: thay "rất nhiều người" bằng con số/tên thật (nếu có căn cứ), thay "công nghệ phát triển" bằng CÁI GÌ làm ĐƯỢC GÌ. (d) Động từ MẠNH, câu NGẮN có nhịp; cắt trạng từ rỗng ("rất", "vô cùng", "đáng kể"). Một ý đắt hơn ba ý loãng. Ví dụ — NHẠT: "Trí tuệ nhân tạo đang ngày càng phát triển và có nhiều ứng dụng trong đời sống." → SẮC: "AI vừa làm xong trong 4 giây thứ một hoạ sĩ mất cả tuần." (số liệu chỉ nêu khi có căn cứ thật — không bịa để cho kêu).`;
  const languageLabel = language === "en" ? "tiếng Anh" : "tiếng Việt";
  return `QUY TẮC NỘI DUNG (bắt buộc):
${languageRule}
- KHÔNG bịa số liệu/nguồn/ngày/giá/phần trăm. Không chắc một con số thì đừng nêu.
- scene-01 mở bằng HOOK trực diện kéo người xem ở lại (không chào hỏi/định nghĩa lề mề). Cảnh CUỐI chốt lại gắn chủ đề (không "like/share/subscribe" chung chung) — tuỳ chủ đề mà chốt bằng câu hỏi, lời mời hành động, hay điểm nhấn đọng lại.
- Mỗi cảnh MỘT ý; narration 1–3 câu cô đọng (khoảng 18–40 từ). Đa dạng form.
${narrationRule}
- TÁO BẠO NGAY TỪ BẢN ĐẦU (đừng "chơi an toàn" rồi đợi sửa): bản nháp ĐẦU TIÊN đã phải hấp dẫn, KHÔNG được để mọi cảnh chỉ là "một tiêu đề + một khối chữ ở giữa". Mỗi video PHẢI có: ≥1 cảnh số liệu RẤT lớn (số tự dựng bằng <div> chữ 80–160px) nếu có số thật; ≥1 cảnh bố cục khác thường (HAI CỘT so sánh tự dựng, danh sách tự dựng, hoặc biểu đồ tự vẽ bằng SVG); ≥1 "beat chữ ký" có đồ hoạ SVG/CSS bespoke tự vẽ (không chỉ card chữ). Hình dung cụ thể cho cảnh mở đầu + cảnh điểm nhấn TRƯỚC khi viết — coi như bản cuối, không phải bản tạm.
- THỜI LƯỢNG: nếu yêu cầu nêu thời lượng (vd "90 giây", "1p30s", "1 phút rưỡi"), hãy ước TỔNG lời đọc toàn video ≈ thời_lượng_giây × ${rate} từ (giọng đọc ${languageLabel} ~${rate} từ/giây) và viết ĐỦ số cảnh để đạt tổng đó — thà hơi DƯ còn hơn hụt (vd 90 giây → khoảng ${w90} từ tổng, thường 12–16 cảnh; 60 giây → khoảng ${w60} từ, thường 9–11 cảnh). Không nêu thời lượng thì 8–12 cảnh.`;
}

const OUTPUT_FORMAT = `ĐỊNH DẠNG TRẢ VỀ (AI_Output_Contract) — trả về TRONG MỘT REPLY:
1) Đúng MỘT khối \`\`\`json là manifest (KHÔNG chứa code):
\`\`\`json
{
  "title": "tiêu đề video (KHÔNG chứa hashtag)",
  "hashtags": ["#chu_de", "#tu_khoa"],
  "theme": { "dominant": "#RRGGBB", "mood": "mô tả ngắn tông màu" },
  "scenes": [
    { "component": "id-canh", "eyebrow": "NHÃN", "headline": "tiêu đề cảnh", "narration": "lời đọc", "props": { }, "transitionToNext": "slide|fade|wipe|clockWipe|zoom" }
  ]
}
\`\`\`
2) Với MỖI component id duy nhất, MỘT khối \`\`\`tsx, DÒNG ĐẦU là marker "// component: <id>", thân là module .tsx đầy đủ theo hợp đồng.
   ⚠ Khối mẫu DƯỚI ĐÂY chỉ minh hoạ CẤU TRÚC export bắt buộc + cách tự dựng bằng JSX/SVG trần — KHÔNG phải mẫu thẩm mỹ để chép cho mọi cảnh. KHÔNG còn thư viện block: mỗi cảnh TỰ DỰNG nền + bố cục + đồ hoạ bằng <div>/<svg> theo nội dung (xem QUY TẮC NỘI DUNG về sự táo bạo). KHÔNG import "@news/blocks"/"@news/theme":
\`\`\`tsx
// component: id-canh
import React from "react";
import { z } from "zod";
import { useCurrentFrame, interpolate } from "remotion";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
export const schema = z.object({ /* props */ });
type Props = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<Props>> = ({ headline, eyebrow }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", inset: 0, background: "#0b1020", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, opacity: enter }}>
      <span style={{ fontSize: 28, letterSpacing: 4, color: "#7dd3fc" }}>{eyebrow ?? "TIN"}</span>
      <h1 style={{ fontSize: 96, lineHeight: 1.05, color: "#fff", margin: 0, fontWeight: 800 }}>{headline}</h1>
      {/* đồ hoạ SVG/CSS bespoke riêng cho cảnh này ở đây */}
    </div>
  );
};
export const example: Props = { /* hợp lệ với schema */ };
export default registerComponent<Props>({ id: "id-canh", displayName: "...", promptGuide: "...", schema, Component: Scene, example });
\`\`\`
id trong manifest phải KHỚP id literal trong registerComponent. KHÔNG kèm văn bản thừa ngoài các khối trên.`;

/**
 * Build the AUTHOR system prompt for the chosen DELIVERY FORMAT (no design style
 * anymore — the multi-language system was deleted, D1). The format block fixes the
 * canvas + caption presence, the tier block sets the word budget, and the title
 * block steers ONLY the publish title's language; everything else is the invariant
 * content rules + authoring contract + output format.
 */
function authorSystem(format: VideoFormat, tier: DurationTier, videoLanguage: VideoLanguage, wps: number): string {
  const frame = format === "youtube" ? "16:9" : "9:16";
  return `Bạn là tác giả video ngắn ${frame} SÁNG TẠO cho MỌI chủ đề người dùng muốn (không chỉ tin tức: giải thích, kể chuyện, quảng bá, giáo dục, giải trí…), kiêm lập trình viên Remotion. Bạn TỰ VIẾT MỚI mã .tsx cho từng cảnh (KHÔNG chọn từ tập component có sẵn). Mục tiêu tối thượng: video phải THẬT LÓA MẮT, CUỐN HÚT — bám đúng yêu cầu người dùng và dám phá cách.

${formatBlock(format)}

${tierBudgetBlock(format, tier, videoLanguage, wps)}

${languageBlock(format, videoLanguage)}

${contentRules(wps, videoLanguage)}

${AUTHORING_CONTRACT}

${OUTPUT_FORMAT}`;
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
- import { SceneImage } from "@news/compositions" (KHÔNG phải @news/blocks — block layout đã bị gỡ; SceneImage là export DUY NHẤT cho ảnh, lấy từ @news/compositions). Đây là NGOẠI LỆ DUY NHẤT được phép import ngoài react/remotion/zod cho phần hình.
QUAN TRỌNG VỀ KÍCH THƯỚC: <SceneImage> TỰ canh theo đúng tỉ lệ thật của ảnh (khung ôm khít ảnh). TUYỆT ĐỐI KHÔNG bọc nó trong khung có chiều cao/rộng cố định, không dùng overflow:"hidden", height:"...px", aspectRatio hay objectFit ép quanh nó — làm vậy sẽ CẮT hoặc BÓP MÉO ảnh. Cứ đặt <SceneImage> trực tiếp trong cột nội dung; muốn giới hạn chiều cao thì truyền prop maxHeight (số px), đừng tự dựng khung.
CHỈ dùng ref đã được cung cấp, TUYỆT ĐỐI KHÔNG bịa đường dẫn/URL ảnh. Viết nội dung sao cho ảnh khớp tổng thể.
BẮT BUỘC DÙNG ẢNH: những ảnh này do NGƯỜI DÙNG chủ động chọn/đính kèm, nên PHẢI được đưa vào video — KHÔNG được bỏ hết. Hãy đặt MỖI ảnh đã cho vào một cảnh phù hợp (mỗi cảnh tối đa 1 ảnh, nên trải ảnh ra nhiều cảnh); nếu có nhiều ảnh hơn số cảnh hợp, hãy ưu tiên những ảnh khớp nội dung nhất, nhưng TỐI THIỂU phải dùng một ảnh. Soạn nội dung/kịch bản bám theo ảnh để chúng khớp tự nhiên.`;

export function buildAuthorMessages(
  input: AuthorInput,
  research?: string,
  images?: AuthorImageInput[],
  wordsPerSecond?: number,
): VisionMessage[] {
  const links = input.urls.length > 0 ? `\n\nLink trong yêu cầu: ${input.urls.join(", ")}` : "";
  const grounding = research
    ? `\n\nTư liệu đã đọc từ link (dùng làm căn cứ, không bịa thêm):\n${research}`
    : input.urls.length > 0
      ? "\n\n(Không đọc được nội dung link. Chỉ dùng thông tin trong yêu cầu + kiến thức chắc chắn về chủ đề. KHÔNG bịa số liệu, ngày tháng, giá, phần trăm hay tên sản phẩm/phiên bản mới — thiếu căn cứ thì đừng nêu.)"
      : "";
  const source = `Yêu cầu của người dùng:\n${input.text}${links}${grounding}`;
  const instruction = `${source}\n\nHãy soạn kịch bản + VIẾT MÃ .tsx cho từng cảnh, trả về đúng định dạng AI_Output_Contract.`;
  // System prompt is driven by the chosen DELIVERY FORMAT (canvas + caption
  // presence), the duration tier (word budget), and the full video language — the
  // backend injects these from the user's create-screen choice; the model never
  // picks them. Absent ⇒ the historical defaults (tiktok / tier 1 / vi).
  const videoLanguage = input.videoLanguage ?? "vi";
  const effectiveWordsPerSecond = wordsPerSecond
    ?? (videoLanguage === "en" ? DEFAULT_ENGLISH_WORDS_PER_SECOND : DEFAULT_WORDS_PER_SECOND);
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
   * but the .tsx no longer renders it. When set, the prompt hard-requires keeping
   * the `<SceneImage imageRef={image.ref} />` block.
   */
  hasImage?: boolean;
};

/**
 * Reauthor system prompt. The multi-language design system was deleted (D1), so a
 * repair carries only the invariant authoring contract — there is no per-style
 * slice to restore toward anymore.
 */
function reauthorSystem(): string {
  return `Bạn đang SỬA một cảnh video (module .tsx Remotion) cho đúng hợp đồng AUTHOR mode. Giữ ý/nội dung của cảnh, chỉ sửa lỗi được nêu.

NGUYÊN TẮC REWRITE: đây là sửa cục bộ, KHÔNG phải viết lại thành một cảnh an toàn/rỗng. Phải giữ hoặc nâng độ phong phú thị giác hiện có: nền, bố cục, SVG/CSS tự vẽ, ảnh SceneImage, danh sách/số liệu, motion và các visual anchor đang có. KHÔNG được thay cảnh bằng title-card đơn giản chỉ có eyebrow/headline/text. Nếu lỗi là bố cục/tràn/cắt chữ/tương phản, hãy sửa bằng reposition/scale/spacing/font/color hoặc chia lại nhóm phần tử, không xoá toàn bộ đồ hoạ. Nếu code hiện tại có biến/hàm thiếu gây fallback, khai báo/sửa biến đó thay vì bỏ cả block visual.

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

// --- AI visual-QA (vision critique over rendered stills) --------------------

const VISUAL_QA_SYSTEM = `Bạn là QA BỐ CỤC cho video dọc 9:16 (bất kỳ chủ đề nào). Video có thể theo BẤT KỲ ngôn ngữ thiết kế nào (nền sáng hoặc tối, vuông hoặc bo tròn) — ĐỪNG giả định một look cố định.
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
