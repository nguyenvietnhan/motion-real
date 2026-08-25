# PLAN — Luật chơi & lộ trình MotionReal Skill Studio

> Tài liệu định hướng chính khi xây dựng trong folder này.
> Đọc cùng DESIGN.md (kiến trúc) và RESEARCH.md (kiến thức nền về skill).
> Cập nhật trạng thái ngay khi có quyết định mới. Không bỏ qua checklist.

## 1. Mục tiêu sản phẩm

Một folder đóng gói độc lập: bất kỳ AI agent nào (Claude Code, Codex,
Antigravity, GLM, opencode...) mở folder, gõ lệnh skill kèm chủ đề +
thời lượng → tự research → tự viết kịch bản → tự sinh giọng Việt → tự code
video Remotion (sync theo từ) → xuất MP4 9:16 vào `jobs/<slug>/output/`.

## 2. Nguyên tắc bất di bất dịch

1. **Không đụng motion-real gốc.** Mọi file tạo/sửa nằm trong `skill-test/`.
2. **Chuẩn mở trước:** dùng Agent Skills spec (agentskills.io) và quy ước
   `.agents/skills/`; không phụ thuộc tính riêng của một agent nào.
3. **Chữ trước, code sau:** mỗi giai đoạn phải chốt tài liệu rồi mới code.
   Skill md là "sản phẩm chính", code chỉ là nguyên liệu mà chữ trỏ tới.
4. **Mỗi bước phải kiểm chứng được** (có lệnh chạy thử rõ ràng).
5. **Quyết định nào ra quyết định đó:** thay đổi kiến trúc phải cập nhật
   DESIGN.md cùng lúc, ghi lý do ngắn.
6. **Không bịa sự kiện:** cả trong nội dung skill lẫn pipeline video —
   research-grounding bắt buộc đối chứng nguồn.

## 3. Lộ trình (mỗi phase có Definition of Done)

### Phase 0 — Nền tài liệu ✅ (bước hiện tại)
- [x] DESIGN.md: kiến trúc tổng thể chốt
- [x] PLAN.md (file này)
- [x] RESEARCH.md: kiến thức viết skill + dữ liệu VieNeu-TTS
- DoD: ba file khép kín, người đọc mới hiểu được toàn bộ hướng đi.

### Phase 1 — Starter kit render được ✅ (25/08/2026)
- [x] `starter/`: project Remotion 4.0.515 tối giản (9:16 1080×1920 @30fps),
      cài đặt chạy được, render composition mẫu ra MP4.
- [x] Kiểm chứng: `npm install` + `npx remotion browser ensure` một lần,
      sau đó render offline (ffmpeg đi kèm Remotion, không cần cài riêng).
- DoD đạt: `npm run render` → out/sample.mp4 (312 kB, 150 frame);
  `npx tsc --noEmit` sạch; QA bằng mắt 2 frame tĩnh (frame 10, 75) —
  word-highlight "mèo" đúng timing, safe-area 3 vùng đúng vị trí.
  Bug đã sửa trong quá trình: CONTENT_AREA.right nhầm tọa độ x thành inset CSS.

### Phase 2 — Voice pipeline (VieNeu local) ✅ (25/08/2026)
- [x] `tools/vieneu-tts/gen_voice.py`: wrapper CLI gọi SDK vieneu 3.3.0
      (venv Python 3.12 qua uv, CPU ONNX int8, 48kHz). Text → WAV + meta
      JSON (duration, word timings char-proportion, startFrame/endFrame,
      textHash làm khóa cache).
- [x] Kiểm chứng: 3 lượt sinh WAV (1.04s / 6.56s / offline) — pipeline
      lặp lại ổn định; waveform thật (peak 58%, RMS 3372); 20 giọng preset
      Bắc/Trung/Nam đã liệt kê; RTF ≈ 1.3 trên CPU.
