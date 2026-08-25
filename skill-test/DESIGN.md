# Thiết kế MotionReal Skill Studio (nháp thảo luận)

> Toàn bộ công việc xây dựng ý tưởng nằm trong folder này.
> KHÔNG đụng vào mã nguồn motion-real gốc.

## Engine: HyperFrames (chốt 25/08/2026 sau spike)

- **Engine chính: HyperFrames** (HeyGen, Apache 2.0) — HTML + CSS +
  GSAP → MP4. Lý do: AI viết HTML quen hơn TSX, lint dạy lỗi tốt, hệ
  26 skill chính thức, audio render thẳng không cần mux.
- **Phương án B: Remotion** — `starter/` giữ lại nguyên vẹn (render
  nhanh hơn ~8 lần) nhưng không nằm trong luồng chính.
- Số liệu spike: cùng 1 video 35s — HyperFrames render 4-6 phút,
  Remotion ~40s; chất lượng hình tương đương (cùng designer).

## Mục tiêu

Một folder đóng gói độc lập: bất kỳ agent nào (Claude Code, Codex,
Antigravity, GLM, opencode...) mở folder, gọi skill chính, nhập chủ đề
→ tự research → tự viết kịch bản → tự sinh giọng đọc → tự code video
HyperFrames (sync theo từ) → xuất MP4 9:16 vào `jobs/<slug>/output/`.

## Phi mục tiêu (giai đoạn core)

- Không sửa motion-real gốc.
- Chưa cần UI; sau này UI có thể tái dùng giao diện desktop hiện tại
  (ẩn phần nhập prompt + queue, giữ gallery/quản lý).

## Sự thật đã kiểm chứng (08/2026)

- Chuẩn mở Agent Skills (agentskills.io): folder `.agents/skills/` trong
  workspace được Claude Code, Codex, Antigravity, Copilot, Cursor,
  VS Code, Gemini CLI, opencode... đọc chung. SKILL.md + YAML frontmatter.
- Skill theo folder = kích hoạt khi mở đúng folder. Đúng mong muốn.
- Nhiều skill song song cộng hưởng tốt (cùng một context).
- Prior art: `claude-faceless-shorts-creator`; HyperFrames phát hành
  kèm Agent Skills; Remotion có skill chính thức; digitalsamba toolkit.

## Kiến trúc chốt (v2 — HyperFrames)

```text
skill-test/
├── .agents/skills/            # 13 skill auto-load (chuẩn mở)
│   ├── make-video/            # SKILL chính: workflow tổng (spine)
│   ├── scene-authoring/       # Viết composition HyperFrames (HTML+GSAP)
│   ├── voice-vieneu/          # TTS local VieNeu + word timestamps
│   ├── research-grounding/    # Tra cứu + claim ledger chống bịa
│   ├── frontend-design/       # (vendor Anthropic) chống AI-slop
│   └── hyperframes*/          # 10 skill lõi của engine
├── hf-extras/                 # 16 skill workflow mẫu HF — chỉ tham khảo
├── starter-hf/                # KHUNG CHÍNH: fonts + fonts.css + gsap
│   ├── fonts/                 #   + scripts/gen-captions.mjs
│   ├── gsap.min.js
│   └── scripts/
├── starter/                   # (phương án B) Remotion starter — giữ nguyên
├── tools/
│   └── vieneu-tts/            # gen_beats_batch + merge_voice + gen_voice
├── styles/                    # DESIGN SYSTEM phổ quát (không gắn 1 video)
│   ├── default/ bao-giay/ phong-lab/
├── jobs/                      # OUTPUT CONTRACT (trống lúc mới tải): mỗi
│                              #   video 1 folder brief→research→script→
│                              #   beats→voice→output/video.mp4
├── DESIGN.md PLAN.md RESEARCH.md E2E-LOG.md README.md
└── .gitignore                 # loại venv/node_modules/wav/mp4 khỏi git
```

## Quyết định thiết kế

1. **Modular theo chuẩn mở**: skill chính điều phối, skill con chuyên
   môn hoá; skill ngoài cộng hưởng được trong cùng context.
2. **Style pack = design system phổ quát**: tokens + thang chữ + công
   thức component + motion + cấm kê. Áp được cho MỌI chủ đề — cấm
   hardcode theo một video mẫu.
3. **Voice-first pipeline**: giọng TRƯỚC → duration + word timings →
   hình sync theo từ (karaoke: dòng cố định, highlight bằng màu).
4. **Output contract** qua cây `jobs/`; HyperFrames render thẳng
   video.mp4 có audio (không cần mux).
5. **Mượn sức ngoài**: frontend-design (Anthropic), 26 skill HyperFrames
   (HeyGen). Pattern brand/project của digitalsamba chỉ mượn ý tưởng
   (style pack + jobs contract), không copy file. Không viết lại phần
   đã có người kiểm chứng.
6. **QA bằng mắt bắt buộc**: check 0 error + đọc snapshot PNG theo
   checklist trước khi render — bù cho việc AI không nhìn thấy output.

## Vấn đề đang mở

- [x] Engine: chốt HyperFrames chính, Remotion phương án B.
- [ ] Word timestamps: hiện char-proportion; upgrade faster-whisper khi cần.
- [ ] UI integration (tái dùng giao diện desktop) — bàn sau khi skill
      chạy ổn trên agent khác.
