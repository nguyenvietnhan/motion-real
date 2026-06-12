# Kế hoạch lớn: Multi-style "thay áo" (Phần A) + Vòng đời render & UX preview (Phần B)

> **Trạng thái:** Phần A ĐÃ ĐỔI HƯỚNG + đã code nền (một-layout-chung). Phần B
> item 1/2/3 đã code. File ý tưởng sống, dùng làm nguồn tổng hợp trước khi implement.
>
> Cập nhật gần nhất: 2026-06-11.
>
> **Hai phần độc lập nhau:**
> - **Phần A** (§1–§7): kiến trúc style khi có nhiều phong cách design.
> - **Phần B** (§8–§13): Dừng render + xem draft/final trong app + tải về.
>
> Thứ tự implement ở [§14](#14-thứ-tự-implement-tổng).

---

# PHẦN A — MULTI-STYLE "THAY ÁO"

## 1. Bối cảnh & cú đổi hướng

### 1.1 — Tham vọng ban đầu (đã BỎ)

Câu hỏi gốc của user (2026-06-10): *"Mai mốt cho người dùng chọn nhiều phong cách
design, phong cách đó có thể bị vài oracle bắt lỗi sai thì nên làm sao?"*

Hướng đầu tiên ta theo: **mỗi style là một ngữ pháp layout riêng**. Dựng cả một hệ
`LayoutProfile` (mỗi style có `contentZone`/`captionBand`/`uiReserve` riêng), oracle
phân tier `universal`/`grammar`/`parametric`, registry + test gate, style pack trỏ
`layoutProfileId`. Tất cả đã code xong, 562 test xanh.

### 1.2 — Vì sao BỎ (user 2026-06-11)

User nhìn bản demo render hai style và nhận ra **mình không cần đến mức đó**:

> *"Ta đang hơi overengineering rồi. Mọi cách bố trí đồ đều sẽ giống style 1. Vẫn
> làm nhiều style nhưng oracle không cần chia từng style nữa — ta chỉ thay phong
> cách thiết kế: style 1 vuông góc, style 2 bo tròn, style 3 không khung chỉ chữ…
> Nó như một người thay áo vậy. Thế đơn giản hơn."*

Tiền đề đỡ cho cả hệ `LayoutProfile` là *"style 2 cần layout khác để có chỗ rộng hơn
cho ảnh"*. Nhưng user cũng chốt **mọi style đều được phép có ảnh** và **dùng chung
một cách bố trí** → tiền đề đó tự sụp. Khi mọi style chung một layout, "layout riêng
theo style" là tầng trừu tượng thừa.

**Quyết định:** **xé hẳn** `LayoutProfile` về một bộ hằng số chung. Style khác nhau
**chỉ ở chrome** (cái "áo"). → đã teardown, xem changelog 2026-06-11 (7).

---

## 2. Mô hình mới: MỘT layout, style = thay áo

```
                 ┌─────────────────────────────────────┐
                 │  MỘT layout chung (zones.ts)         │
                 │  CONTENT_ZONE / CAPTION_BAND /        │
                 │  UI_RESERVE — hằng số global,         │
                 │  mọi style + mọi oracle cùng đọc      │
                 └─────────────────────────────────────┘
                                  │
            ┌─────────────────────┼─────────────────────┐
            ▼                     ▼                     ▼
     ┌────────────┐        ┌────────────┐        ┌────────────┐
     │  Style 1   │        │  Style 2   │        │  Style 3   │
     │ vuông góc  │        │  bo tròn   │        │ không khung│
     │ khung dày  │        │ khung mảnh │        │  chỉ chữ   │
     │ có divider │        │ có divider │        │ KHÔNG div. │
     └────────────┘        └────────────┘        └────────────┘
            └──── tất cả khác nhau chỉ ở ChromeLevel ("áo") ────┘
```

**Hai trục — giờ chỉ còn MỘT trục biến thiên:**
- **Layout (zones):** CỐ ĐỊNH, chung cho mọi style. Một nguồn sự thật ở
  `@news/schema` `zones.ts`. Oracle đọc đúng bộ này.
- **Chrome ("áo"):** trục DUY NHẤT mà style khác nhau. Vuông/bo-tròn, khung
  dày/mảnh/không-khung, có/không grid, có/không divider, font, scrim caption…

**Nguyên tắc:** thêm một style = thêm **một entry `ChromeLevel`**, KHÔNG đụng layout,
KHÔNG đụng oracle.

---

## 3. Oracle: MỘT bộ chung, không chia theo style

Vì layout là chung, oracle không cần biết "đang ở style nào". Toàn bộ N1–N30 đọc
cùng một bộ zones. Không còn `LayoutProfile`, không còn tier, không còn registry
phân loại theo style.

**Hệ quả thực tế (đã code):** `render-grid.ts` vẫn có thể giữ một danh sách oracle
gọn (thứ tự chạy rõ ràng), nhưng **không mang metadata tier/profile**. Mỗi oracle là
một hàm thuần đọc hằng số chung — đúng như trước khi ta vẽ ra hệ multi-style.

**Một ngoại lệ đã có sẵn và GIỮ:** cờ `dividerClearanceAbove` (mặc định bật) trong
`render-grid.ts`. Một style "không khung chỉ chữ" sẽ KHÔNG vẽ divider → bật cờ này
`false` cho style đó. Đây là mẫu đúng cho "đồ trang trí bật/tắt theo áo": **oracle
vẫn tồn tại, chỉ tắt khi style thật sự không có khái niệm đó** — không phải tắt để
"cho qua".

> **Lằn ranh giữ lại từ hướng cũ (vẫn đúng):** style mới được phép TẮT một oracle
> CHỈ KHI style đó không có khái niệm mà oracle canh (vd: không divider → tắt
> divider-clearance). KHÔNG bao giờ tắt một oracle correctness/legibility
> (overlap, contrast, safe-area, pacing…) để cho style qua.

---

## 4. Layout chung hiện tại (số đã chốt)

Đọc `@news/schema` `zones.ts` (2026-06-11), canvas 1080×1920:

| Mốc | y | Ghi chú |
|---|---:|---|
| `CONTENT_ZONE` top → bottom | 96 → **1350** | divider vẽ ở bottom; vùng nội dung + ảnh |
| `CAPTION_BAND` top → bottom | **1370** → **1650** | phụ đề burn-in 1 dòng, nằm dưới divider |
| Gap divider↔caption | 1350 → 1370 | ~20px, divider sát caption |
| `uiReserveTop()` = 1920 − `UI_RESERVE.bottom`(270) | **1650** | platform vẽ UI từ đây xuống |

**Lịch sử dịch chuyển (user yêu cầu "dịch nội dung + caption xuống"):**
- Content bottom 1190 → 1300 → **1350** (nội dung cao hơn, chỗ cho ảnh).
- Caption band 1230/1610 → **1370/1650** (tụt xuống theo, ngồi thấp như người xem
  quen thấy phụ đề).
- `UI_RESERVE.bottom` 300 → 270: **đây là ngưỡng VALIDATE, không phải vị trí render.**
  Hạ xuống để caption bottom 1650 nằm khít sàn (giữ invariant `caption.bottom ≤
  uiReserveTop()` chặt) — quyết định product "caption ngồi thấp, chấp nhận che một
  tí UI nền tảng" (xem §5).

---

## 5. Số safe-area THẬT (nghiên cứu giữ lại từ hướng cũ)

> Phần này vẫn giá trị dù đã bỏ `LayoutProfile` — nó giải thích vì sao caption không
> thể tụt thấp vô hạn.

`UI_RESERVE` ban đầu (`300/140`) là **ước lượng tay** (git: commit migration
`ae61a46`, không có rationale cho con số). Đối chiếu nhiều nguồn web 2026 (lấy bằng
Playwright vì trang JS-rendered):

| Reserve | Thực tế 2026 (TikTok = chật nhất) |
|---|---|
| bottom | ~320–400px (progress bar + caption + CTA) |
| right | ~120–150px (action rail) |
| usable | TikTok **780×1270**, Reels 810×1340, Shorts 820×1400 |

**Hai sự thật ngành:**
1. **Không có pixel-perfect duy nhất** — UI TikTok co giãn theo độ dài caption. Nên
   `UI_RESERVE` bản chất là **ngưỡng product-risk thận trọng**, không phải ranh giới
   vật lý tuyệt đối.
2. **Thiết kế cho TikTok (chật nhất) ⇒ an toàn cả Reels + Shorts.**

**Quyết định product (user):** *"Không nhất thiết phải trong vùng an toàn — bị
caption che một chút cũng được, nhưng đừng quá thấp ở dưới."* → caption ngồi sát sàn
(bottom 1650), chấp nhận chạm nhẹ mép trên vùng UI nền tảng. Đây là lý do
`UI_RESERVE.bottom` để 270 (caption bottom = đúng sàn) chứ không phải 360 (đẩy
caption lên cao, mất thẩm mỹ).

**Trần vẫn còn:** caption KHÔNG thể tụt thấp hơn 1650 mà không lọt sâu vào vùng
TikTok vẽ username/caption/nút. Content thì còn dịch xuống thêm được; caption thì
đây là đáy — muốn xuống nữa phải nén band mỏng lại, không tụt thêm.

---

## 6. Ảnh: mở cho MỌI style (gần như đã sẵn)

User: *"Tôi cũng sẽ cho phép style 1 được phép có ảnh."*

**Đã xác nhận (đọc code):** ảnh KHÔNG hề bị khóa theo style. AI được chèn ảnh bất cứ
khi nào có ảnh truyền vào, qua block `<SceneImage>` đặt trong `<Content>`/`<Story>`
(luôn trong vùng an toàn). Không có cổng nào chặn "style X không được có ảnh". Nên
"cho mọi style có ảnh" về cơ bản **đã sẵn** — tính năng ảnh (`SceneImage` schema,
`scene-image.tsx`, crawl/admission) độc lập hoàn toàn với chuyện multi-style.

**Việc thật sự cần (chưa làm, thuộc việc chính):** siết **chỉ dẫn cho AI** để nó biết
co/giãn bố cục theo kích thước ảnh nhưng LUÔN nằm trong vùng cho phép — với style 1:
toàn bộ vùng trên divider, trong khung, chừa divider một chút. Đây là việc về prompt
+ oracle (đã có sẵn `checkContentZone`/`checkDividerClearanceAbove` canh), nằm gọn
trong mô hình một-layout.

---

## 7. Việc chính còn lại: trục CHROME ("áo")

> Đây là phần CHƯA code — việc chính ta sắp bắt tay.

Mục tiêu: mỗi style là một bộ `ChromeLevel` khác nhau, cùng một layout. Cần mở rộng
`ChromeLevel` (`@news/design` `style-packs.ts`) để diễn tả đủ các "áo":

| Trục áo | Đã có? | Cần thêm |
|---|:---:|---|
| Khung dày/mảnh | ✅ `border.width`/`border.style` | — |
| Không khung | ✅ `border.style: "none"` (type hỗ trợ) | dùng nó cho style "chỉ chữ" |
| Grid nền bật/tắt | ✅ `grid` | — |
| Ticks góc bật/tắt | ✅ `registrationTicks` | — |
| Scrim sau caption | ✅ `captionScrim?` | — |
| Font | ✅ `fontFamily` | — |
| **Bo góc (vuông/tròn)** | ❌ | thêm `cornerStyle: "square" \| "rounded"` (+ radius) |
| **Divider bật/tắt** | ⚠️ một nửa | style "không khung" cần tắt divider: thêm cờ chrome `divider: boolean`, nối với `dividerClearanceAbove` của oracle |

**Nguyên tắc khi dựng style mới:**
1. Thêm một entry `STYLE_PACKS` với `ChromeLevel` riêng. KHÔNG đụng zones, KHÔNG đụng
   oracle (trừ bật/tắt cờ divider nếu style không có divider).
2. Block đọc chrome qua `theme.chrome.*` (đã có sẵn `chromeBorder`/`chromeShadow`…) —
   thêm helper cho bo góc.
3. Render still so bằng mắt giữa các style (đã chứng minh đây là cách bắt lỗi mà test
   không bắt — xem demo trong lịch sử).

**Còn cần bàn với user trước khi code:** UI cho người dùng CHỌN style (user nói sẽ
cho ý tưởng giao diện trước), và mạch `stylePackId` từ lúc tạo project xuống manifest
(hiện chọn style chưa nối ra UI).

---

# PHẦN B — VÒNG ĐỜI RENDER & UX PREVIEW

> 3 yêu cầu user (2026-06-10), thực ra là **một** vấn đề: *trạng thái của một vòng
> đời render, hiển thị trên MỘT bề mặt.* Dự án đã có sẵn state machine render
> (idle → rendering draft → draft ready → rendering full → full ready) trong
> orchestrator; UI chỉ chưa phản chiếu ra.

## 8. Sự thật kiến trúc (đã đọc code xác nhận 2026-06-10)

**Render chạy IN-PROCESS trong main Electron, KHÔNG phải worker con.** Chuỗi gọi:

```
UI (renderer React)
  → IPC (preload allow-list channels)
    → WorkspaceController (apps/desktop/src/main/workspace/workspace-controller.ts)
      → AgentWorker (CustomLoopAgentWorker)
        → AuthoringBackend (NineRouterAuthoringBackend) → MCP tools render_draft/full
          → renderProject (packages/pipeline/src/orchestrator.ts)
            → renderVideo (packages/pipeline/src/render/renderer.ts)
              → Remotion renderMedia()  ⟵ chỉ ĐÂY mới spawn child process (chrome + ffmpeg)
```

- Tất cả tầng JS ở trên **chung một process** (header agent-worker tự ghi
  "single-process orchestrator").
- Child process tách rời **duy nhất** = chrome-headless-shell + ffmpeg do Remotion
  tự spawn bên trong `renderMedia`/`renderStill`.

### Đã xác nhận sẵn sàng (làm Phần B nhẹ đi nhiều)

- ✅ **`media://` protocol đã có** (`apps/desktop/src/main/media-protocol.ts`):
  `mediaUrl(absPath)` phục vụ file dưới `.video-tool`, có containment 403 + HTTP
  Range (seekbar chạy). → phát MP4 local chỉ là `<video src={mediaUrl(path)}>`.
- ✅ **Remotion 4.0.472 có `makeCancelSignal()`** + **`isUserCancelledRender(err)`**.
  `renderMedia`/`renderStill` đều nhận `cancelSignal`.
- ✅ **Tracker đã có trạng thái `paused-resumable`**.
- ✅ Stage `published` đã mang `outputPath` bọc mediaUrl.

---

## 9. Item 1 — DỪNG render (đã code)

### Vì sao nặng — 4 lý do thật

1. **Xuyên chuỗi sâu + cắt ngang hợp đồng MCP.** Tín hiệu hủy phải luồn qua ~7 tầng.
2. **Không phải "một render" mà cả pipeline nhiều chặng, có chặng tốn tiền** (TTS,
   determinism, render, review, vòng repair). Tín hiệu phải tới cả model fetch lẫn
   TTS fetch, không chỉ ffmpeg.
3. **In-process ⇒ phần JS chỉ hủy hợp tác (cooperative), không SIGKILL được.** Child
   process Remotion thì giết sạch được qua `cancelSignal`.
4. **Phải phục hồi trạng thái mạch lạc + dọn artifact dở** — nhả `inFlight`, stage về
   chỗ hợp lý, **xóa MP4 viết dở** (bẫy âm thầm nguy hiểm nhất).

### Hướng đã chốt + code: cooperative AbortSignal + Remotion cancelSignal

- Một `AbortController` mỗi job, `WorkspaceController` giữ theo `projectId`.
- Channel `projects:cancel` → `controller.cancel(projectId)` → `abort()`. **Cancel là
  hành động DUY NHẤT được phép chạy trong lúc `inFlight`** → không qua `guarded()`.
- Luồn `signal` xuống `renderProject`, kiểm `signal.throwIfAborted()` tại ranh giới
  mỗi chặng. Trong `renderVideo`: nối `AbortSignal` → Remotion `cancelSignal`.
- Khi abort: phân biệt "đã hủy" với "lỗi" (màn "Đã dừng" hiền, không error đỏ), nhả
  `inFlight`, dọn MP4 dở, set stage về trạng thái trước.

> Đã code (commit `599fd54` "reliable Dừng render across every render stage").

---

## 10. Item 2 — XEM DRAFT trong app (đã code)

- Seam `draftMedia(projectId)` + `hasDraft(projectId)` (sao y `outputMedia`/
  `hasOutput`, file `<id>.draft.mp4`).
- Stage `ready` mang thêm `draftPath` (bọc mediaUrl); helper `readyStage()` gom 5 chỗ
  set `ready` để không drop draft.
- StoryboardView: khung preview lớn = `<video>` draft mặc định + toggle qua ảnh tĩnh
  để sửa cảnh, kèm nhãn "bản nháp nhẹ" (nửa độ phân giải, 10fps, jpeg, **có tiếng**).

> Đã code (commit `e75aedd`).

---

## 11. Item 3 — XEM BẢN CUỐI + TẢI VỀ (đã code)

- Stage `published` thay EmptyState bằng `<video>` final + nút `[Tải về…][Mở thư
  mục][Quay lại]`.
- Channel `projects:save` → `dialog.showSaveDialog` + `copyFile` (**COPY không
  move** — bản gốc phải nằm yên vì `hasOutput` dựa vào nó; tên mặc định từ title
  project; ghi ngoài sandbox CHỈ qua dialog).

> Đã code (commit `e75aedd`).

---

## 12. UI: progressive disclosure (đã code)

Nút đi theo trạng thái, không bày hết cùng lúc. Một thanh hành động mảnh đổi theo
`stage.kind` (một nguồn sự thật = `stages` Map):

| Stage | Preview lớn | Thanh hành động |
|-------|-------------|-----------------|
| `rendering` | progress bar | `[Dừng]` |
| `ready` (có draft) | video draft + rail ảnh | `[Render bản full]` `[Sửa cảnh]` |
| `published` | video final | `[Tải về…]` `[Mở thư mục]` |

UI là **hàm thuần của trạng thái render** — một component `<VideoPlayer src=…>` duy
nhất, đổ 2 nguồn (draft/final).

---

## 13. (trống — gộp vào §12)

---

## 14. Thứ tự implement tổng

1. ✅ **Phần B item 2 + 3** (xem draft/final + tải về) — đã code.
2. ✅ **Phần B item 1** (Dừng render) — đã code.
3. ✅ **Phần A nền** (một-layout-chung, dịch caption xuống, gỡ `LayoutProfile`) — đã code.
4. ⬜ **Phần A trục chrome** (§7: bo góc, divider bật/tắt, dựng style 2/3) — **việc
   chính tiếp theo**, chờ user cho ý tưởng UI chọn style.
5. ⬜ Siết prompt AI co/giãn bố cục theo kích thước ảnh trong vùng cho phép (§6).

---

## Changelog
- 2026-06-10 (1): tạo file. Hướng ban đầu: phân loại oracle 3 nhóm
  (universal/grammar/parametric), ghi sẵn `LayoutProfile`.
- 2026-06-10 (2): chốt 3 quyết định §6 hướng cũ (tách checkContentZone / trục
  layoutProfileId độc lập / registry + test gate). Thêm Phần B (vòng đời render):
  §8 kiến trúc in-process, §9 Dừng, §10 draft, §11 final+tải, §12 UI.
- 2026-06-10 (3): **ĐÃ CODE Phần B item 2 + 3**. 495/495 test xanh.
- 2026-06-10 (4): §6.5 — "đẩy caption xuống cho premium" vật lý không cho (band đã
  sát đáy). [Bối cảnh này nay nằm ở §5 bản mới.]
- 2026-06-11 (1): §6.6 — số safe-area thật (Playwright). `UI_RESERVE 300/140` là ước
  lượng tay. TikTok chật nhất 780×1270. [Nghiên cứu giữ ở §5 bản mới.]
- 2026-06-11 (2): §6.7 — hướng cũ "caption per-style" qua `LayoutProfile`
  (`spacious-content`), scrim = chrome. Data model + 4 bất biến + 5 edge case.
- 2026-06-11 (3): sửa mâu thuẫn §7.1 (tổng-phân-số không phân phối qua phép tách).
- 2026-06-11 (4): **ĐÃ CODE §7.1** hướng cũ — registry + `OracleTier`, 552/552 xanh.
- 2026-06-11 (5): **ĐÃ CODE §7.2** hướng cũ — `LayoutProfile` profile-hóa 5 package,
  557/557 xanh.
- 2026-06-11 (6): **ĐÃ CODE §7.3 cơ chế** hướng cũ — lưới anti-vacuous 3 oracle +
  3 test makeTheme, 562/562 xanh. "§7 hoàn tất cơ chế" (theo hướng cũ).
- 2026-06-11 (7): **ĐỔI HƯỚNG — XÉ HẲN `LayoutProfile`.** User nhìn demo render hai
  style, nhận ra over-engineer: *"mọi cách bố trí giống style 1, oracle không cần
  chia theo style, ta chỉ thay áo — vuông/bo-tròn/không-khung."* + *"style 1 cũng
  được có ảnh"* → tiền đề đỡ cho `LayoutProfile` sụp. Gỡ: `LayoutProfile`,
  `LAYOUT_PROFILES`, `resolveLayoutProfile`, `layoutProfileId`, `theme.layout`,
  `OracleTier`/`tier`, option `o.layout` — về MỘT bộ hằng số chung
  (`CONTENT_ZONE`/`CAPTION_BAND`) mà mọi block + oracle cùng đọc. GIỮ: tính năng ảnh
  (độc lập), `captionScrim` (thuần chrome), số safe-area thật. Dịch layout xuống theo
  yêu cầu user: content bottom 1190→1350, caption 1230/1610→1370/1650,
  `UI_RESERVE.bottom` 300→270 (ngưỡng validate, không render). Teardown xuống còn
  554 test xanh (gỡ 8 test thuộc riêng máy cũ), typecheck sạch. **Plan viết lại
  hoàn toàn theo mô hình "một layout, style = thay áo" (§1–§7 mới).** CÒN: trục
  chrome (§7) — việc chính tiếp theo.
