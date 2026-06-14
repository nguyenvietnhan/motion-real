# Vision — news_remotion_tool

## Tại sao tool này tồn tại

Biến một prompt tiếng Việt (hoặc một URL bài báo) thành một video tin tức ngắn
9:16 hoàn chỉnh, chất lượng đăng được — tự động, ổn định, không cần một designer
ngồi dựng từng cảnh. Khác với cách dùng ~40 template cố định (như
`news_video_tool` cũ), ở đây **AI tự viết mã Remotion (React) mới cho từng cảnh**
(pure AUTHOR mode), nên độ đa dạng hình ảnh là không giới hạn; chất lượng giữ ổn
định nhờ một **safety grid liệt kê được (N1–N30)** chặn lỗi trước khi render.

## Bốn bất biến (KHÔNG đổi qua mọi refactor)

1. **Pure AUTHOR mode** — mỗi cảnh là một module `.tsx` AI viết mới, đi qua
   admission gate (N4/N5). Không có template kit, không có PICK mode.
2. **Safety grid N1–N30 là contract** — mỗi class lỗi nhìn thấy được phải graduate
   thành một check + self-test, KHÔNG vá bằng một dòng prompt. Hard error chặn
   lock/render/done.
3. **Free pacing** — số cảnh và tổng thời lượng KHÔNG phải preset cố định;
   `duration` chỉ là target mềm. Một bản render dài hơn target mà giọng đọc đầy đủ,
   không bị cắt, là CHẤP NHẬN ĐƯỢC.
4. **Draft-first** — luôn render draft nhanh (10fps, nửa độ phân giải) cho user
   xem trước; full render bị từ chối nếu chưa có draft (enforced trong code).

## Ngoài scope (cố ý KHÔNG làm)

- **Template/scene kit** — phá vỡ bất biến 1.
- **Đa ngôn ngữ UI/nội dung** — chỉ tiếng Việt; giữ tên brand/model bằng tiếng Anh.
- **Tool use / function calling cho AI runtime** — 9router serve nhiều provider,
  khả năng tool-calling không đồng đều; structured output đã giải quyết bằng
  Zod-validated generate (xem [adr/005-library-adoption-strategy.md](adr/005-library-adoption-strategy.md)).
- **Tách orchestrator thành nhiều service** — single-process là quyết định cố ý
  (xem [adr/004-single-process-orchestration.md](adr/004-single-process-orchestration.md)).
- **Media payload thật** — chỉ cấm ảnh/asset thật bên ngoài; SVG/CSS tự vẽ được
  khuyến khích.

## Đọc tiếp

- [architecture.md](architecture.md) — kiến trúc hiện trạng (package, data flow,
  god-file map).
- [authoring-contract.md](authoring-contract.md) — hợp đồng viết cảnh `.tsx`.
- [refactor-backlog.md](refactor-backlog.md) — nợ kỹ thuật + library candidate đã eval.
- [adr/](adr/) — các quyết định kiến trúc đã khoá.
