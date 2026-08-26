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
   data-width="1080" data-height="1920" data-duration="263.21">` — PHẢI có
   `data-start="0"`, PHẢI khai báo kích thước px (root không size → content
   đổ về góc trên trái). `data-duration` = `totalSeconds` trong
   beats.json của job (đừng copy mù con số ví dụ).
2. Mỗi cảnh là một clip: `class="clip" data-start data-duration
   data-track-index` (giây, không phải frame). **CSS `.clip` do BẠN
   tự khai báo** trong `<style>`: `.clip { position:absolute; inset:0; }`
   — framework KHÔNG cung cấp sẵn.
   **1 BEAT = 1 CLIP — cấm gom nhiều beat vào một scene lớn.** Gom
   cảnh để "giảm số element/tăng tốc" là nguyên nhân số một tạo ra
   slide: cả 40-60 giây nội dung nằm lộ sẵn và bất động. Muốn nhẹ
   thì nén audio (dùng narration.m4a), không phải cắt cảnh.
3. Đúng MỘT timeline GSAP paused, dựng ĐỒNG BỘ lúc load:
   `window.__timelines["main"] = tl`.
4. **Cấm tween `left/top/width/height`** (snap pixel nguyên → giật khi
   render từng frame) — dùng transform `x/y/scale/opacity`. Cấm đặt
   CSS transform tĩnh trùng property tween — dùng `gsap.fromTo`.
5. Deterministic: cấm `Math.random` không seed, clock, network,
   `repeat: -1`. Cấm `<br>` trong body text. Id duy nhất toàn trang.
   **Cấm dùng cú pháp `/* ... */` trong BẤT KỲ text hiển thị nào trên
   màn hình** (kể cả mockup code) — linter đọc nhầm là comment CSS
   (`visible_markup_comment`). Code mockup hiển thị dùng `//` hoặc `#`.
   **Mọi `<svg>` chứa sơ đồ/text nghiêng PHẢI có
   `data-layout-allow-overlap`** trên `<svg>` và các `<text>` bên
   trong — bounding box text xoay sẽ chạm nhau và fail layout check.
6. Nền full-frame đặt trên con `position:absolute; inset:0`, KHÔNG đặt
   background trên root (render có thể mất nền root → đen).
7. **Audio = MỘT thẻ duy nhất** (master đã merge), dùng bản NÉN:
   `<audio id="vo-master" src="voice/narration.m4a" data-start="0.00"
   data-volume="1"></audio>`. WAV gốc 5 phút nặng ~25MB → Chromium
   timeout khi load; m4a ~3-5MB load dưới 1 giây. `merge_voice.py`
   tự tạo cả hai. CẤM đặt từng thẻ `<audio>` theo beat — 36 thẻ audio
   làm Chromium treo (Navigation timeout) vì khởi tạo 36 media
   pipeline cùng lúc.
8. GSAP load LOCAL, KHÔNG dùng CDN và KHÔNG dùng đường dẫn `../`
   (lint HyperFrames cấm traversal). Copy `gsap.min.js` vào thẳng
   folder `<slug>\` rồi `<script src="gsap.min.js"></script>`.
9. Font: copy folder `fonts\` vào `<slug>\`, rồi **INLINE toàn bộ khối
   `@font-face`** (copy từ `fonts\fonts.css`) vào `<style>` của
   index.html — KHÔNG dùng `<link rel="stylesheet">`: StaticGuard của
   engine không resolve CSS ngoài và sẽ báo lỗi font thiếu. Vẫn giữ
   `src:url('fonts/...woff2')` trỏ tới file font trong folder.

## Quy trình chuẩn

Lệnh viết cho PowerShell 5.1 (Windows) — không dùng `||`/`&&` bash.
Lệnh fail 2 lần → đổi cách + báo user, cấm lặp vô hạn.

**Vị trí chạy lệnh là bắt buộc:**

- `gen-captions.mjs` chạy từ GỐC TOOLBOX.
- Mọi lệnh `npx hyperframes ...` chạy từ TRONG `starter-hf\<slug>\`
  (folder chứa index.html). Chạy sai chỗ → CLI không thấy composition.

```powershell
# 0. từ GỐC TOOLBOX: sinh caption + audio markup (không tự gõ tay)
node starter-hf\scripts\gen-captions.mjs <slug>   # -> ghi file captions_snippet.html/.css

