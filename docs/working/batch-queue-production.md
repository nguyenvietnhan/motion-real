# Working note (TẠM) — Batch / queue sản xuất video

> **Không phải contract.** Không thay `AI_CONTRACT.md` / `docs/current/*`.  
> Xóa file này (hoặc gộp vào doc bền) khi kết quả đã sync vào `docs/current/` hoặc track đóng.  
> Ngày ghi: 2026-07-16  
> Liên quan: `docs/working/production-automation-track.md` (mục 1.3 Queue / multi-job).  
> Nền unattended đã có: `reviewMode: skip_edit` + tắt script gate + tắt image human review.

---

## 0. Product intent (chốt với owner)

MotionReal là tool **sản xuất video short-form tự động**. Owner muốn **treo máy chạy nhiều video** theo **hàng đợi tuần tự** (serial), thấy được trạng thái từng cái, thông báo như bình thường khi xong/lỗi.

**Không làm trên note này (và không ship cùng MVP):**

- Render **song song** nhiều project (process giả định 1 workflow render; registry + bundle cache — xem `docs/current/maintenance.md` Parallel Render Assumption).
- Editor layout / template catalog / theme authored (cấm contract).
- Hủy giữa chừng job đang encode để “nhảy” video Home ngay (destructive + cancel phức tạp) — trừ khi owner đòi sau.
- Nhiều queue active cùng lúc trong một process — **1 queue active / process** là đủ.

---

## 1. Hai cửa vào — cùng một hàng đợi

### 1.1 Tab sidebar riêng (cách dùng chính)

- Thêm **một tab bên sidebar** dành cho chức năng sản xuất hàng loạt / hàng đợi (tên UI TBD, ví dụ “Hàng đợi”).
- Owner vào tab → tạo / mở **một project queue (container)**.
- Trong đó **thêm bao nhiêu prompt tùy ý** (URL/ảnh theo create path hiện có nếu reuse — scope input TBD lúc implement).
- Tool **tự render lần lượt hết** số job trong queue.
- **Thông báo như bình thường** (reuse job-notify: OS + in-app khi done/fail; không invent notify stack mới).

### 1.2 Tự nhận biết (khả năng phụ, không thay tab)

- Nếu đã có video đang tạo / đang render (job `running` hoặc chuỗi queue còn việc).
- Owner prompt / create **thêm** một video nữa.
- App **tự nhận** “đang có việc trước” → tạo project (tên tạm được) và **xếp vào chuỗi queue**, không chen ngang job đang chạy.
- Mục tiêu: owner **thấy và quản lý** được chuỗi: video nào tới đâu, bao nhiêu cái, cái nào xong / chưa / fail.

**Tên project tạm:** không cần đẹp lúc tạo (slug từ prompt, `Queue N`, …) — chỉ cần `projectId` thật + label hiển thị.

---

## 2. Mô hình runtime (khung vững, tối thiểu)

```text
Queue container (1 active / process)
  jobs[]: ordered list
    job = { projectId, prompt/input, status, ... }

status (tối thiểu):
  queued | running | done | failed | cancelled

Worker (serial, concurrency = 1):
  while next job:
    run existing create → unattended path (skip_edit + gates OFF khi production treo)
    on settle → next
```

**Ràng buộc kỹ thuật đã có trong repo (không “chỉ thiếu nút”):**

| Ràng buộc | Hệ quả cho queue |
| --- | --- |
| `inFlight` per `projectId` | Một project một loop author/render |
| Bundle/composition cache + registry process-wide | **Không** parallel cross-project trong 1 desktop process |
| `withProjectRenderLock` | Chỉ khóa cùng project; queue serial = an toàn hơn parallel |
| Draft-first / `skip_edit` auto full | Queue production dựa unattended settings; không silent mock TTS |

Worker = **scheduler** trên create + workspace path hiện có — không rewrite orchestrator/render-grid.

---

## 3. Conflict: quên, ra Home create trong khi đang có queue

### 3.1 Tình huống

- Owner **đã có** project queue (còn job `running` và/hoặc `queued`).
- Quên → ra **trang chủ (Home)** → prompt create **một video ngoài** tab queue.

### 3.2 Bắt buộc hỏi (không im lặng xếp hàng)

Thông báo / dialog kiểu:

> Bạn đang có hàng đợi đang chạy. Video mới này muốn xếp thế nào?

| Lựa chọn | Ý nghĩa | Thứ tự sau khi chọn |
| --- | --- | --- |
| **A. Xếp cuối queue** | Làm **hết** các job queue hiện tại → mới tới video Home | `…queued…` → **Home job** |
| **B. Ưu tiên sau job đang dở** | **Không** hủy video đang render. Xong job `running` → **Home job** → rồi mới các job queue còn lại | `running` → **Home** → các `queued` cũ… |
| **C. Hủy / không tạo** | Đóng dialog, không tạo project Home | Queue giữ nguyên |

