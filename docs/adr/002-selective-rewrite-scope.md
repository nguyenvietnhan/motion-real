# ADR-002 — Selective rewrite, không phải big-bang refoundation

- **Status**: Accepted (2026-06-14). Khoá quyết định D1.

## Context

Phiên refoundation 2026-06-14 bắt đầu từ cảm giác "lỗi đẻ ra lỗi", nợ kỹ thuật
chồng chất. Lựa chọn:

1. **Big-bang rewrite** — viết lại từ đầu. Rủi ro cao, mất các invariant đã đúng
   (safety grid, atomic writes, draft-first gate, AST admission).
2. **Selective rewrite** — giữ những gì đã vững, chỉ thay những vùng là nguồn
   bug thật, ưu tiên ghép nối thư viện chuẩn ngành thay vì build lại.

Bằng chứng đo được: 22/30 commit gần nhất là `fix(`, riêng `authoring/` có 12 fix
liên tiếp/90 ngày. Nhưng các package nền (`schema`, `blocks`, `compositions`,
`tts`) ít churn và có test tốt.

## Decision

Selective rewrite. Quyết định gốc là giữ các package nền và chỉ thay vùng gây
churn. **Amended theo freeform pivot 2026-06-17:** design registry cũ đã bị xoá
và thay bằng `@motionreal/theme`; `@motionreal/blocks` không còn layout toolkit
authored-facing, chỉ còn runtime internals + `SceneImage`. Các vùng vẫn phải cực
kỳ thận trọng: `@motionreal/schema`, `@motionreal/theme`,
`@motionreal/blocks` runtime, `@motionreal/compositions`, `@motionreal/tts`,
legacy MCP stdio package đã xoá, và đặc biệt `orchestrator.ts` (off-limits per
user — pipeline architecture đang chạy đúng).

**Trong scope** (theo tiêu chí inclusion bên dưới): luồng authoring trong
`apps/desktop/src/main/authoring/`, bắt đầu từ slice `authorScenes`.

**Tiêu chí inclusion** một vùng vào refactor backlog:
- LoC > 500, **HOẶC**
- fix churn > 8 commit / 90 ngày, **HOẶC**
- coverage gap rõ ở vùng rủi ro cao.

Các vùng nhạy cảm hiện được tóm tắt trong [maintenance.md](../current/maintenance.md).

## Consequences

- Mỗi god-file ≥ 500 LoC chỉ được đụng sau khi có characterization test
  (existing hoặc viết trước) — Working Agreement rule 5.
- Refactor tiến theo slice end-to-end, mỗi slice một PR, behavior-equivalent với
  baseline (verify bằng MP4 so sánh).
- Các vùng off-limits (orchestrator, render-grid) chỉ mở khi có ADR riêng.
- Pivot sang ghép nối thư viện (Vercel AI SDK, Firecrawl, Pino, neverthrow) là
  hệ quả trực tiếp của tiêu chí "ghép nối > build lại" — xem [ADR-005](005-library-adoption-strategy.md).
