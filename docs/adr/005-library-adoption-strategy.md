# ADR-005 — Library adoption strategy (ghép nối > build lại)

- **Status**: Accepted (2026-06-14). **Sửa lại 2026-06-16**: kế hoạch ban đầu định
  adopt 4 thư viện; sau khi làm thật, **chỉ Pino có lợi thật và được giữ**. Ba thư
  viện còn lại (Vercel AI SDK, Firecrawl, neverthrow) **KHÔNG adopt** — lợi bất cập
  hại (xem §Kết quả thực tế bên dưới). Khoá quyết định D6 (pivot).

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

Kế hoạch ban đầu: adopt 4 thư viện, mỗi cái có **wrapper** giữ kiến trúc hiện tại
(đặc biệt giữ 9router làm transport — yêu cầu rõ của user). **Kết quả sau khi làm
thật (2026-06-16): chỉ adopt Pino.** Bảng dưới ghi cả kế hoạch lẫn phán quyết cuối:

| Thư viện | context7 | Thay | Phán quyết cuối |
| --- | --- | --- | --- |
| **Pino** | [/pinojs/pino](https://context7.com/pinojs/pino) score 92.8 | `console.*` + bare catch | **ADOPTED** — `createLogger(scope)` child logger. Có lợi thật: log có cấu trúc + scope, thay bare catch im lặng. |
| **Vercel AI SDK** `generateObject` | [/vercel/ai](https://context7.com/vercel/ai) score 82.6 | parser ad-hoc + retry | **KHÔNG adopt** — lợi bất cập hại (xem §Kết quả thực tế). |
| **Firecrawl** | [/firecrawl/firecrawl-docs](https://context7.com/firecrawl/firecrawl-docs) score 84.7 | `ingest_url` + `crawlArticleImages` | **KHÔNG adopt** — `@mozilla/readability` + `linkedom` đã đủ và nhẹ. |
| **neverthrow** | [/supermacro/neverthrow](https://context7.com/supermacro/neverthrow) score 89.5 | `{ok}` ad-hoc | **KHÔNG adopt** — `{ ok } \| { ok: false }` thủ công đã đủ, không đáng thêm dependency + lối viết. |

**Đã eval, KHÔNG adopt** (lý do trong [refactor-backlog.md](../refactor-backlog.md)):
- **XState** (state machine) — defer P1, chuyển `workspace-controller.ts` là
  refactor lớn, đáng có ADR riêng.
- **ts-morph** (AST) — skip, admission gate đã solid 9 fixture + 11 test;
  ts-morph ergonomic hơn nhưng không đập vào bug nào.
- **electron-trpc** (IPC) — skip, IPC không phải nguồn bug.

## Kết quả thực tế (2026-06-16) — vì sao chỉ giữ Pino

Sau khi bắt tay làm, chỉ **Pino** chứng minh có lợi thật và được cài (commit
`b3b0eca`). Ba thư viện còn lại bị loại — không phải vì khó cài, mà vì **lợi bất
cập hại** cho dự án ở quy mô này:

- **Vercel AI SDK (`generateObject`)** — định thay parser manifest tay + retry.
  Nhưng nó kéo theo một lớp provider/abstraction nữa chồng lên 9router (vốn đã là
  một lớp gateway), trong khi việc validate shape **đã làm được bằng Zod thẳng**
  (`authorManifestSchema.safeParse`) — đúng tầng 1 của [ADR-003](003-safety-grid-as-contract.md).
  Thêm SDK = thêm bề mặt phụ thuộc + một cách-gọi-model thứ hai song song
  `NineRouterClient`, đổi lấy thứ Zod đã cho. Không xứng.
- **Firecrawl** — định thay `ingest_url`/crawl ảnh. Nhưng nó là dịch vụ ngoài
  (cần key/self-host) hoặc một SDK nặng; `@mozilla/readability` + `linkedom` (đã
  cài, nhẹ, chạy local, không cần mạng ngoài) đã trích được text bài báo đủ tốt.
  Thêm Firecrawl = thêm điểm phụ thuộc ngoài cho thứ đang chạy ổn local.
- **neverthrow** — định thay pattern `{ ok } | { ok: false }` ad-hoc bằng
  `Result` monad. Nhưng pattern tay hiện tại **đã tường minh và đủ**; neverthrow
  bắt cả codebase học lối viết `.map/.andThen/.match` cho lợi ích biên. Không đáng.

**Bài học ghi lại:** "verify trên context7 + score cao" chỉ nói thư viện *tốt*,
KHÔNG nói nó *đáng adopt cho dự án này*. Một thư viện chỉ đáng nếu nó xoá một class
lỗi/khối code tay đáng kể mà KHÔNG thêm một lớp trừu tượng song song với cái đã có.
Pino qua bài test đó (xoá bare catch im lặng); ba cái kia không.

## Consequences

- **Bắt buộc verify context7 trước khi adopt bất kỳ thư viện mới** —
  `resolve-library-id` → `query-docs`, không dựa training data (Section G).
- **9router vẫn là transport DUY NHẤT** cho runtime AI — không thêm một cách-gọi-model
  thứ hai (Vercel AI SDK) song song `NineRouterClient`. Vẫn multi-provider, không
  khoá vào một model.
- **Lỗi shape manifest được chặn bằng Zod thẳng** (`authorManifestSchema.safeParse`),
  không qua `generateObject` — đúng tầng 1 của [ADR-003](003-safety-grid-as-contract.md).
- **Tool use / function calling defer hoàn toàn**: 9router serve nhiều provider,
  tool-calling khả dụng không đồng đều; structured output đã giải đúng vấn đề thực
  bằng Zod. Tool use là feature khác, ADR khác.
- **Dependency surface gần như không đổi**: chỉ thêm Pino (nhẹ). KHÔNG kéo về SDK
  AI, Firecrawl, hay jsdom — giữ cây phụ thuộc gọn, ít điểm hỏng ngoài.
- **Bài học khoá lại**: score context7 cao = thư viện *tốt*, KHÔNG = *đáng adopt*.
  Chỉ adopt khi nó xoá một class lỗi/khối code tay đáng kể mà không dựng một lớp
  trừu tượng song song với cái đã có.
