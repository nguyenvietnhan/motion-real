# Style Pack: default

Nền tối trung tính — mốc cơ bản khi user không chọn pack. Đậm, sạch,
đọc rõ trên điện thoại. Đây là design system dùng cho MỌI chủ đề.

## 1. Tokens

| Token | Giá trị |
| --- | --- |
| `--bg` | `#0B0E14` |
| `--ink` | `#F4F7FB` |
| `--ink-sub` | `#8B94A6` |
| `--accent` | `#60A5FA` (xanh — accent DUY NHẤT) |
| `--accent-danger` | `#F87171` |
| `--panel` | `#121722` |
| `--radius` | 16-24px |
| `--border` | 3px accent hoặc ink |

## 2. Thang chữ (1080×1920)

| Vai | Font | Size |
| --- | --- | --- |
| Display/tiêu đề | Be Vietnam Pro 900 | 58-88px |
| Số liệu lớn | IBM Plex Mono 600 | 96-150px |
| Eyebrow/nhãn | IBM Plex Mono 600 | 36-40px, HOA, ls 4px |
| Body | Be Vietnam Pro 400/600 | 44-56px |

CẤM dùng "sans-serif hệ thống" làm display — dùng font đã vendor
(Be Vietnam Pro / IBM Plex Mono / Archivo / Literata).

## 3. Công thức component

- **Hero object**: viền 14px ink + fill accent + tối thiểu 3 lớp chi
  tiết (icon, pattern/hatch cho phần mất/hỏng, vẽ nét strokeDashoffset,
  counter). Cấm hình trơn.
- **Stamp**: viền `double` 10-12px accent + `rotate(-4deg)` + scale
  2.1→1.
- **Highlight box**: nền accent, chữ màu bg, `rotate(-2deg)`.
- **Counter**: mono lớn, tween theo timeline, đơn vị cỡ 70px màu sub.
- **Card**: nền panel + viền 3px accent, eyebrow mono phía trên.
- **Danh sách**: check box bo `--radius` nền accent, hoặc số display
  lớn accent + hairline phân cách.

## 4. Motion

- Entrance: fade + translateY 24-46px, 0.25-0.45s, không nảy quá.
- Chuyển cảnh: fade 0.28s qua nền (trừ đầu/cuối).
- Living motion nhỏ có chu kỳ sau khi entrance ổn; không đè chữ.

## 5. Bố cục

- **1 thông điệp/màn hình, ≥50% khoảng trống.** Tối đa 2 nhóm element
  mỗi beat. CẤM panel/khung bao toàn màn hình — content thả trên nền.
- CẤM footer chrome (watermark, tên video, timestamp meta).
- Stamp tối đa 1-2 lần/cả video. Eyebrow chỉ khi cần định vị.
- Đổi hình thức bố cục theo beat (menu 6 form trong scene-authoring).
- Safe-area: top 160 / trái 72 / phải 160 / trên caption band 340px.

## 6. Cấm (anti-slop)

Gradient tím/xanh loè loè · glassmorphism · neon glow · emoji thay icon
· "sans-serif hệ thống" làm display · quá 2 accent màu/video · cùng
một layout lặp toàn video.
