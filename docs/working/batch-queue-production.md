# Working note (TẠM) — Batch / queue sản xuất video

> **Không phải contract.** Không thay `AI_CONTRACT.md` / `docs/current/*`.  
> Xóa file này (hoặc gộp vào doc bền) khi kết quả đã sync vào `docs/current/` hoặc track đóng.  
> Ngày ghi: 2026-07-16 · Cập nhật: 2026-07-17  
> Liên quan: `docs/working/production-automation-track.md` (mục 1.3 Queue / multi-job).  
> Nền unattended: `reviewMode: skip_edit` + tắt script gate + tắt image human review.

---

## 0. Product intent (chốt với owner)

MotionReal là tool **sản xuất video short-form tự động**. Owner muốn **treo máy chạy nhiều video** theo **hàng đợi tuần tự** (serial), thấy được trạng thái từng cái, thông báo như bình thường khi xong/lỗi.

**Không ship (vẫn đúng):**

- Render **song song** nhiều project trong 1 process (registry + bundle cache — `docs/current/maintenance.md` Parallel Render Assumption).
- Editor layout / template catalog / theme authored (cấm contract).
- Preempt: hủy encode đang chạy để “nhảy” video khác ngay (destructive) — trừ khi owner đòi sau.
- Queue service / job framework ngoài process.

**Đã chốt thêm (2026-07-17):**

- **Queue-of-queues (B):** nhiều *project queue* (container); Start lô 2/3 khi lô 1 đang chạy → **xếp chờ FIFO**, không reject, không parallel render.
- **Home spillover → container tạm `home`** (thay dialog A/B/C cũ) — xem §3.

---

## 1. Hai cửa vào

### 1.1 Tab sidebar “Hàng đợi” (cách dùng chính) — **ĐÃ SHIP**

- Tab sidebar **Hàng đợi**.
- Tạo / mở **project queue (container)** (default title `project-N`).
- Thêm N prompt (knobs: duration / lang / voice / BGM; optional smoke).
- **Add ≠ render** — chỉ **Bắt đầu** mới drain serial.
- Worker serial: create path hiện có → poll stage đến terminal.
- Notify: reuse `job-notify` (OS + in-app) khi **video project** settle done/fail.
- Persist jobs/containers: `VIDEO_TOOL_HOME/queues.json`.
- Queue-of-queues: Start container khác khi busy → `mode: scheduled` + badge UI; pending **RAM-only** (restart mất lịch Start, jobs vẫn `queued`).

**Code neo:**

| Layer | Path |
| --- | --- |
| Types | `apps/desktop/src/shared/queue-types.ts` |
| Store | `apps/desktop/src/main/queue/queue-store.ts` |
| Runner | `apps/desktop/src/main/queue/queue-runner.ts` |
| IPC | `main/index.ts` `queue:*` |
| UI | `renderer/views/queue.tsx`, `theme/queue.css` |

### 1.2 Home create khi hệ thống đang bận — **CHỐT PRODUCT (chưa code)**

Chỉ áp dụng **tạo video từ Home** (composer trang chủ / `projects:create` từ Home).  
**Không** áp dụng: add job trong tab Queue, Settings smoke (tách sau nếu cần).

---

## 2. Runtime model

```text
Process-wide runner (concurrency = 1 render chain)
  active container
    jobs[] serial: queued → running → done | failed | cancelled
  pending containers[]  (FIFO Start order; RAM)
    …
  (Home spillover — planned)
    container title "home" (ephemeral)  ← chỉ job tạo từ Home khi busy
```

| Ràng buộc | Hệ quả |
| --- | --- |
| `inFlight` per `projectId` | Một video project một loop; **không** chặn 2 project khác id → Home+Queue **hiện có thể song song** (lỗ §6) |
| Bundle/composition cache process-wide | Cấm parallel cross-project |
| `withProjectRenderLock` | Cùng project |
| Unattended settings | Queue **không force** skip_edit; user Settings — kẹt human-wait nếu sai knob (§6) |

Worker = scheduler trên create + workspace; **không** rewrite orchestrator / render-grid.

---

## 3. Home create khi đã có queue / runner bận

### 3.1 Quyết định mới (2026-07-17) — **thay A/B/C dialog**

