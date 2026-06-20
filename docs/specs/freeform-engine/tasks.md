# Tasks — Freeform Engine (cuộc "thay máu")

> Kế hoạch triển khai. Mỗi task map về `R*`/`D*` trong
> [requirements.md](requirements.md) và mục thiết kế trong [design.md](design.md).
> Thứ tự bám **§13 (A→K)** của design: mỗi nhóm chỉ bắt đầu khi nhóm phụ thuộc đã
> xanh (typecheck + test + build).
>
> Trạng thái: **A–I + K + L XONG** trên đường TikTok/freeform hiện tại. J
> (YouTube author-by-segment / true long-form main-video path) vẫn là khối riêng
> chưa làm.
>
> **Luồng refine đã CHỐT LẠI (theo phản hồi chủ dự án, ghi đè bản F cũ):** author
> bản "mù" → render stills bản-1 (nhàm, KHÔNG soi lỗi) → **1 lần "render lại cho
> sáng tạo hơn" trên MỌI cảnh** → render stills bản-2 → **vòng vision N pass** (số
> lần = `refinePasses`, dừng sớm khi 2 pass liên tiếp sạch) → CHỈ KHI ĐÓ mới dựng
> draft MP4 thật. Hai render đầu (bản-1 + bản-2 sáng tạo) ẩn hoàn toàn với người
> dùng. Đường **sửa cảnh / sửa toàn bộ sau draft** BỎ bước "sáng tạo bản-2", chỉ
> giữ vòng vision. (Chi tiết: Nhóm L1.)

## Quy ước

- **DoD chung mỗi task:** `npm run typecheck` + `npx tsx scripts/test.ts` +
  (nếu chạm render/blocks/composition) `npm run build` đều xanh. Working
  Agreement #1 (fix AI-output → fixture + vitest) và #5 (verify trước commit) áp.
- **UI = TẠM (chốt với chủ dự án):** mọi task `apps/desktop` renderer chỉ cần
  "đủ bấm được + nút chỉnh thô" để test nhanh — KHÔNG trau chuốt. Đẹp để sau.
- **Greenfield (D0):** không viết lớp tương thích project dọc cũ.
- **[KHỐI RIÊNG]** = YouTube author-by-segment, làm sau khi TikTok đường-mới xanh.

---

## Nhóm A — `@news/schema`: format & geometry (nền) — R7, D3

- [x] **A1. `geometry(format)` trong `zones.ts`.**
  - Thêm `type VideoFormat = "tiktok" | "youtube"`, `type FormatGeometry`, hàm
    `geometry(format): FormatGeometry`.
  - TikTok = 1080×1920, giữ NGUYÊN rect hiện có (contentZone/captionBand/uiReserve)
    → zero hồi quy dọc.
  - YouTube = 1920×1080, `captionBand: null`, `uiReserve {bottom:0,right:0}`,
    `contentZone` = toàn khung trừ `safeMargin` mỏng.
  - Giữ export cũ (`CANVAS`, `CONTENT_ZONE`, …) = `geometry("tiktok")` để không
    vỡ consumer trong lúc chuyển — xoá ở task cuối nhóm khi hết tham chiếu.
  - **Test:** `geometry("tiktok")` === hằng số dọc cũ (byte-for-byte rect);
    `geometry("youtube")` có canvas 1920×1080 + `captionBand===null`.

- [x] **A2. `VideoSpec.format` + `durationTier`.**
  - Thêm `format: VideoFormat` (BẮT BUỘC) và `durationTier` vào `VideoSpec`
    (`@news/schema`) + `LockedVideoSpec`.
  - `validateVideoSpecStructure`: spec thiếu `format` ⇒ hard error (greenfield).
  - **Test:** spec không `format` ⇒ invalid; spec hợp lệ cả 2 format ⇒ ok.

- [x] **A3. Consumer đọc geometry thay hằng số.**
  - `@news/blocks`, `@news/compositions`, oracle N14: thay import hằng số global
    bằng `geometry(spec.format)`. (Blocks lấy format qua context/prop — xem C.)
  - Xoá các export hằng số dọc trong A1 sau khi hết tham chiếu.
  - **Verify:** typecheck + build xanh.

