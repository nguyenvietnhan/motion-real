# Freeform Pivot + Vòng lặp Vision tự động

> Ghi chú ý tưởng (branch `pivot/freeform`) đã được triển khai phần lớn qua nhóm
> L trong `docs/specs/freeform-engine/tasks.md`. Tài liệu này KHÔNG phải hợp đồng
> cứng; hợp đồng hiện hành nằm ở `CLAUDE.md`, `docs/architecture.md`, và task
> status. Triết lý vẫn đúng: **sáng tạo không điểm dừng, bỏ ràng buộc khô khan**.
> Oracle thẩm mỹ KHÔNG còn là toà án chặn render — chúng hạ xuống cố vấn. Thứ
> duy nhất được phép chặn là admission/security + render-integrity.

**Hiện trạng code:** desktop chạy hidden stills-first flow trước draft MP4:
render stills bản 1 → creative bootstrap toàn cảnh → render stills bản 2 →
vision QA `refinePasses` vòng (early-stop khi 2 pass sạch liên tiếp, nếu bật) →
mới render draft MP4 thật. Sửa sau draft bỏ creative bootstrap và chỉ chạy vision
QA trên cảnh liên quan.

---

## 0. Vì sao pivot (bối cảnh)

Dự án từng kẹt vòng "lỗi đẻ ra lỗi": 4 lỗi khác nhau (N10 radius, N3 headline,
N10 marginHorizontal, N3 canDoText) đều CÙNG MỘT HỌ — một oracle từ chối một
video **đáng lẽ render ngon**. Kết luận: chính các hard-gate là bệnh, không phải
triệu chứng. Tham vọng "hoàn hảo tuyệt đối nhờ ràng buộc" đã bóp chết sáng tạo.

Quyết định: **cho AI thoả sức sáng tạo, không khuôn news/style**, miễn thứ tạo ra
**lóa mắt, cuốn hút**. Lỗi nhỏ giật cục chấp nhận được — người xem không để ý.

---

## 1. ĐÃ LÀM — hạ oracle xuống warning (đã verify: typecheck + 647 test + build OK)

**Điều kiện tiên quyết đã gắn:** per-scene error boundary trong
[video.tsx](../packages/compositions/src/video.tsx) (`SceneErrorBoundary`). Một
cảnh throw lúc render → hiện fallback (headline + eyebrow trên surface an toàn),
các cảnh khác vẫn render. **Video LUÔN ra.** Boundary là hàm thuần của subtree →
N16 determinism không đổi. Đây là tấm lưới khiến việc hạ N10 trở nên an toàn.

**Hạ xuống `warning`** (vẫn hiện trong report + route reauthor, KHÔNG chặn render):

| Oracle | Là gì | File |
| --- | --- | --- |
| N3 | Zod prop mismatch | [static-grid.ts](../packages/pipeline/src/safety/static-grid.ts) |
| N6/N7 | Đánh vần phiên âm / viết tắt cách quãng (heuristic tiếng Việt — luôn sai với Hàn/Đức/Anh) | [content-rules.ts](../packages/pipeline/src/safety/content-rules.ts) |
| N14 ×4 | safe-area, content-zone, caption-clearance, divider-clearance (= khung news 9:16) | [render-grid.ts](../packages/pipeline/src/safety/render-grid.ts) |
| N10 | Typecheck cảnh authored — hard cho lỗi dễ tạo SceneFallback; warning cho lỗi runtime-safe đã biết | [typecheck-authored.ts](../packages/pipeline/src/safety/typecheck-authored.ts) |
| N1 | Non-sequential scene id + multiline narration | [static-grid.ts](../packages/pipeline/src/safety/static-grid.ts) |

**GIỮ CỨNG** (crash-class / không-ra-video — vision KHÔNG thay được, đừng bỏ):
N2 (component lạ), N9 (ảnh remote), N10 crash/fallback-prone, N11 (bundle),
N12/N13 (timing/audio), N16 (determinism), duplicate scene id, empty spec.

