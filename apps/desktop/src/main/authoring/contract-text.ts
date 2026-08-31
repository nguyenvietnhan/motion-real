/**
 * The pure-AUTHOR contract, inlined. A condensed
 * but faithful version of `docs/current/authoring-contract.md` — inlined as a
 * constant so the bundled Electron main never reads it from disk (deterministic,
 * no fs in the hot path). Initial authoring receives both the technical and
 * creative sections; targeted repair receives only the technical invariants.
 * Keep this in sync with `docs/current/authoring-contract.md` when the contract changes.
 */

const TECHNICAL_CORE = `HỢP ĐỒNG VIẾT CẢNH (AUTHOR mode — KHÔNG CÓ THƯ VIỆN BLOCK) — mỗi cảnh là MỘT module .tsx Remotion bạn TỰ VIẾT MỚI 100% bằng JSX/SVG trần.

EXPORT BẮT BUỘC (mọi module):
- import React from "react"; import { z } from "zod";
- import { registerComponent, type SceneComponentProps } from "@motionreal/compositions";
- export const schema = z.object({...})  // CHỈ props BESPOKE của cảnh
  → TUYỆT ĐỐI KHÔNG khai báo headline/eyebrow/body/image/durationInFrames trong schema — đó là field TOP-LEVEL hệ thống tự truyền vào cảnh (xem SceneComponentProps), KHÔNG thuộc props. Đặt chúng vào schema là lỗi N3 ("props invalid at headline: expected string, received undefined") chặn render. schema chỉ chứa dữ liệu RIÊNG cảnh tự nghĩ ra (số liệu, nhãn, danh sách…). Cảnh không có props riêng thì để z.object({}).
- type Props = z.infer<typeof schema>
- const Scene: React.FC<SceneComponentProps<Props>> = ({ headline, body, eyebrow, durationInFrames, props }) => (... )
  → headline/body/eyebrow/image/durationInFrames lấy từ tham số top-level (đã destructure ở trên); dữ liệu bespoke lấy từ props.*.
- export const example: Props = {...}      // CỰC KỲ QUAN TRỌNG: PHẢI HOÀN TOÀN HỢP LỆ VỚI schema BẠN ĐÃ KHAI BÁO (nếu schema có các trường bắt buộc thì example PHẢI chứa các trường đó với dữ liệu mẫu cụ thể. Thiếu export const example hoặc dữ liệu mẫu không khớp với schema sẽ gây lỗi nạp "missing required export" chặn render và làm hỏng toàn dự án!).
- export default registerComponent<Props>({ id: "ten-canh", displayName, promptGuide, schema, Component: Scene, example });
  → id là CHUỖI LITERAL (chữ thường/số/gạch-ngang), khớp manifest.scenes[].component. Riêng manifest.scenes[].id PHẢI là scene-01, scene-02… theo thứ tự, không thêm hậu tố.

CÚ PHÁP TSX BẮT BUỘC (tự kiểm như chạy TypeScript parser trước khi trả lời):
- Mỗi module phải là TypeScript/TSX parse được hoàn chỉnh: import/export hợp lệ, JSX tag đóng đủ, ngoặc (), {}, [], dấu phẩy và dấu nháy cân bằng.
- Trong object literal — đặc biệt style={{ ... }} — CHỈ viết thuộc tính dạng key: value hoặc spread hợp lệ. KHÔNG viết biểu thức/call trần như foo("bar"), condition && ..., JSX rời, hay token lạ bên trong object.
- CSS inline của React phải dùng key camelCase với value rõ ràng, ví dụ justifyContent: "flex-start", alignItems: "center", backgroundColor: "#111827". Không dùng cú pháp CSS string rời/kebab-case như trong file .css.
- Nếu tự thêm motion/math/helper trong component, khai báo biến/hàm hợp lệ trước khi dùng; không để câu chữ giải thích hoặc pseudocode lọt vào khối .tsx.

IMPORT WHITELIST (N4) — CHỈ được import: react, remotion, @motionreal/compositions, zod.
KHÔNG CÒN thư viện block/theme: TUYỆT ĐỐI KHÔNG import "@motionreal/blocks" hay "@motionreal/theme" (đã ngắt — import vào là lỗi N4 chặn render). Không có useTheme, không có Frame/Story/TitleBlock… nào để gọi.
NGOẠI LỆ DUY NHẤT cho ảnh: nếu cảnh có ảnh (field image), import { SceneImage } from "@motionreal/compositions" và render <SceneImage imageRef={image.ref} alt={image.alt} role={image.role} /> — đây là cách DUY NHẤT được phép hiện ảnh (cấm tự dùng <img>/Img/staticFile). role="logo"/"icon" phải giữ asset nhỏ gọn; không phóng thành ảnh hero.
KHÔNG: node:*, gói bên thứ ba, import tương đối ra ngoài file.

API CẤM (N5) — cảnh là HÀM THUẦN của frame:
KHÔNG Math.random, Date/Date.now, fetch/XMLHttpRequest, eval/Function, require/import() động, fs/child_process/process, window.location/document.cookie, dangerouslySetInnerHTML.
Ngẫu nhiên → random(seed) của remotion; hoạt hoạ → useCurrentFrame()+interpolate/spring.

TỰ DỰNG MỌI THỨ (KHÔNG có block dựng sẵn): viết toàn bộ cảnh bằng JSX thuần — thẻ <div>/<span> style inline + <svg>. Tự dựng nền full-bleed (một <div> phủ kín, position absolute inset 0, BẮT BUỘC dùng background: "transparent" để quầng sáng chuyển màu ở nền hiển thị đẹp mắt, tránh dùng nền đặc tối màu), tự dựng card/khung/số-lớn/danh-sách/nhãn bằng div+CSS, tự vẽ mọi đồ hoạ bằng SVG. Tự chọn font-family, màu, khoảng cách, bo góc — hardcode tất cả.
- KHÔNG tự render caption/phụ đề — caption do hệ thống sinh trung tâm từ narration.
Được vẽ SVG/CSS bespoke tuỳ ý (đồ hoạ riêng cho chủ đề); cấm chỉ là ảnh/asset thật bên ngoài.
SVG được dùng <defs> nội bộ với fill/stroke/marker/filter kiểu url(#id). KHÔNG dùng url(http...), url(file...), data:, blob: hay ảnh ngoài.

LAYOUT ZONES:
- Nội dung chính vẫn ở content-zone ~18–62% chiều cao, nhưng 62% là GIỚI HẠN DƯỚI chứ không phải vị trí cần lấp đầy. Thường đặt tâm của focal mass (title/hero/số liệu chính) quanh ~42–46% chiều cao khung — cao hơn nhẹ khoảng 2% so với bố cục dồn thấp — và phân bố cụm nội dung quanh mốc đó. Top reserve áp dụng cả eyebrow/headline: thường bắt đầu chúng từ mép trên của content-zone, không đặt chữ trong ~18% đầu khung (nơi UI FYP/Shorts có thể che) rồi tính phần đồ hoạ thấp hơn vào focal mass. Đây là hướng dẫn bố cục mềm, không phải lệnh ép mọi cảnh vào đúng giữa; bố cục top-aligned (bên trong content-zone) hoặc bất đối xứng vẫn hợp lệ khi có ý đồ thị giác rõ ràng.
- Chừa dải phụ đề (~64–84%) + UI reserve (đáy ~16%) TRỐNG cho phụ đề karaoke + UI nền tảng — đừng đặt nội dung quan trọng sát đáy.
- Giữ nội dung chính PHÍA TRÊN dải phụ đề; tràn xuống là cảnh báo N14 (advisory — KHÔNG chặn render), nhưng vẫn nên tránh để phụ đề đọc rõ. (Không có đường kẻ nào do hệ thống vẽ; cần ngăn cách thì tự dùng khoảng trắng/viền tự vẽ/đổi nền.)
- Cân bằng vùng: cảnh chỉ một tiêu đề + một dòng đọc TRỐNG/đầu nặng; cho beat thưa một mỏ neo (số lớn/đồ hoạ nhỏ).`;

