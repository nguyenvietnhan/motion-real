# Design — Freeform Engine (cuộc "thay máu")

> Tài liệu thiết kế. Map thẳng từng `R*`/`D*` trong [requirements.md](requirements.md)
> vào kiến trúc + file cụ thể. Mọi đường dẫn/hàm dưới đây là CÓ THẬT trong repo
> (đã đọc), không phải giả định.
>
> Trạng thái: **ĐÃ TRIỂN KHAI PHẦN LỚN CHO ĐƯỜNG TIKTOK**. A–I + K + L đã vào
> repo; J (YouTube author-by-segment / true long-form main-video path) vẫn
> pending. File này là design record + roadmap, không phải mô tả mọi mục đã
> hoàn tất.

---

## 0. Nguyên tắc kiến trúc của đợt thay máu

1. **Format là tham số, không phải hằng số.** Mọi thứ trước đây đóng đinh "9:16
   dọc" (canvas, zones, caption band, oracle) trở thành hàm của `format`.
2. **A.I tự do hình ảnh; hệ thống chỉ giữ "khung sống".** Engine không còn áp
   look; chỉ còn lớp chống-vỡ + một oracle "không-bay-khỏi-khung" theo format.
3. **Self-heal là mặc định, không phải tính năng.** Một cảnh hỏng → fallback;
   một bản refine tệ → không nhận. Video LUÔN ra, KHÔNG BAO GIỜ thụt lùi.
4. **Refine ngầm bằng đường rẻ nhất.** Vòng nhìn-sửa chạy trên *stills* (1 PNG),
   không TTS, không MP4, không oracle nặng — người dùng chỉ thấy bản đã đẹp.
5. **TikTok và YouTube tách luồng author.** TikTok one-shot (như cũ); YouTube
   author-theo-đoạn. Chung engine render, khác chiến lược sinh kịch bản.

---

## 1. Bản đồ gói (cái gì đổi)

| Gói | Hiện tại | Sau thay máu |
| --- | --- | --- |
| `@news/schema` | `CANVAS`+zones dọc vẫn giữ cho back-compat ([zones.ts](../../packages/schema/src/zones.ts)) | **`geometry(format)`** trả canvas+zones theo `"tiktok"\|"youtube"`. `VideoSpec` mang `format`. |
| `@news/design` | hệ style đa-ngôn-ngữ (core/languages/style-packs) | **XOÁ**. Thay bằng `@news/theme` — một theme trung tính DUY NHẤT (D1). |
| `@news/blocks` | từng là layout toolkit đọc `useTheme()` của design | giờ là runtime nội bộ + `SceneImage`; layout blocks bị xoá khỏi authored whitelist. |
| `@news/compositions` | composition dọc + caption overlay luôn bật | composition **theo format**: caption/karaoke chỉ ở TikTok (D8); error-boundary giữ. |
| `@news/tts` | client Vivibe | + **calib** đo tốc độ đọc (D13). |
| `@news/pipeline` | orchestrator render MP4 qua single process | + **đường stills nhanh** (no-TTS/no-MP4), BGM handoff, thumbnail brand-card, title/hashtag fields; **author-by-segment (YT)** vẫn pending J. |
| `@news/mcp` | `render_draft/full/...` | + `render_stills` (tập-con scene). |
| `apps/desktop` | UI chọn style, tên dự án = prompt | chọn **format+mức thời lượng+ngôn-ngữ-title**; tên = title; phân trang; BGM UI; refine ngầm. |

> **D0 greenfield:** không viết lớp tương thích cho project dọc cũ. `format` là
> field BẮT BUỘC của spec mới; spec cũ thiếu nó ⇒ không mở (chấp nhận).

---

## 2. Format & Canvas (R7, D3) — phần lõi

### 2.1. `@news/schema`: zones thành hàm

`zones.ts` hiện export `CANVAS`, `CONTENT_ZONE`, `CAPTION_BAND`, `UI_RESERVE` là
hằng số dọc. Thay bằng:

```ts
export type VideoFormat = "tiktok" | "youtube";

export type FormatGeometry = {
  format: VideoFormat;
  canvas: { width: number; height: number };
  contentZone: Rect;
  captionBand: Rect | null;   // null ⇒ KHÔNG có caption band (YouTube, D8)
  uiReserve: { bottom: number; right: number };
  safeMargin: number;          // tỉ lệ ring "bay khỏi khung" cho oracle (O5)
};

export function geometry(format: VideoFormat): FormatGeometry;
```

