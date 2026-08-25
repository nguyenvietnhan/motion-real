# Starter HyperFrames — khung project video 9:16

Engine chính của MotionReal Skill Studio: **HyperFrames** (HTML + CSS +
GSAP → MP4). Mỗi video là một folder con tại đây, ví dụ `<slug>/`:

```text
starter-hf/<slug>/
  index.html      composition (agent viết theo skill scene-authoring)
  fonts/          font đã vendor + fonts.css (copy từ fonts/ gốc)
  gsap.min.js     copy từ gốc (lint cấm đường dẫn ../)
  voice/          b*.wav + narration.wav/m4a (từ jobs/<slug>/voice/)
  output/         video.mp4 render ra
```

## Cài một lần

Bộ skill HyperFrames **đã có sẵn** trong `../.agents/skills/` — không
cần cài lại. Engine `npx hyperframes` tự tải về cache ở lần chạy đầu
(vài phút — không phải treo).

```bash
npx hyperframes check   # thử lần đầu (tự tải engine)
```

GSAP đã vendor tại `gsap.min.js` — copy vào thẳng folder `<slug>/` và
load `<script src="gsap.min.js"></script>` (lint CẤM `../`). Render
offline hoàn toàn.

## Lệnh

```bash
# từ GỐC TOOLBOX:
node starter-hf/scripts/gen-captions.mjs <slug>    # sinh caption + audio markup (ghi file)

# từ TRONG starter-hf/<slug>/:
npx hyperframes check                   # lint + runtime + layout (0 error mới qua)
npx hyperframes snapshot --at 3,12,25 --output qa/   # frame tĩnh để QA bằng mắt

# render ẨN (không pop-up terminal) — chạy từ GỐC TOOLBOX:
powershell -File starter-hf/scripts/render-hidden.ps1 -Slug <slug> -Verb render
# poll: Get-Content starter-hf/<slug>/render.log -Tail 5 -Wait
```

Render chậm (~4-8× thời lượng video) — QA ảnh trước, render sau.

## Lưu ý

- Font: copy folder `fonts/` (có fonts.css) vào project; INLINE khối
  `@font-face` vào `<style>` (StaticGuard không đọc `<link>` ngoài).
- Audio: dùng `voice/narration.m4a` (bản nén — WAV gây timeout); do
  `tools/vieneu-tts/merge_voice.py` tạo. Framework quản playback.
- Remotion starter (`../starter/`) giữ lại như phương án B — không dùng
  trong luồng chính.
