# Refactor Backlog — news_remotion_tool

Bảng ưu tiên nợ kỹ thuật + library candidate đã verify trên context7. Cập nhật khi
một mục được giải quyết hoặc một god-file mới xuất hiện.

## Công thức ưu tiên

- **P0** = high churn × low test density (vết thương đang chảy máu).
- **P1** = high size × low churn (lớn nhưng ổn định — refactor có kế hoạch).
- **P2** = blocker phụ thuộc, hoặc cleanup diện rộng.

## God-files

| File | LoC (2026-06-16) | Fix churn 90d | Priority | Hướng |
| --- | --- | --- | --- | --- |
| `apps/desktop/.../workspace-controller.ts` | 1159 | ~5 | P1 | XState (state machine) — cần ADR riêng |
| `safety/render-grid.ts` | 1035 | thấp | P1 | Tách theo oracle group; chưa có ADR |
| `apps/desktop/.../authoring/ninerouter-backend.ts` | 755 | ~12 | **P0** | Vùng churn cao nhất; slice end-to-end (xem dưới) |
| `orchestrator.ts` | 627 | thấp | — | **Off-limits** per user (pipeline architecture đang ổn) |
| `cli/cli.ts` | 606 | thấp | P2 | Tách verb handlers; thấp ưu tiên |

## Library candidates (đã verify context7) — phán quyết cuối 2026-06-16

Kế hoạch ban đầu định adopt 4 (Vercel AI SDK, Firecrawl, Pino, neverthrow). Sau
khi làm thật, **chỉ Pino có lợi thật và được giữ**; ba cái kia loại vì lợi bất cập
hại (chi tiết: [adr/005](adr/005-library-adoption-strategy.md) §Kết quả thực tế).

| Thư viện | Score | Replace | Phán quyết cuối |
| --- | --- | --- | --- |
| Pino (`/pinojs/pino`) | 92.8 | `console.*` rời rạc + bare `catch {}` | **ADOPTED** — `createLogger(scope)`, commit `b3b0eca`. Lợi thật. |
| `@mozilla/readability` (`/mozilla/readability`) | 97.2 | ingest text bài báo (+ `linkedom`) | **ĐANG DÙNG** — nhẹ, local, không cần mạng ngoài. |
| Vercel AI SDK (`/vercel/ai`) | 82.6 | `parseAuthorReply` + manifest validate/retry | **KHÔNG adopt** — Zod thẳng đã validate shape; SDK thêm lớp provider song song 9router. |
| Firecrawl (`/firecrawl/firecrawl-docs`) | 84.7 | `ingest_url` + `crawlArticleImages` | **KHÔNG adopt** — dịch vụ ngoài/SDK nặng; readability+linkedom đã đủ. |
| neverthrow (`/supermacro/neverthrow`) | 89.5 | `{ ok } \| { ok: false }` ad-hoc | **KHÔNG adopt** — pattern tay đã tường minh, không đáng thêm dependency. |
| XState (`/statelyai/xstate`) | 75.7 | `workspace-controller.ts` state machine ngầm | **DEFER** P1 — refactor lớn, cần ADR |
| ts-morph (`/dsherret/ts-morph`) | 77.9 | `admission.ts` AST raw | **SKIP** — gate đã solid (9 fixture + 11 test), không đập vào bug |
| electron-trpc (`/jsonnull/electron-trpc`) | 82 | `ipc-router.ts` hand-rolled | **SKIP** — IPC không phải nguồn bug |

**Bài học:** "context7 score cao" chỉ nói thư viện *tốt*, không nói nó *đáng adopt
cho dự án này*. Một thư viện chỉ đáng nếu nó xoá một class lỗi/khối code tay đáng kể
mà KHÔNG thêm một lớp trừu tượng song song với cái đã có. Chỉ Pino qua được bài đó.

## Follow-up (named)

- `reauthor` trong ninerouter-backend (slice riêng).
- 15 silent catches còn lại ở `index.ts`, `gateway/ninerouter-client.ts`,
  `workspace-controller.ts` (migrate khi mở rộng Pino).
- XState cho workspace-controller (P1, cần ADR).
