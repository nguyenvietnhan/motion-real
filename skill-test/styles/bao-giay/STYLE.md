# Style Pack: báo giấy (bao-giay)

Editorial magazine — giấy kem, mực đen, đỏ son. Sang trọng, đọc sướng.
Hợp nội dung phân tích, kể chuyện, "sự thật ít ai biết", so sánh cũ/mới.

**Pack này là design system dùng cho MỌI chủ đề** — không phải mô tả
một video cụ thể. Áp công thức dưới đây vào nội dung của bạn.

## 1. Tokens

| Token | Giá trị |
| --- | --- |
| `--bg` | `#F6F1E7` (giấy kem) |
| `--ink` | `#17140E` (mực chính) |
| `--ink-sub` | `#6B6459` (mực phụ) |
| `--accent` | `#D6452C` (đỏ son — MỘT accent duy nhất) |
| `--accent-danger` | `#B3382B` (chỉ cho cảnh báo/nguy) |
| `--paper-card` | `#FFFDF7` |
| `--radius` | 4-8px (góc gần vuông — cấm bo 32px kiểu app) |
| `--border` | 3px solid ink; hairline 2px ink cho kẻ phân cách |

## 2. Thang chữ (1080×1920)

| Vai | Font | Size | Ghi chú |
| --- | --- | --- | --- |
| Display/tiêu đề | Literata 900 (serif) | 58-88px | KHÔNG italic |
| Số liệu lớn | IBM Plex Mono 600 | 96-150px | kèm "%" cỡ 70px |
| Eyebrow/nhãn | IBM Plex Mono 600 | 36-40px | HOA, letter-spacing 4px |
| Body | Be Vietnam Pro 400/600 | 44-56px | weight 700 cho nhấn |

Root luôn `font-family: 'Be Vietnam Pro', sans-serif`; display riêng
cho tiêu đề. Vendor fonts: Literata-900, BeVietnamPro-400/600,
IBMPlexMono-400/600 (subset vi + latin).

## 3. Công thức component (áp cho nội dung bất kỳ)

- **Hero object** (đối tượng trung tâm của beat): viền mực 14px + fill
  accent phẳng + ÍT NHẤT 3 lớp chi tiết (pattern hatch cho phần
  "mất/hỏng", icon line-8px, vết nứt/kẻ chi tiết strokeDashoffset).
  Cấm hình trơn một màu.
- **Stamp/con dấu**: chữ trong viền `double` 10-12px, `rotate(-4deg)`,
  scale 2.1→1 bật xuống, màu accent hoặc danger. Dùng cho kết luận/
  con số gây sốc.
- **Counter số liệu**: mono 150px đếm tăng/giảm theo timeline
  (onUpdate), kèm eyebrow mono nhỏ phía trên.
- **Highlight box**: nền accent/danger, chữ màu giấy, `rotate(-2deg)`,
  padding 6-16px — dùng cho cụm từ chốt trong câu display.
- **Quote card**: nền paper-card + viền 3px + thanh mực 14px trên đỉnh,
  dấu ngoặc kép serif 150px accent, hairline phân cách trước footer.
- **Danh sách**: số serif 80px accent + text 56px, kẻ hairline 2px giữa
  các dòng, KHÔNG checkbox bo tròn màu mầm.
- **Đối tượng đo (nhiệt kế/đồng hồ/đồ thị)**: line-art mực, phần giá
  trị fill accent/danger, mốc số mono.

## 4. Motion

- Entrance: fade + translateY 24-46px, 0.25-0.45s, `power3.out`, KHÔNG nảy.
- Chuyển cảnh: fade 0.28s qua nền (trừ cảnh đầu vào/cuối ra).
- Vẽ nét: strokeDashoffset theo timeline. Counter: linear, clamp.
- Stamp: scale 2.1→1 + rotate cố định, 0.35s.
- Giấy in KHÔNG thở: cấm pulse/wave lặp.

## 5. Bố cục

- **1 thông điệp/màn hình, ≥50% khoảng trống** — như một trang báo
  dàn thoáng, không nhồi. Tối đa 2 nhóm element mỗi beat.
- CẤM panel/khung bao toàn màn hình. Card nhỏ chỉ khi có nghĩa, ≤2/beat.
- CẤM footer chrome. Stamp ≤2 lần/cả video (đặc trưng pack — đừng lạm).
- Đổi hình thức bố cục theo beat (menu 6 form trong scene-authoring).
- Safe-area: nội dung chính trong top 160 / trái 72 / phải 160 /
  trên dải caption 340px.

## 6. Cấm (anti-slop)

Gradient bất kỳ · bóng đổ mềm · glassmorphism · neon · emoji ·
Inter/Roboto/system-ui làm display · nhiều hơn 1 accent màu/video ·
checkbox bo tròn kiểu app · nền tối (đây là pack giấy sáng).
