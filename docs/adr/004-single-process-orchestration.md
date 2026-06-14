# ADR-004 — Single-process orchestration (không tách service)

- **Status**: Accepted (2026-06-14). Ghi lại lý do của một quyết định đã tồn tại.

## Context

Toàn bộ pipeline chạy trong **một process**: `orchestrator.ts` import
`@news/compositions` từ source (một registry instance duy nhất), và cùng đường đó
được test suite + MCP server + desktop main process dùng. Không có service
boundary, không có queue/worker tách rời, không có DB (state là JSON file +
`events.ndjson` append-only, atomic write qua temp+rename).

Câu hỏi đặt ra khi refoundation: có nên tách render thành service riêng (scale,
isolation) không?

## Decision

**Giữ single-process.** Không tách service trong giai đoạn này.

Lý do:
- Registry handshake giữa authored scene và `@news/compositions` rất nhạy với
  việc resolve **hai instance** registry (lỗi "registration not found" trên
  Windows khi chạy `tsx -e` inline). Một process = một registry = một nguồn sự
  thật. Tách service nhân đôi bề mặt lỗi này.
- Deployment đơn giản: desktop app gọi `renderProject()` trực tiếp, không cần
  IPC qua network, không cần orchestrate nhiều process.
- Determinism: cùng một code path cho test, MCP, desktop → cái gì test xanh thì
  chạy thật cũng xanh.

## Consequences

- **Trade-off chấp nhận**: registry fragility (phải đi đúng build-script path,
  không `tsx -e` inline) đổi lấy deployment simplicity. Handshake giờ mirror một
  stray instance phòng thủ, nhưng path được support vẫn là build-script.
- Render nặng (headless Chromium) chạy in-process với desktop — concurrency phải
  cap (draft concurrency = 2, vì forcing all cores crash Chromium trong Electron).
- Nếu sau này cần scale bulk production qua nhiều máy, đó là một ADR mới —
  không phải nới dần single-process hiện tại.
- `orchestrator.ts` là off-limits cho refactor (per user) một phần vì nó là tâm
  của single-process model này.