# 1. từ GỐC TOOLBOX: tạo project + copy voice + merge master + fonts + gsap
New-Item -ItemType Directory -Path "starter-hf\<slug>\voice" -Force
Copy-Item "jobs\<slug>\voice\*" "starter-hf\<slug>\voice\"
& tools\vieneu-tts\.venv\Scripts\python.exe tools\vieneu-tts\merge_voice.py <slug>
Copy-Item "starter-hf\fonts" "starter-hf\<slug>\fonts" -Recurse
Copy-Item "starter-hf\gsap.min.js" "starter-hf\<slug>\"

# 2. viết starter-hf\<slug>\index.html — NHỊP: viết 1-2 cảnh -> snapshot
#    NGAY các mốc của cảnh đó -> ĐỌC ảnh -> sửa liền -> mới viết cảnh kế.
#    (npx hyperframes snapshot --at <giay-trong-canh> --output qa)

# 3. cd VÀO project rồi mới kiểm tổng thể (từ đây mọi lệnh chạy tại starter-hf\<slug>)
cd starter-hf\<slug>
npx hyperframes check        # phải 0 error
npx hyperframes snapshot --at 3,12,25 --output qa   # quét toàn timeline, ĐỌC TỪNG PNG

# 4. render/check ẨN (không pop-up terminal con) — log ra file để poll
#    (chạy từ GỐC TOOLBOX)
powershell -File starter-hf\scripts\render-hidden.ps1 -Slug <slug> -Verb check
powershell -File starter-hf\scripts\render-hidden.ps1 -Slug <slug> -Verb render
#    log: starter-hf\<slug>\render.log — poll: Get-Content <log> -Tail 5 -Wait
```

Lỗi bắt ở bước snapshot cảnh tốn ~5 giây; lỗi để lọt đến render tốn
10-15 phút. Vì vậy soi NGAY khi viết, không dồn QA ra cuối.

Lần đầu chạy `npx hyperframes` nó tải engine về cache — có thể mất
vài phút, KHÔNG phải treo. Cấm chạy `npx hyperframes preview` trong
flow tự động (nó là server chặn, không tự thoát).

## Linter — error là gate, warning là tư vấn

`npx hyperframes check` chỉ FAIL khi có **error**. Các warning/info
sau đây là **TƯ VẤN** — tuyệt đối KHÔNG hy sinh motion, reveal, hay
luật bố cục để làm chúng im:

| Warning | Nghĩa thật | Ứng xử đúng |
| --- | --- | --- |
| `timeline_track_too_dense` | track có nhiều timed element | Bình thường với video 40+ beat. Giữ nguyên. |
| `composition_file_too_large` | index.html nhiều dòng | Bình thường với video dài. Giữ nguyên. |
| `content_overlap` trên `.cw` caption | sub-pixel chạm khi wrap | Đã có `data-layout-allow-overlap` sẵn từ gen-captions — bỏ qua. |
| `studio_missing_editable_id` | thiếu id cho Studio edit | Thẩm mỹ, không chặn render. |

Lần trước agent thấy 2 warning này và ĐÃ CẮT GSAP animation + gom 41
beat thành 6 scene tĩnh để "làm linter hài lòng" → video thành slide.
CẤM lặp lại: warning không phải lỗi; luật motion/reveal/bố cục trong
skill này THẮNG warning trong mọi trường hợp. Chỉ `error` mới phải
sửa. Nếu timeout khi load (audio nặng) → dùng `narration.m4a`, không
gom cảnh.

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

**Quy tắc engine (bắt buộc):** KHÔNG BAO GIỜ tween opacity trực tiếp
lên phần tử `.clip` — HyperFrames sở hữu vòng đời + visibility của clip
(tween trên clip = lỗi `gsap_exit_missing_hard_kill`). Cấu trúc đúng:

```html
<section id="b2" class="clip" data-start="..." data-duration="..." data-track-index="1">
  <div class="scene-inner" style="position:absolute; inset:0;">
    <!-- toàn bộ nội dung cảnh bọc trong đây -->
  </div>
