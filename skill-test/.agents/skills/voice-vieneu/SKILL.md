---
name: voice-vieneu
description: Sinh giọng đọc tiếng Việt local bằng VieNeu-TTS (CPU, miễn phí, offline) - text thành WAV 48kHz kèm duration và word timings từng từ. Use when generating Vietnamese narration/voiceover for videos, during Stage 3 of make-video, or when the user asks for "giọng đọc", "voice", "TTS", "sinh giọng".
---

# Voice VieNeu — giọng Việt local

Sinh lời đọc bằng VieNeu-TTS v3 Turbo chạy local (ONNX int8, CPU, 48kHz).
Miễn phí, không API key. Tool: `tools/vieneu-tts/gen_voice.py`.

## Setup kiểm tra (một lần)

Lệnh mẫu viết cho PowerShell 5.1 (Windows). Trên bash/Git-Bash: đổi
`\` thành `/`, dùng `export` thay `$env:`. Nếu một lệnh
fail 2 lần → đổi cách, không lặp lại y nguyên.

Venv tại `tools/vieneu-tts/.venv`. Nếu chưa có:

```powershell
cd <toolbox-root>\tools\vieneu-tts
uv venv --python 3.12 .venv
uv pip install --python .venv vieneu numpy
```

Lần chạy đầu tải model về cache HF (một lần duy nhất). Sau đó chạy được
offline với `$env:HF_HUB_OFFLINE="1"`.

## Lệnh chuẩn — BATCH (dùng cho Stage 3, KHÔNG chạy từng beat)

`gen_beats_batch.py` đọc `beats.json`, load model ONNX **một lần duy
nhất**, sinh beat thiếu (cache theo textHash — beat đã có và chưa đổi
sẽ CACHED), rồi **tự cập nhật** `start`/`duration`/`totalSeconds` vào
`beats.json`:

```powershell
$env:PYTHONIOENCODING="utf-8"
<toolbox-root>\tools\vieneu-tts\.venv\Scripts\python.exe `
  <toolbox-root>\tools\vieneu-tts\gen_beats_batch.py <slug>
```

Cấm gọi gen_voice.py lặp 36 lần — mỗi lần gọi lại load model mất
3-5 phút tổng. gen_voice.py chỉ dùng để test nhanh một câu đơn.

Sau batch: `beats.json` đã có duration thật + totalSeconds. Kết thúc
bằng lệnh gộp master audio (bắt buộc cho HyperFrames — xem
scene-authoring):

```powershell
<toolbox-root>\tools\vieneu-tts\.venv\Scripts\python.exe `
  <toolbox-root>\tools\vieneu-tts\merge_voice.py <slug>
```

→ tạo `voice/narration.wav` (một file duy nhất, các beat đã đặt đúng
mốc theo `start`).

Kết quả: `b1.wav` + `b1.json`:

```json
{
  "durationSeconds": 1.2,
  "sampleRate": 48000,
  "textHash": "342d912384184c29",
  "timingMethod": "char-proportion",
  "words": [
    { "word": "Đây", "start": 0.0, "end": 0.26, "startFrame": 0, "endFrame": 8 }
  ]
}
```

## Quy tắc sử dụng trong pipeline

1. **Mỗi beat một WAV**, đặt tên theo beat id (`b1.wav`, `b2.wav`...).
2. **Cache tự động trong tool**: nếu `voice/<id>.json` đã tồn tại và
   `textHash` khớp text hiện tại → tool in `CACHED` và bỏ qua (không
   tốn thời gian sinh lại). Muốn ép sinh lại dùng `--force`. TTS là
   generative — chạy lại sẽ ra giọng hơi khác, nên SỬA MỘT CÂU CHỈ
   SINH LẠI CÂU ĐÓ (tool tự lo: câu chưa đổi sẽ CACHED).
   **Phạm vi cache = NỘI BỘ một job.** CẤM copy wav/json từ job khác
   sang — job mới thì voice phải sinh mới trong job mới.
3. **Đọc `durationSeconds` từ meta, không bao giờ ước lượng** thời lượng
   beat khi đã có WAV. Chỉ ước lượng ở giai đoạn viết kịch bản, TRƯỚC
   khi có giọng: **tiếng Việt ~4.0-4.3 từ/giây** (đo thực tế giọng Adam;
   số 2.7 wps quen thuộc là của tiếng Anh).
4. Word timings là ước lượng tỉ lệ ký tự — đủ cho caption highlight.
   Đừng quảng cáo độ chính xác từng-ms.

## Chọn giọng

20 preset, 3 vùng miền. Tham chiếu nhanh (đầy đủ trong
`tools/vieneu-tts/README.md`):

| Nhu cầu | Gợi ý |
| --- | --- |
| Nam Bắc chuẩn tin tức | Minh Đức |
| Nữ Bắc tự nhiên | Trúc Ly |
| Nam Nam kể chuyện | Thái Sơn |
| Nữ Nam tin tức | Thùy Dung |
| Mặc định trung tính | Adam |

Mặc định khi user không chọn: **Adam**. Ghi giọng đã chọn vào
`beats.json` (`voice`) để các lần chạy sau nhất quán.

Tag cảm xúc chèn thẳng trong text: `[cười]` `[thở dài]` `[hắng giọng]`
(dùng tiết chế, chỉ khi đúng cảm xúc beat).

## Văn bản lời đọc (tts_text)

- Viết số bằng CHỮ: "2026" → "hai không hai sáu" nếu TTS đọc sai
  (nghe thử trước khi quyết; TTS đọc số năm thường ổn).
- Tên riêng tiếng Anh giữ nguyên — VieNeu code-switch được En-Vi.
- Không viết tắt phi âm thanh: "VN" → "Việt Nam", "AI" → "AI" (đọc
  "ây-ai" ổn) nhưng "vd" → "ví dụ".
- Tag cảm xúc KHÔNG tính là từ trong đếm timing (tool tự bỏ).

## Done =

- Mỗi beat có `voice/<id>.wav` + `voice/<id>.json` hợp lệ (duration > 0,
  words không rỗng).
- `beats.json` đã ghi `duration` từng beat = `durationSeconds` từ meta.
- Không beat nào còn dùng duration ước lượng khi WAV đã tồn tại.
