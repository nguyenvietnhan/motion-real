# ADR-001 — Pure AUTHOR mode (AI viết toàn bộ scene `.tsx`)

- **Status**: Accepted (2026-06-14). Khoá quyết định D2.
- **Supersedes**: PICK-mode / template-kit (di sản `render-pipeline`, đã gỡ).
- **Amended (2026-06-17, hiện hành)**: AUTHOR mode vẫn giữ, nhưng **thư viện
  layout-block đã bị XOÁ khỏi authored-facing surface** (owner phê duyệt) vì tái
  dùng block khiến mọi video trông một khuôn. Whitelist authored hiện là
  `react`/`remotion`/`@news/compositions`/`zod` — KHÔNG còn `@news/blocks`/
  `@news/theme`. Mỗi scene là JSX/SVG trần viết tay; ngoại lệ duy nhất là
  `SceneImage` (qua `@news/compositions`) cho tính năng ảnh. `@news/blocks` vẫn
  tồn tại như runtime internals cho composition/captions/probe/fonts.

## Context

Có hai cách để một AI sinh video:

1. **PICK mode** — AI chọn từ một catalog template cố định (~40 template như
   `news_video_tool` cũ dùng HyperFrames). Chất lượng ổn định nhưng đa dạng hình
   ảnh bị chặn cứng ở số template.
2. **AUTHOR mode** — AI viết mới một module Remotion `.tsx` cho từng scene. Đa
   dạng hình ảnh là code không giới hạn.

Tool này chọn AUTHOR mode từ đầu. Câu hỏi đặt lại trong phiên refoundation
2026-06-14: paradigm này có phải nguồn gốc của "lỗi đẻ ra lỗi" không, có nên đổi
sang template không? Kết luận: **giữ AUTHOR mode** — nguồn bug thật nằm ở parser
ad-hoc + scraping yếu + silent catch, không phải ở paradigm (xem [ADR-005](005-library-adoption-strategy.md)).

## Decision

Mỗi video, AI viết brand-new `.tsx` scene module dưới
`VIDEO_TOOL_HOME/.video-tool/projects/<id>/authored/`. Không có catalog template,
không có PICK mode. Một scene chỉ vào được render sau khi qua **admission gate**
(`admitAuthoredComponent`, AST tĩnh — N4/N5):

- import whitelist (`react`, `remotion`, `@news/compositions`, `zod`),
- banned-API blacklist (`Math.random`, `Date`, `fetch`, `eval`, `fs`, …),
- required exports (`default` = `registerComponent(...)`, `schema`, `example`),
- `registerComponent({ id })` với id là **literal string**.

Scene tự dựng text/structure/visual bằng raw JSX/SVG/CSS. Một scene text/list
thuần là lựa chọn hợp lệ hạng nhất. Nếu scene có ảnh local do user/crawler cung
cấp, nó dùng `SceneImage` import từ `@news/compositions`; không dùng `<img>`,
`Img`, `staticFile`, URL, hay import `@news/blocks`.

## Consequences

- **Hệ luỵ chính (quy tắc cứng)**: một class lỗi mới do AI sinh ra **phải** được
  graduate thành một admission check hoặc render oracle + self-test — KHÔNG vá
  bằng cách thêm một dòng prompt. Đây là gốc của Working Agreement rule 1 và 3
  (xem [AI_CONTRACT.md](../../AI_CONTRACT.md) và [ADR-003](003-safety-grid-as-contract.md)).
- Admission gate là tuyến phòng thủ bảo mật duy nhất chặn AI output xấu/độc — nó
  phải solid (hiện có 9 fixture + 11 test, cover RCE bypass, computed-key
  evasion, host-RCE).
- Đa dạng hình ảnh không giới hạn, nhưng chất lượng/độ đúng layout dựa hoàn toàn
  vào safety grid N1–N30 chứ không vào bộ template được kiểm duyệt sẵn.
- Determinism là bắt buộc: scene là hàm thuần của frame (enforced bởi N5 + gate).