</section>
```

```js
// fade-in + fade-out diễn ra trên .scene-inner, KHÔNG trên .clip
tl.fromTo("#b2 .scene-inner", { opacity: 0 }, { opacity: 1, duration: 0.28, ease: "none" }, START_B2);
tl.to("#b2 .scene-inner", { opacity: 0, duration: 0.28, ease: "none" }, START_B2 + DUR_B2 - 0.28);
// HARD KILL bắt buộc sau exit — chống trôi trạng thái khi seek không tuần tự
tl.set("#b2 .scene-inner", { opacity: 0 }, START_B2 + DUR_B2);
```

- Clip đầu vào: bỏ fade-in. Clip cuối: bỏ fade-out + hard kill.
- Nền các cảnh cùng màu → fade qua nền = crossfade tự nhiên.

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
- Tự kiểm diagram: chủ xuất hiện từ hook và còn mặt ở beat cuối; ≥ nửa
  số beat có diagram THAY ĐỔI TRẠNG THÁI (không chỉ entrance); ≥ 2 chỗ
  hình phản ứng đúng thời điểm một từ/cụm từ; không beat nào chỉ toàn
  chữ không có hình tương tác.
- **Chuẩn mức sống cần đạt** (ví dụ từ phân tích video thật): nói
  K-Means → chùm quét quét qua đám điểm, điểm đổi màu gom cụm dần;
  nói Gradient Descent → quả cầu LĂN thật trên đường cong theo frame,
  số Loss nhảy liên tục; nói mạng nơ-ron → xung ánh sáng chạy qua từng
  layer khi giọng đọc nhắc tầng; nói code lỗi → dòng if-else tự gõ
  (typewriter) rồi dấu cảnh báo nhấp nháy. Nếu hình của bạn im hơn
  các ví dụ này → chưa đạt.

## Choreography density — mỗi beat là một CHƯƠNG TRÌNH nhiều pha

Bằng chứng từ video thất bại: freezedetect đo được **55 khoang đóng
băng 4-7 giây liên tục** — mỗi beat hiện 1 layout rồi đứng im cả beat.
Đó là slide. Chuẩn cần đạt là kiểu choreography của scene được author
tốt: **nhiều PHA nối tiếp kể chuyện bằng chuyển động**:

```text
vd beat "giảm 27% chi phí": Pha 1 (t=0.5s) hai cột MỌC lên tới mốc
→ Pha 2 (t=1.2s) cột thứ hai CO DẦN 27% (spring riêng)
→ đồng thời số % ĐẾM NGƯỢC theo tiến trình co
→ Pha 3 (t=2s) glow pulse nhẹ giữ sự sống đến hết beat.
```

### Luật density (cứng)

1. **Timeline của mỗi beat phải có 3-6 "moments" RẢI ĐỀU across toàn
   beat** — không dồn tất cả vào 0.5s đầu rồi bất động. Moment = 1
   reveal, 1 phase chuyển, 1 nhấn sáng theo từ, 1 counter mốc.
2. **Tối thiểu 1 tween LIÊN TỤC kéo dài phần lớn beat**: đường vẽ dần,
   counter chạy, quả cầu lăn, chùm quét quét — semantic progression
   theo đúng nghĩa.
3. **Cấm bất kỳ khoảng ≥4 giây nào không có pixel nào thay đổi** trong
   vùng content. Gate tự động: `check-motion.ps1` (dưới đây) sẽ FAIL.
4. **SVG/Canvas-first cho hình khái niệm**: sơ đồ/quá trình/so sánh
   vẽ bằng SVG động (quét, vẽ nét, gom cụm), KHÔNG phải card HTML
   chữ tĩnh. Card chỉ dùng cho trích dẫn/nhãn.

### Gate tự động bắt buộc (chạy sau render, trước bàn giao)

```powershell
powershell -File starter-hf\scripts\check-motion.ps1 `
  -VideoPath jobs\<slug>\output\video.mp4
# FAIL nếu có freeze >= 4s trong vùng content (đã crop bỏ caption band).
# FAIL -> quay lại timeline của beat bị freeze (t ghi trong báo cáo),
# thêm pha/living motion cho beat đó -> re-render -> chạy lại gate.
```

