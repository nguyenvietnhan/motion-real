# MotionReal Skill Studio

Xưởng video 9:16 (TikTok/Reels/Shorts) điều hành bởi AI agent: mở folder
này bằng agent bất kỳ (Claude Code, Codex, Grok, Antigravity, opencode...),
gọi skill **make-video** với một chủ đề → tự research, viết kịch bản,
sinh giọng Việt local, code video, QA, render MP4.

## Bắt đầu

```text
/make-video <chủ đề> [thời lượng] [style pack]
```

Ví dụ: `/make-video "tại sao nên học SQL" 90s phong-lab`

- Thời lượng: 45s / 90s / 150s / 210s (mặc định 45s)
- Style pack: `default` / `bao-giay` / `phong-lab` (mặc định default)

> **`make-video` là workflow DUY NHẤT để tạo video trong toolbox này.**
> Các skill `hyperframes-*` chỉ là tài liệu kỹ thuật của engine. 16
> skill workflow mẫu khác của HyperFrames được để ở `hf-extras/` — chỉ
> đọc tham khảo, không dùng làm quy trình chính.

## Môi trường yêu cầu

- Node 18+ (đã cài), Python 3.12 venv tại `tools/vieneu-tts/.venv` (đã cài)
- **Shell trên Windows là PowerShell 5.1** — KHÔNG dùng `||`, `&&`,
  `tr` kiểu bash. Xem luật chi tiết trong skill make-video.
- Lần render đầu, `npx hyperframes` tự tải engine (cần mạng).

## Cấu trúc

| Folder | Vai trò |
| --- | --- |
| `.agents/skills/` | 31 skill (make-video là spine; hyperframes* là docs engine) |
| `starter-hf/` | Khung project video chính (fonts + gen-captions) |
| `tools/vieneu-tts/` | Giọng đọc local (text → WAV + word timings) |
| `styles/` | 3 design system: default, bao-giay, phong-lab |
| `jobs/<slug>/` | Mỗi video một folder: brief → research → script → beats → voice → output |
| `jobs/sac-pin-qua-dem/` | Ví dụ hoàn chỉnh tham chiếu |
| `DESIGN.md` `PLAN.md` `RESEARCH.md` | Kiến trúc, lộ trình, kiến thức nền |
