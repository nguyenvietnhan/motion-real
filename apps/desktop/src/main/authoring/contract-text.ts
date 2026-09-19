/**
 * The pure-AUTHOR contract, inlined. A condensed
 * but faithful version of `docs/current/authoring-contract.md` — inlined as a
 * constant so the bundled Electron main never reads it from disk (deterministic,
 * no fs in the hot path). Initial authoring receives both the technical and
 * creative sections; targeted repair receives only the technical invariants.
 * Keep this in sync with `docs/current/authoring-contract.md` when the contract changes.
 */

export type DesignTokens = {
  BG: string;
  SPOTLIGHT: string;
  ACCENT_PRIMARY: string;
  ACCENT_SECONDARY: string;
  TEXT_PRIMARY: string;
  TEXT_MUTED: string;
  STATUS_ERR: string;
  STATUS_OK: string;
};

export function normalizeDominantHex(dominantInput?: string): string {
  if (!dominantInput) return "#38BDF8";
  const trimmed = dominantInput.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  const match3 = /^#([0-9A-Fa-f])([0-9A-Fa-f])([0-9A-Fa-f])$/.exec(trimmed);
  if (match3) {
    return `#${match3[1]}${match3[1]}${match3[2]}${match3[2]}${match3[3]}${match3[3]}`.toUpperCase();
  }
  return "#38BDF8";
}

export function getDesignTokens(dominantInput?: string): DesignTokens {
  const dominant = normalizeDominantHex(dominantInput);

  const r = parseInt(dominant.slice(1, 3), 16);
  const g = parseInt(dominant.slice(3, 5), 16);
  const b = parseInt(dominant.slice(5, 7), 16);
  const spotlight = `rgba(${r}, ${g}, ${b}, 0.15)`;

  const isIndigo = dominant.toLowerCase() === "#818cf8" || dominant.toLowerCase() === "#6366f1";
  const accentSecondary = isIndigo ? "#38BDF8" : "#818CF8";

  return {
    BG: "#0B0F17",
    SPOTLIGHT: spotlight,
    ACCENT_PRIMARY: dominant,
    ACCENT_SECONDARY: accentSecondary,
    TEXT_PRIMARY: "#FFFFFF",
    TEXT_MUTED: "#94A3B8",
    STATUS_ERR: "#EF4444",
    STATUS_OK: "#10B981",
  };
}

export function formatPaletteContract(dominant?: string): string {
  const t = getDesignTokens(dominant);
  return `BẢNG MÀU THIẾT KẾ (PALETTE TOKEN CONTRACT) — BẮT BUỘC ÁP DỤNG:
- BG: "${t.BG}" (Nền chính video, tối sâu)
- SPOTLIGHT: "${t.SPOTLIGHT}" (Radial glow sau focal object)
- ACCENT_PRIMARY: "${t.ACCENT_PRIMARY}" (Màu nhấn chủ đạo: icon, đường nối SVG, viền active, số liệu chính)
- ACCENT_SECONDARY: "${t.ACCENT_SECONDARY}" (Màu phụ trợ: nhánh phụ, trạng thái chuyển tiếp)
- TEXT_PRIMARY: "${t.TEXT_PRIMARY}" (Tiêu đề, chữ chính — độ tương phản > 7:1)
- TEXT_MUTED: "${t.TEXT_MUTED}" (Nhãn phụ, chú thích, đơn vị đo)
- STATUS_ERR: "${t.STATUS_ERR}" (Lỗi, rủi ro, cảnh báo — chỉ dùng trên viền/badge)
- STATUS_OK: "${t.STATUS_OK}" (Thành công, tối ưu — chỉ dùng trên viền/badge)
NGHIÊM CẤM: Không dùng mã hex ngoài bảng này! Mọi cảnh BẮT BUỘC dùng chung bảng màu này để video đồng nhất 100%.
NGUYÊN TẮC TƯƠNG PHẢN (TRÁNH N18): Tiêu đề & chữ chính BẮT BUỘC là màu TRẮNG (${t.TEXT_PRIMARY}). CẤM chữ đỏ (${t.STATUS_ERR})/tối trên nền tối. ACCENT/STATUS chỉ dùng cho viền, icon, SVG, badge.`;
}