- DoD đạt: text → WAV + timings.json lặp lại được, không GPU, chạy được
  cả offline sau khi model đã cache (`HF_HUB_OFFLINE=1` xác nhận).
  Đã ghi chú: timing char-proportion là ước lượng, upgrade path
  faster-whisper để sau; audio generative → nhất quán qua cache textHash.

### Phase 3 — Nội dung 4 skill ✅ (25/08/2026)
- [x] `make-video` (spine): artifact contract jobs/, beats.json schema,
      7 stage đánh số, Done=, ranh giới skill nào mở/khóa.
- [x] `scene-authoring`: luật cứng deterministic, safe-area, word-sync
      (kèm bẫy frame cục bộ/toàn cục), motion grammar, QA 5 mục;
      references/remotion-cheatsheet.md.
- [x] `voice-vieneu`: lệnh chuẩn, cache textHash, bảng giọng, luật tts_text.
- [x] `research-grounding`: 5 bước, claim ledger + độ tin cậy, chống
      injection, format findings.md, ngân sách nguồn.
- [x] `styles/default/STYLE.md` (style pack mặc định để cơ chế hoàn chỉnh).
- [x] Cả 4 skill pass `skills-ref validate` (bắt 1 lỗi YAML thật: dấu
      hai chấm trong description research-grounding — đã sửa).
- DoD đạt: 4 SKILL.md + 1 reference + 1 style pack, chuẩn mở hợp lệ.
  Còn mở (không chặn): vendor-copy ffmpeg/frontend-design từ
  digitalsamba — làm khi cần ở Phase 4/5.

### Phase 4 — E2E đầu tiên ✅ (25/08/2026)
- [x] Chạy thật toàn bộ flow bằng agent (opencode đóng vai agent lạ),
      chủ đề "Sạc điện thoại qua đêm có làm hỏng pin không?".
- [x] Thành phẩm: jobs/sac-pin-qua-dem/output/video.mp4 (35.27s, 6 beat,
      giọng Adam, caption sync theo từ) — đã copy ra V:\downloads.
- [x] Ghi log: jobs/sac-pin-qua-dem/e2e-log.md — 8 vấn đề, 3 việc cần vá
      skill (fontFamily rule, wps tiếng Việt ~4.2 không phải 2.7,
      gen-job-data.mjs thành bước chuẩn).
- Còn mở: người thật NGHE video đánh giá giọng; Phase 4b vá skill theo log.

### Phase 5 — Style packs + thẩm mỹ ✅ (25/08/2026)
- [x] Vendor-copy skill `frontend-design` (Anthropic, qua digitalsamba).
- [x] Vendored 14 font faces (Literata, Be Vietnam Pro, IBM Plex Mono,
      Archivo; subset vi+latin) + loader chuẩn.
- [x] 2 style pack + cơ chế theme; video "báo giấy" đạt cấp poster
      (pin hatch + vết nứt + counter, stamp, highlight box, per-word stagger).
- [x] Feedback vòng 3: caption karaoke (dòng cố định + highlight màu),
      structural tokens, render lại cả 2 bản.

### Phase 6 — Spike HyperFrames + PIVOT + Audit ✅ (25/08/2026)
- [x] Cài HyperFrames (26 skill), dựng lại đúng video này bằng HTML+GSAP,
      pass lint (lint bắt 1 lỗi thật: tween `left` snap pixel), render
      thành công có audio.
- [x] Fix 2 bug spike: caption clip chồng nhau (bỏ padding), caption
      dán đỉnh frame (align-items flex-end); thêm fade chuyển cảnh.
- [x] **QUYẾT ĐỊNH (user chốt): engine chính = HyperFrames.** Pivot:
      scene-authoring viết lại cho HF, make-video cập nhật Stage 4-6,
      starter-hf/ dựng khung mới (gen-captions.mjs generic), 26 skill HF
      chuyển vào .agents/skills/, Remotion starter giữ làm phương án B.
- [x] Style pack viết lại thành DESIGN SYSTEM phổ quát (công thức
      component + menu biến tấu chữ + cấm kê) — không gắn cứng video mẫu.