**Nới prompt** ([prompt.ts](../apps/desktop/src/main/authoring/prompt.ts)): vai trò
AI "biên tập viên tin tức" → "tác giả video sáng tạo cho MỌI chủ đề"; mục tiêu
"thật lóa mắt"; CTA không buộc kiểu news; QA chỉ soát lỗi bố cục. Giữ tiếng Việt
(đa ngôn ngữ là phase sau) + giữ luật "táo bạo từ bản đầu".

---

## 2. INSIGHT CỐT LÕI — "bản đầu luôn kém sáng tạo" KHÔNG phải hên xui

Quan sát lặp lại: lần author đầu **lúc nào cũng rụt rè**; phải pass 2 mới đẹp.

**Nguyên nhân cấu trúc (không phải prompt dở):**
- **Pass 1 (author) viết MÙ** — chỉ có text, không thấy gì mình đang tạo.
- **Pass 2 (reauthor) được NHÌN ảnh render** (`stillDataUrl` gắn vào prompt).
- Model `ag/gemini-3-flash-agent` vốn yếu sáng tạo → khi mù thì chơi an toàn;
  khi thấy khung mình vừa dựng mới biết đường đẩy mạnh.

→ Đây là **vòng phản hồi thị giác**, không phải may rủi. Tự động hoá nó =
"bản đầu đã đẹp".

---

## 3. Ý TƯỞNG CHÍNH — vòng lặp vision tự động (giấu bước xấu đi)

```
author (mù, chỉ text)
└─ stills (1 PNG/cảnh — KHÔNG TS, KHÔNG encode ffmpeg — rẻ nhất, đã có sẵn)
   └─ enhance pass 1 (vision): "mày rụt rè quá — đây là khung, làm TÁO BẠO hơn"
      └─ stills lại
         └─ enhance pass 2 (vision): "đây là khung — nhìn lỗi bố cục, sửa"
            └─ … lặp tới maxPasses (chỉnh trong SETTING)
               └─ render draft THẬT (1 lần duy nhất) → đưa người dùng xem
```

**Phân biệt quan trọng:**
- **Pass vision ĐẦU = "làm đẹp/bạo hơn"** (vì bản mù luôn rụt rè).
- **Các pass sau = "nhìn lỗi, sửa lỗi"**.

**Vì sao dùng `stills` chứ KHÔNG render video 1fps:** chế độ stills render mỗi
cảnh đúng 1 khung PNG — bỏ TTS (không tốn tiền Vivibe), bỏ mux audio, bỏ encode.
Video 1fps vẫn phải đi qua TS + encode. Stills rẻ hơn hẳn và là đúng input N14/N15
đang decode. Ta KHÔNG render hai lần — chỉ thêm: N lần stills (rẻ) + N lượt vision.

**Người dùng tưởng "bản đầu đẹp sẵn"** vì các bước stills + enhance chạy ngầm,
chỉ draft cuối hiện ra.

---

## 4. HAI CÁI BẪY phải xử TRƯỚC khi dựng vòng lặp