~~Dialog hỏi A (cuối queue) / B (chen sau job dở) / C (hủy).~~ **Không làm** (superseded).

**Chốt owner:**

Khi user **tạo video trên Homepage** và **đã có queue/runner đang bận** (ít nhất: runner `busy` — active container đang drain, hoặc còn pending schedule; chi tiết trigger implement §3.3):

1. **Không** chạy create Home song song (tránh 2 workflow / process).
2. Đảm bảo có **một project queue tạm** tên hiển thị **`home`** (hoặc fixed title `home`).
3. Mọi video create từ Home trong lúc hệ thống còn bận → **ném job vào container `home`** (cuối list, status `queued`), kèm knobs Home (prompt, duration, lang, voice, BGM; ảnh create-time nếu làm được cùng path).
4. Container `home` được **xếp vào schedule serial** (queue-of-queues): sau các lô đang active/pending **đã Start trước đó**, hoặc auto-`start`/`schedule` nếu chưa nằm trong pending.
5. Khi **hết việc trên container `home`** (không còn job `queued`/`running` — chốt: sau drain xong lần Start đó, hoặc khi mọi job terminal **và** không còn queued): **tự xóa** container `home` khỏi store (ephemeral).  
   - Video project thật (MP4 / gallery **Dự án**) **giữ** — chỉ xóa **queue container**, không xóa project video.
6. Nếu user Home-create **tiếp** trong lúc `home` còn sống → **reuse cùng** container `home`, append job (không tạo `home-2`).

**Chỉ khi tạo ở Homepage.** Create/add trong tab Queue → container user chọn, **không** đụng logic `home`.

### 3.2 Khi Home create mà hệ thống **idle**

- Không có runner busy / không còn chuỗi queue đang chạy: Home create **như hiện tại** (project thẳng workspace, không bắt buộc vào queue).
- Không tạo container `home` “dự phòng”.

### 3.3 Trigger “đang bận” (implement gợi ý — chưa code)

Tối thiểu:

| Busy nếu | Ghi chú |
| --- | --- |
| `queueRunner.isBusy()` | Active + đang drain / còn pending RAM |
| (Optional) còn job `status===running` trong store | Crash zombie — xem §6 |
| (Optional) workspace `inFlight` non-empty | Home job non-queue đang chạy |

**Không** coi “còn job `queued` nhưng user chưa Start” là busy cho Home spillover — user có list chờ manual; Home idle create vẫn thẳng (tránh bất ngờ).  
*Nếu owner muốn “có bất kỳ queued nào cũng spill Home → home” — đổi trigger sau; hiện chốt: **runner busy / schedule active**.*

### 3.4 UX Home khi spill

- Toast/info ngắn: *“Đang có hàng đợi chạy — video đã xếp vào lô home, sẽ chạy sau.”*
- Không dialog A/B/C.
- User có thể mở tab Hàng đợi thấy container **home** + job list.
- (Optional) deep-link mở container `home` — nice-to-have.

### 3.5 Vòng đời container `home`

```text
Home create + busy
  → ensure container title=="home" (create if missing)
  → addJob(...)
  → schedule/start home container if not already active/pending
  → (runner drains earlier containers first, then home)

Sau drain home (không còn queued/running trong home):
  → delete container home (auto)
  → unschedule nếu còn sót
```

**Cạnh tranh tên:** user rename tay container thành `home` — implement: đánh dấu ephemeral bằng flag ẩn (`ephemeral: "home"`) **hoặc** id cố định `queue-home`, không chỉ so title. **Prefer** `id: "queue-home"` hoặc field `ephemeralKind: "home"` trong store (schema v1 extend optional field; normalize bỏ qua nếu cũ).

### 3.6 Out of scope Home (vẫn)

- Preempt / abort job đang encode để làm Home ngay.
- “Dừng hết queue chỉ làm Home”.
- Spill từ Projects retry / workspace Fix — chỉ **Home create path**.

---

## 4. UI / quản lý

### Đã có

- List containers + badge **Đang chạy** / **Chờ**.
- Detail: add prompt, knobs, Start / Đã xếp chờ, rename, delete (không xóa active).
- Job: status, edit/xóa khi queued, Dừng khi running, xóa terminal; Start requeue failed/cancelled.
- Progress k/N khi **container này** active.