## Bố cục cô đọng (chuẩn đối thủ — chống "khung bự tổ")

Đối thủ chuẩn (ainius): **1 thông điệp/màn hình, ≥50% khoảng trống,
không panel bao**. Video của ta từng chết vì: panel viền bọc toàn màn
+ 5-7 nhóm element + footer chrome + stamp lặp — người xem thấy bí
bách và "slide".

### Luật cứng

1. **CẤM panel/khung bao toàn màn hình.** Content thả trực tiếp trên
   nền. Card/panel nhỏ chỉ dùng khi nó CÓ NGHĨA (ví dụ note dán, thẻ
   so sánh) và tối đa 1-2 cái/beat.
2. **Tối đa 2 nhóm element/beat** (vd: 1 headline + 1 số liệu; hoặc
   1 diagram + 1 nhãn). Mọi thứ khác = cắt.
3. **≥50% diện tích là khoảng trống.** Đặc = sai.
4. **CẤM footer chrome** (watermark, tên video, "210S MASTER"...) —
   vô nghĩa với người xem.
5. **Stamp tối đa 1-2 lần/cả video.** Dùng nhiều = mất tác dụng.
6. Eyebrow chỉ dùng khi thực sự cần định vị — không phải beat nào
   cũng cần.

### Menu 6 hình thức bố cục — mỗi beat chọn 1, TẬN DỤNG THAY ĐỔI

| Form | Khi nào dùng | Trông như |
| --- | --- | --- |
| **Số biến đổi** | có con số trước/sau | số cũ gạch ngang nhỏ → số mới KHỔNG LỒ accent, giữa màn |
| **Bằng chứng thật** | có nguồn tài liệu | screenshot tài liệu thật full-screen (nghiêng nhẹ) + tô vàng câu chốt + caption bar đen |
| **Khung tuyên bố** | tuyên bố lớn/số liệu gây sốc | banner màu + headline condensed 3 dòng, kiểu breaking news |
| **Step list tiến hóa** | quy trình/những bước | các bước mọc dần theo lời, bước xong có ✓, nối đường chấm |
| **Trích dẫn** | quote/định nghĩa từ nguồn | câu quote lớn + tên nguồn nhỏ dưới |
| **Takeaway list** | kết bài | các điểm đánh số mọc dần theo lời, mỗi điểm 1 dòng |

Cùng hero diagram tiến hóa (mục trên) với form bố cục thay đổi theo
beat = hết cảm giác slide.

## Reveal schedule + living motion (chống "hiện hết ngay từ đầu")

Bệnh kinh điển: mở đầu beat là TẤT CẢ element đã nằm sẵn trên màn,
người dẫn đọc trong khi hình đứng im — video thành slide có thuyết
minh. Quy tắc ngược lại:

### 1. Reveal schedule — element chỉ hiện KHI lời đọc nhắc đến

- **Trạng thái mặc định của mọi element là ẨN** (opacity 0 / scale 0).
  Chỉ hiện ra tại thời điểm word-timing của từ/cụm từ mô tả nó (lấy từ
  `words[]` trong voice meta hoặc CAPTION_WORDS).
- Ví dụ: VO nói "con mèo" tại giây 4.2 → con mèo xuất hiện tại 4.2s,
  kèm động tác riêng (đi, vẫy đuôi). Nói "con chó" tại 8.0s → chó mới
  xuất hiện. Trước đó màn hình chỉ có những gì ĐÃ được nhắc.
- Mở đầu beat: chỉ có nền + tiêu đề (hoặc gần như trống). Hook beat
  được phép composed sẵn — các beat sau KHÔNG.
- Cách viết: mỗi element một dòng reveal —
  `tl.fromTo(el, {autoAlpha:0, y:24}, {autoAlpha:1, y:0, duration:0.35}, t_cua_tu);`

