---
name: scene-authoring
description: Viết composition HyperFrames (HTML + CSS + GSAP) cho video dọc 9:16 TikTok/Reels/Shorts - contract data-attributes, karaoke captions, chuyển cảnh fade, hiệu ứng typography quảng cáo, QA bằng check + snapshot. Use when writing/editing video scenes in starter-hf/, during Stage 4-5 of make-video, or when the user mentions HyperFrames, HTML video, scene, animation code.
---

# Scene Authoring — HyperFrames 9:16

Engine: HyperFrames (HTML thuần + GSAP). Một video = một folder project
`starter-hf/<slug>/` chứa `index.html` + `fonts/` + `voice/`. Agent viết
HTML/CSS/GSAP — không cần build step.

## Contract cốt lõi (vi phạm = lint/render fail)

1. Root: `<div id="root" data-composition-id="main" data-start="0"
   data-width="1080" data-height="1920" data-duration="35.25">` — PHẢI có
   `data-start="0"`, PHẢI khai báo kích thước px (root không size → content
   đổ về góc trên trái).
2. Mỗi cảnh là một clip: `class="clip" data-start data-duration
   data-track-index` (giây, không phải frame). **CSS `.clip` do BẠN
   tự khai báo** trong `<style>`: `.clip { position:absolute; inset:0; }`
   — framework KHÔNG cung cấp sẵn.
3. Đúng MỘT timeline GSAP paused, dựng ĐỒNG BỘ lúc load:
   `window.__timelines["main"] = tl`.
4. **Cấm tween `left/top/width/height`** (snap pixel nguyên → giật khi
   render từng frame) — dùng transform `x/y/scale/opacity`. Cấm đặt
   CSS transform tĩnh trùng property tween — dùng `gsap.fromTo`.
5. Deterministic: cấm `Math.random` không seed, clock, network,
   `repeat: -1`. Cấm `<br>` trong body text. Id duy nhất toàn trang.
6. Nền full-frame đặt trên con `position:absolute; inset:0`, KHÔNG đặt
   background trên root (render có thể mất nền root → đen).
7. `<audio src="voice/b1.wav" data-start="3.01" data-volume="1">` —
   framework tự quản playback; cấm gọi play()/pause() thủ công.
8. GSAP load LOCAL (đã vendor tại `starter-hf/gsap.min.js`), KHÔNG dùng
   CDN — render phải chạy offline:
   `<script src="../gsap.min.js"></script>` (từ folder `<slug>/`).

## Quy trình chuẩn

Lệnh viết cho PowerShell 5.1 (Windows) — không dùng `||`/`&&` bash.
Lệnh fail 2 lần → đổi cách + báo user, cấm lặp vô hạn.

**Vị trí chạy lệnh là bắt buộc:**

- `gen-captions.mjs` chạy từ GỐC TOOLBOX.
- Mọi lệnh `npx hyperframes ...` chạy từ TRONG `starter-hf\<slug>\`
  (folder chứa index.html). Chạy sai chỗ → CLI không thấy composition.

```powershell
# 0. từ GỐC TOOLBOX: sinh caption + audio markup (không tự gõ tay)
node starter-hf\scripts\gen-captions.mjs <slug>   # -> in HTML + JS paste vào index.html

# 1. từ GỐC TOOLBOX: tạo project + copy voice + fonts
New-Item -ItemType Directory -Path "starter-hf\<slug>\voice" -Force
Copy-Item "jobs\<slug>\voice\*" "starter-hf\<slug>\voice\"
Copy-Item "starter-hf\fonts\*" "starter-hf\<slug>\fonts\"

# 2. viết starter-hf\<slug>\index.html (scenes + timeline)

# 3. cd VÀO project rồi mới kiểm (từ đây mọi lệnh chạy tại starter-hf\<slug>)
cd starter-hf\<slug>
npx hyperframes check        # phải 0 error
npx hyperframes snapshot --at 3,12,25 --output qa   # rồi ĐỌC TỪNG PNG