- [x] Audit + chuẩn hóa md: DESIGN v2, PLAN, RESEARCH §8, e2e-log đủ 4
      vòng feedback; tất cả skill pass skills-ref validate.
- Còn mở: test skill trên agent khác (bước tiếp của user); UI integration.

## 4. Rủi ro & phòng ngừa

| Rủi ro | Phòng ngừa |
| --- | --- |
| VieNeu không trả word timestamps | Kế hoạch B đã sẵn: ffprobe đo duration dòng + faster-whisper align; fallback cuối: chia tỉ lệ ký tự trong dòng |
| Skill quá dài → agent bỏ sót luật | Giữ <500 dòng, tách references/, mục quan trọng đặt đầu file |
| Agent viết code crash render (frame âm, range interpolate) | skill scene-authoring liệt kê lỗi hay gặp + bước QA bắt buộc xem frame tĩnh |
| Phụ thuộc mạng lúc runtime (model HF tải lần đầu) | Phase 2 ghi rõ bước preload/cache model vào setup |
| Lan man đụng vào repo gốc khi lấy cảm hứng | Chỉ COPY pattern sang skill-test, không import/import path chéo |

## 5. Checklist trước khi coi một việc là xong

- [ ] Đúng vị trí file theo cây trong DESIGN.md
- [ ] Có lệnh kiểm chứng đã chạy thành công (dán kết quả vào commit/note)
- [ ] DESIGN.md/PLAN.md còn đúng sự thật (sửa ngay nếu lệch)
- [ ] Không có file mới nằm ngoài skill-test/

### Phase 7 - Audit toan dien + fix theo lo (25/08/2026) ✅

Audit doc lap: doc tung dong 5 skill chinh + scripts + docs + 2 job Grok
de lai. Tim thay 22 loi/lo hong phan lo A (nang) - E (enforcement).

Fix theo 7 batch, moi batch 1 commit:
1. `1382d2a` A1 CWD rules + A2 cong thuc so tu (giay x 3.7) + A3 luat chay lien tuc
2. `d2ffefc` A4 research Done= + verify findings gate + tu kiem 4 diem Stage 2
3. `d4b7e38` B2 vendor gsap local + canh bao preview/first-run (B3/B4)
4. `7f4c2d9` B5/B6 gen-captions friendly errors + cache textHash trong code + schema totalSeconds
5. `85e9764`+`3927771` C stale docs + default pack design system + boundary list
6. `fae69a6` D1/D2 tach 16 skill HF workflow canh tranh sang hf-extras/, make-video = workflow duy nhat
7. (commit nay) log + plan

Trang thai: 14 skill auto-load (5 cua ta + 9 HF core), 16 HF extras tai
hf-extras/. Cho user test lai tren agent khac.

### Phase 8 - Tich hop findings Gemini E2E + nang chat luong visualize (25/08/2026) ✅

Gemini 3.8 High chay thanh cong end-to-end (job lightgbm, 36 beat, 200s).
6 diem nghen that te da tich hop: master narration (1 the audio), gsap
local trong slug folder, gen_beats_batch.py (1 lan load model), gen-captions
v2 (mang timing + element cache), fonts/fonts.css chuan, cam inline one-liner.
Nang chat: hero diagram tien hoa theo loi noi (3b1b), cot "Hinh dien bien"
bat buoc. Commit: 52b9c29, f7695c8, 91d8dc2 + log.

### Cleanup - ve trang thai moi tai ve (25/08/2026) ✅

Bo job test (sac-pin-qua-dem, decision-tree, lightgbm), spike-hyperframes/,
starter-hf/lightgbm + sac-pin-qua-dem, starter out/node_modules, test-out.
Nhat ky kiem nghiem chuyen thanh E2E-LOG.md o goc. starter/ tra ve sample
goc (SampleVideo), tsc OK sau npm install. jobs/ de trong - san sang cho
nguoi dung moi.
