# tools/vieneu-tts — Giọng đọc tiếng Việt local

Wrapper quanh SDK [VieNeu-TTS v3 Turbo](https://github.com/pnnbao97/VieNeu-TTS)
(Apache 2.0): text → WAV 48kHz + meta JSON có duration và word timings.
Chạy hoàn toàn local trên CPU (ONNX int8), không cần GPU, không cần API key.

## Setup một lần (cần mạng)

```powershell
uv venv --python 3.12 .venv
uv pip install --python .venv vieneu
```

Lần chạy đầu tiên sẽ tải model về cache Hugging Face. Từ lần sau có thể
chạy offline (`$env:HF_HUB_OFFLINE="1"` để tắt kiểm tra hub).

## Ba tool — vai trò

| Tool | Khi nào dùng |
| --- | --- |
| **gen_beats_batch.py** `<slug>` | **Chính thức cho pipeline** (Stage 3): đọc beats.json, load model 1 lần, cache textHash, tự cập nhật start/duration/totalSeconds |
| **merge_voice.py** `<slug>` | Sau batch: gộp tất cả WAV thành `voice/narration.wav` (1 thẻ audio cho HyperFrames) |
| gen_voice.py | Test nhanh MỘT câu đơn (có cache textHash + `--force`) — không dùng cho pipeline |

## Sử dụng (pipeline chuẩn)

```powershell
$env:PYTHONIOENCODING="utf-8"
.venv\Scripts\python.exe gen_beats_batch.py <slug>
.venv\Scripts\python.exe merge_voice.py <slug>
```

```powershell
$env:PYTHONIOENCODING="utf-8"
.venv\Scripts\python.exe gen_voice.py --text "Đây là con mèo." `
  --voice "Adam" --out <job>\voice\scene-01.wav --fps 30
```

Kết quả: `scene-01.wav` + `scene-01.json`:

```json
{
  "durationSeconds": 1.2,
  "sampleRate": 48000,
  "textHash": "342d912384184c29",
  "words": [
    { "word": "Đây", "start": 0.0, "end": 0.26, "startFrame": 0, "endFrame": 8 }
  ]
}
```

`textHash` là khóa cache: cùng text + voice → tái dùng WAV cũ, không sinh lại.

## Giọng preset (20)

| Vùng | Giọng |
| --- | --- |
| Bắc | Minh Đức (tin tức), Phạm Tuyên (tự nhiên), Thanh Bình (kể chuyện), Trúc Ly, Ngọc Linh (kể chuyện), Đoan Trang, Mai Anh (tin tức), Quỳnh Anh (đọc truyện), Ngọc Huyền |
| Trung | Quang Sơn, Ngọc Trân (tự nhiên) |
| Nam | Adam (tự nhiên, mặc định), Thái Sơn (kể chuyện), Xuân Vĩnh, Minh Triết (tin tức), Thùy Dung (tin tức), Thục Đoan (kể chuyện), Mỹ Duyên (đọc truyện), Đức Trí, Kim Thanh |

Tag cảm xúc thí nghiệm chèn thẳng vào text: `[cười]` `[thở dài]` `[hắng giọng]`.

## Hiệu năng đo thực tế (CPU máy dev, 08/2026)

- Câu 6.56s audio sinh trong ~8.7s → RTF ≈ 1.3 (chưa tính load model).
- Câu ngắn ~1.2s sinh trong ~1.4s sau khi model đã nóng.
- Video 45s ≈ tốn ~60s sinh giọng. Chấp nhận được cho quy trình hiện tại.

## Lưu ý đã biết

- **Word timings hiện là ước lượng theo tỉ lệ ký tự** (`timingMethod:
  "char-proportion"`): đủ chính xác cho caption highlight, có thể lệch
  vài chục ms cho hiệu ứng "xuất hiện đúng từ". Nâng cấp sau: align bằng
  faster-whisper trên WAV đã sinh (không đổi interface meta).
- TTS là generative — chạy 2 lần cùng text ra audio hơi khác nhau. Muốn
  nhất quán thì dùng cache theo `textHash` ở tầng workflow.
- Model tải lần đầu qua HF Hub; mạng chậm có thể đặt `HF_TOKEN` để tăng
  rate limit (tùy chọn, không bắt buộc).