### Chưa / mỏng

- Aggregate count tổng/chờ/xong/fail trên card.
- Stage workspace chi tiết trên job card (`rendering 40%`, `script`, …).
- Pause cả queue; cancel-all chain.
- Toast “xong cả container / cả chuỗi”.
- UI copy tiếng Việt “final”.
- Surface container `home` (badge “Tạm · Home”) khi ship §3.

Notify: không spam percent tick (giữ edge terminal).

---

## 5. Settings / unattended (treo máy)

Để chuỗi không kẹt UI người:

- `reviewMode = skip_edit`
- `scriptGateEnabled = false`
- `imageCrawlHumanReview = false` (nếu URL crawl)
- TTS + gateway + model ready (không silent mock)

Queue runner **chưa force** các knob này.  
`waitTerminal` chỉ thoát `published` | `error` | cancel user — nếu stage `script` / `image-review` / `ready` → **job running mãi, cả chain đứng** (§6).

Preset “Full auto” = track 1.2; không chặn queue MVP.

---

## 6. Edge cases & lỗ đã audit (2026-07-17)

### 🔴 Cao (production)

| # | Tình huống | Hiện trạng | Hướng xử lý |
| --- | --- | --- | --- |
| E1 | Home create lúc queue busy | **Song song 2 workflow** (inFlight per project) | §3 spill → `home` + không create thẳng |
| E2 | reviewMode/gate sai → stage human-wait | `waitTerminal` **poll forever** | Fail rõ / timeout / detect non-terminal human stages → `failed` + message Settings |
| E3 | Crash giữa job `running` | Zombie `running` trong JSON; `requeueRetryable` **không** đụng | Startup reconcile: `running` → `failed` hoặc `queued` |
| E4 | Pending schedule RAM mất sau restart | Jobs còn `queued`, user phải Start lại | OK YAGNI; document. Optional persist pending sau |

### 🟠 Trung

| # | Tình huống | Ghi chú |
| --- | --- | --- |
| E5 | Add job vào container **đang** active | Loop `nextQueuedJob` **vẫn lấy** trong lần Start hiện tại |
| E6 | Add job vào container pending | Drain khi tới lượt — OK |
| E7 | Queue job **không** staging ảnh Home | Prompt/URL/BGM only; ảnh local TBD nếu spill Home cần parity |
| E8 | Nhiều toast từng video, không toast cả lô | Accept hoặc toast container-done sau |
| E9 | Fail job → vẫn tiếp job/container sau | Đúng hiện tại; không “stop on first fail” |
| E10 | Cancel running → tiếp job sau + pending containers | Không cancel-all |
| E11 | Đổi Settings giữa chuỗi | Job sau theo settings lúc create |

### 🟡 Thấp

- Không reorder drag; không pause.
- Checklist cũ từng đánh `[x]` A/B/C / auto-detect dù chưa code — đã sửa §7 (product vs code tách rõ).

---

## 7. Checklist owner / code

### Product chốt

- [x] Tab sidebar hàng loạt.
- [x] Trong tab: container → N prompt → Start serial → notify project.
- [x] Worker serial; không parallel trong runner.
- [x] Queue-of-queues B (Start lô 2/3 → chờ FIFO + UI).
- [x] Home lúc busy → **container tạm `home`**, gom mọi Home create vào đó; **tự xóa** container khi xong hết việc lô home (chốt 2026-07-17).
- [x] **Không** dialog A/B/C (superseded bởi `home`).
- [x] Chỉ spill khi create **Homepage**; tab Queue không dùng logic này.
- [x] Badge “Tạm · Home” + ẩn rename trên ephemeral (bước 5).
- [ ] Cancel/pause/retry UX chi tiết hơn (optional).
- [ ] Persist pending schedule qua restart (optional; hiện RAM).

### Code ship

