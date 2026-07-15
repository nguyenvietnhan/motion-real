# Working note (TẠM) — Production automation track

> **Không phải contract.** Không thay `AI_CONTRACT.md` / `docs/current/*`.  
> Xóa file này (hoặc cả thư mục `docs/working/`) khi kết quả đã sync vào doc bền hoặc track đóng.  
> Branch làm việc: `track/production-automation`  
> Ngày ghi: 2026-07-16  
> Đã đối chiếu code/docs trước khi ghi (không chỉ “ý tưởng”).

---

## 0. Product intent (đã chốt với owner)

MotionReal là **tool sản xuất video short-form tự động + nhanh**, không phải editor ngồi chỉnh lâu.

- User **chọn mức phù hợp** qua Settings / create knobs (nhiều knob là **cố ý**, không phải rối).
- Mục tiêu: **input (link / prompt / ảnh) → máy chạy theo mức đã chọn → full MP4**, ít hoặc không dừng duyệt nếu user chọn full-auto.
- Setting nâng cao = **độ tự động hóa / chất–tốc–rủi ro**, giống preset máy sản xuất.

**Không làm trên track này:** “cắt bớt advanced settings cho đỡ rối”, landscape/YouTube, layout-block kit, theme token authored, rewrite orchestrator “cho sạch”.

---

## 1. Bốn hướng làm việc (chi tiết + đã verify)

### 1.1 Cứng unattended path  
**(link/prompt → full theo preset, fail rõ, re-run được)**

#### Ý nghĩa dễ hiểu

User chọn mức “chạy một mình” → dán link/prompt → bấm tạo → **không cần ngồi duyệt** → quay lại có **MP4 full**, hoặc **lỗi rõ + bấm thử lại được**.

#### Hiện trạng đã verify trong repo

| Hạng mục | Nguồn | Trạng thái |
| --- | --- | --- |
| `reviewMode`: `full` \| `stills_edit` \| `skip_edit` | `SettingsModel`, Settings tab **Dựng video** (`docs/current/maintenance.md`) | Có |
| Default review mode | `DEFAULT_REVIEW_MODE = "full"` (`settings-model.ts`) | Default **có dừng** (draft), không phải skip |
| `skip_edit` sau stills → **auto full**, không stage `ready` | `WorkspaceController.runRender` + test `skip_edit: after stills goes straight to full publish` | **Code đúng unattended** |
| Không có draft → `forceFull: true` khi publish | `runPublish` + test publish | Đúng contract desktop |
| Silent refine **vẫn chạy** trước auto full (độc lập reviewMode) | `runRender` + test refine before auto full | Có |
| Create-time BGM trước skip_edit auto-full | `create-controller.ts`, `index.ts`, Home BGM picker | Có (cần cho full có nhạc) |
| Retry hint: `create` / `draft` / `full` | error stage + `App.tsx` “Thử lại” + `projects:retry` | Có khung |
| Retry rehydrate brief sau restart | `recallInput` / `retry()` trong workspace | Có (brief hỏng → chỉ in-session) |
| Contract mô tả skip_edit | `AI_CONTRACT.md` Runtime Workflow | Khớp code |

#### Drift / bẫy đã phát hiện (nhớ khi làm)

1. **Comment sai trong `types.ts`:**  
   `ReviewMode` ghi `skip_edit`: *“user still approves full”* — **sai**.  
   Code + test + `AI_CONTRACT`: skip_edit **không** dừng review, auto `runPublish`.  
   → Khi đụng file này: sửa comment cho khớp (không đổi behavior).

2. **Gate khác có thể phá unattended** (dù `reviewMode === skip_edit`):
   - `scriptGateEnabled` — dừng duyệt kịch bản trước draft/render.
   - `imageCrawlHumanReview` — màn **chặn** chọn ảnh crawl trước author.
   - Gateway/AI chưa ready, TTS credential missing (không silent fallback — contract).
   - `refinePasses` / repair exhausted → error (đúng, nhưng message + retry phải đủ dùng production).