### 4.1 Path reauthor đang bị CẮT CỤT reply (BẮT BUỘC vá trước)
Bằng chứng trong log thật: `no-code` scene-03 — reply đứt ngay giữa hàm SVG,
không có fence ` ``` ` đóng. Model CÓ trả code, chỉ là reply bị truncate.
- Path **author** đã có vá nối-reply-cụt (stitching).
- Path **reauthor** thì **CHƯA**.
- Nếu dựng vòng lặp 3 pass trên path cứ vài lần rớt 1 cảnh → nó âm thầm **giữ
  cảnh cũ**, người dùng tưởng "đã sửa" nhưng thật ra đứng yên. → Vòng lặp xây trên cát.

→ **Việc #1: vá stitching cho path reauthor** (mirror cái author đã có).

### 4.2 Chỉ NHẬN bản viết lại nếu still của nó render được
Viết lại 1 cảnh → render still cảnh đó → **OK thì giữ, throw thì TRẢ VỀ bản cũ**.
→ Vòng lặp **không bao giờ làm cảnh tệ đi**; tệ nhất là đứng yên ở bản tốt trước đó.
(Error-boundary lo "không vỡ video"; cái này lo "không thụt lùi".)

---

## 5. HAI cải tiến để nó THẬT SỰ ngon hơn (không chỉ chạy được)

1. **Tự dừng sớm.** Máy QA-vision đã trả `{issues:[{sceneId,issue,severity}]}` có
   cấu trúc (`buildVisualQaMessages`). Pass nào QA báo "hết lỗi high" → dừng,
   khỏi đốt đủ maxPasses. Pass 1→2 là cú nhảy lớn; 2→3 với flash thường loanh
   quanh, có khi **làm hư cảnh đang đẹp**. maxPasses là TRẦN, không bắt chạy đủ.
2. **Accept-gate bằng still render** (đã nói ở 4.2) — bảo đảm monotonic không tụt.

---

## 6. Vision THAY gì, KHÔNG thay gì (nói thẳng)

- **THAY được:** oracle *thẩm mỹ / bố cục* — N14/N15/N30 (cái mắt người mới phán
  được, oracle đoán mò). Đây đúng là "mấy oracle tào lao" đáng bỏ vai gác cổng.
- **KHÔNG thay được:** crash-class — N2, N11, N16, N9. Vision không nhìn ra
  "bundle vỡ" hay "render không tất định". Giữ cứng.

Tức: vision nhận vai **"soi đẹp/xấu"**, KHÔNG nhận vai **"chống vỡ"**.

---

## 7. Tradeoff thật (để không bị bất ngờ)

- Draft đầu **lâu hơn rõ**: mỗi pass = 1 lượt stills (~30s) + ~12 lượt gọi flash.
  3 pass có thể thêm 5–8 phút trước khi thấy video.
- "Nhanh hơn" ở đây = nhanh hơn **vòng sửa tay thủ công của người dùng**, KHÔNG
  nhanh hơn draft hiện tại.
- Enhance **không phải lúc nào cũng đẹp hơn** — đôi khi làm rối cảnh đang ổn.
  (Mục 5.1 + 5.2 giảm rủi ro này.)
- Đổi lại: thứ đầu tiên người dùng thấy **đã đẹp, 0 vòng sửa tay**.

---

## 8. Quyết định đã chốt / còn treo

1. **Per-scene vs contact-sheet:**
   - *Per-scene* (gửi từng ảnh, viết lại từng cảnh): chắc tay, mỗi lần chỉ đẻ 1
     block → **ít rủi ro truncation hơn**. Chậm hơn. → **Đang nghiêng về cái này.**
   - *Contact-sheet 1 call* (ghép hết ảnh, 1 lượt, trả nhiều block): nhanh, nhưng
     bắt flash trả ~12 block/reply → **càng dễ cắt cụt**.
2. **Default maxPasses:** đã chốt thành `refinePasses` default 2, clamp 0–5.
3. **Early stop:** đã chốt thành `refineEarlyStop`, dừng khi 2 pass vision liên
   tiếp sạch; tắt thì chạy đủ budget.

---

## 9. Việc cần làm (khi chốt dựng)

- [x] **Vá reply cụt path reauthor/parser** (thu hồi code fence chưa đóng khi có
  thể).
- [x] Dựng vòng lặp: author → stills bản 1 → creative bootstrap → stills bản 2 →
  vision QA×N → render draft.
- [x] Accept-gate/snapshot-restore: cảnh refine không render được thì giữ bản cũ.
- [x] Early-stop qua QA-vision: 2 pass sạch liên tiếp khi `refineEarlyStop` bật.
- [x] Setting `refinePasses` (default 2, clamp 0–5).
- [x] Prompt enhance: bootstrap = "bạo/đẹp hơn"; vision pass = "sửa lỗi nhìn thấy".