function buildTechnicalCore(dominant?: string): string {
  const t = getDesignTokens(dominant);
  const palette = formatPaletteContract(dominant);
  return `HỢP ĐỒNG VIẾT CẢNH (AUTHOR mode — KHÔNG CÓ THƯ VIỆN BLOCK) — mỗi cảnh là MỘT module .tsx Remotion bạn TỰ VIẾT MỚI 100% bằng JSX/SVG trần.

EXPORT BẮT BUỘC (mọi module):
- import React from "react"; import { z } from "zod";
- import { registerComponent, type SceneComponentProps } from "@motionreal/compositions";
- export const schema = z.object({...})  // CHỈ props BESPOKE của cảnh
  → CẤM khai báo headline/eyebrow/body/image/durationInFrames/motionCueFrames trong schema — là field TOP-LEVEL (xem SceneComponentProps), đưa vào là lỗi N3 chặn render. Cảnh không props riêng: z.object({}).
- type Props = z.infer<typeof schema>
- const Scene: React.FC<SceneComponentProps<Props>> = ({ headline, body, eyebrow, durationInFrames, motionCueFrames, props }) => (... )
  → Props bespoke lấy từ props.*.
- export const example: Props = {...}      // PHẢI hợp lệ với schema (thiếu/lệch là lỗi "missing required export" chặn render!).
- export default registerComponent<Props>({ id: "ten-canh", displayName, promptGuide, schema, Component: Scene, example });
  → id là CHUỖI LITERAL (chữ thường/số/gạch-ngang), khớp manifest.scenes[].component. Riêng manifest.scenes[].id PHẢI là scene-01, scene-02… theo thứ tự, không thêm hậu tố.

CÚ PHÁP TSX BẮT BUỘC (tự kiểm như chạy TypeScript parser trước khi trả lời):
- Mỗi module phải là TypeScript/TSX parse được hoàn chỉnh: import/export hợp lệ, JSX tag đóng đủ, ngoặc (), {}, [], dấu phẩy và dấu nháy cân bằng.
- Trong object literal — đặc biệt style={{ ... }} — CHỈ viết thuộc tính dạng key: value hoặc spread hợp lệ. KHÔNG viết biểu thức/call trần như foo("bar"), condition && ..., JSX rời, hay token lạ bên trong object.
- CSS inline của React phải dùng key camelCase với value rõ ràng, ví dụ justifyContent: "flex-start", alignItems: "center", backgroundColor: "#111827". Không dùng cú pháp CSS string rời/kebab-case như trong file .css.
- SVG TRONG REACT BẮT BUỘC DÙNG camelCase (tránh N10/N11): Thuộc tính SVG trong JSX phải viết camelCase, CẤM kebab-case: strokeWidth (CẤM stroke-width), strokeDasharray, strokeDashoffset, strokeLinecap, strokeLinejoin, stopColor, stopOpacity, fillOpacity, clipPath. Thẻ SVG phải đóng đủ.
- Khai báo biến/hàm hợp lệ; không để câu chữ giải thích hoặc pseudocode lọt vào khối .tsx.

IMPORT WHITELIST (N4) — CHỈ được import: react, remotion, @motionreal/compositions, zod.
KHÔNG CÒN thư viện block/theme: TUYỆT ĐỐI KHÔNG import "@motionreal/blocks" hay "@motionreal/theme" (đã ngắt — import vào là lỗi N4 chặn render). Không có useTheme, không có Frame/Story/TitleBlock… nào để gọi.
NGOẠI LỆ DUY NHẤT cho ảnh: nếu cảnh có ảnh (field image), import { SceneImage } from "@motionreal/compositions" và render <SceneImage imageRef={image.ref} alt={image.alt} role={image.role} /> (cấm tự dùng <img>/Img/staticFile). role="logo"/"icon" phải giữ asset nhỏ gọn; không phóng thành hero.
KHÔNG: node:*, gói bên thứ ba, import tương đối ra ngoài file.

API CẤM (N5) — cảnh là HÀM THUẦN của frame:
CẤM Math.random, Date/Date.now, fetch, eval/Function, require/import() động, fs/child_process, window.location/document.cookie, dangerouslySetInnerHTML. Ngẫu nhiên → random(seed) của remotion; hoạt hoạ → useCurrentFrame()+interpolate/spring.

${palette}

TỰ DỰNG MỌI THỨ & KHÔNG GIAN BỐI CẢNH (SCENE-LOCAL BACKDROP):
TỰ DỰNG MỌI THỨ bằng JSX/SVG. Tự chọn và HARDCODE font, màu (theo Palette Token Contract), khoảng cách, bo góc.
Dùng background BG kèm SPOTLIGHT radial gradient mềm phía sau focal mass (background: "radial-gradient(circle at 50% 40%, ${t.SPOTLIGHT} 0%, rgba(11, 15, 23, 0.6) 50%, ${t.BG} 90%)", pointerEvents: "none").
Chỉ dùng card khi nội dung thật sự là card/document/UI record/lựa chọn; TUYỆT ĐỐI KHÔNG làm vỏ mặc định bọc quanh tiêu đề. Tránh bọc text trong <div> hộp kính mờ (frosted card trap).
Được vẽ SVG/CSS bespoke tuỳ ý. SVG dùng <defs> nội bộ với url(#id). KHÔNG url(http...), file:, data:, blob:.

LAYOUT ZONES (CANVAS 1080×1920 — MÔ HÌNH PHÂN TẦNG LƯỠNG PHÂN / BIMODAL LAYOUT ZONES):
1) TOP RESERVE (0%–12% / 0–230px): Dành cho UI FYP/Shorts. Bắt đầu eyebrow/headline từ ~12%–16% (y: 230–300px), không đặt chữ trong ~12% đầu khung nơi UI FYP/Shorts có thể che.
2) ACTIVE TYPOGRAPHY & EDITORIAL ZONE (12%–62% / 230–1190px): Chữ đọc được (tiêu đề, nhãn, body, kết luận leaf node) BẮT BUỘC DỪNG Ở <= 62%–64% (y <= 1228px) tạo safe breathing buffer > 140px trên dải phụ đề, tránh đè chữ/dấu tiếng Việt. Tâm focal mass đặt quanh ~38%–46% chiều cao khung.
3) STRUCTURAL GROUNDING EXTENSION (62%–70% / 1190–1350px): ĐỒ HOẠ KHÔNG CHỮ: đuôi SVG (<path>), chân đế pedestal, bóng container, ambient radial wash mở rộng xuống 68%–70% (y <= 1350px) neo sàn khung hình, xoá cảm giác hút chân không ở đáy. CẤM chữ ở đây.
4) CAPTION BAND (71%–86% / 1370–1650px): Dành riêng phụ đề karaoke. Không đặt chữ/thẻ/nút vào đây.
5) BOTTOM RESERVE (86%–100% / 1650–1920px): Vùng platform UI (avatar, sound, action rail). Giữ sạch.
- Hướng dẫn bố cục mềm: không phải lệnh ép mọi cảnh vào đúng giữa; bố cục top-aligned (bên trong content-zone) hoặc bất đối xứng vẫn hợp lệ khi có ý đồ thị giác rõ ràng.
- Tràn chữ xuống dải phụ đề là cảnh báo N14 (advisory — KHÔNG chặn render), nhưng nên tránh để phụ đề đọc rõ. Không có đường kẻ nào do hệ thống vẽ.
- Tránh dồn toàn bộ nội dung thành một dải hẹp giữa màn hình tạo cảm giác "hút chân không" ở nửa dưới. Cho beat thưa một mỏ neo (số lớn/đồ hoạ nhỏ).

ĐIỀU KHOẢN MỞ RỘNG BỐ CỤC: Profile cung cấp ngôn ngữ thị giác chủ đạo của toàn video. Tác giả hoàn toàn được phép tự do vẽ các bố cục phụ trợ (hai cột đối chiếu, đồng hồ đo số liệu, đường nối SVG) bằng JSX/SVG trần khi tình tiết của cảnh yêu cầu.`;
}