3. **Unit test skip_edit** giả lập `refinePasses: 0`, tắt script gate / image review.  
   Chưa thay cho **smoke tay** full stack: URL thật + gateway + TTS + skip_edit.

#### Việc làm trên track (1.1) — checklist

- [ ] Ma trận production (manual + ideally automated smoke):

  | # | Input | Settings tối thiểu cho unattended | Kỳ vọng | Unit (2026-07-16) | Manual full stack |
  | --- | --- | --- | --- | --- | --- |
  | A | prompt only | `skip_edit`, script gate OFF, image human review OFF | author → refine? → stills → full → `published` / done | **PASS** (`matrix A: beginScript…`) | **PASS** (2026-07-16, sau fix fonts CSS; full end-to-end) |
  | B | 1–N URL | như A + (tuỳ) image AI filter ON, human review **OFF** | same; claim demote ok, không kẹt UI | partial (crawl tests exist; unattended URL E2E unit chưa gộp) | pending |
  | C | prompt + ảnh local | như A | assets vào project trước author | pending | pending |
  | D | A/B/C + BGM create | BGM chọn lúc Home | full có BGM | historical fix exists | pending |
  | E | A với `stills_edit` / `full` | intentional stop | **có** điểm dừng đúng mode | stills_edit + full covered elsewhere | pending |

- [x] Fail rõ (slice A): full-render fail trên skip_edit → `retry: "full"` (unit). Còn: gateway/TTS/admission classes end-to-end.
- [x] Re-run full: skip_edit fail tags `retry:full` (unit). Rehydrate brief sau restart: already covered by `retry() rehydrates…`.
- [x] Gate phụ: `scriptGate` ON + `skip_edit` **vẫn dừng** `script` (unit) — unattended **bắt buộc** tắt gate.
- [x] Sửa drift comment `ReviewMode` trong `types.ts` (khớp auto full).
- [ ] Ghi defect lặp production (manual) → fixture khi gặp.

**Done khi:** một người production tin được “chọn skip + tắt gate phụ + create → đi làm việc khác → về là full hoặc lỗi actionable”.

---

### 1.2 Preset / profile trên knobs hiện có  
**(nếu cần UX — không thay knobs)**

#### Ý nghĩa dễ hiểu

Knobs (Settings chi tiết) **giữ nguyên**.  
Preset chỉ là **nút “chọn gói nhanh”** gán nhiều knob một lúc (như “In nhanh” trên máy in).

#### Knobs hiện có (đã verify — hệ ghim behavior)

| Knob / control | Vai trò production |
| --- | --- |
| `reviewMode` | Điểm dừng người: draft+edit / stills+edit / **full auto** |
| `scriptGateEnabled` | Dừng sửa narration/headline trước render |
| `refinePasses` (0–5, default 2) | Vòng vision refine im lặng trước draft/stills-ready |
| `refineEarlyStop` | Dừng refine sớm sau 2 pass sạch liên tiếp |
| `maxRepairAttempts` (1–10, default 3) | Budget repair draft/oracle |
| `imageCrawlAiFilter` | AI prefilter ảnh crawl |
| `imageCrawlHumanReview` | **Blocking** review ảnh — **tắt** nếu muốn unattended URL |
| Voice: provider / voice id / model / calibration WPS | TTS + word budget |
| `preferredAiModelId` | Model generate (persist settings) |
| Create: `durationTier`, `videoLanguage`, `bgm`, images, raw/URLs | Input job |
| Gateway 9router ready | Điều kiện chạy AI |

#### Việc làm trên track (1.2)

- [ ] **Chỉ làm sau** khi 1.1 đã cứng, **và** thấy user hay chỉnh 4–5 chỗ mỗi lần.
- [ ] Đề xuất mỏng (ví dụ — chưa chốt UI):
  - **Full auto (link/prompt):** `skip_edit` + script gate OFF + image human review OFF + refine mặc định.
  - **Nhanh – stills:** `stills_edit` + …
  - **Có draft nghe thử:** `full` + …
