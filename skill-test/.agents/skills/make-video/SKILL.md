---
name: make-video
description: Tạo video dọc 9:16 TikTok/Reels/Shorts hoàn chỉnh từ một chủ đề - research có nguồn, kịch bản tiếng Việt, giọng đọc local, code HyperFrames (HTML+GSAP) đồng bộ theo từ, QA snapshot, render MP4. Use when the user wants to create/make a vertical short video from a topic, e.g. "làm video về X", "tạo short về X trong 90s", "make a video about X". Đây là skill chính điều phối các skill scene-authoring, voice-vieneu, research-grounding.
---

# Make Video — xưởng video 9:16 end-to-end

> **Đây là workflow DUY NHẤT để tạo video trong toolbox.** Các skill
> workflow mẫu của HyperFrames (faceless-explainer, general-video...)
> KHÔNG dùng làm quy trình — chỉ `hyperframes-core/-animation/-cli/...`
> là tài liệu kỹ thuật của engine.

Từ chủ đề → MP4 dọc hoàn chỉnh có giọng Việt. Mọi đường dẫn tương đối
tính từ GOC TOOLBOX (folder chứa `.agents/`, `starter-hf/`, `tools/`,
`jobs/`, `styles/`).

## Shell Windows — luật sinh tồn (bắt buộc đọc trước khi chạy lệnh)

Máy chạy **PowerShell 5.1**. Cấm dùng cú pháp bash:

- KHÔNG có `||`, `&&`, `tr`, `head`, `tail`, `2>&1 |`. Lệnh kiểu
  `ls a || echo x && tr` sẽ ParserError ngay.
- Chuỗi lệnh: dùng `;` (tuần tự) hoặc tách từng dòng. Điều kiện:
  `if ($?) { ... }`. Liệt kê: `Get-ChildItem` (hoặc `ls` đơn lẻ).
- **Giao thức thất bại**: một lệnh fail 2 lần liên tiếp → DỪNG, báo
  cho user 1 câu lỗi là gì + đề xuất hướng khác. CẤM lặp lại cùng một
  lệnh đã fail, CẤM im lặng bỏ cuộc — luôn nói đang ở Stage nào.
- **Cấm inline one-liner phức tạp** (`node -e "..."`,
  `powershell -Command "..."` nhiều tầng nháy) — PowerShell 5.1 nuốt
  dấu nháy. Cần logic gì → viết file `.mjs`/`.py` ngắn rồi
  `node file.mjs`.

## Artifact contract — cây file của một job

```text
jobs/<slug>/
  brief.md          yêu cầu đầu vào (chủ đề, thời lượng, giọng, style)
  research/
    findings.md     kết quả research + claim ledger (research-grounding)
  script.md         kịch bản người đọc + bảng beat
  beats.json        hợp đồng máy: timeline toàn cục tính GIÂY
  voice/
    b1.wav, b1.json ...  audio + word timings từng beat (voice-vieneu)
  output/
    video.mp4          thành phẩm có giọng (render thẳng bởi HyperFrames)
    meta.json          thông tin để thư viện/UI đọc
```

`beats.json` schema:

```json
{
  "slug": "ten-job",
  "topic": "...",
  "targetSeconds": 45,
  "fps": 30,
  "voice": "Adam",
  "stylePack": "default",
  "totalSeconds": 45.2,
  "beats": [
    {
      "id": "b1",
      "role": "hook",
      "vo": "lời đọc...",
      "wav": "voice/b1.wav",
      "start": 0.0,
      "duration": 3.4
    }
  ]
}
```

`totalSeconds` = beat cuối `start + duration` + đuôi hold (~1.5-2s).

`start`/`duration` tính GIÂY, lấy từ `durationSeconds` trong meta WAV.
Đổi ra frame: `Math.round(giay * 30)`.

## Stage 0 — Brief

Hỏi user (hoặc nhận từ lệnh) nếu thiếu: **chủ đề**, **thời lượng**
(mặc định 45s; chấp nhận MỌI thời lượng 30-600s — công thức số từ tự
thích ứng, không giới hạn mức), **giọng** (mặc định Adam), **style
pack** (mặc định `default` — đọc `styles/<tên>/STYLE.md` ngay từ đầu
và áp dụng xuyên suốt). Thời lượng tính bằng GIÂY, dùng đúng con số
user yêu cầu — KHÔNG làm tròn xuống mức chuẩn nào cả.

Tạo `jobs/<slug>/brief.md`. Slug: chữ thường, gạch ngang, ngắn.

## Luật chạy liên tục

Đã có đủ input ở Stage 0 → chạy LIÊN TIẾP Stage 1→6 không dừng hỏi
user giữa chừng (kể cả "cho tôi duyệt beat sheet"). Chỉ dừng khi: thiếu
input bắt buộc, hoặc gặp lỗi theo giao thức thất bại (fail 2 lần).
Báo cáo tiến độ từng Stage trong lúc chạy — nhưng không chờ duyệt.