- **TikTok** = 1080×1920, giữ NGUYÊN các rect hiện có (contentZone/captionBand/
  uiReserve) — zero hồi quy cho dọc.
- **YouTube** = 1920×1080, `captionBand: null`, `uiReserve` ~0 (YT không overlay
  UI lên video), `contentZone` = gần toàn khung trừ một safe-margin mỏng.

> Vì `@news/schema` là tầng đáy (không import design), đây là chỗ ĐÚNG để đặt
> hình học. Mọi consumer (blocks, composition, oracle N14) đọc `geometry(spec.format)`
> thay vì hằng số global → một nguồn sự thật, không drift.

### 2.2. `VideoSpec`/manifest mang `format`

- `authorManifestSchema` ([manifest-schema.ts:77](../../apps/desktop/src/main/authoring/manifest-schema.ts#L77))
  thêm `format` + `durationTier`. **Nhưng** model KHÔNG tự chọn format — người
  dùng chọn ở UI; backend tiêm vào manifest sau khi parse (giống cách tiêm theme
  hiện tại). Model chỉ lo nội dung.
- `authorManifestSchema.scenes` hiện `min(3)` và không còn upper cap; YouTube
  vẫn cần chiến lược author-by-segment riêng ở §6 vì one-shot 60–100 cảnh vẫn dễ
  vỡ reply dù schema không chặn.

### 2.3. Composition theo format

`VideoComposition` ([video.tsx](../../packages/compositions/src/video.tsx)) đọc
`spec.format`:
- TikTok: y như hiện tại (TransitionSeries + `<Captions>` + `CaptionDivider`).
- YouTube: KHÔNG mount `<Captions>`/`CaptionDivider`. Lưu ý hiện trạng: true
  16:9 main-video render chưa là production path; `Thumbnail` đã format-aware,
  còn long-form/main-video YouTube thuộc Nhóm J.
- Error-boundary per-scene (đã có) giữ nguyên cho cả hai.

---

## 3. Gỡ `@news/design` → `@news/theme` trung tính (R1, D1/D2)

### 3.1. Vì sao không xoá trắng blocks

`@news/blocks` vẫn có runtime internals (`Captions`, `LayoutProbe`, timing,
motion, fonts/chrome helpers, `SceneImage`) đọc `useTheme()`. Xoá design mà giữ
runtime ⇒ phải có MỘT theme để runtime không vỡ. Nên:

- Tạo `@news/theme`: export `Theme` (cùng SHAPE `useTheme()` đang dùng:
  `colors`, `radius`, `fonts`, `surface`, `backdrop`) nhưng chỉ **một** giá trị
  trung tính: nền tối gần đen, chữ gần trắng, **1 màu nhấn** mặc định, bo góc vừa,
  font hệ thống. Giữ luôn **2 lớp phòng thủ** đã chứng minh (typed alias +
  Proxy fallback) cho `colors` và `radius` để token lạ không bao giờ crash render.
- `@news/blocks` đổi import `@news/design` → `@news/theme`. **API `useTheme()`
  không đổi** ⇒ runtime internals (`Captions`, `SceneImage`, probes, fonts,
  chrome helpers) chạy y nguyên, chỉ "mặc đồ trung tính".

### 3.2. A.I được phủ định hoàn toàn (D2 — amended)

- Contract authoring bỏ mọi câu "đọc màu/bo/surface từ theme". Thay bằng: *"Bạn
  tự quyết toàn bộ màu/nền/bố cục trong code cảnh và viết JSX/SVG/CSS tay 100%."*
- Authored scenes KHÔNG còn được import `@news/blocks`/`@news/theme`. `SceneImage`
  là ngoại lệ duy nhất, import qua `@news/compositions`.
- Một cảnh hợp lệ = chỉ cần qua admission (import whitelist + export đúng) + render
  được. KHÔNG còn ràng buộc look.

### 3.3. UI bỏ chọn style (R1.5)

- `CreateInput.stylePackId/accentColor` ([types.ts:82](../../apps/desktop/src/renderer/state/desktop-state.test.ts))
  → bỏ. `StylePackVM` + picker style → xoá. Thay bằng **chọn format + mức thời
  lượng + ngôn ngữ title** (§7).

> **O1 chốt:** theme trung tính là **hằng số cứng** trong đợt này (1 màu nhấn mặc
> định). Cho người dùng chỉnh màu nhấn = mục NICE-TO-HAVE, để sau — vì A.I giờ tự
> quyết màu trong code cảnh rồi, chỉnh theme ít giá trị.

---

## 4. Oracle tối thiểu, theo-format (R2, D7) — táo bạo nhưng có lưới

Em được toàn quyền (anh nói "thích làm gì làm"). Quyết định:

### 4.1. GIỮ HARD (lớp chống-vỡ — không bao giờ là khẩu vị)

| Oracle | Vì sao bất khả nhượng |
| --- | --- |
| N2 component lạ | không có gì để render cho cảnh đó |
| N9 media remote | phá offline + xác định (N16), không chứa được |
| N11 bundle | code không build được = không có video |
| N12/N13 timing/audio lock | sai khung giờ = video vỡ tiếng/lệch |
| N16 determinism | render 2 lần khác nhau = không kiểm soát được |
| dup scene-id / spec rỗng | đụng tên file PNG + React key; không có cảnh |

### 4.2. GIỮ MỘT oracle layout "không-bay-khỏi-khung", THEO FORMAT (D7, O5)

- Gộp 4 biến thể N14 hiện tại thành **một** `checkInFrame(frame, geometry)`:
  chỉ bắt nội dung **tràn HẲN ra ngoài canvas** (ngoài `safeMargin` ring), KHÔNG
  nhặt sạn divider/caption-clearance nữa.
- Ngưỡng theo format: TikTok ring mỏng (giữ ~) ; YouTube ring rất mỏng (16:9 dùng
  gần hết khung). **Severity = warning** (advisory) — refine dùng nó để biết cảnh
  nào cần sửa, nhưng KHÔNG hard-block (tránh xích lại như cũ).

### 4.3. HẠ WARNING / GỠ phần còn lại

- N3, N6, N7, N14-chi-tiết, N15/N17/N18/N20/N30 → **warning** (phần lớn đã hạ
  ở nhánh hiện tại). Vẫn hiện trong report cho refine.
- N10 chỉ warning cho các slip đã biết là runtime-safe; diagnostic dễ tạo crash /
  SceneFallback vẫn là hard error để repair trước khi người dùng thấy draft.
- **Giữ self-test mọi oracle** (D7/R2.4) — không xoá lưới kiểm thử dù hạ severity.

### 4.4. Cơ chế: chặn chỉ khi `severity==="error"`

Không cần sửa lớp gate — `makeReport`/`gate`/orchestrator đã key theo
`severity==="error"`. Hạ severity là đủ. Đường stills (§5) thì BỎ QUA oracle nặng
hoàn toàn.

---

## 5. Đường stills nhanh + refine ngầm (R4, R5, R6) — trái tim tốc độ

### 5.1. Vấn đề hiện tại (đã verify)

Vòng vision/QA gọi `generateValidateRepair → renderDraft` = **render full draft**:
admit → **Vivibe TTS** → lock → **MP4 encode (ffmpeg)** → oracles → review → *rồi
mới* đẻ stills ở `reviewDir`. PNG mà A.I cần nằm ở bước CUỐI của chuỗi nặng nhất.

### 5.2. `renderProjectStills` — đường tắt mới (`@news/pipeline`)

```ts
renderProjectStills(projectId, { sceneIds?, signal }): Promise<{ stills: string[] }>
```

Luồng: `admit cảnh` → `lockSpec(spec, **null**, {fps})` (no-TTS, dùng
`durationInSeconds` làm hold — đã hỗ trợ ở [lock.ts:43-47](../../packages/pipeline/src/audio/lock.ts#L43)) →
`renderSceneStills(locked, reviewDir, { sceneIds })`. **BỎ**: Vivibe, MP4 encode,
oracle nặng, review checklist. Còn lại: admit (AST, ~ms) + bundle (1 lần) + N×
`renderStill`.

- `renderSceneStills` ([renderer.ts:168](../../packages/pipeline/src/render/renderer.ts#L168))
  đã iterate per-scene + bundle-một-lần. Thêm tham số `sceneIds?` để render **đúng
  tập con** (R5.3) — sửa 1 cảnh ⇒ 1 PNG (R4.3).
- Stills KHÔNG có caption (no SRT) → tốt cho QA bố cục (chữ caption không che).

### 5.3. MCP + backend

- MCP: thêm `render_stills(projectId, sceneIds?)`.
- Backend `AuthoringBackend`: thêm `renderStills(projectId, sceneIds?, signal)`.

### 5.4. Vòng refine ngầm (R4)

Sau author (bản mù), TRƯỚC khi lộ cho người dùng:

```
for pass in 1..N (N = settings.refinePasses, default 2):
  renderStills(scope)                    # rẻ
  defects = visualQa(stills)             # 1 call vision, trả {sceneId, issue, severity}
  if no high-severity defects: break     # dừng sớm (R4.5)
  reauthor(defects)  # accept chỉ khi cảnh render được (R3.2) — snapshot/restore đã có
pass-1 intent = "làm TÁO BẠO/đẹp hơn"; pass-2+ = "nhìn lỗi sửa lỗi" (R4.4)
```

- Tái dùng `withVisualQa` ([workspace-controller.ts:602](../../apps/desktop/src/main/workspace/workspace-controller.ts#L602))
  nhưng đổi `renderDraft`→`renderStills`, và lặp N pass thay vì 1, có dừng-sớm.
- **YouTube:** chỉ refine cảnh bị QA gắn cờ (D6/R4.6) + cảnh báo quota.
- Người dùng chỉ thấy bản nháp SAU refine (R6.1). Một bản draft thật (voice+MP4)
  chỉ render ở bước cuối để xem/preview.

### 5.5. Settings

`SettingsModel` ([types.ts:188](../../apps/desktop/src/renderer/state/desktop-state.test.ts))
thêm `refinePasses: number` (mặc định 2, clamp 0–5). UI cảnh báo "tăng pass = tốn
quota + lâu hơn" (D6). `visualQaEnabled` cũ trở thành `refinePasses>0`.

---

## 6. YouTube author-theo-đoạn (R7.5, D5) — khối lớn riêng

### 6.1. Vì sao không one-shot

YT 10p ≈ 2.800 từ ≈ 60–100 cảnh. Bắt model trả 100 module .tsx trong MỘT reply =
vỡ chắc (reply cắt cụt — chính lỗi `no-code` đang thấy). Hiện parser không còn
upper cap scene count, nhưng đó không giải quyết giới hạn reply/model; YouTube
vẫn cần author theo đoạn.

### 6.2. Chiến lược

1. **Outline pass:** model sinh DÀN Ý toàn video (N "đoạn", mỗi đoạn 1 chủ điểm +
   ngân sách từ) — 1 call rẻ, chỉ text.
2. **Segment authoring:** mỗi đoạn (8–12 cảnh) author riêng = 1 call → parse →
   admit. Lặp đến hết outline. ID cảnh đánh số liên tục toàn cục (`scene-01..NN`).
3. **Ghép (O2 chốt):** ghép ở **tầng manifest** (nối scenes + modules thành một
   spec), KHÔNG concat MP4. Lý do: lock timing + caption + render đã xử lý spec
   nhiều cảnh sẵn; concat MP4 đẻ vấn đề nối tiếng/khung. Một spec → một render.
4. **Scene-count policy cho J:** parser hiện chỉ giữ floor `min(3)`. Khi làm J,
   quyết định lại cap/validation theo format+tier cho segment manifests nếu cần,
   thay vì dựa vào cap TikTok cũ.

### 6.3. Tối ưu render YT (R5.5 — mục tiêu liên tục)

- Bundle MỘT LẦN cho toàn spec (đã vậy).
- Refine chỉ trên cảnh gắn cờ (không quét 100 cảnh mỗi pass).
- Cảnh báo người dùng: YT 10p render rất lâu + tốn quota (D4).
- (Để mở) song song hoá render scene-stills nhiều worker — t.

---

## 7. Tiêu đề, tên dự án, ngôn ngữ (R9, D9/D10)

### 7.1. Sinh title cùng kịch bản

- `authorManifestSchema.title` đã có (`max(160)`). Thêm luật theo format:
  - TikTok: `< 100` ký tự, **kèm hashtag**.
  - YouTube: `< 200` ký tự.
- Thêm field `videoLanguage: "vi"|"en"` (người dùng chọn, D10) tiêm vào
  prompt builder — CHỈ ảnh hưởng title/hashtag, KHÔNG đổi ngôn ngữ kịch bản.
- Hashtag: prompt yêu cầu 3–6 hashtag hợp chủ đề.

### 7.2. Tên dự án = title (D9)

- `scaffold_project` hiện đặt id từ prompt/link (xấu). Đổi: sau author, slug-hoá
  `manifest.title` làm tên hiển thị + id. Trùng → thêm hậu tố ngắn (`-a1b2`).
- **Đổi tên:** thêm IPC + store update; `ProjectCardVM.title` đã có.

### 7.3. Màn cuối: copy title

- Stage `published` ([types.ts:168](../../apps/desktop/src/renderer/state/desktop-state.test.ts))
  thêm `title`+`hashtags`; UI hiện panel + nút **Copy** (R9.5).

---

## 8. Danh sách dự án — phân trang (R10, O3)

- **O3 chốt:** **12 dự án/trang**, lưới **3 cột × 4 hàng** (cân, lướt gọn, không
  tràn màn). Có điều hướng trang.
- Renderer giữ trang hiện tại + tổng số; main trả page slice. Thuần UI + một IPC
  `listProjects(page, pageSize)`.

---

## 9. Nhạc nền BGM (R11, O4)

- **O4 chốt:** thư viện BGM lưu **theo máy** (thư mục `VIDEO_TOOL_HOME/.video-tool/
  bgm/`), dùng chung mọi dự án; dự án chỉ lưu **tham chiếu** file đã chọn. Định
  dạng: `.mp3/.m4a/.wav`.
- UI Settings (hoặc panel BGM): liệt kê / **thêm** (copy vào thư viện) / **xoá**.
- Khi render, nếu dự án có BGM ref → mix vào (đường mix đã có trong `@news/tts`).
  Không chọn → không nhạc (R11.3).
- SFX: ngoài phạm vi (D11).

---

## 10. Thumbnail / cover — CẢ HAI format (R12, D12)

- MỘT composition Remotion mới `Thumbnail` (`packages/compositions/src/thumbnail.tsx`),
  **format-aware**: canvas set theo `geometry(props.format)` ở tầng
  `calculateMetadata` của `Root.tsx` (1080×1920 cho tiktok, 1920×1080 cho
  youtube). `NewsVideo` không đụng; đường video 16:9 thật thuộc Nhóm J.
- **Cả TikTok và YouTube:** cover/thumbnail là brand card sạch:
  `sceneBackground(theme)` + publish title trong content zone. KHÔNG dùng frame
  cảnh thật làm nền, vì overlay title lên một scene text-heavy tạo lỗi chồng 2
  khối text lớn.
- Hàm `renderThumbnail(projectId)` (`packages/pipeline/src/render/render-thumbnail.ts`)
  đọc manifest (format/title/dominant), `selectComposition("Thumbnail")` +
  `renderStill` ở frame cuối (title reveal đã settle) → `review/thumbnail.png`.
  KHÔNG đụng `prepareComposition`/`renderProject`/orchestrator (ADR-002).
- Render tại frame cuối (durationInFrames-1) để `useReveal` = 1.

---

## 11. Calib tốc độ đọc Vivibe (R5.4, D13)

- Script đo: gửi vài đoạn văn bản độ dài biết trước qua Vivibe, đo giây thật →
  suy `từ/giây` trung bình (hiện hard-code ~4.7 trong prompt).
- Lưu hằng số calib vào config; prompt builder + ước-cảnh dùng nó để nhắm mức
  thời lượng, sai số mục tiêu ≤ 20s (D4). Đo lại được khi đổi voice.

---

## 12. Self-heal — đóng nốt lỗ hổng (R3)

- **Error boundary per-scene:** ĐÃ XONG (nhánh hiện tại) — giữ.
- **Accept-gate (R3.2):** reauthor chỉ ghi đè khi render được; rollback đã có
  ([workspace-controller.ts:629](../../apps/desktop/src/main/workspace/workspace-controller.ts#L629)).
  Mở rộng: với đường stills, "render được" = renderStill cảnh đó không throw.
- **Vá reply cắt cụt cho reauthor (R3.3) — XONG.** Khi đọc code thật, chẩn đoán
  ban đầu sai: nối-reply (`finish_reason:"length"`) KHÔNG ở riêng đường author —
  nó ở `ninerouter-client.chat()`
  ([ninerouter-client.ts:303](../../apps/desktop/src/main/gateway/ninerouter-client.ts#L303)),
  và `chatWithVisionFallback` dùng CHUNG cho author + reauthor, nên reauthor ĐÃ
  được stitch khi provider báo "length". Gap thật nằm ở **parser**: `extractFences`
  ([reply-parser.ts:35](../../apps/desktop/src/main/authoring/reply-parser.ts#L35))
  đòi fence đóng ` ``` `; khi reply vẫn đứt giữa block (cạn pass stitch, hoặc
  provider không báo "length"), block không có fence đóng → 0 block → `no-code` →
  giữ cảnh cũ âm thầm (đúng triệu chứng `scene-03`). Fix: `extractFences` thu hồi
  MỘT block cuối chưa đóng fence (phần còn lại tới EOF). Nếu `registerComponent`
  sống sót → cứu được; nếu cắt trước cả `registerComponent` → vẫn `no-code` (giữ
  cảnh cũ, đúng R3.2 — không bao giờ nhận nửa module). Regression test ở
  [reply-parser.test.ts](../../apps/desktop/src/main/authoring/reply-parser.test.ts).

---

## 13. Thứ tự phụ thuộc (để chia task ở pha 3)

```
A. @news/schema: geometry(format) + VideoSpec.format         ← nền, không phụ thuộc ai
B. @news/theme (thay @news/design) + blocks trỏ sang          ← phụ thuộc A
C. composition theo format + oracle checkInFrame(geometry)     ← phụ thuộc A,B
D. renderProjectStills + MCP render_stills + backend           ← phụ thuộc A
E. vá reply-cụt reauthor                                       ← độc lập, làm sớm
F. refine ngầm N-pass (đổi withVisualQa dùng stills)           ← phụ thuộc D,E
G. format/tier/title/titleLang vào schema+prompt+UI            ← phụ thuộc A
H. tên dự án = title + đổi tên + copy                          ← phụ thuộc G
I. phân trang + BGM UI + thumbnail/cover brand-card             ← phụ thuộc G
J. YouTube author-by-segment (outline→segment→ghép manifest)   ← phụ thuộc A,G; KHỐI RIÊNG
K. calib Vivibe                                                ← độc lập
```

TikTok đường-mới = A+B+C+D+E+F+G+H+I+K+L. YouTube = thêm J (làm sau, riêng).

---

## 14. Verify mỗi bước

`npm run typecheck` · `npx tsx scripts/test.ts` · `npm run build` — như Working
Agreement #5. Mỗi oracle hạ/gỡ giữ self-test. Mỗi normalizer/coercion mới đi kèm
fixture (Working Agreement #1).

---

## 15. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
| --- | --- |
| Gỡ `@news/design` làm vỡ blocks hàng loạt | `@news/theme` giữ ĐÚNG shape `useTheme()`; đổi import, không đổi API. Typecheck bắt ngay. |
| 16:9 làm oracle/zone dọc sai | `geometry(format)` một nguồn; oracle đọc geometry, không hằng số. |
| Refine ngầm làm cảnh ĐANG đẹp thành xấu | accept-gate + dừng-sớm + chỉ sửa cảnh gắn cờ; snapshot/restore. |
| YT 100 cảnh vỡ reply | author-by-segment + vá reply-cụt; ghép tầng manifest. |
| Refine YT đốt quota | chỉ refine cảnh gắn cờ + cảnh báo + cho hạ pass. |
| Mất project cũ | D0 chấp nhận (greenfield). |

---

## Mở (cho pha tasks, không chặn duyệt design)

- T1. `@news/theme` là gói mới hay đổi tên `@news/design`? **Đã chốt/triển khai:
  gói mới `@news/theme`, xoá `@news/design`.**
- T2. YouTube cap scenes chính xác (~120?) + có chia tier cap không.
- T3. Thứ tự commit greenfield: gỡ design TRƯỚC hay dựng theme TRƯỚC (đề xuất: dựng theme, trỏ blocks, rồi xoá design — luôn xanh).