- [ ] Preset **ghi đè** các field `SettingsModel` đã có; tab advanced **không xóa**.
- [ ] Không thay contract CLI draft-first.

**Done khi:** (nếu ship) chọn 1 profile = đúng behavior đo được; power user vẫn chỉnh từng knob.

**Có thể skip** cả mục này nếu team chỉ dùng một profile cố định và không đau.

---

### 1.3 Feature tăng throughput / auto quality  
**(không feature “ngồi editor lâu hơn”)**

#### Ý nghĩa dễ hiểu

- **Throughput:** cùng thời gian → **nhiều video đăng được hơn**.
- **Auto quality:** khi **không ai duyệt**, video **ít phải làm lại** hơn.

#### Hướng feature (chọn sau bottleneck — không làm simultaneous)

| Ứng viên | Throughput | Auto quality | Ghi chú spine |
| --- | --- | --- | --- |
| Queue / multi-job | Cao | — | Cần lifecycle workspace cẩn thận |
| Notify khi done/fail | Cao (không canh màn) | — | Desktop OS / in-app |
| Retry job / re-run từ fail rõ hơn | Cao | — | Mở rộng retry hiện có |
| Export pack (MP4 + thumb + caption text) | Cao (đóng vòng đăng) | — | Không đụng AUTHOR |
| Brief/prompt presets theo niche | Cao (input nhanh) | Gián tiếp | **Không** visual template catalog |
| Cải thiện class fail lặp (admission/repair/TTS) | — | Cao | Fixture + gate đúng lớp |
| Scene re-author có chủ đích khi auto fail partial | Trung bình | Cao | Sensitive workspace/author |

#### Không ưu tiên trên track

- Editor kiểu Canva / kéo layout lâu.
- Thêm mode review thứ N trước khi 3 mode hiện tại + unattended đã tin cậy.
- Template layout / theme authored (cấm contract).

#### Việc làm trên track (1.3)

- [ ] Sau 1.1 (và defect 1.4): **chọn đúng 1** feature theo bottleneck thật (fail vs chờ vs “xong chưa đăng được”).
- [ ] Spec mỏng + test + không phình IPC contract lung tung.

**Done khi:** metric thô “job/tuần” hoặc “tỷ lệ full không tay” cải thiện, không phải “thêm màn hình”.

---

### 1.4 Pipeline chỉ khi tăng tin cậy / tốc độ / đúng mode production

#### Ý nghĩa dễ hiểu

Sửa “động cơ” **chỉ khi máy gãy, chậm, hoặc sai mode** — không refactor cho đẹp.

#### Sensitive (đọc `maintenance.md` / contract trước khi đụng)

- `packages/pipeline/src/orchestrator.ts`
- `packages/pipeline/src/safety/render-grid.ts`
- `apps/desktop/src/main/workspace/workspace-controller.ts`
- `apps/desktop/src/main/authoring/ninerouter-backend.ts`
- `apps/desktop/src/main/index.ts`

#### Khi nào **được** đụng pipeline / workspace flow

| Được | Không |
| --- | --- |
| skip_edit / mode X **sai behavior** production | “file dài quá, tách cho gọn” |
| Fail class lặp có incident | Big-bang rewrite |
| Latency user-visible (bước thừa không đổi chất) | Tối ưu micro không đo được |
| forceFull / draft-first **lệch** desktop vs CLI policy | Làm yếu draft-first CLI không forceFull |
| Visual QA / refine **nói dối** clean (xem maintenance) | Biến advisory layout thành hard gate không owner |

#### Việc làm trên track (1.4)

- [ ] Mọi fix pipeline: **1 defect → 1 slice → test/fixture → typecheck/test/build** (khi đụng pipeline/desktop authoring).
- [ ] Không mở epic “cleanup orchestrator” song song feature.

**Done khi:** defect production hết + regression test xanh; không tăng abstraction “phòng tương lai”.

---

## 2. Thứ tự thực hiện (vừa làm vừa test)