- [x] Store + runner + IPC + UI tab + tests meta-queue (`a514296` queue-of-queues).
- [x] Store: `queue-home` + `ensureHomeQueue` + `ephemeralKind` + rename lock + auto-delete predicate (bước 1).
- [x] Home spillover → `source:home` + busy → ensure home + addJob + start/schedule (IPC + `home-spill.ts`) — bước 3.
- [x] Renderer: toast xếp chờ, không open workspace; cảnh báo ảnh dropped — bước 3–4.
- [x] Auto-delete container `home` khi drain xong (runner hook; keep if failed) — bước 2.
- [ ] Anti-stuck: human-wait stages → failed rõ (E2).
- [ ] Startup reconcile zombie `running` (E3).
- [ ] (Optional) Home images parity vào queue job.
- [x] Home spillover end-to-end code path (bước 1–5, 2026-07-17). Manual smoke matrix owner machine TBD.
- [x] Track 1.3: queue MVP marked shipped; Home `home` listed as follow-up.

---

## 8. Slice implement gợi ý (tiếp theo)

Thứ tự đề xuất:

1. **Home spillover `home`** (§3) — vá parallel + product chốt.  
   - `projects:create` từ Home (flag hoặc channel) check `queueRunner.isBusy()`.  
   - ensure ephemeral home container → `addJob` → `start`/`schedule`.  
   - Return UX: không open workspace ngay / toast xếp chờ.  
   - Auto-delete home khi `drainJobs` xong container đó và id/flag ephemeral.
2. **E2 anti-stuck** human stages trong `waitTerminal`.
3. **E3 reconcile** on app boot / queue load.
4. Tests: Home busy → job in home; idle → create thẳng; home auto-delete; no second inFlight from Home while busy.
5. Polish badge UI + working note → sync `docs/current` nếu behavior bền.

**Sensitive:** không big-bang `orchestrator.ts` / `render-grid.ts`.

---

## 9. Definition of done (khung product cập nhật)

1. Tab queue: N prompt, treo máy → N video serial (hoặc fail rõ) + notify project.
2. Nhiều container Start chồng → FIFO, 1 render chain, UI active/pending rõ.
3. **Home create khi runner busy** → job vào container **`home`** (reuse), không song song render; user thấy trong tab Hàng đợi.
4. Container **`home` tự xóa** khi hết việc lô đó; video thật vẫn ở Dự án.
5. Home create khi idle → như create hiện tại.
6. Không 2 full/author-render workflow từ **Home+Queue** cùng lúc (sau slice §3).
7. (Hardening) không poll forever trên human-wait stages.

---

## 10. Nhật ký

| Ngày | Ghi chú |
| --- | --- |
| 2026-07-16 | Tạo note: tab queue, auto-detect, Home A/B/C, serial, unattended + parallel gate. |
| 2026-07-17 | MVP tab + serial + `queues.json` đã ship. Queue-of-queues B ship (`feat` schedule containers). |
| 2026-07-17 | Audit: note vs code; E1–E11 edge cases. Checklist A/B/C `[x]` là drift. |
| 2026-07-17 | **Chốt Home:** bỏ A/B/C; Home create khi busy → container tạm **`home`** (reuse, append jobs), schedule serial, **tự xóa** khi xong hết video trong lô home. Chỉ Homepage. |
| 2026-07-17 | **Bước 0** baseline OK (queue-of-queues B live; Home spillover chưa code). **Bước 1** store: `HOME_QUEUE_ID`, `ensureHomeQueue`, `shouldAutoDeleteHomeQueue` (giữ nếu còn failed). |
| 2026-07-17 | **Bước 2** runner: after drain `maybeAutoDeleteHome` for ephemeral only. |
| 2026-07-17 | **Bước 3–4** `spillHomeCreateIfBusy` + `projects:create` return `started|queued`; Home passes `source:home`; toast + no openProject when queued. |
| 2026-07-17 | **Bước 5** list badge `Tạm · Home`; hide rename on ephemeral. |
| 2026-07-17 | **Bước 6** final: queue unit tests + typecheck green. Manual smoke (busy Home → home → auto-delete) owner TBD. |
| 2026-07-17 | **Fix:** Home **smoke** đi `settings:renderSmoke` immediate → bỏ qua spill. Giờ runner **busy** → smoke job vào `home` + toast. Cần **Bắt đầu** queue (chỉ add job chưa `isBusy`). |

---

*Hết working note tạm — cập nhật khi ship Home spillover / harden E2–E3.*
