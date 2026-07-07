import { titleMaxChars, type DurationTier, type VideoFormat, type VideoLanguage } from "@motionreal/schema";
import { computePacingBudget, SHORTFORM_90S_SCENE_RANGE } from "./pacing-policy.js";

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
export function formatBlock(format: VideoFormat): string {
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
export function tierBudgetBlock(format: VideoFormat, tier: DurationTier, language: VideoLanguage, wps: number): string {
  const pacing = computePacingBudget({ format, durationTier: tier, videoLanguage: language }, wps);
  const seconds = pacing.targetSeconds;
  const rate = roundRate(wps);
  const words = pacing.targetWords;
  const low = Math.round((seconds - 20) * wps);
  const high = Math.round((seconds + 20) * wps);
  const languageLabel = language === "en" ? "tiếng Anh" : "tiếng Việt";
  return `MỤC TIÊU THỜI LƯỢNG: video nhắm khoảng ${seconds} giây. Giọng đọc ${languageLabel} ~${rate} từ/giây, nên hãy viết TỔNG lời đọc toàn video khoảng ${words} từ (chấp nhận ${low}–${high} từ — thà hơi DƯ còn hơn hụt), chia thành đủ số cảnh để đạt tổng đó. Nhịp cảnh nên khoảng ${pacing.minScenes}–${pacing.maxScenes} cảnh, nhắm ${pacing.targetScenes}; đừng nhồi quá nhiều lời vào vài cảnh dài. KHÔNG cắt câu để ép đúng giây.`;
}

/**
 * Video-language rule. The user's choice governs all viewer-facing content:
 * title, hashtags, authored display text, narration, and central captions.
 */
export function languageBlock(format: VideoFormat, videoLanguage: VideoLanguage): string {
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
 * Content rules (the bulk are rate-independent; only the THỜI LƯỢNG line scales
 * with the measured words/second). Built as a function so the rate the model is
 * told matches the calibrated/measured rate the tier word-budget uses — a single
 * source of truth, never a stale baked "4.7" diverging from a recalibrated voice.
 */
export function contentRules(wps: number, language: VideoLanguage): string {
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
- TÁO BẠO NGAY TỪ BẢN ĐẦU nhưng AN TOÀN THEO NỘI DUNG: bản nháp ĐẦU TIÊN phải có visual anchor rõ, KHÔNG để mọi cảnh chỉ là "một tiêu đề + một khối chữ ở giữa". Chọn recipe theo beat, đừng ép dạng không có căn cứ: số lớn/chỉ số 80–160px CHỈ khi số đó có trong tư liệu; HAI CỘT so sánh khi beat thật sự là so sánh/tradeoff; biểu đồ/SVG process khi ý có cấu trúc, luồng, timeline hoặc quan hệ; statement beat không có dữ liệu vẫn hợp lệ với typography mạnh + một glyph/metaphor tự vẽ + quick entrance rồi readable hold. Ít nhất cảnh mở đầu hoặc cảnh điểm nhấn nên có một "beat chữ ký" bespoke SVG/CSS đúng chủ đề, nhưng KHÔNG bịa số/fact chỉ để trông hoành tráng.
- THỜI LƯỢNG: nếu yêu cầu nêu thời lượng (vd "90 giây", "1p30s", "1 phút rưỡi"), hãy ước TỔNG lời đọc toàn video ≈ thời_lượng_giây × ${rate} từ (giọng đọc ${languageLabel} ~${rate} từ/giây) và viết ĐỦ số cảnh để đạt tổng đó — thà hơi DƯ còn hơn hụt (vd 90 giây → khoảng ${w90} từ tổng, thường ${SHORTFORM_90S_SCENE_RANGE.min}–${SHORTFORM_90S_SCENE_RANGE.max} cảnh; 60 giây → khoảng ${w60} từ, thường 9–11 cảnh). Không nêu thời lượng thì 8–12 cảnh.`;
}