```text
A. Cứng unattended path (1.1)     ← ưu tiên #1; manual matrix + vá
       ↓ defect lộ ra
B. Pipeline/workspace fix (1.4)  ← scoped + test; không refactor chơi
       ↓ path tin cậy
C. Một feature throughput/auto-Q (1.3)  ← chọn 1 theo bottleneck
       ↓ (tuỳ)
D. Preset/profile (1.2)          ← chỉ nếu knobs đau khi chọn mức
```

Mỗi PR/slice nhỏ; gate:

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

(Desktop smoke tay cho A/B/C matrix khi đụng render thật — cần Chromium/Remotion + 9router + TTS.)

---

## 3. Definition of done (track)

- [ ] Unattended matrix A–E (mục 1.1) đã chạy và ghi kết quả (pass/fail + note) trong file này hoặc PR.
- [ ] Drift comment `ReviewMode` đã xử lý nếu có PR types.
- [ ] Không ship “giảm setting” trái product intent.
- [ ] Working note này **xóa** sau khi outcome vào `docs/current/` (nếu có behavior/doc đổi) hoặc track đóng không doc.

---

## 4. Ghi chú workspace lúc mở track (2026-07-16)

- Branch: `track/production-automation` (từ `main`, main ahead origin ~20 commits tại thời điểm tạo note).
- Working tree **có thể còn** test-cleanup uncommitted từ session trước (xóa vài IPC/baseline tests, shrink helpers) — **không** trộn mù vào PR production-automation; commit hygiene riêng hoặc stash trước slice A.
- File `.mcp.example.json` modified — ngoài scope track; đừng nhét commit.

---

## 5. Log làm việc (điền dần)

| Ngày | Việc | Kết quả | Follow-up |
| --- | --- | --- | --- |
| 2026-07-16 | Tạo note + verify code/docs | skip_edit auto-full OK; types comment drift; gates script/image human | Bắt matrix 1.1 |
| 2026-07-16 | Hygiene commits | test cleanup + working note on branch | — |
| 2026-07-16 | Matrix A unit lock | `ReviewMode` comment fixed; 3 tests (beginScript→published, scriptGate blocks, full fail→retry:full); workspace-controller 73 passed | Manual smoke A; matrix B/C/D |
| 2026-07-16 | Manual smoke A (`test-a7ef7cb9`) | Settings unattended OK. Flow skip_edit ran. **Full fail ×2**: `delayRender` "Loading vendored font Inter 400 vietnamese" ~118s. Earlier stills N31 `row1Scale is not defined` (AI scene) then refine continued. Retry full: TTS/build/runtime/determinism OK → same font timeout. | Fix fonts.ts batch+timeout (1.4 reliability) |
| 2026-07-16 | Smoke retest (`test-eb97afc9`) | New label `Loading vendored fonts` **still** fail ~10s (= our budget − 2s Remotion). Root: module-level delayRender + FontFace.load; Remotion `timeout − 2000`. N4 reauthor noise scene-02. | **Root fix**: drop delayRender entirely; CSS `@font-face` inject theme fonts only |
| 2026-07-16 | Smoke A sau root font fix | User confirmed: render **đầu → cuối** unattended OK (full MP4) | Matrix B/C/D optional; throughput features later |

---

## 6. Liên kết nhanh code

| Chủ đề | Chỗ nhìn |
| --- | --- |
| Review modes + clamp | `apps/desktop/src/shared/settings-model.ts` |
| Settings shape | `apps/desktop/src/shared/types.ts` (`SettingsModel`, `ReviewMode`) |
| skip_edit → publish | `apps/desktop/src/main/workspace/workspace-controller.ts` (`runRender`, `runPublish`) |
| Tests mode | `workspace-controller.test.ts` describe `reviewMode (stills_edit / skip_edit)` |
| Create BGM | `create-controller.ts`, Home knobs / `bgm-picker.tsx` |
| Retry IPC | `projects:retry`, `WorkspaceController.retry`, `App.tsx` error actions |
| Contract flow | `AI_CONTRACT.md` Runtime Workflow + draft-before-full |
| Sensitive / modes | `docs/current/maintenance.md` |

---

*Hết working note tạm.*