### 3.3 Biến thể cùng khung

| Case | Xử lý |
| --- | --- |
| Queue **idle** (không job running/queued, hoặc paused hết việc) | Home create **bình thường**, không dialog conflict |
| Chỉ còn **1 job đang dở**, không còn `queued` | A ≈ B → gộp copy: *“Xong cái đang làm rồi làm video này”* + Hủy |
| Create **trong tab Queue** | Luôn enqueue vào container; **không** dialog Home-conflict |
| Home create khi **không** có queue active | Như flow create hiện tại |
| **1 queue active / process** | Tránh N container song song; đủ cho “thg chủ quên Home” |

### 3.4 Không mặc định ship (destructive / phức tạp)

- “Dừng hết queue, chỉ làm video Home” — destructive; chỉ add khi owner đòi.
- Preempt: abort encode đang chạy để nhảy Home ngay.
- Kéo-thả sắp xếp vị trí tùy ý giữa queue (editor queue) — add khi cần.

---

## 4. UI / quản lý (owner nhìn thấy gì)

Tab queue tối thiểu:

- Danh sách job: label/tên tạm, prompt rút gọn, `status`, stage/progress (reuse workspace stage / friendly status hiện có nếu được).
- Số lượng: tổng / đang chạy / chờ / xong / fail.
- (Implement sau, không chặn khung) pause queue, cancel một job `queued`, retry job `failed`.

Notify: **reuse** path notify hiện có khi job settle (done/fail); không spam mỗi percent tick.

---

## 5. Settings / unattended (nhắc, không redesign)

Để “treo cả chuỗi” không kẹt UI người:

- `reviewMode = skip_edit`
- `scriptGateEnabled = false` (script gate **vẫn dừng** dù skip_edit — đã verify unit)
- `imageCrawlHumanReview = false` nếu URL crawl
- TTS + gateway + model ready (không silent fallback mock)

Preset “Full auto” gộp knob = nice-to-have riêng (track 1.2); **không** chặn queue MVP.

---

## 6. Phạm vi implement gợi ý (khi bật tay — chưa làm trong note này)

Thứ tự slice đề xuất (serial, ít file):

1. **Model + worker serial** (in-memory hoặc JSON dưới `.video-tool/` nếu cần sống qua session — persist **chỉ khi** cần resume crash; ponytail: RAM-first nếu đủ).
2. **Tab sidebar + list status** + “thêm prompt vào queue”.
3. **Enqueue-on-busy** (tự nhận biết).
4. **Home conflict dialog** A / B / C.
5. Tests: thứ tự A vs B; idle không dialog; serial không start 2 running.

**Sensitive (không đụng “cho sạch”):** `orchestrator.ts`, `render-grid.ts`; workspace controller chỉ wire scheduler, không big-bang rewrite.

---

## 7. Checklist chốt ý owner (đã nói trong chat)

- [x] Tab sidebar riêng cho sản xuất hàng loạt.
- [x] Cách dùng chính: trong tab tạo queue container → thêm N prompt → tool render hết → notify như bthg.
- [x] Khả năng tự nhận biết: đang làm video / đang queue → create thêm → thành job trong chuỗi, tên tạm OK, thấy progress từng cái.
- [x] Worker **serial** (xong cái này mới cái kia); không parallel.
- [x] Home create khi đang có queue → **hỏi** A (cuối queue) / B (sau job dở, chen trước các queued còn lại) / C (hủy).
- [x] Không im lặng auto-pick A hoặc B.
- [ ] (Chưa chốt UI copy tiếng Việt cuối / tên tab.)
- [ ] (Chưa chốt persist queue qua restart app.)
- [ ] (Chưa chốt cancel/pause/retry chi tiết trên tab.)

---

## 8. Out of scope rõ ràng

| Không | Vì |
| --- | --- |
| Cross-project parallel render | Design gate cache/registry (`maintenance.md`) |
| Queue service / job framework ngoài process | YAGNI; 1 desktop process đủ |
| Đổi contract AUTHOR / admission | Queue không đụng scene import rules |
| Thay notify stack | Đã có `job-notify` |

---

## 9. Done khi (definition of done khung product)

1. Owner vào tab queue, nhồi N prompt, treo máy → N video lần lượt (hoặc fail rõ từng cái) + notify.
2. Đang bận mà create thêm (tự nhận / hoặc sau dialog Home) → list queue phản ánh đúng thứ tự.
3. Home + queue active → luôn có confirm A/B/C; không mất job im lặng.
4. Không bao giờ 2 full/author-render workflow song song trong cùng process.

---

## 10. Nhật ký

| Ngày | Ghi chú |
| --- | --- |
| 2026-07-16 | Tạo note: gom intent tab queue, auto-detect, Home conflict A/B/C, serial worker, nền unattended + parallel gate. Chưa implement. |
