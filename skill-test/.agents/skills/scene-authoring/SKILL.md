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
7. **Audio = MỘT thẻ duy nhất** (master đã merge):
   `<audio id="vo-master" src="voice/narration.wav" data-start="0.00"
   data-volume="1"></audio>`. CẤM đặt từng thẻ `<audio>` theo beat —
   36 thẻ audio làm Chromium treo (Navigation timeout) vì khởi tạo 36
   media pipeline cùng lúc. narration.wav do `merge_voice.py` tạo.
8. GSAP load LOCAL, KHÔNG dùng CDN và KHÔNG dùng đường dẫn `../`
   (lint HyperFrames cấm traversal). Copy `gsap.min.js` vào thẳng
   folder `<slug>\` rồi `<script src="gsap.min.js"></script>`.
9. Font: copy folder `fonts\` (có sẵn `fonts.css` đầy đủ subset
   vietnamese + latin) vào `<slug>\`, link một dòng:
   `<link rel="stylesheet" href="fonts/fonts.css">`. KHÔNG tự viết
   @font-face từng cái — dễ thiếu subset latin cho ký tự Anh/số.

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

# 1. từ GỐC TOOLBOX: tạo project + copy voice + merge master + fonts + gsap
New-Item -ItemType Directory -Path "starter-hf\<slug>\voice" -Force
Copy-Item "jobs\<slug>\voice\*" "starter-hf\<slug>\voice\"
& tools\vieneu-tts\.venv\Scripts\python.exe tools\vieneu-tts\merge_voice.py <slug>
Copy-Item "starter-hf\fonts" "starter-hf\<slug>\fonts" -Recurse
Copy-Item "starter-hf\gsap.min.js" "starter-hf\<slug>\"

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

## Visualize theo lời nói (chuẩn giải thích kỹ thuật — KHÔNG phải slide)

Video giải thích phải như **3blue1brown**: hình là một phần của lời
giải thích, không phải ảnh minh họa đứng cạnh lời đọc. Hai dấu hiệu
bị chặn: (1) mỗi beat một hình tĩnh mới = slide trình chiếu; (2) hình
không đổi trong khi lời đọc chạy = hình trang trí.

### Nguyên tắc hero diagram tiến hóa

- **MỘT diagram chủ tồn tại xuyên suốt video** (cây quyết định, đường
  đồ thị, quy trình, hệ trục...) — mỗi beat NÓI đến đâu, diagram
  TIẾN MỘT BƯỚC ở đó: thêm nhánh khi nói "phân nhánh", tô node khi gọi
  tên, kéo trục khi nói so sánh. Beat sau kế thừa trạng thái beat trước.
- **Mỗi beat = một thay đổi trạng thái có nghĩa** (lấy từ cột "Hình
  diễn biến" của beat sheet). Nếu beat không làm diagram đổi trạng
  thái → hỏi lại kịch bản hoặc thêm chuyển động semantic.
- **Word-sync emphasis**: khi VO gọi tên chi tiết (vd từ "nút gốc",
  "35 độ"), chính chi tiết đó trên diagram nhấn sáng/scale nhẹ ĐÚNG
  LÚC TỪ ĐÓ (dùng CAPTION_WORDS timings hoặc words[] của beat).
- Vẽ dần (`strokeDashoffset`), mọc dần (scale/height theo progress),
  đếm số (counter) là công cụ chuẩn để "hình đi cùng lời".

### Checklist chống "slide thuyết trình"

- [ ] Diagram chủ xuất hiện từ hook và còn mặt ở beat cuối
- [ ] ≥ nửa số beat có diagram THAY ĐỔI TRẠNG THÁI (không chỉ entrance)
- [ ] Có ≥ 2 chỗ hình phản ứng đúng thời điểm một từ/cụm từ nói
- [ ] Không beat nào chỉ toàn chữ không có hình tương tác

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