const CREATIVE_COMPOSITION = `ART DIRECTION CẢ VIDEO — trước khi viết code, TỰ CHỌN NGẦM ngôn ngữ thị giác đúng chủ đề: nền sâu nhưng lùi, palette hẹp (theo Palette Token Contract), motif mảnh, typography/khoảng thở. Giữ nó xuyên video; KHÔNG đổi style vô cớ hay sao chép palette/diện mạo của thương hiệu/video có sẵn.
- Mỗi cảnh là MỘT bố cục biên tập có focal structure rõ (evidence, timeline, process, comparison, metric, diagram, metaphor), không mặc định "eyebrow + headline + card + ảnh trong khung". Chi tiết phụ phải làm rõ focal structure; dùng khoảng trống có chủ đích.
- Hook, điểm ngoặt và payoff cần signature beat bespoke; cảnh giải thích yên hơn nhưng vẫn có visual anchor. Đa dạng layout trong cùng ngôn ngữ đó, không lặp shell/panel/HUD.
- Asset thật là evidence/subject trong bố cục, không mặc định ảnh trong card; logo/icon chỉ là accent.

Ưu tiên hierarchy cao, tương phản dễ đọc (N18) và nội dung nằm trong content-zone (mục LAYOUT ZONES ở trên).`;

const TECHNICAL_RUNTIME = `CỠ CHỮ (1080×1920): tiêu đề chính ≥ 64px; câu/đoạn nội dung chính ≥ 40px; nhãn/đơn vị/chú thích phụ ≥ 24px. CẤM text < 18px. Số liệu nổi bật nên RẤT lớn (80–160px). Ưu tiên chữ TO hơn, ít chữ.

CHỮ TRÊN CẢNH ≠ LỜI ĐỌC (tránh bê nguyên narration lên màn hình). Phụ đề karaoke đáy khung đã chạy câu đầy đủ; chữ vẽ trên cảnh chỉ là Ý CHÍNH cô đọng (headline ≈3–7 từ; body/nhãn vài từ khoá). KHÔNG chép cả narration. Giữ màn hình thoáng.

CAPTIONS: phụ đề tiếng Việt một dòng sinh TRUNG TÂM từ narration + đốt vào video (karaoke). KHÔNG tự viết phụ đề trong props.

DETERMINISM + MOTION: Dùng useCurrentFrame() và durationInFrames (từ SceneComponentProps top-level) để tính tiến trình cục bộ, dựng motion theo progress:
const frame = useCurrentFrame();
const { fps } = useVideoConfig();
const progress = durationInFrames > 1 ? Math.min(1, Math.max(0, frame / (durationInFrames - 1))) : 1;
MOTION TEMPO: Mặc định an toàn là quick entrance 0.2–0.8 giây rồi readable hold. Đừng kéo dài vô cớ.
1) quick entrance/reveal/pop: cho title, label, card, icon. Ví dụ: const enterEnd = Math.max(1, Math.round(fps * 0.45)); rồi interpolate(frame, [0, enterEnd], [0, 1], { extrapolateRight: "clamp" }).
2) semantic progression: khi có motionBeats thì mọi beat (cả đầu) dùng cue id và fallback tương đối:
const firstAt = motionCueFrames?.["receive-request"] ?? Math.round(durationInFrames * 0.12);
const secondAt = motionCueFrames?.["show-result"] ?? Math.round(durationInFrames * 0.55);
Ẩn beat trước cue; mỗi cue phải reveal/focus/transform. Beat cũ có thể dim; beat cuối phải hold. Không có motionBeats thì dùng progress [0,1].
3) continuous living motion: cho wave, shimmer, pulse, signal flow, loop sau khi settle: phase = ((Math.max(0, frame - enterEnd)) % periodFrames) / periodFrames. Chuyển động phải nhỏ, bounded, có chủ đích, không che chữ.
Gợi ý: motionProgression không bắt mọi cảnh nhiều tầng motion. Quick entrance + readable final hold luôn hợp lệ cho statement beat. Tự viết hoạt hoạ bằng useCurrentFrame() + spring()/interpolate(). Với interpolate, inputRange PHẢI tăng dần nghiêm ngặt; KHÔNG dùng durationInFrames - N làm mốc cuối nếu có thể âm/bằng mốc đầu — hãy bọc bằng Math.max(1, durationInFrames - N) hoặc dùng progress [0, 1]. KHÔNG viết vòng góc kiểu [340, 360, 60] — hãy tách thành hai interpolate có clamp (340→360 và 0→60).`;

