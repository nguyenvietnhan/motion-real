# Starter HyperFrames — khung project video 9:16

Engine chính của MotionReal Skill Studio: **HyperFrames** (HTML + CSS +
GSAP → MP4). Mỗi video là một folder con tại đây, ví dụ `sac-pin-qua-dem/`:

```text
starter-hf/<slug>/
  index.html      composition (agent viết theo skill scene-authoring)
  fonts/          font đã vendor (copy từ fonts/ gốc)
  voice/          b1.wav + b1.json ... (từ jobs/<slug>/voice/)
  output/         video.mp4 render ra
```

## Cài một lần

Bộ skill HyperFrames **đã có sẵn** trong `../.agents/skills/` — không
cần cài lại. Engine `npx hyperframes` tự tải về cache ở lần chạy đầu
(vài phút — không phải treo).

```bash
npx hyperframes check   # thử lần đầu (tự tải engine)
```

GSAP đã vendor tại `gsap.min.js` — composition load bằng
`<script src="../gsap.min.js"></script>`, render offline hoàn toàn.

## Lệnh

```bash
node scripts/gen-captions.mjs <slug>    # sinh caption + audio markup
npx hyperframes check                   # lint + runtime + layout (0 error mới qua)
npx hyperframes snapshot --at 3,12,25 --output qa/   # frame tĩnh để QA bằng mắt
npx hyperframes render --output <job>/output/video.mp4
```

Render chậm (~4-8× thời lượng video) — QA ảnh trước, render sau.

## Lưu ý

- Font: copy từ `fonts/` gốc vào project, khai báo `@font-face` với
  subset vietnamese + latin.
- Audio do framework quản — chỉ khai báo `<audio data-start>`, không
  tự play/seek.
- Remotion starter (`../starter/`) giữ lại như phương án B — không dùng
  trong luồng chính.
