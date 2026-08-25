# Starter Kit — Remotion 9:16

Khung dự án Remotion tối giản cho video dọc TikTok/Reels/Shorts
(1080×1920 @30fps). Agent viết composition mới vào `src/video/` và đăng ký
trong `src/Root.tsx`.

## Cài đặt (một lần, cần mạng)

```bash
npm install
npx remotion browser ensure
```

`browser ensure` tải Headless Shell Chromium dùng cho render. Sau bước này,
render chạy hoàn toàn offline (ffmpeg đã đi kèm Remotion).

## Lệnh

```bash
npm run studio        # xem trước trong trình duyệt
npm run render        # render SampleVideo -> out/sample.mp4
npx remotion still SampleVideo out/frame.png --frame=80   # xuất 1 khung hình để QA
```

## Quy ước có sẵn trong `src/lib/geometry.ts`

- Kích thước + fps chuẩn 9:16.
- Safe area TikTok: dải caption dưới cùng 340px, mép phải 160px — nội dung
  chính nằm trong `CONTENT_AREA`.
- Kiểu `WordTiming` + helper `secondsToFrames` để đồng bộ hình theo từ nói.
- `SampleVideo` demo: entrance nhanh bằng `spring`, highlight từng từ theo
  timing, và lớp phủ safe-area guide (bật/tắt qua prop).