export function creativeVisualization(dominant?: string): string {
  const t = getDesignTokens(dominant);
  return `VISUALIZE SÁNG TẠO — BIẾN Ý THÀNH HÌNH (THAY THẾ TOÀN BỘ CARD BẰNG 4 GEOMETRIC ARCHETYPES):
BIẾN Ý của cảnh thành HÌNH: Dùng <svg>/<div> trần theo frame. TUYỆT ĐỐI TRÁNH bọc text vào các hộp chữ nhật kính mờ (frosted card trap). Thay vào đó, BẮT BUỘC áp dụng 4 hình mẫu hình học (Geometric Archetypes) cụ thể:
1) Pipeline Dataflow (Luồng dữ liệu/Quy trình): Chuỗi 3 node trạm tuần tự nối bằng thẻ <svg viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}><path d="M 540 380 L 540 920" fill="none" stroke="${t.ACCENT_PRIMARY}" strokeWidth={3} strokeDasharray="6 6" /></svg>. Payload di chuyển qua các trạm. Đuôi path mở rộng xuống y: 1250–1350px neo sàn khung.
2) Dual Split-Core (So sánh/Trade-off): HAI CỘT đối xứng (left: 100 & 570, width: 410, y: 340–1100px), trục phân cách SVG ở giữa (x1=540, y1=360, x2=540, y2=1200) và badge đối chiếu ("VS" hoặc tiêu chí) tại x: 540, y: 700. Chân đế pedestal SVG neo ở y: 1200–1320px.
3) Metric Gauge (Chỉ số/Tiến trình vòng): Vòng tròn/bán nguyệt SVG (tâm x: 540, y: 620, r: 200) với vòng nền mờ và vòng tiến trình stroke="${t.ACCENT_PRIMARY}" animate bằng strokeDashoffset. Số liệu KHỔNG LỒ 80–160px (chữ trắng) ở tâm vòng, nhãn phụ ở dưới. Ray quét mở rộng xuống y: 1200–1300px neo không gian.
4) Architecture Stack (Tầng kiến trúc/Phân cấp): 3 tầng kiến trúc tối giản (Top Tier: Input y: 320px, Mid Tier: Logic y: 620px, Bottom Tier: Data y: 920px), viền mảnh 1px, connector bus SVG nối giữa các tầng, bệ đỡ kết cấu rộng ở y: 1200–1340px.

Mọi số, giá, ngày hoặc phần trăm literal trong props/JSX/SVG/chữ trên cảnh phải có trong brief hoặc CONTENT PLAN đã duyệt. CẤM bịa số trang trí để làm đồ hoạ cụ thể; không có số thật thì dùng nhãn định tính.

HÃY DÁM VẼ ẨN DỤ: chuyển ý trừu tượng thành hình cụ thể (tiến trình vọt vạch, khối nứt, node nối, cột tăng). Vẽ bằng <svg>/<div> theo frame.
LUẬT CHỐNG LẶP & CHỐNG CARD TRAP:
1) KHÔNG để hơn 2 cảnh LIÊN TIẾP cùng một khuôn bố cục.
2) Trong video 9–12 cảnh, dùng ÍT NHẤT 3 dạng bố cục khác nhau VÀ có ÍT NHẤT 1–2 cảnh mang đồ hoạ/ẩn dụ TỰ VẼ (SVG/CSS).
3) Toàn video tối đa 1 cảnh dạng card; các cảnh khác bắt buộc dùng Geometric Archetypes.`;
}

export function technicalAuthoringContract(dominant?: string): string {
  return `${buildTechnicalCore(dominant)}\n\n${TECHNICAL_RUNTIME}`;
}

export function creativeAuthoringDirection(dominant?: string): string {
  return `${CREATIVE_COMPOSITION}\n\n${creativeVisualization(dominant)}`;
}

export function authoringContract(dominant?: string): string {
  return `${technicalAuthoringContract(dominant)}\n\n${creativeAuthoringDirection(dominant)}`;
}

export const TECHNICAL_AUTHORING_CONTRACT = technicalAuthoringContract("#38BDF8");
export const CREATIVE_AUTHORING_DIRECTION = creativeAuthoringDirection("#38BDF8");
export const AUTHORING_CONTRACT = authoringContract("#38BDF8");
