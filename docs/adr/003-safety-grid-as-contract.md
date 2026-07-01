# ADR-003 — Safety grid là contract boundary, không vá bằng prompt

- **Status**: Accepted (2026-06-14).

## Context

Pattern bệnh lý đo được trong git: 12 commit `fix(authoring)` liên tiếp trong 90
ngày, mỗi commit thêm một rule mới vào prompt khi AI sinh ra một thứ sai. Đây là
"prompt engineering by commit": prompt phình ra, không có regression guard, và
một AI khác (qua 9router serve 15 provider) có thể không tuân prompt đó — lỗi tái
phát ở model khác.

Một rule trong prompt là **lời cầu xin** AI cư xử đúng. Một check/normalizer là
**sự ép buộc** ở ranh giới hệ thống, áp cho mọi model bất kể nó có đọc prompt hay
không.

## Decision

Mỗi class defect do AI sinh ra phải được xử lý ở đúng tầng, theo thứ tự ưu tiên:

1. **Schema validation (Zod)** — nếu là lỗi shape (manifest field sai kiểu,
   thiếu field, sai enum). `generateObject` của Vercel AI SDK validate + retry tự
   động (xem [ADR-005](005-library-adoption-strategy.md)).
2. **Normalizer** — nếu là lỗi cú pháp/giá trị sửa được cơ học (Extrapolate
   rewrite, interpolate→interpolateColors, font-size clamp, import normalize).
3. **Admission gate / render oracle** — nếu là lỗi tĩnh (banned API, import
   ngoài whitelist) hoặc lỗi layout pixel (N14 overflow).
4. **Prompt rule** — **phương án cuối**, chỉ khi không tầng nào trên áp được.

Mọi check mới ship kèm một **non-vacuous self-test**: một fixture known-bad chứng
minh check thực sự fire.

## Consequences

- **Working Agreement rule 1**: không `fix(authoring)` commit nào được merge nếu
  không kèm fixture trong `__fixtures__/` + vitest case.
- **Working Agreement rule 3**: trước khi thêm prompt rule, phải tự hỏi
  schema/normalizer/gate có đúng chỗ hơn không.
- Khi user nói "thêm rule chống lỗi X", agent phải hỏi tầng nào đúng trước khi
  đụng prompt (Section G của plan).
- Prompt giữ được kích thước, không phình theo mỗi edge case.
- Chi phí: viết một check + self-test tốn hơn thêm một dòng prompt — nhưng đó
  chính là khoản trả nợ kỹ thuật, không phải vay thêm.