---

## Nhóm B — `@news/theme` (xoá `@news/design`) — R1, D1/D2, T1/T3

- [x] **B1. Tạo gói `@news/theme`.**
  - Export `Theme` ĐÚNG shape `useTheme()` đang dùng (`colors`, `radius`, `fonts`,
    `surface`, `backdrop`) — MỘT theme trung tính: nền tối gần đen, chữ gần trắng,
    1 màu nhấn, bo vừa, font hệ thống.
  - Giữ **2 lớp phòng thủ** đã chứng minh: typed alias + Proxy fallback cho
    `colors` và `radius` (token lạ → màu/bo an toàn, không crash).
  - **Test:** port `theme-colors.test` + `theme-radius.test` sang — token lạ
    không bao giờ `undefined`/throw.

- [x] **B2. `@news/blocks` trỏ `@news/design` → `@news/theme`.**
  - Đổi mọi import; **API `useTheme()` KHÔNG đổi** ⇒ blocks chạy y nguyên.
  - **Verify:** typecheck + build; test blocks xanh.

- [x] **B3. Xoá hẳn `@news/design` (T1).**
  - Gỡ package + mọi tham chiếu còn lại (admission import-whitelist, doctor,
    contract-text, prompt). Grep `@news/design` = 0 hit.
  - **Verify:** typecheck + test + build xanh.

---

## Nhóm C — composition + oracle theo format — R2, D7/D8

- [x] **C1. `VideoComposition` theo `spec.format`.**
  - TikTok: y nguyên (TransitionSeries + `<Captions>` + `CaptionDivider`).
  - YouTube: KHÔNG mount caption/divider. Lưu ý: true 16:9 main-video render vẫn
    thuộc Nhóm J; phần đã xong ở đây là caption behavior + shared composition
    fallback, không phải production long-form YouTube.
  - Error-boundary per-scene giữ.
  - **Test:** render fixture mỗi format không throw; YT không có caption track.

- [x] **C2. Gộp N14 → `checkInFrame(frame, geometry)` (D7, O5).**
  - Một oracle bắt nội dung tràn HẲN ngoài canvas (ngoài `safeMargin` ring), theo
    format. **Severity = warning**. Bỏ 4 biến thể divider/clearance cũ.
  - Giữ self-test (fire khi tràn, pass khi sạch) cho cả 2 format.

- [x] **C3. Rà severity oracle còn lại.**
  - Đảm bảo chỉ lớp chống-vỡ (N2/N9/N11/N12/N13/N16/dup-id/empty) là `error`;
    còn lại warning. Cập nhật test severity.

---

## Nhóm D — đường stills nhanh — R4/R5

- [x] **D1. `renderProjectStills(projectId, {sceneIds?, signal})` (`@news/pipeline`).**
  - admit → `lockSpec(spec, null, {fps})` (no-TTS) → `renderSceneStills(locked,
    reviewDir, {sceneIds})`. BỎ Vivibe/MP4/oracle-nặng/review.
  - **Test:** chạy ra đúng N PNG; truyền `sceneIds` ⇒ chỉ render tập con; KHÔNG
    gọi TTS.

- [x] **D2. `renderSceneStills` nhận `sceneIds?`.**
  - Lọc scene theo danh sách; bundle vẫn 1 lần. (R5.3 → R4.3.)
  - **Test:** 1 id ⇒ 1 PNG.

- [x] **D3. MCP `render_stills` + backend `renderStills`.**
  - Thêm tool `render_stills(projectId, sceneIds?)`; `AuthoringBackend.renderStills`.
  - **Test:** tool trả danh sách stills; tôn trọng sceneIds.

---

## Nhóm E — vá reply cắt cụt cho reauthor — R3.3 (độc lập, làm sớm)