## Stage 1 — Research

Dùng skill **research-grounding**. Đầu ra: `research/findings.md` với
claim ledger có độ tin cậy. Không có research thì không có Stage 2.

**VERIFY trước khi sang Stage 2** — mở findings.md và kiểm: (a) mọi
claim định lượng đều có URL ngay trên dòng hoặc trong bảng ledger;
(b) không claim nào gán "high" mà không có nguồn; (c) đủ 4 mục chuẩn.
Thiếu → quay lại research bổ sung (theo giao thức thất bại nếu nguồn
không tìm được), KHÔNG sang Stage 2 với findings rỗng nguồn.

## Stage 2 — Kịch bản

Viết `script.md` + `beats.json`. Ngữ pháp beat cho video ngắn:

```text
HOOK (0-3.5s) → BỐI CẢNH/CỬA THẠCH → TWIST/INSIGHT → TAKEAWAY
```

- **Hook**: vào thẳng câu gây tension nhất có dữ liệu hỗ trợ. Cấm chào
  hỏi, cấm "hôm nay chúng ta sẽ", cấm định nghĩa suông. Frame 0 phải
  có sẵn hình (đã composed).
- **Kết**: CTA riêng theo chủ đề (câu hỏi quyết định, gợi ý hành động
  cụ thể). Cấm "like subscribe" chung chung.
- **Nhịp tiếng Việt (đo thực tế VieNeu): ~4.0-4.3 từ/giây.** Công thức
  quy đổi BẮT BUỘC (dùng cái này, không tra bảng rồi đọc nhầm row):

  ```text
  tổng số từ lời đọc ≈ thời lượng mục tiêu (giây) × 3.7   (chấp nhận ±10%)
  vd: 45s → ~167 từ | 90s → ~333 | 150s → ~555 | 210s → ~777
  ```

  Khi viết xong beat sheet, PHẢI in rõ phép tính cho user thấy:
  "tổng <N> từ × (1/3.7) ≈ <M> giây speech + nghỉ ≈ <K> giây — khớp
  mục tiêu <tier>s". Nếu M lệch ngoài ±10% mục tiêu → viết thêm/bớt
  beat NGAY LÚC ĐÓ. CẤM tuyên bố "đúng tier" mà không kèm phép tính;
  CẤM phép tính bịa kiểu "47.7s + 12s nghỉ ≈ 240s".
  Sau khi có WAV thật thì duration = số đo thật, không dùng ước lượng.
- **TỰ KIỂM BẮT BUỘC trước khi sang Stage 3** (4 điểm, thiếu điểm nào
  sửa ngay tại chỗ):
  1. **Số từ**: đếm tổng số từ của cột VO. PHẢI khớp công thức
     `thời lượng user yêu cầu (giây) × 3.7 ±10%` — dùng ĐÚNG con số
     user yêu cầu (300s = ~1110 từ), không làm tròn xuống mức chuẩn.
     In rõ phép tính: "tổng <N> từ ≈ <M> giây speech + nghỉ ≈ <K> giây
     — khớp mục tiêu <T>s". CẤM tuyên bố "đúng" không kèm phép tính;
     CẤM phép tính bịa kiểu "47.7s + 12s nghỉ ≈ 240s". Thiếu từ →
     viết thêm beat NGAY LÚC ĐÓ.
  2. **Hook**: câu đầu tiên KHÔNG là định nghĩa ("X là..."), KHÔNG
     chào hỏi, KHÔNG câu hỏi chung chung — phải vào thẳng tension.
  3. **Nguồn**: mọi số liệu trong VO truy được về claim ledger có URL;
     claim low chỉ nói kèm từ giảm nhẹ, không làm hook.
  4. **Under-budget**: tổng duration beat (sau voice) dưới 80% mục
     tiêu → quay lại Stage 2 viết thêm beat + re-voice, đừng giao
     video cụt.
- Chia beat: mỗi beat 1 ý, vo ≤ 25 từ cho dễ sync, role ghi rõ
  (hook/context/twist/takeaway).
- **Cột "Bố cục" bắt buộc**: mỗi beat chọn 1 hình thức từ menu 6 form
  trong scene-authoring (số biến đổi / bằng chứng thật / khung tuyên
  bố / step list / trích dẫn / takeaway). HAI beat kế tiếp không được
  dùng cùng một form — đây là thứ diệt cảm giác slide.
- **Cột "Hình diễn biến" = động từ + mốc reveal**: mỗi beat ghi rõ
  element nào xuất hiện Ở TỪ NÀO (theo word timing dự kiến) và ĐỘNG
  TỪ của nó (SLAMS / DRAWS / TYPES ON / FLOATS...). Element không có
  động từ = chưa được thiết kế. Sau khi render, chạy 6 bài test trong
  scene-authoring (mute/slideshow/reveal/dead-zone/squint/safe-area).
