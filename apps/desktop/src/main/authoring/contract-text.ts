/**
 * The pure-AUTHOR contract, inlined (desktop-author-mode, Req 1.5). A condensed
 * but faithful version of `.kiro/steering/authoring-contract.md` — inlined as a
 * constant so the bundled Electron main never reads it from disk (deterministic,
 * no fs in the hot path). Embedded into the author + reauthor prompts so the AI
 * writes `.tsx` scene modules that pass the admission gate (N4/N5) and look
 * on-brand. Keep this in sync with the steering doc when the contract changes.
 */

export const AUTHORING_CONTRACT = `HỢP ĐỒNG VIẾT CẢNH (AUTHOR mode) — mỗi cảnh là MỘT module .tsx Remotion bạn TỰ VIẾT MỚI.

EXPORT BẮT BUỘC (mọi module):
- import React from "react"; import { z } from "zod";
- import { registerComponent, type SceneComponentProps } from "@news/compositions";
- import các block từ "@news/blocks".
- export const schema = z.object({...})  // props của cảnh
- type Props = z.infer<typeof schema>
- const Scene: React.FC<SceneComponentProps<Props>> = ({ headline, body, eyebrow, props }) => (... )
- export const example: Props = {...}      // PHẢI hợp lệ với schema
- export default registerComponent<Props>({ id: "ten-canh", displayName, promptGuide, schema, Component: Scene, example });
  → id là CHUỖI LITERAL (chữ thường/số/gạch-ngang), trùng id trong manifest.

IMPORT WHITELIST (N4) — CHỈ được import: react, remotion, @news/design, @news/blocks, @news/compositions, zod.
KHÔNG: node:*, gói bên thứ ba, import tương đối ra ngoài file.

API CẤM (N5) — cảnh là HÀM THUẦN của frame:
KHÔNG Math.random, Date/Date.now, fetch/XMLHttpRequest, eval/Function, require/import() động, fs/child_process/process, window.location/document.cookie, dangerouslySetInnerHTML.
Ngẫu nhiên → random(seed) của remotion; hoạt hoạ → useCurrentFrame()+interpolate/spring.

BLOCKS (@news/blocks) — COMPOSE, đừng tự code khung:
- Frame: nền full-bleed. Story: khung biên tập (HeaderBar trên + panel giữa + Footer). Content: cột content-zone.
- TitleBlock({headline, body?}): card tiêu đề có khung. Panel({title?,tone?}): hộp viền. Callout, IdeaPanel, StatChip.
- StatBlock/CountUp: số lớn (chỉ số THẬT). KeyPoints({items}): danh sách tự đánh số.
- KHÔNG tự render caption/phụ đề — caption do hệ thống sinh trung tâm từ narration.
Được vẽ SVG/CSS bespoke (đồ hoạ riêng cho chủ đề); cấm chỉ là ảnh/asset thật bên ngoài.

LAYOUT ZONES:
- Nội dung chính ở content-zone phía TRÊN (~tới 62% chiều cao); Content/Story tự căn.
- Chừa caption band (~64–84%) + UI reserve (đáy ~16%) TRỐNG.
- Có đường kẻ ĐEN ở đáy content-zone; giữ nội dung PHÍA TRÊN nó — tràn xuống là lỗi N14 (chặn render).
- ĐƯỜNG KẺ NGANG ở đáy content-zone do HỆ THỐNG tự vẽ — TUYỆT ĐỐI KHÔNG tự thêm đường kẻ ngang trải hết bề rộng (div/hr full-width, position:absolute left:0 right:0) làm "vạch phân cách"/"đường trang trí" ở giữa hay bất kỳ đâu trong cảnh; nó cắt đôi khung hình và đè lên divider thật. Muốn ngăn cách thị giác thì dùng KHOẢNG TRẮNG, viền của block (Panel/Story), hoặc đổi nền — đừng kẻ ngang ngang màn.
- Cân bằng vùng: cảnh chỉ một tiêu đề + một dòng đọc TRỐNG/đầu nặng; cho beat thưa một mỏ neo (số lớn/đồ hoạ nhỏ).

DESIGN (BẤT BIẾN, áp cho MỌI ngôn ngữ thiết kế): KHÔNG hardcode màu/viền/bo góc/nền. Đọc MỌI quyết định hình ảnh từ theme: theme.colors.* (màu), theme.radius.* (bo góc — VUÔNG hay BO TRÒN tuỳ ngôn ngữ), theme.surface (cách vẽ viền/fill/bóng/chip), theme.fonts.* (phông — CHỈ có 3 key: theme.fonts.display cho tiêu đề, theme.fonts.body cho đoạn văn, theme.fonts.mono cho nhãn/số/đơn vị; KHÔNG có heading/title/sans/serif — dùng key khác là lỗi N10 chặn render). Frame tự sơn nền + backdrop đúng ngôn ngữ (đừng tự vẽ nền). Chữ tương phản cao (N18). Khối nội dung COMPOSE từ @news/blocks — chúng tự đọc theme nên hợp mọi ngôn ngữ; muốn đồ hoạ bespoke thì cũng đọc theme (đừng đặt màu/bo góc cứng).
MÀU — đọc qua const theme = useTheme(); rồi theme.colors.X (KHÔNG đọc phẳng theme.X). Token CÓ THẬT: nền bg/bgElevated, thẻ panel, chữ fg, chữ mờ muted, nhấn chính accent, nhấn phụ/đối lập signal, viền line; bộ data-viz red/blue/yellow/green/violet. (KHÔNG cần ink/paper/primary/text — dùng fg/bg/accent.)
⚠ NGÔN NGỮ THIẾT KẾ CỤ THỂ của video này (nền/bo góc/phông/cách vẽ khối — TUÂN THEO, đừng mặc định kiểu in ấn sáng) được nêu Ở DƯỚI phần hợp đồng này.

CỠ CHỮ (canvas 1080×1920, xem trên điện thoại — chữ nhỏ là lỗi hay gặp nhất): tiêu đề chính ≥ 64px; câu/đoạn nội dung chính ≥ 40px; nhãn/đơn vị/chú thích phụ ≥ 24px. TUYỆT ĐỐI không để text dưới 18px (không đọc nổi). Số liệu nổi bật nên RẤT lớn (80–160px). Khi nghi ngờ, để chữ TO hơn — ưu tiên ít chữ + lớn hơn nhiều chữ + nhỏ.

CAPTIONS: phụ đề tiếng Việt một dòng sinh TRUNG TÂM từ narration + đốt vào video (karaoke). KHÔNG tự viết phụ đề trong props.

DETERMINISM + MOTION: entrance ease-in rồi settle (useReveal/useRamp); KHÔNG dao động vĩnh viễn (đừng dùng Math.sin(frame), frame%n, interpolate không clamp). Tilt nền nhẹ ở MỘT wrapper cha. Zoom nhấn một lần rồi về scale 1.0 trước midpoint.

ĐA DẠNG HÌNH THỨC (QUAN TRỌNG — lỗi hay gặp nhất là MỌI cảnh trông GIỐNG NHAU: một tiêu đề + một panel chữ ở giữa). Mỗi cảnh phải CHỌN bố cục theo KIỂU nội dung của nó, KHÔNG dùng một khuôn cho cả video. Bản đồ nội dung → bố cục (theo đúng đây):
- Con số/chỉ số THẬT (%, tiền, lượng) → StatBlock hoặc CountUp số RẤT lớn (80–160px), KHÔNG nhét số vào câu chữ thường.
- So sánh A với B / trước-sau / hai phe → HAI CỘT cạnh nhau (hai Panel/StatBlock song song trong một flex row), mỗi bên một nhãn.
- Quá trình/các bước/dòng thời gian → chuỗi bước DỌC có số thứ tự hoặc mũi tên giữa các bước (KeyPoints hoặc các Callout xếp chuỗi).
- Liệt kê 3–5 điểm → KeyPoints (tự đánh số) hoặc lưới cards, KHÔNG viết thành một đoạn văn.
- Một định nghĩa/ý/tuyên bố → TitleBlock lớn hoặc một Callout nhấn; cho phép cảnh chữ thưa nhưng phải có một mỏ neo thị giác (số, icon bespoke, hình khối).
- Beat chữ ký (mở đầu/điểm nhấn lớn) → đồ hoạ SVG/CSS bespoke riêng cho chủ đề (KHÔNG chỉ là card chữ).
LUẬT CHỐNG LẶP (đếm được, tự kiểm trước khi trả về):
1) KHÔNG để hơn 2 cảnh LIÊN TIẾP dùng cùng một khuôn bố cục (vd 3 cảnh liền đều "TitleBlock + Panel" là SAI — đổi ít nhất một sang hai-cột/stat/list/bespoke).
2) Trong toàn video, một video 9–12 cảnh nên dùng ÍT NHẤT 3 dạng bố cục khác nhau (vd: vài cảnh title, ≥1 cảnh stat lớn, ≥1 cảnh hai-cột hoặc list, ≥1 beat bespoke).
3) StatBlock/CountUp chỉ cho số THẬT có trong tư liệu — không có số thật thì đừng bịa ra để "có dạng stat".
Text/list thuần là lựa chọn CÓ CHỦ ĐÍCH cho nội dung chữ, KHÔNG phải khuôn mặc định cho mọi cảnh.`;