- [x] **E1. Port nối-reply (`finish_reason:"length"`) sang đường reauthor.**
  - `parseReauthorReply` / `chatWithVisionFallback`: khi reply đứt giữa block →
    gọi tiếp "viết tiếp từ chỗ dừng", nối đến khi có fence đóng hợp lệ. Cùng cơ
    chế đường author đã có.
  - **Test (Working Agreement #1):** fixture = reply đứt giữa hàm SVG (như log
    `scene-03`) → sau nối ⇒ parse ok 1 block đúng id. (regression vĩnh viễn)

---

## Nhóm F — refine ngầm N-pass — R4/R6 (phụ thuộc D, E)

- [x] **F1. `withVisualQa` dùng stills + lặp N pass + dừng sớm.**
  - Đổi `renderDraft`→`renderStills(scope)`; vòng `for pass in 1..refinePasses`;
    `break` khi QA hết defect high (R4.5). Pass-1 intent "táo bạo/đẹp hơn",
    pass-2+ "nhìn lỗi sửa lỗi" (R4.4). Accept-gate + snapshot/restore giữ (R3.2).
  - **Test:** mock QA trả [defect, rồi rỗng] ⇒ dừng ở pass 2; QA luôn rỗng ⇒ dừng
    ngay pass 1; reauthor lỗi ⇒ giữ bản cũ.
  - ⚠ **Bị Nhóm L1 thay thế một phần:** hiện refine chạy SAU draft MP4 (gây "đứng
    100%" — vấn đề #6) và dừng ngay pass-1-rỗng (không có "sáng tạo bản-2"). L1 đảo
    lại theo luồng đã chốt.

- [x] **F2. `refinePasses` vào `SettingsModel` (default 2, clamp 0–5).**
  - `visualQaEnabled` cũ ⇒ `refinePasses>0`. UI: ô số + cảnh báo "tốn quota + lâu".
  - **Test:** clamp 0–5; default 2.

- [x] **F3. ~~Nối refine ngầm vào luồng author~~ → superseded bởi Nhóm L1.**
  - Quyết định cũ "dừng ở F1" nay được thay bằng luồng refine đã CHỐT LẠI (xem đầu
    file + L1): stills bản-1 → sáng tạo bản-2 → vòng vision → MỚI dựng MP4. F3 cũ
    (chỉ "chạy refine trước stage ready") không còn đủ — L1 là bản đầy đủ.

---

## Nhóm G — format/tier/title/titleLang vào schema + prompt + UI — R7/R9, D10

- [x] **G1. Schema: `format`, `durationTier`, `videoLanguage`.**
  - `authorManifestSchema` + `CreateInput`: thêm 3 field (backend tiêm format/tier,
    không để model chọn format). Bỏ `stylePackId/accentColor`.
  - Title rule theo format: TikTok `<100` + hashtag; YouTube `<200`.
  - **Test:** coercion + cap ký tự; videoLanguage ∈ {vi,en}; legacy mix → vi.

- [x] **G2. Prompt builder de-style + theo format + ngân sách-từ theo tier.**
  - Bỏ mọi câu "đọc theme/style". Tiêm format (khung + có/không caption), tier
    (ngân sách từ từ calib §K), videoLanguage (toàn bộ nội dung video).
  - **Test:** `prompt.test` cập nhật — không còn chuỗi style/news cứng; có ngân
    sách-từ theo tier.

- [x] **G3. UI tạm: chọn format + mức thời lượng + ngôn ngữ title.**
  - Các nút chọn ở màn create: TikTok/YouTube; 3 mức; vi/en; Vivibe/ElevenLabs.
    KHÔNG style đẹp. (D-UI tạm.)

---

## Nhóm H — tên dự án = title + đổi tên + copy — R9, D9

- [x] **H1. Tên hiển thị = title (giữ id thư mục).** (chốt với chủ dự án: tên
  HIỂN THỊ = `manifest.title`, KHÔNG đổi id thư mục — id đã unique nhờ uuid8 nên
  "trùng → hậu tố" tự thỏa.) `ProjectSummary.title` đọc từ `manifest.json` ở
  `listProjects`; `gallery-controller.titleOf` ưu tiên title hơn prompt thô.
  - **Test:** store surfaces manifest title (trimmed; blank/absent ⇒ omit);
    gallery card ưu tiên title.

- [x] **H2. Đổi tên dự án (IPC + manifest).**
  - Channel `projects:rename` + `DashboardApi.projects.rename` + preload +
    handler; `WorkspaceController.rename` load-merge-write `manifest.title`
    (manifest là single source of truth, không denormalize vào brief); re-emit
    published stage để Copy panel cập nhật live. UI tạm: nút bút chì trên card.
  - **Test:** rename ghi đúng title (clamp/trim), giữ scenes; empty ⇒ no-op;
    published stage cập nhật title.

- [x] **H3. Màn cuối copy title + hashtag.**
  - `hashtags` tách RIÊNG khỏi title (title sạch = tên dự án): schema coercion
    (string/array → `["#..."]`, cap 6) + fixture; prompt yêu cầu field riêng;
    `Manifest`/`toEngineManifest` mang hashtags; stage `published` mang
    `title`+`hashtags`; UI panel + nút Copy (R9.5).
  - **Test:** coercion fixture (mọi shape + bad value degrade); prompt-wording
    (field riêng, không nhồi vào title).

---

## Nhóm I — phân trang + BGM + thumbnail (cả 2 format) — R10/R11/R12

- [x] **I1. Phân trang dự án (12/trang, lưới 3×4) (O3).**
  - IPC `listProjects(page, pageSize=12)`; renderer giữ trang + tổng; nút trang.
  - **Test:** slice trang đúng; 13 dự án ⇒ 2 trang.
  - *Đã làm:* phân trang phía renderer (helper `paginate` thuần, 12/trang) thay vì
    truyền `(page,pageSize)` xuống store — store vẫn đọc mọi brief để sort, và poll
    1.5s sẽ nhấp nháy nếu phân trang ở backend. Pager footer "Trang x/y · N dự án".

- [x] **I2. Thư viện BGM theo máy + chọn/thêm/xoá (O4).**
  - Thư mục `VIDEO_TOOL_HOME/.video-tool/bgm/` (`.mp3/.m4a/.wav`); dự án lưu ref.
    Render có ref ⇒ mix (đường mix `@news/tts` đã có); không ⇒ không nhạc.
  - UI tạm: list + thêm + xoá. **Test:** thêm/xoá cập nhật thư viện; ref vào lock.
  - *Đã làm:* store `bgm-library.ts` (list/add/remove/resolve, collision-safe,
    chống path-traversal) + 8 test; field `bgm` trên manifest; ref được resolve ở
    **ranh giới MCP render-tool** (`resolveProjectBgm` → opt `bgmPath`) nên
    orchestrator off-limits (ADR-002) không đổi. IPC `bgm:*` + picker `<select>`
    trong header StoryboardView (đặt nhạc TRƯỚC khi duyệt bản full).

- [x] **I3. Thumbnail / cover cho CẢ HAI format (D12).**
  - Cover/thumbnail là **brand card sạch** cho cả TikTok 9:16 và YouTube 16:9:
    theme wash + publish title, KHÔNG dùng frame cảnh thật làm nền và KHÔNG có
    scene picker. Lý do: overlay title lên scene text-heavy gây chồng 2 khối text.
  - *Đã làm:* composition `Thumbnail` format-aware (canvas theo `geometry(format)`
    ở `Root.tsx`); `renderThumbnail()` qua `selectComposition("Thumbnail")` +
    `renderStill` frame cuối → `review/thumbnail.png` (KHÔNG đụng orchestrator/
    `NewsVideo`); IPC `thumbnail:generate` + panel ở stage published (xem/tạo lại).
    **Test:** `render-thumbnail.test.ts` (TikTok/YouTube đều không có
    `bgImageSrc`, output `review/thumbnail.png`) + client coverage.

---

## Nhóm K — calib Vivibe — R5.4, D13 (độc lập)

- [x] **K1. Script đo tốc độ đọc.**
  - Gửi vài đoạn độ dài biết trước qua Vivibe, đo giây thật → `từ/giây` trung bình.
    Lưu hằng số calib vào config; prompt/ước-cảnh dùng nó (thay 4.7 hard-code).
  - **DoD:** sai số ước thời lượng ≤ 20s trên một video thử mỗi tier.
  - *Đã làm (cơ chế):* `scripts/calibrate-voice.ts` (gửi 5 đoạn VN cố-định qua
    `VivibeClient.synthesize` → `measureAudioDuration` → `computeWordsPerSecond`
    trung-bình-có-trọng-số Σtừ/Σgiây, clamp [2,8]) ghi `voiceWordsPerSecond` +
    `voiceWpsCalibratedFor` vào settings JSON. `prompt.ts` tham-số-hoá hết
    `WORDS_PER_SECOND` (cả `tierBudgetBlock` lẫn `contentRules`, default
    `DEFAULT_WORDS_PER_SECOND`=4.7); backend đọc `settingsStore.calibratedWordsPerSecond()`
    (bỏ qua rate đo cho voice KHÁC voice hiện tại) → `buildAuthorMessages`.
    **Test:** calib math + clamp + prompt dùng rate inject. *Chờ chạy thật:* số
    calib mỗi tier đợi đo qua Vivibe (cần quota + voice cấu hình).

---

## Nhóm J — [KHỐI RIÊNG] YouTube author-by-segment — R7.5, D5, T2

> Chỉ bắt đầu khi A–I (TikTok đường-mới) đã xanh + chạy thật ổn.

- [ ] **J1. Cap scenes theo format.**
  - Parser hiện chỉ giữ floor `min(3)` và không có upper cap. J cần quyết định
    lại cap/validation theo format+tier cho YouTube segment manifests (nếu cần),
    không giả định TikTok còn `max(14)`.

- [ ] **J2. Outline pass.**
  - 1 call text: model sinh dàn ý N đoạn (chủ điểm + ngân sách từ/đoạn).
  - **Test:** parser outline; tổng ngân sách ≈ tier.

- [ ] **J3. Segment authoring + ghép manifest (O2).**
  - Mỗi đoạn 8–12 cảnh author riêng → parse → admit; id liên tục toàn cục. Ghép ở
    TẦNG MANIFEST (nối scenes+modules → 1 spec), KHÔNG concat MP4.
  - **Test:** 3 đoạn → 1 spec id `scene-01..NN` liên tục, admit hết.

- [ ] **J4. Tối ưu render YT (R5.5, mục tiêu liên tục).**
  - Refine chỉ cảnh gắn cờ; cảnh báo quota + thời gian; (mở) song song stills.

---

## Nhóm L — vá phản hồi test thực tế (ƯU TIÊN HIỆN TẠI)

> 6 vấn đề chủ dự án gặp khi test bản A–G. L1 là LÕI (đảo luồng refine theo bản
> đã chốt + thay F3 cũ); L2–L6 độc lập, làm song song được. Mọi thay đổi tuân
> **SOLID** (mỗi seam một trách nhiệm; bơm phụ thuộc qua `WorkspaceDeps`/`ToolDeps`,
> không nhồi vào god-file). `orchestrator.ts` + `render-grid.ts` off-limits (ADR-002).

- [x] **L1. Đảo luồng refine: stills-bản-1 → sáng-tạo-bản-2 → vision N-pass → MỚI draft MP4.**
  - **Nguyên nhân (verify):** `runRender` ([workspace-controller.ts:743-750](../../../apps/desktop/src/main/workspace/workspace-controller.ts#L743-L750))
    chạy `generateValidateRepair` (draft MP4, progress chạy tới 100%) RỒI mới
    `withVisualQa` (render stills + vision) → giai đoạn "đứng 100%" chính là vision
    chạy SAU render (vấn đề #6). Đúng thiết kế R4.1/R6.1: refine PHẢI chạy TRƯỚC MP4.
  - **Luồng mới** (đường author lần đầu, `runRender`):
    1. author bản "mù" (đã có) → `renderStills` TẤT CẢ cảnh (bản-1, KHÔNG soi lỗi).
    2. **1 lần "sáng tạo bản-2"**: reauthor MỌI cảnh với intent "làm táo bạo/đẹp hơn"
       (KHÔNG cần vision cờ lỗi) → `renderStills` lại tất cả (bản-2). Accept-gate +
       snapshot/restore giữ (cảnh không render được → khôi phục, R3.2/R4.7).
    3. **Vòng vision N-pass** (`refinePasses`): mỗi pass `visualQa` → reauthor cảnh
       bị cờ → `renderStills` cảnh đó. Dừng sớm theo L4 (2 pass liên tiếp sạch).
    4. **CHỈ KHI ĐÓ** `generateValidateRepair` (TTS + draft MP4 + grid) MỘT lần →
       stage `ready`. Đây là MP4 đầu tiên tồn tại.
  - **Đường sửa-cảnh / sửa-toàn-bộ sau draft (`runSceneEdits`)**: BỎ bước "sáng tạo
    bản-2" (bước 2); chỉ giữ vòng vision (bước 3) trên cảnh liên quan + draft lại.
    → tách rõ "creative bootstrap" (chỉ lần đầu) khỏi "vision QA" (mọi lần).
  - **SOLID:** tách hàm riêng `creativeBootstrapPass(projectId, sceneIds, signal)`
    (bước 2) khỏi `withVisualQa` (bước 3) — mỗi hàm một trách nhiệm; `runRender` gọi
    cả hai, `runSceneEdits` chỉ gọi `withVisualQa`.
  - **Test:** lần đầu ⇒ thứ tự gọi = renderStills, reauthor-all, renderStills,
    [visionN], generateValidateRepair (MP4 sau cùng); sửa-cảnh ⇒ KHÔNG có
    reauthor-all; reauthor bản-2 lỗi ⇒ giữ bản-1.

- [x] **L2. Background mặc định cho cả 2 format.**
  - **Nguyên nhân (verify):** composition đặt `backgroundColor: theme.colors.bg`
    (#0E0F13, gần đen) ([video.tsx:90](../../../packages/compositions/src/video.tsx#L90));
    có sẵn `sceneBackground(theme)` tạo radial-gradient ([theme.ts:481](../../../packages/theme/src/theme.ts#L481))
    nhưng KHÔNG dùng → nền trơ đen ở cả TikTok lẫn YouTube.
  - Đổi backdrop gốc của composition sang một wash mặc định (dùng `sceneBackground`
    hoặc tương đương) áp cho cả 2 format; cảnh tự vẽ nền vẫn đè lên như cũ.
  - **SOLID:** wash là 1 hàm thuần trong `@news/theme` (đã có) — composition chỉ
    tiêu thụ, không tự chế màu. Giữ determinism (N16): hàm thuần theo dominant.
  - **Test:** composition render ra nền KHÁC `colors.bg` trơ (có gradient) ở cả 2
    format; vẫn deterministic (render 2 lần = bytes giống — N16 không vỡ).

- [x] **L3. Loading status: hiện vòng vision thứ mấy + ẩn 2 render đầu.**
  - **Nguyên nhân (verify):** `ProjectStage.rendering.phase` có `"qa"` nhưng KHÔNG
    mang số pass ([types.ts:182](../../../apps/desktop/src/shared/types.ts#L182)).
  - Thêm thông tin pass vào stage QA: `phase:"qa"` + `qaPass?: number` +
    `qaTotal?: number` → UI hiện "Đang soát lỗi hình ảnh (lần 2/5)…".
  - **Ẩn 2 render đầu** (stills bản-1 + sáng-tạo bản-2 của L1): trong 2 giai đoạn
    này KHÔNG đẩy stage hiển thị tiến trình render cho user (giữ `writing` hoặc một
    phase trung tính "Đang dựng bản nháp…") — để AI có không gian sáng tạo, user
    không thấy bản thô. Chỉ vòng vision + draft cuối mới hiện chi tiết.
  - **SOLID:** mở rộng kiểu `ProjectStage` (open/closed) + map ở renderer; không
    đụng logic điều phối.
  - **Test:** stage QA mang đúng `qaPass/qaTotal`; 2 render đầu KHÔNG phát stage
    `rendering` chi tiết.

- [x] **L4. Early-stop "2 pass liên tiếp sạch" + toggle Settings.**
  - **Nguyên nhân (verify):** hiện `break` ngay khi 1 pass đầu rỗng
    ([workspace-controller.ts:638](../../../apps/desktop/src/main/workspace/workspace-controller.ts#L638)).
    Chủ dự án muốn yêu cầu MẠNH hơn: 2 pass liên tiếp sạch mới dừng (đỡ bỏ sót), và
    có toggle bật/tắt để tiết kiệm quota.
  - Thêm `refineEarlyStop: boolean` (default true) vào `SettingsModel` +
    `settings-model.ts` + `SettingsStore` getter + UI toggle. ON ⇒ dừng khi đếm
    được 2 pass-sạch liên tiếp; OFF ⇒ chạy đủ `refinePasses`.
  - **SOLID:** cờ đọc qua `WorkspaceDeps.settings` (đã có pattern `refinePasses`);
    logic đếm nằm gọn trong `withVisualQa`.
  - **Test:** ON + QA [sạch, sạch] ⇒ dừng sau pass 2; ON + [sạch, lỗi, sạch, sạch]
    ⇒ dừng sau pass 4; OFF ⇒ chạy đủ N; default true.

- [x] **L5. Fix sync danh sách dự án sau create/render.**
  - **Nguyên nhân (verify):** `brief.json` được ghi NGAY ở `scaffoldVideoProject`
    ([orchestrator.ts:120](../../../packages/pipeline/src/orchestrator.ts#L120)) và
    `listProjects` chỉ cần `existsSync(brief)` ([store.ts:202](../../../packages/pipeline/src/store/store.ts#L202))
    → dự án CÓ trong list ngay. Vấn đề ở UI: gallery chỉ refresh khi rời workspace /
    lúc mount ([App.tsx:112-120,149-153](../../../apps/desktop/src/renderer/App.tsx#L112-L120)),
    KHÔNG poll → trễ/không hiện.
  - Refresh gallery NGAY sau `create` (trước khi vào workspace), và poll danh sách
    định kỳ khi ở màn home (giống poll stage), hoặc refresh khi `status` event báo
    đổi. Đảm bảo card hiện ngay + cập nhật trạng thái live.
  - **SOLID:** giữ `refreshGallery` là một nguồn refresh duy nhất; thêm trigger
    (poll/event) gọi nó, không nhân bản logic đọc list.
  - **Test (renderer-thuần nếu được):** sau create, danh sách chứa project mới;
    event `status` → gallery cập nhật trạng thái.

- [x] **L6. Tách rõ pipeline thumbnail vs video chính (chống xung đột).**
  - **Hiện trạng (verify):** `renderProjectStills`/`renderSceneStills` ĐÃ
    format-agnostic (render theo `spec.format`, 1 code path) — stills ghi `review/`,
    MP4 ghi `renders/` (đã tách thư mục). 9:16 KHÔNG thiếu cơ chế thumbnail.
  - Việc cần: (a) xác nhận 9:16 stills chạy đúng end-to-end qua app (không chỉ test);
    (b) đảm bảo render-stills (refine) và render-MP4 (draft/full) KHÔNG chạy chồng
    cho cùng project — đã có `inFlight` guard ([workspace-controller.ts:164](../../../apps/desktop/src/main/workspace/workspace-controller.ts#L164)),
    verify nó bao trùm đường stills mới của L1; (c) nhãn rõ trong UI/log đâu là
    thumbnail, đâu là video.
  - **SOLID:** không trộn trách nhiệm — `renderStills` (xem trước) tách hẳn
    `render_draft/full` (xuất bản); guard đảm nhiệm loại trừ lẫn nhau.
  - **Test:** 9:16 + 16:9 đều sinh PNG review; guard chặn 2 job song song 1 project.

---

## Thứ tự thực thi gợi ý

0. **A–I + K + L XONG** cho TikTok/freeform path.
1. **J** (YouTube author-by-segment / true long-form main-video) — khối riêng,
   sau cùng.

Mỗi nhóm xanh (typecheck+test+build) mới sang nhóm sau; commit gọn theo nhóm.
