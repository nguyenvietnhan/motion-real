# Style Pack: phòng lab (phong-lab)

Terminal / thiết bị đo — nền tối ánh lục, lưới mảnh, số liệu mono.
Hợp nội dung benchmark, so sánh, đo đạc, dev/tool, "kiểm chứng".

**Pack này là design system dùng cho MỌI chủ đề** — áp công thức vào
nội dung của bạn, không copy màn hình cũ.

## 1. Tokens

| Token | Giá trị |
| --- | --- |
| `--bg` | `#0C0F0E` |
| `--ink` | `#E8F0E9` |
| `--ink-sub` | `#7C8A80` |
| `--accent` | `#46E08A` (phosphor — kết quả đúng/đo được) |
| `--accent-warn` | `#FFC24B` (amber — cảnh báo; KHÔNG dùng đỏ) |
| `--panel` | `#111613` |
| `--radius` | 4px |
| `--grid` | ô 72px, `#7C8A80` alpha 8%, TĨNH |

## 2. Thang chữ

| Vai | Font | Size |
| --- | --- | --- |
| Display | Archivo 900 | 64-88px, letter-spacing -1px, có thể HOA |
| Body | Be Vietnam Pro 400/600 | 44-52px |
| Số liệu/nhãn | IBM Plex Mono 400/600 | 36-48px nhãn HOA ls-4px; 96-150px số lớn |

MỌI con số, đơn vị, nhãn trạng thái dùng mono. Vendor fonts:
Archivo-900, BeVietnamPro-400/600, IBMPlexMono-400/600.

## 3. Công thức component

- **Hero object kiểu thiết bị**: khung viền 6px ink + fill accent +
  nhãn `[ ĐANG ĐO ]` / `[ KẾT QUẢ ]` mono + corner brackets (⌐¬L⌡ bằng
  2 đường 4px accent). Ít nhất 3 lớp chi tiết.
- **Counter/đọc số**: mono 150px, đếm theo timeline linear clamp, đơn
  vị cỡ 70px màu sub.
- **Thanh đo**: viền 6px ink, fill accent chạy linear dừng đúng mốc;
  phần trăm mono 48px căn phải cạnh thanh.
- **Toggle/công tắc**: pill accent khi bật, panel khi tắt, knob ink.
- **Gạch bỏ dữ liệu sai**: đường chéo 4px amber + label mono.
- **Bảng so sánh**: hairline `#2A352E`, cột thắng fill accent alpha
  15%, nhãn mono HOA.

## 4. Motion

- Entrance: slide 24px + fade 8 frame, `power3.out`, không nảy.
- Chuyển cảnh: fade 0.28s qua nền.
- Counter + thanh đo: linear, clamp, không overshoot.
- Lưới nền TĨNH. Không scanline chạy, không glow.

## 5. Bố cục

- **1 thông điệp/màn hình, ≥50% khoảng trống.** Tối đa 2 nhóm element
  mỗi beat. CẤM panel bao toàn màn hình — thiết bị đo cũng chỉ chiếm
  vùng nội dung, không bọc cả frame.
- CẤM footer chrome. Stamp ≤2 lần/cả video.
- Đổi hình thức bố cục theo beat (menu 6 form trong scene-authoring).
- Safe-area: top 160 / trái 72 / phải 160 / trên caption band 340px.

## 6. Cấm (anti-slop)

Neon glow · text-shadow màu · scanline chạy · gradient tím/xanh · nền
trắng · emoji · Inter làm display · đỏ (dùng amber cho cảnh báo) ·
lưới chuyển động vô nghĩa.