# 4. render sau khi QA sạch (output ra job folder)
npx hyperframes render --output "..\..\jobs\<slug>\output\video.mp4"
```

Lần đầu chạy `npx hyperframes` nó tải engine về cache — có thể mất
vài phút, KHÔNG phải treo. Cấm chạy `npx hyperframes preview` trong
flow tự động (nó là server chặn, không tự thoát).

## Karaoke captions (đã fix 2 bug thật — làm đúng công thức)

Dùng output của `gen-captions.mjs`. Nguyên tắc nếu tự viết:

- Nhóm ~4 từ/thành dòng; dòng hiện từ từ đầu tiên đến khi dòng KẾ bắt đầu
  (KHÔNG cộng padding — hai clip chồng nhau = chữ đè chữ).
- `.caption-line` cần `align-items: flex-end` (box clip kéo từ top:0,
  căn baseline mặc định → chữ dán lên đỉnh frame).
- Highlight từ đang nói = ĐỔI MÀU thôi (`tl.set` màu tại start và tại
  end). Cấm đổi font-weight/scale giữa các từ — glyph metric dịch →
  dấu tiếng Việt nhích lên xuống.
- Vị trí: bottom 280px (trên dải caption nền tảng 340px, chừa lùi 60px).

## Chuyển cảnh giữa cảnh

Cắt cứng = nghiệp dư. Mỗi clip (trừ clip đầu vào, clip cuối ra):

```js
tl.fromTo("#b2", { opacity: 0 }, { opacity: 1, duration: 0.28, ease: "none" }, START_B2);
tl.to("#b2", { opacity: 0, duration: 0.28, ease: "none" }, START_B2 + DUR_B2 - 0.28);
```

Nền các cảnh cùng màu → fade qua nền = crossfade tự nhiên.

## Ngữ pháp motion + biến tấu chữ (bắt buộc, chống "slide chán")

- Entrance nhanh 0.25-0.45s rồi hold. Semantic progression chỉ khi nội
  dung thật sự thay đổi theo thời gian. Living motion nhỏ, có chu kỳ.
- **Menu biến tấu typography — mỗi video phải dùng ít nhất 3 kiểu:**
  - **Stamp/con dấu**: viền `double` 10-12px + `rotate(-4deg)` + scale
    2.1→1 bật xuống.
  - **Highlight box**: nền accent, chữ màu nền, `rotate(-2deg)`,
    padding lớn.
  - **Per-word stagger**: từng từ `fromTo y:46→0 + rotate` lệch 0.1s.
  - **Counter số**: tween object + `onUpdate` ghi `textContent`
    (deterministic theo seek).
  - **Hatch/texture**: `<pattern>` gạch chéo cho phần "mất/hỏng".
  - **Vẽ nét**: `strokeDasharray/offset` cho vết nứt, đường kẻ, chart.
- **Hero object phải có chi tiết**: không vẽ hình trơn. Pin = viền +
  fill + hatch + bolt + vết nứt + counter. Ít nhất 3 lớp chi tiết.

## Style pack

Đọc `styles/<tên>/STYLE.md` được chọn và ÁP DỤNG như design system:
token màu, thang chữ, công thức component, menu biến tấu, cấm kê. Không
hardcode theo một video cũ — pack là hệ thiết kế dùng cho mọi chủ đề.

## QA bắt buộc (không bỏ qua)

`npx hyperframes check` phải 0 error. Snapshot tại: 0.5s, mốc vào từng
cảnh, giữa các cảnh, 1s cuối — **ĐỌC TỪNG PNG**:

- [ ] Frame đầu composed sẵn (thumbnail-grade), không fade từ đen
- [ ] Caption không đè chữ, không dán lên đỉnh, không chồng dòng
- [ ] Hiệu ứng đúng beat/từ; hero object đủ chi tiết
- [ ] Không nội dung lọt safe-area (dưới 340px, phải 160px)
- [ ] Chuyển cảnh mượt (không cắt cứng, không nháy nền)

Sửa → snapshot lại frame lỗi → sạch hết mới render.

## Done =

- `npx hyperframes check` 0 error; QA snapshot đã đọc, checklist đạt.
- `output/video.mp4` render thành công, có cả audio, đúng duration.
