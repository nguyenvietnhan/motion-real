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
- Cân bằng vùng: cảnh chỉ một tiêu đề + một dòng đọc TRỐNG/đầu nặng; cho beat thưa một mỏ neo (số lớn/đồ hoạ nhỏ).

DESIGN: nền CREAM sáng + mực gần đen, VUÔNG (bo góc 0), viền mực 4px (không tối, không hairline); màu nhấn theo useTheme() (accent/signal + data-viz). Chữ tương phản cao (N18).

CỠ CHỮ (canvas 1080×1920, xem trên điện thoại — chữ nhỏ là lỗi hay gặp nhất): tiêu đề chính ≥ 64px; câu/đoạn nội dung chính ≥ 40px; nhãn/đơn vị/chú thích phụ ≥ 24px. TUYỆT ĐỐI không để text dưới 18px (không đọc nổi). Số liệu nổi bật nên RẤT lớn (80–160px). Khi nghi ngờ, để chữ TO hơn — ưu tiên ít chữ + lớn hơn nhiều chữ + nhỏ.

CAPTIONS: phụ đề tiếng Việt một dòng sinh TRUNG TÂM từ narration + đốt vào video (karaoke). KHÔNG tự viết phụ đề trong props.

DETERMINISM + MOTION: entrance ease-in rồi settle (useReveal/useRamp); KHÔNG dao động vĩnh viễn (đừng dùng Math.sin(frame), frame%n, interpolate không clamp). Tilt nền nhẹ ở MỘT wrapper cha. Zoom nhấn một lần rồi về scale 1.0 trước midpoint.

ĐA DẠNG HÌNH THỨC: mỗi cảnh CHỌN form theo nội dung (số→biểu đồ/CountUp; so sánh→hai cột; quá trình→sơ đồ luồng; liệt kê→cards/KeyPoints; ý/định nghĩa→text). KHÔNG lặp một block cho cả video; viết đồ hoạ bespoke cho beat chữ ký. Text/list thuần là lựa chọn CÓ CHỦ ĐÍCH cho nội dung chữ, không phải mặc định lười.`;