### 2. Motion verb — mỗi element một động từ trước khi code

Viết beat sheet xong, liệt kê từng element kèm ĐỘNG TỪ chuyển động
(SLAMS, DRAWS, GROWS, COUNTS UP, TYPES ON, FLOATS, ORBITS...). Không
đặt được động từ = element chưa được thiết kế — bỏ hoặc nghĩ tiếp.
Ví dụ: "số 1000 SLAMS vào → code block TYPES ON dòng từng dòng →
con trỏ nhấp nháy FLOATS".

## Ngữ pháp motion + biến tấu chữ (bắt buộc, chống "slide chán")

- Entrance nhanh 0.25-0.45s rồi hold. Semantic progression chỉ khi nội
  dung thật sự thay đổi theo thời gian.
- **Living motion — element đã hiện phải SỐNG, không đứng im**: thở
  (scale 1↔1.02), trôi nhẹ (y ±4), xoay chậm, lặp chu kỳ xác định
  (period/phase). Ít nhất MỘT element/beat chuyển động liên tục.
  Nhân vật/diagram có "hành động" phục vụ lời giải thích (mèo đi,
  nhánh mọc dần, đồ thị vẽ tiếp) — không lắc lư vô nghĩa. Nền có thể
  có lớp sống riêng (gradient trôi, hạt lơ lửng), rất nhẹ.
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

## Composition viết mới từ trang trắng

Mỗi job = một `index.html` viết mới hoàn toàn. **CẤM copy index.html
(hoặc đoạn scene/timeline) từ job khác** — kể cả cùng chủ đề, cùng
style pack. Được phép mở job cũ chỉ để THAM KHẢO kỹ thuật (cách làm
hiệu ứng), không phải để chép nội dung/timeline. Thuật ngữ của toolbox:
pure AUTHOR — mỗi video là tác phẩm biên soạn mới.

## QA bắt buộc (một checklist duy nhất — không bỏ qua)

`npx hyperframes check` phải 0 error. Snapshot tại: 0.5s, mốc vào từng
cảnh, giữa các cảnh, 1s cuối — **ĐỌC TỪNG PNG**, chấm đủ 3 nhóm:

**Hiển thị:**
- [ ] Frame đầu composed sẵn (thumbnail-grade), không fade từ đen
- [ ] Caption không đè chữ, không dán lên đỉnh, không chồng dòng
- [ ] Không nội dung lọt safe-area (dưới 340px, phải 160px)
- [ ] Chuyển cảnh mượt (không cắt cứng, không nháy nền)
- [ ] Hero object đủ chi tiết; hiệu ứng đúng beat/từ

**Kể chuyện bằng hình:**
- [ ] Diagram chủ xuất hiện từ hook và còn mặt ở beat cuối
- [ ] ≥ nửa số beat có diagram THAY ĐỔI TRẠNG THÁI (không chỉ entrance)
- [ ] ≥ 2 chỗ hình phản ứng đúng thời điểm một từ/cụm từ nói
- [ ] Không beat nào chỉ toàn chữ không có hình tương tác

**Sáu bài test:**
- [ ] Mute test — tắt tiếng vẫn hiểu câu chuyện
- [ ] Slideshow test — không beat nào chỉ là hình tĩnh + chữ
- [ ] Reveal test — không element nào hiện TRƯỚC khi được nhắc đến
- [ ] Dead-zone test — không khoảng ≥3 giây im bấc
- [ ] Squint test — nheo mắt vẫn thấy phân cấp chính/phụ
- [ ] Safe-area test — (trùng mục hiển thị, xác nhận lần cuối)

Engine có công cụ audit: `hyperframes-animation` sinh
`animation-map.json` (phát hiện dead zone, stagger) — dùng khi nghi ngờ.
Sửa → snapshot lại frame lỗi → sạch hết mới render.

## Done =

- `npx hyperframes check` 0 error; QA snapshot đã đọc, checklist đạt.
- `output/video.mp4` render thành công, có cả audio, đúng duration.