const CREATIVE_COMPOSITION = `ART DIRECTION CẢ VIDEO — trước khi viết code, TỰ CHỌN NGẦM ngôn ngữ thị giác đúng chủ đề: nền sâu nhưng lùi, palette hẹp (nền/chữ/accent), motif mảnh, typography/khoảng thở. Giữ nó xuyên video; KHÔNG đổi style vô cớ hay sao chép palette/diện mạo của thương hiệu/video có sẵn.
- Mỗi cảnh là MỘT bố cục biên tập có focal structure rõ (evidence, timeline, process, comparison, metric, diagram, metaphor), không mặc định "eyebrow + headline + card + ảnh trong khung". Chi tiết phụ phải làm rõ focal structure; dùng khoảng trống có chủ đích.
- Hook, điểm ngoặt và payoff cần signature beat bespoke; cảnh giải thích yên hơn nhưng vẫn có visual anchor. Đa dạng layout trong cùng ngôn ngữ đó, không lặp shell/panel/HUD.
- Asset thật là evidence/subject trong bố cục, không mặc định ảnh trong card; logo/icon chỉ là accent.

DESIGN — BẠN TỰ DO quyết định TOÀN BỘ hình ảnh ngay trong code cảnh: tự chọn màu, nền, gradient, bố cục, bo góc, font, đồ hoạ SVG/CSS. HARDCODE tất cả — không có theme/token nào để đọc nữa. Mỗi cảnh tự dựng từ <div>+<svg> trần. Ưu tiên hierarchy cao, tương phản dễ đọc (N18) và nội dung nằm trong content-zone (mục LAYOUT ZONES ở trên).`;

