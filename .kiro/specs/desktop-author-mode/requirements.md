# Requirements Document

## Introduction

Đây là spec đưa ứng dụng desktop (`apps/desktop`) **về đúng giá trị cốt lõi của
news_remotion_tool: pure AUTHOR mode** — và bổ sung **vòng agent tự-sửa
(self-repair)**.

Vấn đề: backend authoring hiện tại của desktop (`NineRouterAuthoringBackend`)
dùng **scene-kit** — 6 component `.tsx` viết sẵn (string), AI chỉ chọn `id` +
điền text/props. Đây thực chất là **PICK-mode / template** — đúng thứ mà toàn bộ
dự án sinh ra để LOẠI BỎ (AGENTS.md: "AI tự viết component Remotion mới cho MỖI
video... KHÔNG có PICK mode, KHÔNG có catalog template cố định"). Hệ quả: video
desktop không khác gì dùng template; `reauthor` chỉ đổi được chữ trong khung cố
định nên "sửa từng cảnh" vô nghĩa; và toàn bộ năng lực của safety grid + author
mode bị bỏ phí.

Đường engine (`npx tsx scripts/build-*.ts`, spec `author-mode-v2`) **vốn đã làm
pure AUTHOR**: AI viết `.tsx` mới → cổng admission (AST gate N4/N5) → render.
Desktop trước đây không chạy được vì Electron không nạp được `.tsx` lúc
registration handshake — rào cản đó **đã được gỡ** (esbuild loader runtime, đã
có trong code). Vì vậy pure AUTHOR trong desktop giờ khả thi, và là điều kiện để
`reauthor` trở thành self-repair thật (agent **viết lại CODE cảnh** để sửa lỗi,
không phải đổi chữ trong template).

Spec này gồm 2 trục:
1. **Realign authoring**: thay scene-kit bằng pure AUTHOR — AI viết `.tsx` mới
   mỗi cảnh theo `authoring-contract.md`, đi qua admission gate + grid như
   `author-mode-v2`.
2. **Agent self-repair**: hiện thực `reauthor` thật + phân loại lỗi
   (hạ-tầng vs nội-dung) + nút "Sửa bằng AI" để agent tự sửa lỗi nội dung/visual
   rồi render lại.

Phạm vi: chỉ `apps/desktop` + những seam tối thiểu trong `@news/pipeline`/`@news/mcp`
cần cho self-repair. KHÔNG sửa `math_video_tool`/`news_video_tool`. Giữ nguyên các
bất biến engine (single registry, draft-first, voice no-downgrade, captions,
determinism) và luồng Staged_Workspace đã có.

### Ràng buộc & giả định

- Render contract cố định: 30fps full / 10fps draft, 1080×1920 (9:16), `vi`.
- Determinism bắt buộc: scene là hàm thuần của frame (admission gate N5 + lint).
- TTS Vivibe qua `.env`/Settings; không hạ cấp giọng.
- AI được dẫn qua 9router (`/v1` local, model người dùng chọn — kể cả model
  `-agent`); không có API key engine riêng.
- Authored `.tsx` chạy CODE chỉ trong render context (Remotion) + được nạp cho
  handshake qua esbuild loader đã có.

## Glossary

- **Author_Backend**: backend authoring của desktop hiện thực `AuthoringBackend`
  (`apps/desktop/src/main/authoring/ninerouter-backend.ts`), drive bởi
  `CustomLoopAgentWorker`.
- **Pure_Author**: chế độ AI **viết mới mã `.tsx`** cho mỗi cảnh theo
  `Authoring_Contract`, KHÔNG chọn từ tập component cố định.
- **Authoring_Contract**: `.kiro/steering/authoring-contract.md` — export bắt
  buộc (`default`/`schema`/`example`), import whitelist (`react`, `remotion`,
  `@news/design`, `@news/blocks`, `@news/compositions`, `zod`), banned APIs
  (N5), blocks, layout zones, design language, captions trung tâm.
- **Admission_Gate**: `admitAuthoredComponent`/`admitProjectScenes` (AST N4/N5)
  + registration handshake (nạp `.tsx` qua esbuild loader runtime đã có).
- **Scene_Kit**: 6 component `.tsx` viết sẵn hiện tại (`starter-kit.ts`) —
  PICK-mode trá hình, sẽ được loại khỏi đường authoring production.
- **Safety_Grid**: N1–N30. Auto-run trên draft: N1–N13, N14, N16, N18–N22,
  N28–N30. Review-tier (xác nhận trước "done"): N24, N25.
- **Repair_Loop**: vòng generate-validate-repair (`repair-loop.ts`): render
  draft → đọc safety report → nếu lỗi nội dung còn → `reauthor(cảnh lỗi)` →
  render lại, tối đa `maxRepairAttempts`.
- **Reauthor**: thao tác agent **viết lại mã `.tsx`** của (các) cảnh bị gắn cờ
  từ một issue + mã hiện tại của cảnh đó. Hiện đang là NO-OP.
- **Infra_Error**: lỗi hạ tầng/môi trường (thiếu `.env`/loader, Chromium crash,
  network) — agent KHÔNG sửa được; phải báo người dùng.
- **Content_Error**: lỗi nội dung/visual của mã authored (admission N4/N5,
  typecheck N10, oracle render N14/N17/N18..., bố cục) — agent CÓ thể sửa.
- **Error_Classifier**: bộ phân loại một lỗi thành `Infra_Error` hay
  `Content_Error` để định tuyến xử lý.
- **AI_Fix_Action**: hành động người dùng bấm "Sửa bằng AI" trên màn lỗi → gửi
  Content_Error đã bắt cho agent reauthor + render lại.
- **Staged_Workspace**: luồng `ProjectStage` writing → script → rendering →
  ready → error (đã có).
- **Verify_Grid**: `npm run typecheck` + `npm test` (desktop) + `npm run build:renderer && npm run build:main`.

## Requirements

### Requirement 1: Desktop chuyển sang Pure_Author (loại Scene_Kit khỏi đường production)

**User Story:** Là người dùng tool, tôi muốn mỗi video desktop là mã cảnh
AI-viết-mới đa dạng theo chủ đề, để tool đúng bản chất AUTHOR mode chứ không phải
ghép template.

#### Acceptance Criteria

1. WHEN Author_Backend tạo kịch bản cho một dự án, THE AI SHALL được yêu cầu
   VIẾT MỚI mã `.tsx` cho từng cảnh theo Authoring_Contract, KHÔNG chọn từ một
   tập component cố định.
2. THE đường authoring production của desktop SHALL KHÔNG ghi/đăng ký các
   component từ Scene_Kit như lựa chọn mặc định; Scene_Kit SHALL bị loại khỏi
   đường này (giữ lại làm ví dụ/tham khảo ngoài production nếu cần, có ghi chú).
3. WHEN AI trả mã `.tsx`, THE Author_Backend SHALL ghi từng cảnh thành module
   `projects/<id>/authored/<scene>.tsx` và manifest tham chiếu các id đã đăng ký.
4. A scene id SHALL chỉ được manifest tham chiếu SAU khi module của nó qua
   Admission_Gate và đăng ký thành công (R-author-mode-v2 1.3).
5. THE prompt authoring SHALL truyền đạt đầy đủ Authoring_Contract: export bắt
   buộc, import whitelist, banned APIs, compose `@news/blocks`, layout zones,
   design language (cream/squared), captions sinh trung tâm, determinism.
6. THE Author_Backend SHALL KHÔNG âm thầm fallback về Scene_Kit/template khi
   author thất bại; thất bại SHALL được surface để retry hoặc AI_Fix_Action
   (xem R5/R6), vì fallback template sẽ phản bội mục tiêu pure-author.
7. THE hệ thống SHALL định nghĩa **AI_Output_Contract** — định dạng AI trả về
   trong MỘT reply gồm: với mỗi cảnh, một khối mã `.tsx` đầy đủ + metadata
   (component id, narration, eyebrow/headline nếu có, transitionToNext) + theme.
   THE parser SHALL trích được nhiều khối mã (chịu được code-fence/prose bao
   quanh), khớp mỗi khối với entry manifest qua component id, và từ chối (kèm lý
   do) nếu thiếu code cho một cảnh hoặc id không khớp.
8. THE `manifest-schema` (AuthorManifest) SHALL đổi `component` từ enum
   `KIT_COMPONENT_IDS` cố định sang **id mở (string hợp lệ)** do AI đặt, vì
   pure-author không còn tập id cố định.
9. WHERE Scene_Kit (`starter-kit.ts`) và `KIT_COMPONENT_IDS` không còn nằm trên
   đường authoring production, THE refactor SHALL hoặc gỡ bỏ chúng (cùng các
   import ở `prompt.ts`/`manifest-schema.ts`), hoặc giữ lại có ghi rõ lý do
   (vd ví dụ tham khảo) — KHÔNG để code chết mơ hồ (bài học reconcile R5).

### Requirement 2: Authored `.tsx` đi qua Admission_Gate trong Electron

**User Story:** Là người bảo trì, tôi muốn mã AI-viết được kiểm tĩnh + nạp được
trong app Electron, để pure-author chạy được ngoài đường `npx tsx`.

#### Acceptance Criteria

1. THE Admission_Gate SHALL chạy AST check (N4 import whitelist, N5 banned APIs,
   export bắt buộc, literal `registerComponent` id) trên mỗi authored `.tsx`.
2. WHEN registration handshake nạp một authored `.tsx` trong Electron main, THE
   hệ thống SHALL dùng loader runtime (esbuild) đã có để nạp được `.tsx`
   (không còn lỗi "Unknown file extension .tsx").
3. IF một authored `.tsx` vi phạm Admission_Gate, THEN nó SHALL bị từ chối kèm
   danh sách violations (check + message), và scene đó SHALL KHÔNG được render.
4. THE đường `npx tsx scripts/build-*.ts` (engine) SHALL không bị thay đổi hành
   vi bởi spec này.

### Requirement 3: Reauthor thật = self-repair theo mã

**User Story:** Là người dùng, tôi muốn khi một cảnh bị lỗi (tràn vùng, tương
phản kém, không qua admission/typecheck), agent TỰ VIẾT LẠI mã cảnh đó rồi render
lại, để vòng tự-sửa có ý nghĩa thật chứ không chỉ đổi chữ.

#### Acceptance Criteria

1. WHEN Repair_Loop gắn cờ một Content_Error ở (các) cảnh và còn lượt thử, THE
   Reauthor SHALL gửi cho AI: issue (loại lỗi + thông điệp), **mã `.tsx` hiện
   tại của cảnh đó**, và Authoring_Contract, để AI VIẾT LẠI mã cảnh đó.
2. WHEN AI trả mã cảnh đã sửa, THE Reauthor SHALL ghi đè module cảnh đó, chạy
   lại Admission_Gate cho nó, và (nếu đạt) để Repair_Loop render lại.
3. THE Reauthor SHALL chỉ viết lại CÁC cảnh bị gắn cờ, giữ nguyên các cảnh khác
   (sửa khu trú, không dựng lại toàn bộ).
4. THE Repair_Loop SHALL giới hạn số lần thử bằng `settings.maxRepairAttempts`
   và dừng ở report sạch (không còn Content_Error auto-detect) — giữ ngữ nghĩa
   Property 5 hiện có.
5. IF một cảnh sửa lại vẫn vi phạm Admission_Gate, THEN lần thử đó tính là thất
   bại và Repair_Loop tiếp tục/kết thúc theo budget (không crash).
6. THE Reauthor SHALL KHÔNG còn là NO-OP.
7. WHERE lỗi là oracle pixel/bố cục (N14 content-zone/caption-clearance, N18
   contrast/font), THE Reauthor SHALL đính kèm **ảnh still đã render của cảnh
   lỗi** cho một model đa phương thức (vision-guided repair), vì sửa mù chỉ-text
   sẽ không hội tụ cho lỗi bố cục/tương phản. WHERE model người dùng chọn không
   nhận ảnh, THE hệ thống SHALL degrade về repair chỉ-text kèm cảnh báo, không
   crash.
8. THE Reauthor SHALL phân giải `sceneId` → component id → đường dẫn module
   `projects/<id>/authored/<scene>.tsx` (đọc mã hiện tại) TRƯỚC khi yêu cầu AI
   viết lại; nếu không phân giải được file của cảnh lỗi, THE lần thử đó SHALL
   được báo là thất bại có lý do (không ghi nhầm cảnh khác).

### Requirement 4: Phân loại lỗi (Infra_Error vs Content_Error)

**User Story:** Là người dùng, tôi muốn lỗi do hạ tầng (thiếu key, Chromium
crash) được báo rõ cho tôi, còn lỗi do nội dung/visual thì để agent tự sửa, để
không lãng phí lượt agent vào thứ nó không sửa được.

#### Acceptance Criteria

1. THE Error_Classifier SHALL phân loại một lỗi render/author thành Infra_Error
   hoặc Content_Error dựa trên nguồn/stage của lỗi.
2. WHERE lỗi là Content_Error (admission N4/N5, typecheck N10, oracle render
   N14/N17/N18/N19/N20/N21/N22/N30, bố cục authored), THE hệ thống SHALL định
   tuyến cho Repair_Loop/Reauthor xử lý.
3. WHERE lỗi là Infra_Error (thiếu Voice_Config/`.env`, gateway/network, Chromium
   "Target closed", lỗi fs ngoài authored), THE hệ thống SHALL surface thông
   điệp đã redact cho người dùng kèm gợi ý khắc phục, và SHALL KHÔNG gửi cho
   agent reauthor (vì agent không sửa được).
4. WHEN một Infra_Error xuất hiện, THE thông điệp UI SHALL phân biệt rõ với lỗi
   nội dung (ví dụ tiêu đề/gợi ý khác nhau) để người dùng biết nên tự xử lý
   (kiểm tra key/khởi động lại) hay bấm "Sửa bằng AI".
5. THE đường render desktop SHALL chạy/surface typecheck (N10) trên mã authored
   để lỗi kiểu của mã AI-viết được bắt như Content_Error và đưa vào Reauthor —
   thay vì biểu hiện thành một crash bundle khó hiểu (Infra_Error giả).

### Requirement 5: Nút "Sửa bằng AI" trên màn lỗi

**User Story:** Là người dùng, khi gặp lỗi nội dung tôi muốn một nút gửi lỗi đó
cho agent tự sửa rồi dựng lại, để không phải tự mò.

#### Acceptance Criteria

1. WHERE stage hiện tại là `error` và lỗi là Content_Error, THE màn lỗi
   workspace SHALL hiển thị nút "Sửa bằng AI" (cạnh "Thử lại" / "Quay lại").
2. WHEN người dùng bấm "Sửa bằng AI", THE hệ thống SHALL gửi Content_Error đã
   bắt + ngữ cảnh cảnh cho agent (Reauthor) thử sửa, rồi chạy lại render, và
   cập nhật stage theo kết quả (rendering → ready/error).
3. WHERE lỗi là Infra_Error, THE nút "Sửa bằng AI" SHALL bị ẩn hoặc vô hiệu (vì
   agent không sửa được), chỉ hiện "Thử lại"/"Quay lại".
4. WHEN AI_Fix_Action đang chạy, THE UI SHALL hiển thị trạng thái đang xử lý
   (rendering/percent) và không cho bấm trùng.
5. THE thông điệp lỗi và mọi nội dung gửi/hiện qua IPC SHALL được redact (không
   lộ N-code/`.tsx`/đường dẫn nội bộ) theo bất biến R8.5 (reconcile).
6. THE AI_Fix_Action SHALL đi qua một kênh IPC chuyên biệt nằm trong allow-list
   (tương tự kênh `projects:retry` đã thêm), KHÔNG dùng kênh ad-hoc nằm ngoài
   danh sách cho phép.

### Requirement 6: Bảo toàn bất biến engine + luồng Staged_Workspace

**User Story:** Là người bảo trì, tôi muốn realign authoring không phá các đảm
bảo cốt lõi và trải nghiệm staged đã có.

#### Acceptance Criteria

1. THE hệ thống SHALL giữ Single_Registry (đúng một `createTools`) cho mọi tool
   call (R8.1 reconcile).
2. THE hệ thống SHALL giữ draft-first: full render chỉ sau khi có draft đã
   review (hoặc forceFull).
3. THE hệ thống SHALL giữ Voice_Config không hạ cấp giọng; thiếu cấu hình → báo
   đúng key/voice thiếu (Infra_Error).
4. THE luồng Staged_Workspace (writing → script → rendering %% → ready → error)
   SHALL giữ nguyên thứ tự/hành vi; pure-author + self-repair gắn vào các giai
   đoạn writing/rendering hiện có.
5. THE captions SHALL tiếp tục sinh trung tâm từ narration (không author trong
   props).
6. THE review-tier N24/N25 SHALL KHÔNG chặn cổng repair của DRAFT (đã tách); việc
   xác nhận chất lượng cuối thuộc bước duyệt cảnh ở stage `ready` (người dùng),
   hoặc một pass vision sau này (ngoài phạm vi spec này nếu chưa làm).

### Requirement 7: Độ tin cậy & khả năng phục hồi của Pure_Author

**User Story:** Là người dùng, tôi biết pure-author có thể fail nhiều hơn
template; tôi muốn mọi thất bại đều phục hồi được (retry/AI-fix) chứ không thành
ngõ cụt.

#### Acceptance Criteria

1. WHEN author hoặc render thất bại, THE Staged_Workspace SHALL vào stage `error`
   với thông điệp đã redact và LUÔN cung cấp đường phục hồi (Thử lại; và "Sửa
   bằng AI" nếu là Content_Error).
2. THE log terminal (main process) SHALL ghi chi tiết kỹ thuật của mỗi thất bại
   (author/admission/render/oracle) để gỡ lỗi, trong khi UI chỉ hiện bản đã
   redact.
3. THE Repair_Loop SHALL không bao giờ treo vô hạn: luôn dừng trong
   `maxRepairAttempts` và trả kết quả passed/exhausted.
4. WHERE nhiều lần thử vẫn fail, THE hệ thống SHALL báo người dùng rõ ràng (đã
   thử N lần) thay vì im lặng hoặc loop.
5. THE thiết kế SHALL tính tới chi phí/độ trễ: mỗi call author mang theo prompt
   lớn (toàn bộ Authoring_Contract). Để giới hạn chi phí, Reauthor SHALL chỉ gửi
   (các) cảnh bị gắn cờ — không gửi lại toàn bộ video — và tài liệu hoá kỳ vọng
   này để người dùng hiểu vì sao một lượt sửa tốn thời gian/định mức.

### Requirement 8: Verify sau mỗi Incremental_Step

**User Story:** Là người bảo trì, tôi muốn mỗi bước đều xanh để không bỏ dở app
ở trạng thái hỏng.

#### Acceptance Criteria

1. WHEN một Incremental_Step hoàn tất, THE Verify_Grid SHALL xanh
   (`npm run typecheck`, `npm test` desktop, `npm run build:renderer && npm run build:main`).
2. THE thay đổi đường authoring SHALL đi kèm test (prompt builder, reauthor
   contract, error-classifier) nơi logic thuần cho phép.
3. IF Verify_Grid đỏ sau một bước, THEN SHALL sửa trước khi sang bước kế.
4. THE bất biến hành vi đã có (preserved-invariants, client channel coverage,
   property tests P1–P10 của reconcile) SHALL tiếp tục pass.
