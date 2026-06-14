# ADR-005 — Library adoption strategy (ghép nối > build lại)

- **Status**: Accepted (2026-06-14). Khoá quyết định D6 (pivot).

## Context

Phân tích 12 commit `fix(authoring)` cho thấy ba class lỗi lặp lại, và cả ba đều
đang được giải bằng code viết tay khi có thư viện chuẩn ngành mạnh hơn nhiều
(verify trên context7, không dựa training data):

1. **AI trả manifest sai shape** → vá bằng `extractJsonObject` +
   `parseAuthorReply` + `manifest-schema.ts` hand-rolled + retry tự viết.
2. **Article ingest yếu** → `ingest_url` không xử lý JS-rendered page, anti-bot,
   og:image kém.
3. **Silent failure** → 40+ bare `catch {}` / `.catch(() => null)`, state corrupt
   im lặng → bug không liên quan ở bước sau.

## Decision

Adopt 4 thư viện, mỗi cái có **wrapper** giữ kiến trúc hiện tại (đặc biệt giữ
9router làm transport — yêu cầu rõ của user):

| Thư viện | context7 | Thay | Wrapper |
| --- | --- | --- | --- |
| **Vercel AI SDK** `generateObject` | [/vercel/ai](https://context7.com/vercel/ai) score 82.6 | parser ad-hoc + retry | `@ai-sdk/openai-compatible` provider trỏ `localhost:20128/v1`, wrap `NineRouterClient.chat()` |
| **Firecrawl** | [/firecrawl/firecrawl-docs](https://context7.com/firecrawl/firecrawl-docs) score 84.7 | `ingest_url` + `crawlArticleImages` | adapter cùng interface; fallback `@mozilla/readability`+jsdom khi không reachable |
| **Pino** | [/pinojs/pino](https://context7.com/pinojs/pino) score 92.8 | `console.*` + bare catch | `createLogger(scope)` child logger |
| **neverthrow** | [/supermacro/neverthrow](https://context7.com/supermacro/neverthrow) score 89.5 | `{ok}` ad-hoc | re-export `Result`/`Ok`/`Err` + helpers |

**Đã eval, KHÔNG adopt** (lý do trong [refactor-backlog.md](../refactor-backlog.md)):
- **XState** (state machine) — defer P1, chuyển `workspace-controller.ts` là
  refactor lớn, đáng có ADR riêng.
- **ts-morph** (AST) — skip, admission gate đã solid 9 fixture + 11 test;
  ts-morph ergonomic hơn nhưng không đập vào bug nào.
- **electron-trpc** (IPC) — skip, IPC không phải nguồn bug.

## Consequences

- **Bắt buộc verify context7 trước khi adopt bất kỳ thư viện mới** —
  `resolve-library-id` → `query-docs`, không dựa training data (Section G).
- Wrapper pattern giữ 9router intact → vẫn multi-provider (15 provider), không
  khoá vào một model.
- `generateObject` xoá nguyên class lỗi shape → bớt commit `fix(authoring)` từ
  gốc, không phải vá thêm.
- **Tool use / function calling defer hoàn toàn**: 9router serve nhiều provider,
  tool-calling khả dụng không đồng đều; structured output (`generateObject`) đã
  giải đúng vấn đề thực. Tool use là feature khác, ADR khác.
- Thêm dependency surface (4 lib + jsdom nặng ~50MB) — chấp nhận vì leverage cao
  hơn maintain code tay.
- Adoption tiến theo slice (bắt đầu `authorScenes`), behavior-equivalent baseline.