const TECHNICAL_RUNTIME = `CỠ CHỮ (canvas 1080×1920, xem trên điện thoại — chữ nhỏ là lỗi hay gặp nhất): tiêu đề chính ≥ 64px; câu/đoạn nội dung chính ≥ 40px; nhãn/đơn vị/chú thích phụ ≥ 24px. TUYỆT ĐỐI không để text dưới 18px (không đọc nổi). Số liệu nổi bật nên RẤT lớn (80–160px). Khi nghi ngờ, để chữ TO hơn — ưu tiên ít chữ + lớn hơn nhiều chữ + nhỏ.

CHỮ TRÊN CẢNH ≠ LỜI ĐỌC (lỗi hay gặp: bê NGUYÊN câu narration lên màn hình). Cả câu đầy đủ đã chạy ở phụ đề karaoke đáy khung rồi — nên chữ VẼ trên cảnh chỉ là Ý CHÍNH cô đọng: headline là một CỤM ngắn (≈3–7 từ), không phải cả câu; body/nhãn chỉ vài từ khoá. KHÔNG chép cả narration vào headline/body/Panel. Một cảnh chỉ nên có một-hai mẩu chữ to, KHÔNG phải một đoạn văn nhỏ. Để phụ đề kể câu đầy đủ; màn hình giữ thoáng.

CAPTIONS: phụ đề tiếng Việt một dòng sinh TRUNG TÂM từ narration + đốt vào video (karaoke). KHÔNG tự viết phụ đề trong props.

DETERMINISM + MOTION: Dùng useCurrentFrame() và durationInFrames (từ SceneComponentProps top-level) để tính tiến trình cục bộ của cảnh, rồi dựng motion theo progress này:
const frame = useCurrentFrame();
const { fps } = useVideoConfig();
const progress = durationInFrames > 1 ? Math.min(1, Math.max(0, frame / (durationInFrames - 1))) : 1;
MOTION TEMPO: Mặc định an toàn là quick entrance 0.2–0.8 giây rồi readable hold. Đừng kéo mọi animation ra hết durationInFrames và cũng đừng bịa motion phức tạp chỉ để cảnh luôn động.
1) quick entrance/reveal/pop: dùng cho title, label, card, marker, icon xuất hiện. Công thức an toàn: const enterEnd = Math.max(1, Math.round(fps * 0.45)); rồi interpolate(frame, [0, enterEnd], [0, 1], { extrapolateRight: "clamp" }).
2) semantic progression: chỉ dùng progress dài khi NỘI DUNG thật sự tiến triển qua cảnh — vẽ line/path/chart, process/timeline, before-after, focus shift, map movement, cause/effect. Công thức an toàn: dùng progress đã clamp trong [0, 1], rồi inputRange cũng nằm trong [0, 1], ví dụ interpolate(progress, [0.2, 0.72], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }). Cho final hold sau khi beat chính đã land; final hold là hợp lệ.
3) continuous living motion: chỉ dùng cho wave, shimmer, pulse, signal flow, walking cycle, orbit, vibration nhẹ, ambient depth. Được dùng loop deterministic bằng phase/period sau khi entrance đã settle, ví dụ periodFrames = Math.max(1, Math.round(fps * 1.2)); phase = ((Math.max(0, frame - enterEnd)) % periodFrames) / periodFrames. Chuyển động phải nhỏ, bounded, có chủ đích, không layout shift lớn, không che chữ.
Nếu CONTENT PLAN có motionProgression, xem nó là gợi ý sáng tạo, không phải lệnh bắt mọi cảnh có nhiều tầng motion. Quick entrance + readable final hold luôn hợp lệ cho statement beat. Tự viết hoạt hoạ bằng useCurrentFrame() + spring()/interpolate() của remotion (KHÔNG có hook block nào nữa — không useReveal/useRamp/useTilt), giữ chuyển động mượt, có mục đích và deterministic. Với interpolate, inputRange PHẢI tăng dần nghiêm ngặt; KHÔNG dùng durationInFrames - N làm mốc cuối nếu nó có thể âm hoặc bằng mốc đầu — hãy bọc bằng Math.max(1, durationInFrames - N) hoặc dùng progress [0, 1]. KHÔNG viết vòng góc kiểu [340, 360, 60] — hãy tách thành hai interpolate có clamp (340→360 và 0→60) hoặc chuẩn hoá góc trước.`;

