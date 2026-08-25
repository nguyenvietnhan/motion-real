---
name: make-video
description: Tạo video dọc 9:16 TikTok/Reels/Shorts hoàn chỉnh từ một chủ đề - research có nguồn, kịch bản tiếng Việt, giọng đọc local, code HyperFrames (HTML+GSAP) đồng bộ theo từ, QA snapshot, render MP4. Use when the user wants to create/make a vertical short video from a topic, e.g. "làm video về X", "tạo short về X trong 90s", "make a video about X". Đây là skill chính điều phối các skill scene-authoring, voice-vieneu, research-grounding.
---

# Make Video — xưởng video 9:16 end-to-end

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

`start`/`duration` tính GIÂY, lấy từ `durationSeconds` trong meta WAV.
Đổi ra frame: `Math.round(giay * 30)`.

## Stage 0 — Brief

Hỏi user (hoặc nhận từ lệnh) nếu thiếu: **chủ đề**, **thời lượng**
(mặc định 45s; các mức 45/90/150/210 — thời lượng lẻ thì chọn mức gần
nhất và nói rõ), **giọng** (mặc định Adam), **style pack** (mặc định
`default` — đọc `styles/<tên>/STYLE.md` ngay từ đầu và áp dụng xuyên
suốt). Tier tính bằng GIÂY — không bịa "tier 4" hay đánh số tự chế.

Tạo `jobs/<slug>/brief.md`. Slug: chữ thường, gạch ngang, ngắn.

## Luật chạy liên tục

Đã có đủ input ở Stage 0 → chạy LIÊN TIẾP Stage 1→6 không dừng hỏi
user giữa chừng (kể cả "cho tôi duyệt beat sheet"). Chỉ dừng khi: thiếu
input bắt buộc, hoặc gặp lỗi theo giao thức thất bại (fail 2 lần).
Báo cáo tiến độ từng Stage trong lúc chạy — nhưng không chờ duyệt.

## Stage 1 — Research

Dùng skill **research-grounding**. Đầu ra: `research/findings.md` với
claim ledger có độ tin cậy. Không có research thì không có Stage 2.

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
- **TỰ KIỂM BẮT BUỘC trước khi sang Stage 3**: đếm tổng số từ của cột
  VO trong beat sheet. Con số PHẢI nằm trong khoảng của tier tương ứng
  thời lượng user yêu cầu. Nếu user yêu cầu thời lượng lẻ (vd "cỡ 4
  phút") → chọn tier gần nhất (210s), NÓI RÕ cho user, và vẫn đủ số từ
  tier đó. CẤM ghi tổng ước lượng sai lệch kiểu "47.7s + 12s nghỉ ≈
  240s" — phép tính đó là nói dối. Thiếu từ → viết thêm beat NGAY tại
  Stage 2, không hẹn "để sau".
- **Cảnh báo under-budget**: nếu tổng duration beat (sau voice) dưới
  80% tier mục tiêu → quay lại Stage 2 viết thêm beat và re-voice beat
  mới, đừng giao video cụt.
- Mọi số liệu trong lời đọc PHẢI truy được về claim ledger; claim low
  chỉ được nói kèm từ giảm nhẹ và không làm hook.
- Chia beat: mỗi beat 1 ý, vo ≤ 25 từ cho dễ sync, role ghi rõ
  (hook/context/twist/takeaway).

## Stage 3 — Voice

Dùng skill **voice-vieneu** cho TỪNG beat theo thứ tự. Cập nhật
`beats.json` với duration đo được; tính `start` cộng dồn (+ nghỉ 0.25-0.4s
giữa các beat, nghỉ dài 0.6-0.8s trước twist/takeaway nếu nhịp cần).
Voice nằm ở `jobs/<slug>/voice/`.

## Stage 4 — Composition

Tạo `starter-hf/<slug>/`, copy `voice/` từ `jobs/<slug>/voice/` sang,
copy font từ `starter-hf/fonts/`. Sau đó dùng skill **scene-authoring**
(HyperFrames): sinh caption bằng
`starter-hf\scripts\gen-captions.mjs <slug>`, viết `index.html` theo
style pack, `npx hyperframes check` 0 error, QA snapshot bằng mắt, rồi
mới render `output\video.mp4` (audio đã ghép sẵn bởi framework — không
cần mux ffmpeg).

Tại stage viết CODE này, skill/code-style khác của user ĐƯỢC phép ảnh
hưởng (ponytail, frontend-design...). Các stage check/render thì KHÓA
— chỉ làm đúng lệnh ghi trong skill.

## Stage 5 — QA tổng thể

Xem lại chuỗi snapshot theo beat: chuyển cảnh fade mượt, caption không
chồng/dán sai vị trí, tổng duration khớp `beats.json` (±2 frame quy đổi).

## Stage 6 — Thành phẩm

Từ trong `starter-hf\<slug>\` (xem scene-authoring Quy trình chuẩn):
`npx hyperframes render --output "..\..\jobs\<slug>\output\video.mp4"`
(chậm ~4-8× thời lượng video — chỉ render khi QA đã sạch). Kiểm thành
phẩm: ffprobe có stream video + audio, duration khớp ±0.3s.

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

## Done =

- brief.md, research/findings.md, script.md, beats.json đầy đủ và KHỚP
  nhau (mọi số liệu script truy được ledger).
- Mỗi beat có wav + json; beats.json duration = số đo thật.
- QA snapshot đã đọc, checklist đạt; `hyperframes check` 0 error.
- output/video.mp4 có cả video + audio (render thẳng bởi HyperFrames),
  duration khớp ±0.3s.
- output/meta.json ghi đủ trường.

## Ranh giới skill

- Stage 1-3-4-6: làm theo skill chuyên môn tương ứng, không tự chế bước.
- Stage viết code (4): mở cho skill style/code khác của user.
- Không bao giờ: bịa số liệu, bỏ QA, render full khi frame tĩnh còn lỗi,
  sửa WAV tay, tự ý đổi provider giọng.
