/**
 * The pure-AUTHOR contract, inlined (desktop-author-mode, Req 1.5). A condensed
 * but faithful version of `docs/current/authoring-contract.md` — inlined as a
 * constant so the bundled Electron main never reads it from disk (deterministic,
 * no fs in the hot path). Embedded into the author + reauthor prompts so the AI
 * writes `.tsx` scene modules that pass the admission gate (N4/N5) and look
 * on-brand. Keep this in sync with `docs/current/authoring-contract.md` when the contract changes.
 */

export const AUTHORING_CONTRACT = `HỢP ĐỒNG VIẾT CẢNH (AUTHOR mode — KHÔNG CÓ THƯ VIỆN BLOCK) — mỗi cảnh là MỘT module .tsx Remotion bạn TỰ VIẾT MỚI 100% bằng JSX/SVG trần.

EXPORT BẮT BUỘC (mọi module):
- import React from "react"; import { z } from "zod";
- import { registerComponent, type SceneComponentProps } from "@motionreal/compositions";
- export const schema = z.object({...})  // CHỈ props BESPOKE của cảnh
  → TUYỆT ĐỐI KHÔNG khai báo headline/eyebrow/body/image trong schema — đó là field TOP-LEVEL hệ thống tự truyền vào cảnh (xem SceneComponentProps), KHÔNG thuộc props. Đặt chúng vào schema là lỗi N3 ("props invalid at headline: expected string, received undefined") chặn render. schema chỉ chứa dữ liệu RIÊNG cảnh tự nghĩ ra (số liệu, nhãn, danh sách…). Cảnh không có props riêng thì để z.object({}).
- type Props = z.infer<typeof schema>
- const Scene: React.FC<SceneComponentProps<Props>> = ({ headline, body, eyebrow, props }) => (... )
  → headline/body/eyebrow/image lấy từ tham số top-level (đã destructure ở trên); dữ liệu bespoke lấy từ props.*.
- export const example: Props = {...}      // CỰC KỲ QUAN TRỌNG: PHẢI HOÀN TOÀN HỢP LỆ VỚI schema BẠN ĐÃ KHAI BÁO (nếu schema có các trường bắt buộc thì example PHẢI chứa các trường đó với dữ liệu mẫu cụ thể. Thiếu export const example hoặc dữ liệu mẫu không khớp với schema sẽ gây lỗi nạp "missing required export" chặn render và làm hỏng toàn dự án!).
- export default registerComponent<Props>({ id: "ten-canh", displayName, promptGuide, schema, Component: Scene, example });
  → id là CHUỖI LITERAL (chữ thường/số/gạch-ngang), trùng id trong manifest.

CÚ PHÁP TSX BẮT BUỘC (tự kiểm như chạy TypeScript parser trước khi trả lời):
- Mỗi module phải là TypeScript/TSX parse được hoàn chỉnh: import/export hợp lệ, JSX tag đóng đủ, ngoặc (), {}, [], dấu phẩy và dấu nháy cân bằng.
- Trong object literal — đặc biệt style={{ ... }} — CHỈ viết thuộc tính dạng key: value hoặc spread hợp lệ. KHÔNG viết biểu thức/call trần như foo("bar"), condition && ..., JSX rời, hay token lạ bên trong object.
- CSS inline của React phải dùng key camelCase với value rõ ràng, ví dụ justifyContent: "flex-start", alignItems: "center", backgroundColor: "#111827". Không dùng cú pháp CSS string rời/kebab-case như trong file .css.
- Nếu tự thêm motion/math/helper trong component, khai báo biến/hàm hợp lệ trước khi dùng; không để câu chữ giải thích hoặc pseudocode lọt vào khối .tsx.

IMPORT WHITELIST (N4) — CHỈ được import: react, remotion, @motionreal/compositions, zod.
KHÔNG CÒN thư viện block/theme: TUYỆT ĐỐI KHÔNG import "@motionreal/blocks" hay "@motionreal/theme" (đã ngắt — import vào là lỗi N4 chặn render). Không có useTheme, không có Frame/Story/TitleBlock… nào để gọi.
NGOẠI LỆ DUY NHẤT cho ảnh: nếu cảnh có ảnh (field image), import { SceneImage } from "@motionreal/compositions" và render <SceneImage imageRef={image.ref} alt={image.alt} /> — đây là cách DUY NHẤT được phép hiện ảnh (cấm tự dùng <img>/Img/staticFile).
KHÔNG: node:*, gói bên thứ ba, import tương đối ra ngoài file.

API CẤM (N5) — cảnh là HÀM THUẦN của frame:
KHÔNG Math.random, Date/Date.now, fetch/XMLHttpRequest, eval/Function, require/import() động, fs/child_process/process, window.location/document.cookie, dangerouslySetInnerHTML.
Ngẫu nhiên → random(seed) của remotion; hoạt hoạ → useCurrentFrame()+interpolate/spring.

TỰ DỰNG MỌI THỨ (KHÔNG có block dựng sẵn): viết toàn bộ cảnh bằng JSX thuần — thẻ <div>/<span> style inline + <svg>. Tự dựng nền full-bleed (một <div> phủ kín, position absolute inset 0, BẮT BUỘC dùng background: "transparent" để quầng sáng chuyển màu ở nền hiển thị đẹp mắt, tránh dùng nền đặc tối màu), tự dựng card/khung/số-lớn/danh-sách/nhãn bằng div+CSS, tự vẽ mọi đồ hoạ bằng SVG. Tự chọn font-family, màu, khoảng cách, bo góc — hardcode tất cả.
- KHÔNG tự render caption/phụ đề — caption do hệ thống sinh trung tâm từ narration.
Được vẽ SVG/CSS bespoke tuỳ ý (đồ hoạ riêng cho chủ đề); cấm chỉ là ảnh/asset thật bên ngoài.
SVG được dùng <defs> nội bộ với fill/stroke/marker/filter kiểu url(#id). KHÔNG dùng url(http...), url(file...), data:, blob: hay ảnh ngoài.

LAYOUT ZONES:
- Nội dung chính ở content-zone phía TRÊN (~tới 62% chiều cao); tự căn nội dung vào vùng này.
- Chừa dải phụ đề (~64–84%) + UI reserve (đáy ~16%) TRỐNG cho phụ đề karaoke + UI nền tảng — đừng đặt nội dung quan trọng sát đáy.
- Giữ nội dung chính PHÍA TRÊN dải phụ đề; tràn xuống là cảnh báo N14 (advisory — KHÔNG chặn render), nhưng vẫn nên tránh để phụ đề đọc rõ. (Không có đường kẻ nào do hệ thống vẽ; cần ngăn cách thì tự dùng khoảng trắng/viền tự vẽ/đổi nền.)
- Cân bằng vùng: cảnh chỉ một tiêu đề + một dòng đọc TRỐNG/đầu nặng; cho beat thưa một mỏ neo (số lớn/đồ hoạ nhỏ).

DESIGN — BẠN TỰ DO quyết định TOÀN BỘ hình ảnh ngay trong code cảnh: tự chọn màu, nền, gradient, bố cục, bo góc, font, đồ hoạ SVG/CSS. HARDCODE tất cả — không có theme/token nào để đọc nữa. Mỗi cảnh tự dựng từ <div>+<svg> trần. Mục tiêu là SÁNG TẠO — đừng để mọi cảnh hay mọi video trông giống nhau một khuôn. Hai điều duy nhất phải giữ vì người xem: chữ tương phản cao, dễ đọc trên nền bạn chọn (N18); và nội dung nằm trong content-zone (mục LAYOUT ZONES ở trên).

CỠ CHỮ (canvas 1080×1920, xem trên điện thoại — chữ nhỏ là lỗi hay gặp nhất): tiêu đề chính ≥ 64px; câu/đoạn nội dung chính ≥ 40px; nhãn/đơn vị/chú thích phụ ≥ 24px. TUYỆT ĐỐI không để text dưới 18px (không đọc nổi). Số liệu nổi bật nên RẤT lớn (80–160px). Khi nghi ngờ, để chữ TO hơn — ưu tiên ít chữ + lớn hơn nhiều chữ + nhỏ.

CHỮ TRÊN CẢNH ≠ LỜI ĐỌC (lỗi hay gặp: bê NGUYÊN câu narration lên màn hình). Cả câu đầy đủ đã chạy ở phụ đề karaoke đáy khung rồi — nên chữ VẼ trên cảnh chỉ là Ý CHÍNH cô đọng: headline là một CỤM ngắn (≈3–7 từ), không phải cả câu; body/nhãn chỉ vài từ khoá. KHÔNG chép cả narration vào headline/body/Panel. Một cảnh chỉ nên có một-hai mẩu chữ to, KHÔNG phải một đoạn văn nhỏ. Để phụ đề kể câu đầy đủ; màn hình giữ thoáng.

CAPTIONS: phụ đề tiếng Việt một dòng sinh TRUNG TÂM từ narration + đốt vào video (karaoke). KHÔNG tự viết phụ đề trong props.

DETERMINISM + MOTION: KHUYẾN KHÍCH cảnh có cảm giác đang DIỄN TIẾN qua phần lớn thời lượng khi phù hợp với nội dung, thay vì mọi thứ chỉ xuất hiện ở đầu rồi đứng yên. Hãy nghĩ motion như một phần của cách kể bằng hình: thông tin có thể được hé lộ dần, nét/đường được vẽ tiếp, số liệu hoặc quan hệ thay đổi theo tiến trình, điểm nhấn chuyển từ phần này sang phần khác, hay nhiều lớp chuyển động nhẹ nối nhau. Đây là HƯỚNG SÁNG TẠO, KHÔNG phải luật bắt buộc: không cần làm mọi phần tử chuyển động, và một cảnh tĩnh có chủ đích vẫn hoàn toàn hợp lệ; đừng thêm chuyển động vô nghĩa chỉ để cảnh luôn động. Tự viết hoạt hoạ bằng useCurrentFrame() + spring()/interpolate() của remotion (KHÔNG có hook block nào nữa — không useReveal/useRamp/useTilt), giữ chuyển động mượt, có mục đích và deterministic. Có thể chia thành vài nhịp tự nhiên trong cảnh, nhưng mỗi nhịp nên được giới hạn/settle bằng interpolate có clamp hoặc spring; KHÔNG dao động/lặp vĩnh viễn (đừng dùng Math.sin(frame), frame%n, interpolate không clamp).

ĐA DẠNG HÌNH THỨC + VISUALIZE SÁNG TẠO (QUAN TRỌNG — lỗi hay gặp nhất là MỌI cảnh chỉ là một tiêu đề + một panel chữ ở giữa, video nào cũng một khuôn). Đừng chỉ ĐẶT CHỮ lên cảnh — hãy BIẾN Ý của cảnh thành HÌNH: tự vẽ đồ hoạ/sơ đồ/ẩn dụ thị giác riêng cho nội dung đó bằng SVG/CSS. Mỗi cảnh CHỌN cách trình bày theo KIỂU nội dung; khi ý có chủ thể cụ thể, ưu tiên một hình tự vẽ hơn là thêm một hộp chữ. Bản đồ nội dung → hình thức (gợi ý, KHÔNG phải khuôn buộc):
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