const CREATIVE_VISUALIZATION = `ĐA DẠNG HÌNH THỨC + VISUALIZE SÁNG TẠO (QUAN TRỌNG — lỗi hay gặp nhất là MỌI cảnh chỉ là một tiêu đề + một panel chữ ở giữa, video nào cũng một khuôn). Đừng chỉ ĐẶT CHỮ lên cảnh — hãy BIẾN Ý của cảnh thành HÌNH: tự vẽ đồ hoạ/sơ đồ/ẩn dụ thị giác riêng cho nội dung đó bằng SVG/CSS. Mỗi cảnh CHỌN cách trình bày theo KIỂU nội dung; khi ý có chủ thể cụ thể, ưu tiên một hình tự vẽ hơn là thêm một hộp chữ. Bản đồ nội dung → hình thức (gợi ý, KHÔNG phải khuôn buộc):
- Con số/chỉ số THẬT (%, tiền, lượng) → số RẤT lớn (80–160px, tự dựng bằng <div> chữ to + đếm lên bằng interpolate), hoặc TỰ VẼ con số thành hình: vòng tròn tiến trình, cột/thanh tỉ lệ, lưới chấm "x trên 100", kim đồng hồ đo. KHÔNG nhét số vào câu chữ thường.
- So sánh A với B / trước-sau / hai phe → HAI CỘT cạnh nhau (hai <div> khung tự dựng song song trong một flex row, mỗi bên một nhãn), hoặc tự vẽ đối lập trực quan: hai thanh dài-ngắn, hai vòng to-nhỏ, một mũi tên trước→sau, cán cân nghiêng.
- Quá trình/các bước/dòng thời gian → chuỗi bước DỌC/NGANG có số thứ tự + mũi tên nối, hoặc tự vẽ một timeline/luồng (node nối bằng đường) thay cho list chữ.
- Liệt kê 3–5 điểm → tự dựng danh sách (tự đánh số bằng <div> hàng) hoặc lưới cards; cân nhắc mỗi điểm kèm một icon/glyph tự vẽ để không chỉ là chữ xếp dọc.
- Một định nghĩa/ý/tuyên bố → một khối tiêu đề lớn tự dựng hoặc một câu nhấn; nhưng cho beat thưa MỘT MỎ NEO thị giác tự vẽ (một hình khối/ẩn dụ/glyph lớn), đừng để cảnh chỉ có chữ trôi giữa khung.
- Beat chữ ký (mở đầu/điểm nhấn lớn) → BẮT BUỘC đồ hoạ SVG/CSS bespoke tự vẽ riêng cho chủ đề, KHÔNG chỉ card chữ.
HÃY DÁM VẼ ẨN DỤ: chuyển ý trừu tượng thành hình cụ thể tự dựng — vd "AI tăng tốc" → một thanh tiến trình vọt qua vạch; "rủi ro" → một khối nứt/đường gãy; "kết nối" → các node nối bằng đường; "tăng trưởng" → cột cao dần hoặc đường đi lên; "so kè" → hai phe đối xứng. Vẽ bằng <svg>/<div> tạo hình (path, circle, rect, gradient, mask) + hoạt hoạ theo frame. Đây là LINH HỒN của AUTHOR mode — một cảnh có hình tự vẽ đúng ý hút hơn mười cảnh card chữ.
LUẬT CHỐNG LẶP (đếm được, tự kiểm trước khi trả về):
1) KHÔNG để hơn 2 cảnh LIÊN TIẾP dùng cùng một khuôn bố cục (vd 3 cảnh liền đều "tiêu đề + một khối chữ" là SAI — đổi ít nhất một sang hai-cột/số-lớn/list/bespoke).
2) Trong toàn video, một video 9–12 cảnh nên dùng ÍT NHẤT 3 dạng bố cục khác nhau VÀ có ÍT NHẤT 1–2 cảnh mang đồ hoạ/ẩn dụ TỰ VẼ (SVG/CSS), không phải toàn cảnh card chữ (vd: vài cảnh tiêu đề, ≥1 cảnh số lớn, ≥1 cảnh hai-cột hoặc list, ≥1 beat hình tự vẽ).
3) Số lớn/đếm-lên chỉ cho số THẬT có trong tư liệu — không có số thật thì đừng bịa ra để "có dạng stat".
Text/list thuần là lựa chọn CÓ CHỦ ĐÍCH cho nội dung chữ, KHÔNG phải khuôn mặc định cho mọi cảnh.`;

export const TECHNICAL_AUTHORING_CONTRACT = `${TECHNICAL_CORE}\n\n${TECHNICAL_RUNTIME}`;
export const CREATIVE_AUTHORING_DIRECTION = `${CREATIVE_COMPOSITION}\n\n${CREATIVE_VISUALIZATION}`;
export const AUTHORING_CONTRACT = `${TECHNICAL_AUTHORING_CONTRACT}\n\n${CREATIVE_AUTHORING_DIRECTION}`;