- **Cột "Hình diễn biến" bắt buộc** trong beat sheet: mỗi beat phải ghi
  rõ HÌNH THAY ĐỔI GÌ (trạng thái mới của diagram, element nào xuất
  hiện/tô đậm/vẽ thêm). Beat sheet chỉ có VO không có hình = kịch bản
  chưa xong — đó là công thức "slide thuyết trình", cấm.

## Stage 3 — Voice

Dùng skill **voice-vieneu**: chạy `gen_beats_batch.py <slug>` (load
model MỘT lần, cache theo textHash, tự cập nhật `start`/`duration`/
`totalSeconds` vào beats.json). KHÔNG gọi gen_voice.py từng beat.
Muốn nghỉ giữa beat khác 0.45s → đặt `gapSeconds`/`tailSeconds` trong
beats.json TRƯỚC khi chạy batch. Kết thúc bằng `merge_voice.py <slug>`
→ `voice/narration.wav`.

## Sửa kịch bản sau Stage 3 (beats.json tự heal)

Sau khi đã có voice, KHÔNG viết lại beats.json từ đầu. Chỉ sửa trường
`vo` của beat cần đổi (giữ nguyên start/duration), rồi chạy lại
`gen_beats_batch.py <slug>`: beat chưa đổi → CACHED (0 giây), beat đổi
chữ → tự sinh lại + tự tính lại toàn bộ start/totalSeconds. Ghi đè
toàn bộ file làm mất duration thật — cấm.

## Stage 4 — Composition (vừa viết vừa soi, KHÔNG dồn QA ra cuối)

Tạo `starter-hf/<slug>/`, copy `voice/` từ `jobs/<slug>/voice/` sang,
copy font từ `starter-hf/fonts/`. Sau đó dùng skill **scene-authoring**
(HyperFrames): sinh caption bằng
`starter-hf\scripts\gen-captions.mjs <slug>`, viết `index.html` theo
style pack.

**Nhịp làm việc bắt buộc**: viết xong MỖI 1-2 cảnh → snapshot NGAY
các mốc của cảnh vừa viết (`npx hyperframes snapshot --at <giây>`) →
ĐỌC ảnh → thấy xấu/lỗi sửa LIỀN → mới viết cảnh tiếp. Đây là gate
chính — lỗi bắt ở đây tốn ~5 giây snapshot, không phải 10-15 phút
re-render. Cuối Stage: `npx hyperframes check` 0 error.

Tại stage viết CODE này, skill/code-style khác của user ĐƯỢC phép ảnh
hưởng (ponytail, frontend-design...). Các stage check/render thì KHÓA
— chỉ làm đúng lệnh ghi trong skill.

## Stage 5 — QA tổng thể

Quét snapshot TOÀN bộ timeline một lượt (đầu mỗi beat + giữa + cuối):
chuyển cảnh fade mượt, caption không chồng/dán sai vị trí, reveal đúng
lời, tổng duration khớp `beats.json` (±2 frame quy đổi). Sạch mới
được render.

## Stage 6 — Render + bàn giao

Từ trong `starter-hf\<slug>\` (xem scene-authoring Quy trình chuẩn):
`npx hyperframes render --output "..\..\jobs\<slug>\output\video.mp4"`
(video dài 4-5 phút mất 10-15 phút — BÁO TRƯỚC cho user là chạy nền
lâu). Vì Stage 4-5 đã duyệt từng cảnh bằng snapshot, render chỉ là
hình thức hóa — KHÔNG làm vòng review-sửa-re-render sau bước này.
Kiểm kỹ thuật: ffprobe có stream video + audio, duration khớp ±0.3s.

Viết `output/meta.json`:

```json
{
  "slug": "...",
  "title": "...",
  "topic": "...",
  "durationSeconds": 45.2,
  "fps": 30,
  "resolution": "1080x1920",
  "voice": "Adam",
  "stylePack": "default",
  "beats": 6,
  "createdAt": "2026-08-25"
}
```

Bàn giao: báo user video xong + tự đánh giá trung thực (điểm tốt /
điểm còn hạn chế). User xem muốn chỉnh gì → quay lại Stage 4.

## Done =

- brief.md, research/findings.md, script.md, beats.json đầy đủ và KHỚP
  nhau (mọi số liệu script truy được ledger).
- Mỗi beat có wav + json; beats.json duration = số đo thật.
- QA snapshot đã đọc, checklist đạt; `hyperframes check` 0 error.
- output/video.mp4 có cả video + audio (render thẳng bởi HyperFrames),
  duration khớp ±0.3s.
- output/meta.json ghi đủ trường.

## Ranh giới skill

- Stage 1/3/4: làm theo skill chuyên môn tương ứng, không tự chế bước.
  Stage 5 (QA tổng thể) + Stage 6 (render/verify) làm đúng make-video.
- Stage viết code (4): mở cho skill style/code khác của user.
- Không bao giờ: bịa số liệu, bỏ QA, render full khi snapshot còn lỗi,
  sửa WAV tay, tự ý đổi provider giọng.
