# Refactor Backlog — news_remotion_tool

Bảng ưu tiên nợ kỹ thuật + library candidate đã verify trên context7. Cập nhật khi
một mục được giải quyết hoặc một god-file mới xuất hiện.

## Công thức ưu tiên

- **P0** = high churn × low test density (vết thương đang chảy máu).
- **P1** = high size × low churn (lớn nhưng ổn định — refactor có kế hoạch).
- **P2** = blocker phụ thuộc, hoặc cleanup diện rộng.

## God-files

| File | LoC | Fix churn 90d | Priority | Hướng |
| --- | --- | --- | --- | --- |
| `apps/desktop/.../authoring/ninerouter-backend.ts` | 707 | ~12 | **P0** | Pilot: library adoption slice (xem dưới) |
| `safety/render-grid.ts` | 959 | thấp | P1 | Tách theo oracle group; chưa có ADR |
| `apps/desktop/.../workspace-controller.ts` | 847 | ~5 | P1 | XState (state machine) — cần ADR riêng |
| `orchestrator.ts` | 627 | thấp | — | **Off-limits** per user (pipeline architecture đang ổn) |
| `cli/cli.ts` | 608 | thấp | P2 | Tách verb handlers; thấp ưu tiên |

## Library candidates (đã verify context7)

| Thư viện | Score | Replace | Verdict |
| --- | --- | --- | --- |
| Vercel AI SDK (`/vercel/ai`) | 82.6 | `parseAuthorReply` + `extractJsonObject` + manifest validate/retry | **ADOPT** (pilot) |
| Firecrawl (`/firecrawl/firecrawl-docs`) | 84.7 | `ingest_url` + `crawlArticleImages` | **ADOPT** (pilot) |
| `@mozilla/readability` (`/mozilla/readability`) | 97.2 | Firecrawl fallback (no-network/self-host down) | **ADOPT** (pilot, fallback) |
| Pino (`/pinojs/pino`) | 92.8 | `console.*` rời rạc + bare `catch {}` | **ADOPT** (pilot) |
| neverthrow (`/supermacro/neverthrow`) | 89.5 | `{ ok } \| { ok: false }` ad-hoc | **ADOPT** (pilot) |
| XState (`/statelyai/xstate`) | 75.7 | `workspace-controller.ts` state machine ngầm | **DEFER** P1 — refactor lớn, cần ADR |
| ts-morph (`/dsherret/ts-morph`) | 77.9 | `admission.ts` AST raw | **SKIP** — gate đã solid (9 fixture + 11 test), không đập vào bug |
| electron-trpc (`/jsonnull/electron-trpc`) | 82 | `ipc-router.ts` hand-rolled | **SKIP** — IPC không phải nguồn bug |

## Pilot scope (phiên hiện tại)

Library adoption slice trên luồng `authorScenes` end-to-end. Wrapper giữ 9router
gateway. Xem [adr/005-library-adoption-strategy.md](adr/005-library-adoption-strategy.md)
và plan file. Đập vào ba class lỗi của 12 fix(authoring) commit: manifest sai shape,
ingest yếu, silent catch.

## Follow-up (sau pilot, named)

- `reauthor` trong ninerouter-backend (slice riêng).
- `visualQa`, `crawlImages` filter, `snapshotScenes`/`restoreScenes`.
- 15 silent catches còn lại ở `index.ts`, `gateway/ninerouter-client.ts`,
  `workspace-controller.ts` (migrate khi adopt Pino + neverthrow rộng hơn).
- XState cho workspace-controller (P1, cần ADR).
- Tool use / function calling cho runtime AI (defer — `generateObject` đã giải
  quyết structured output; tool-calling khả dụng không đồng đều qua 9router).
