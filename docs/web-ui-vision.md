# Web UI & Authoring-Engine Vision — discussion log (DRAFT, not yet a spec)

> Status: **brainstorm capture**, not binding. This file records the ideas we
> worked through in chat so they aren't lost as the conversation grows. When we
> agree it's complete, we turn the "Chốt lại" section into a real Kiro spec
> (`.kiro/specs/web-dashboard/`) and build from there. Nothing here changes the
> shipped tool yet.

Date started: 2026-06-07. Context: the `tool-productization` spec is done (style
packs, URL ingest, tracker, doctor, MCP server, bulk loop, CLI, skill + buyer
docs; 228 tests green). This doc is about the **next** layer: a user-facing web
interface + how the AI authoring brain should be wired for the long term.

---

## 0. The starting problem (why this discussion began)

- Today the tool has **no GUI**. Everything is driven by chatting with an AI
  agent (Kiro) + CLI + MCP; output is reviewed by opening the MP4 (or Remotion
  Studio via `preview`).
- The tool has **no in-tool LLM planner by design** — an external AI agent must
  author the scenes. So a non-technical buyer currently must go through an AI
  chat, which is a real barrier for selling.
- Goal of this thread: design the **most fitting** long-term shape — a web
  dashboard + an authoring engine — without weakening the quality bar.
  (Explicitly: quality/fit over speed-to-build. "Thiết kế bao lâu cũng được,
  miễn tốt nhất, phù hợp nhất.")

---

## 1. Roles: two planes

**Control plane (web dashboard) — pure code, NO AI needed:**
- Settings: gắn API key voice (Vivibe), chọn provider/giọng, output path.
- Chọn **style pack** + màu nhấn.
- Quản lý **nhiều dự án** (state, draft/full, ngày tạo).
- **Tiến độ realtime** (dùng `onProgress` đã có → % + log).
- Player nhúng xem **draft**; nút **Approve**; xem **full**.
- Bảng **tracker** cho bulk + chạy/resume.
- (Về sau, đã nói "trước sau gì cũng làm") **tự động upload nhiều nền tảng**
  (YouTube/TikTok/FB) — lớp connector hậu kỳ khi project = done; phần khó là
  OAuth + chính sách nền tảng, không phải render.

**Authoring plane — BẮT BUỘC cần AI:** viết cảnh `.tsx` + manifest + lời dẫn.
Đây là phần duy nhất cần LLM.

Nguyên tắc giữ nguyên: mọi surface (web/CLI/MCP/bulk) đều chạy qua **một
orchestrator một-tiến-trình** (`scaffoldVideoProject`/`renderProject`), giữ
**một registry duy nhất**. Web UI chỉ là một adapter mỏng nữa.

---

## 2. Dung hòa "cần AI" với "muốn dashboard": AI xuống hậu trường

Thay vì bắt người dùng chat, đẩy AI thành **dịch vụ chạy nền (agent worker)**;
dashboard là điểm chạm duy nhất của người dùng.

- **Hướng A — agent worker headless** (đích đến): backend chạy vòng lặp agent,
  tự ingest → author → draft → (người duyệt) → full. AI vô hình.
- **Hướng B — hybrid** (làm ngay được): dashboard lo cơ khí; phần author nối tới
  một agent.

An toàn cốt lõi: dù AI tự động tới đâu, **admission gate + grid N1–N30 +
evidence gate (N9) + draft-first** vẫn chặn ở cuối → **chất lượng không treo vào
việc agent giỏi hay dở**. Đây là điểm bán hàng (chất lượng ổn định).

---

## 3. Nguồn AI: 9Router (đã làm rõ, từng hiểu nhầm rồi sửa)

**9Router** = gateway model **local**, OpenAI/Anthropic-compatible
(`/v1/chat/completions`, `/v1/messages`, streaming, combos auto-fallback,
`/v1/models`). Thêm: image-gen, **TTS, STT, embeddings, web search, web
fetch (URL→markdown)**, vision. Bonus: RTK nén token, fallback 3 tầng.

- Mấu chốt: **Kiro là một provider FREE của 9Router** (`kr/claude-sonnet-4.5`…).
  → người dùng nối Kiro vào 9Router, lấy 1 key 9Router, web trỏ vào đó là dùng
  được mọi AI (kể cả Kiro free), **không khóa nhà cung cấp**.
- Kiến trúc đúng: authoring worker dùng client OpenAI-compatible → `baseURL =
  http://localhost:20128/v1` + key 9Router + chọn model/combo. **Vòng lặp agent
  là CODE của ta**; model chỉ sinh `.tsx`/manifest dạng text, rồi code ta gọi
  scaffold/render. → không bắt buộc model phải function-call xuyên proxy.

**Lưu ý thật lòng:**
- Chất lượng nội dung phụ thuộc model được route tới (Kiro/Claude Sonnet đủ tốt;
  fallback xuống model yếu → nội dung nhạt, grid vẫn chặn lỗi kỹ thuật).
- **TOS:** xài quota free/subscription qua proxy cho sản phẩm thương mại có thể
  đụng điều khoản nhà cung cấp — rủi ro pháp lý/vận hành cần cân nhắc.
- 9Router mặc định chạy local; bán cho người mua chạy máy họ thì OK; làm SaaS thì
  tự deploy 9Router (VPS/Docker).

**9Router KHÔNG tự nạp skill/AGENTS.md của ta** — nó chỉ chuyển tiếp `messages`.
`/skill` là tính năng của client (Kiro), vô nghĩa với API trần.

---

## 4. Giao diện tạo/sửa video: KHÔNG chat — bảng "slide" sửa từng cảnh

(Ý chốt của chủ dự án — ưu tiên hơn ô chat.)

Luồng:
```
Người dùng mô tả ý tưởng / nội dung / link
  → AI render DRAFT v1
  → Hiện bảng kiểu slide PowerPoint: ẢNH TỪNG CẢNH đã render ở draft
  → Mỗi cảnh có 1 Ô SỬA: người dùng coi ảnh → ghi muốn sửa gì cho cảnh đó
  → (thêm) 1 Ô GHI CHÚ TỔNG cho yêu cầu xuyên cảnh + nút Xóa/Thêm/Đổi thứ tự/Đổi look
  → Bấm OK → gom hết delta → GHÉP vào PREPROMPT → prompt hoàn chỉnh → AI
        • sửa chữ thuần (tiêu đề/lời dẫn/CTA): áp THẲNG vào manifest, KHÔNG cần AI, tức thì
        • sửa hình/cấu trúc: AI viết lại ĐÚNG cảnh đó
  → re-render CHỈ cảnh đã đổi (cache giữ cảnh khác byte-identical → nhanh) → DRAFT v2
  → lặp tới khi ưng → FULL RENDER
```

Khớp kiến trúc sẵn có:
- Tool **đã sinh ảnh từng cảnh** ở review (keyframe/contact sheet) → đó là "slide".
- Mỗi cảnh có id ổn định + component + props + narration → sửa surgical theo scene id.
- "Preprompt + ghép delta" = ta sở hữu **template cố định** chứa contract.

Cần nắn:
1. Cảnh có chuyển động → ảnh tĩnh chưa đủ; bắt đầu bằng still, sau cho xem clip mini từng cảnh.
2. Tách **sửa chữ thuần** (áp thẳng manifest, không AI, tức thì) vs **sửa hình/cấu trúc** (cần AI).
3. **Chỉ re-render cảnh đã đổi** (cache reuse) → re-draft nhanh.
4. Thêm **ô ghi chú tổng** + nút thao tác cho yêu cầu xuyên cảnh.
5. Giữ **evidence gate** khi sửa (yêu cầu thêm số liệu không có nguồn → AI từ chối/cảnh báo).
6. (pro) **Lịch sử phiên bản** draft (v1, v2…) để so sánh/rollback.
7. (pro) Cổng **duyệt kịch bản dạng chữ** trước khi render lần đầu (đỡ 1 vòng render).

Kết luận mục này: **âm thầm để chạy, bảng-slide-sửa-từng-cảnh để chỉnh** (thay
cho chat). Trực quan, gom-rồi-gửi (ít vòng AI, rẻ), surgical.

---

## 5. Vấn đề lớn nhất: giao "đống ràng buộc dài cả thước" cho AI thế nào cho ĐÚNG

Nỗi lo: gửi kèm toàn bộ contract mỗi request thì quá dài; tóm tắt thì AI hiểu
sai. → Đổi khung: vấn đề không phải prompt dài/ngắn, mà là **cách GIAO luật + ai
ĐẢM BẢO luật**. **Không bao giờ tóm tắt rồi cầu may.** Giải pháp xếp tầng:

**Tầng 1 — Phân rã tác vụ:** tách author thành bước nhỏ, mỗi bước chỉ cần đúng
lát luật của nó:
- A. Kịch bản/dàn ý → chỉ cần `ai-content-guide` (hook/CTA/evidence/luật VN).
- B. Chọn hình thức mỗi cảnh → chỉ cần `visualization-playbook`.
- C. Viết `.tsx` từng cảnh → chỉ cần `authoring-contract` + API block + hình thức từ B.
→ Mỗi prompt nhỏ mà đầy đủ cho phạm vi của nó.

**Tầng 2 — RAG (full-fidelity, không tóm tắt):** embed toàn bộ contract; truy hồi
đúng đoạn liên quan cho từng cảnh (cảnh chart → kéo mục "chart" + API
`StatBlock/BarChart`). Model nhận nguyên văn đoạn cần. **9Router có endpoint
embeddings** → RAG chạy ngay. Tài liệu vẫn là nguồn sự thật duy nhất.

**Tầng 3 — TRỤ CỘT: Generate → Validate → Repair** (grid là người đảm bảo, không
phải prompt). Không cần model thuộc lòng mọi luật, vì grid N1–N30 + admission là
bộ kiểm định tất định:
```
Model draft → grid kiểm → nếu vi phạm (vd N14/N9/N5) → gửi LẠI đúng lỗi đó
   → model sửa đúng chỗ → kiểm lại → pass
```
→ Luật được "dạy" qua thông báo lỗi cụ thể, đúng lúc. Phần khó (oracle) ĐÃ XÂY XONG.

**Tầng 4 — Prompt caching:** lõi luật bất biến gửi NGUYÊN VĂN nhưng dùng prompt
caching của nhà cung cấp → lần đầu đầy đủ, các lần sau ~10% chi phí + nhanh,
không tóm tắt. *Lưu ý:* cache ăn theo một provider/account ổn định → nên GHIM một
model ổn định cho authoring chính, fallback để cho việc phụ (fallback nhảy
provider dễ miss cache).

**Đỉnh dài hạn — Fine-tune model author riêng:** huấn luyện trên kho video tốt +
contract → design language + luật tiếng Việt "nướng" vào trọng số → prompt cực
ngắn, nhất quán cao nhất. Mỗi video làm ra = dữ liệu huấn luyện. Đánh đổi: tốn
công dataset + chi phí tune, tune lại khi đổi luật, không phải model nào (Kiro
free) cũng tune được. → Làm khi đã có corpus, không phải điểm xuất phát.

**Kiến trúc authoring "phù hợp nhất" (xếp tầng):**
```
Phân rã (A→B→C)
  + RAG kéo đúng lát luật full-fidelity (9Router embeddings)
  + lõi bất biến qua prompt caching (model ổn định)
  + GENERATE → grid N1–N30 VALIDATE → REPAIR theo lỗi cụ thể   ← trụ cột
  ──────────────────────────────────────────────
  (về sau) fine-tune model author riêng từ kho video tốt        ← đỉnh
```

---

## 6. Về skill khi đi qua API (2 kiến trúc worker)

`/skill`, steering, AGENTS.md, MCP = tính năng của **client (Kiro)**, không phải
của model. Có 2 cách dựng worker:

| | (X) API trần + vòng lặp của ta | (Y) Agent-runtime + 9Router làm backend |
|---|---|---|
| Skill/AGENTS.md | Ta tự đọc & nhét vào prompt (preprompt) | Runtime tự nạp (như Kiro) |
| MCP tools | Code ta tự orchestrate | Runtime tự khám phá & gọi |
| 9Router | Nguồn model | Chỉ là nguồn model (kể cả Kiro free) |
| Kiểm soát | Tối đa, gọn | Tiện, "skill chạy như Kiro" |

(Y): runtime (OpenCode/OpenClaw/Cline/Continue/Claude Code/Droid…) tự đọc
`SKILL.md` + `AGENTS.md` + gọi MCP của ta; 9Router chỉ thay model phía sau →
skill "đi theo" qua runtime, không qua 9Router. Skill của ta đang đúng chuẩn
front-matter `name/description` nên runtime hỗ trợ Agent Skills nạp được y hệt.
*Caveat:* phải chọn runtime chạy được **headless/không tương tác** từ web backend.

Lưu ý: với kiến trúc Tầng 1–4 ở mục 5 (phân rã + RAG + repair), phần lớn dùng
(X) là đủ và kiểm soát tốt nhất; (Y) hữu ích khi muốn ít bảo trì prompt.

---

## 7. Khoảng trống / lưu ý vận hành đã ghi nhận

- Nếu người dùng chỉ đưa **tiêu đề** (không link), worker cần **web search** để
  tìm URL trước khi ingest. 9Router có endpoint web search/fetch → có thể dùng.
- `ingest` từng trả `publishedDate` epoch thô — **ĐÃ FIX** (epoch→ISO) trong bản
  hiện tại.
- MCP server `news` nạp `.env` qua `--env-file=.env`; thiếu `.env` thì không khởi
  động (doctor cảnh báo).

---

## 8. CHỐT LẠI (điền khi bàn xong → biến thành spec `.kiro/specs/web-dashboard/`)

> Mục này để TRỐNG cho tới khi cả hai thấy đã đủ. Khi chốt:
> - Quyết: phạm vi web dashboard v1 (control plane trước?).
> - Quyết: worker (X) hay (Y); model/combo mặc định qua 9Router.
> - Quyết: authoring engine bắt đầu tầng nào (đề xuất: Phân rã + Generate-
>   Validate-Repair trước, RAG + caching sau, fine-tune để dành).
> - Quyết: UI review per-scene (slide grid) là tính năng v1 hay v2.
> - Quyết: hosting (local cho người mua vs SaaS).
> Sau đó: tạo spec chính thức và build từ đó.

### Quyết định đã đồng thuận tạm thời (cập nhật 2026-06-07)
- **Không dùng ô chat.** Tương tác = bảng slide review từng cảnh + ô sửa từng
  cảnh + ô ghi chú tổng + nút thao tác (mục 4). ✔ đồng thuận.
- **Silent-first:** AI author âm thầm tới bản nháp; người dùng chỉ thấy tiến độ +
  storyboard mọc dần; chỉ tương tác ở bước review (mục 9.2, 9.6). ✔
- **Progressive disclosure 4 mức** (Mức 0 ẩn engine / 1 luôn hiện / 2 theo ngữ
  cảnh / 3 settings riêng) làm xương sống cho việc "cái nào hiện lúc nào" (mục
  9.3). ✔
- **Ngôn ngữ người dùng:** dịch state kỹ thuật → nhãn thân thiện; lỗi grid hiện
  dạng "đã tự sửa / cần sửa", không phơi mã N-check (mục 9.3, 9.4). ✔
- **Nguồn AI = 9Router** (đa nhà cung cấp, có Kiro free), authoring worker dùng
  endpoint OpenAI-compatible; vòng lặp agent là code của ta (mục 3, 6). ✔
- **Authoring engine xếp tầng:** phân rã (A→B→C) + RAG full-fidelity + prompt
  caching + **generate-validate-repair với grid là trụ cột**; fine-tune để dành
  (mục 5). ✔ (đồng thuận về hướng; thứ tự triển khai sẽ chốt sau)
- **Mọi cổng chất lượng giữ nguyên** (admission, N1–N30, evidence gate,
  draft-first) ở mọi surface. ✔ (bất biến)

### Câu hỏi mở cần chốt (bàn tiếp để làm rõ)
1. **Phạm vi web v1:** chỉ control plane (settings + projects + tạo + xem
   draft/full), hay v1 đã gồm luôn **review-per-scene (slide + ô sửa)**? (cái
   này là trái tim trải nghiệm — có thể đáng đưa vào v1 dù khó hơn.)
2. **Worker khởi đầu:** (X) tự dựng vòng lặp + preprompt, hay (Y) cắm
   agent-runtime headless tự nạp skill+MCP? (ảnh hưởng công sức + độ "đúng chất
   Kiro".)
3. **Định vị bán:** giao repo cho người mua chạy **local** (họ tự dựng 9Router +
   .env), hay **host SaaS** tập trung? (ảnh hưởng kiến trúc, TOS, chi phí.)
4. **Stage 2 (duyệt kịch bản dạng chữ):** bắt buộc, tùy chọn, hay bỏ? (đỡ 1 vòng
   render nhưng thêm 1 bước.)
5. **Render ở đâu:** máy người dùng (Remotion + Chromium nặng) hay server? (liên
   quan câu 3 + cấu hình máy người mua.)

---

## 9. Quy trình làm việc & UX cho người non-tech (có research)

> Mục tiêu chủ dự án đặt ra: KHÔNG nhồi mỗi bước một đống chữ + đống nút; phải
> thông minh, người non-tech hiểu ngay; "cái nào nên hiện lúc nào". Dưới đây là
> nguyên tắc rút từ nghiên cứu UX + cách áp vào tool. (Nguồn ở cuối mục.)

### 9.1 Ba nguyên tắc nền (research-backed)

1. **Time to First Value / khoảnh khắc "Aha"** — người dùng phải đạt "thắng lợi
   đầu tiên có ý nghĩa" càng nhanh càng tốt (ngay phiên đầu); nếu không, tỷ lệ
   quay lại sụp đổ. → Với ta, "Aha" = **xem được bản nháp video đầu tiên**. Suy
   ra: **đừng bắt setup nhiều trước khi tạo**; từ ô nhập tới bản nháp phải ngắn
   nhất. (interaction-design.org; 1capture.io; alexanderjarvis.com)

2. **Progressive disclosure (hé lộ dần)** — chỉ hiện thứ cần cho tác vụ hiện
   tại; đẩy thứ nâng cao/ít dùng sang màn phụ; "để trong tầm với nhưng đừng làm
   ngợp". → Đây chính là thuốc chữa "tràn ngập nút + chữ". (IBM; IDF;
   ui-patterns.com)

3. **Storyboard + sửa-bằng-chữ theo từng cảnh** — chuẩn ngành: chia video thành
   các "shot có nhiệm vụ", review dạng storyboard, sửa bằng cách chỉnh chữ từng
   cảnh thay vì một prompt khổng lồ. → **Xác nhận đúng ý "bảng slide + ô sửa từng
   cảnh" của chủ dự án.** (InVideo "storyboard review + text-based revisions";
   Seedance "scene by scene")

### 9.2 Quy trình làm việc (mental model của người non-tech)

Người non-tech chỉ nghĩ 3 động từ: **Tạo video → Xem & sửa → Lấy/Đăng.** Mọi thứ
khác (style nội bộ, grid, determinism, TTS provider, .tsx, manifest) phải **vô
hình**, chỉ là default.

```
Stage 0 · Setup MỘT LẦN (wizard, xong thì ẩn):
    nối Giọng đọc (key 9Router/Vivibe) + chọn Look mặc định. Hết.

Stage 1 · TẠO:  một ô nhập lớn (chủ đề HOẶC link) + nút "Tạo bản nháp".
    (tùy chọn) 1 dropdown Look. KHÔNG hiện gì khác.

Stage 2 · (thông minh, tùy chọn) DUYỆT KỊCH BẢN dạng chữ trước khi render:
    AI cho xem dàn ý + lời dẫn → sửa chữ ngay → đỡ tốn 1 vòng render.
    (có thể auto-skip cho người muốn nhanh)

Stage 3 · ĐANG TẠO:  thanh tiến độ + storyboard hiện DẦN từng cảnh
    (minh bạch, KHÔNG cần thao tác).

Stage 4 · XEM & SỬA (trái tim):  bảng slide từng cảnh
    [ảnh/clip cảnh] + [ô sửa của cảnh đó] ... + [ô ghi chú tổng] + nút Approve.
    sửa chữ thuần → áp thẳng, tức thì, không AI.
    sửa hình/cấu trúc → AI viết lại CHỈ cảnh đó → re-draft nhanh.
    lặp tới khi ưng.

Stage 5 · XONG:  full render → xem + tải + (về sau) đăng nhiều nền tảng.
```

### 9.3 "Cái nào hiện lúc nào" — 4 mức hé lộ dần

- **Mức 1 — LUÔN hiện (chính):** ô nhập + nút Tạo; player bản nháp; ô sửa từng
  cảnh; nút Approve. Đây là 90% nhu cầu.
- **Mức 2 — hiện THEO NGỮ CẢNH (ở bước review, thu gọn mặc định):** đổi style
  pack, đổi màu nhấn, "tạo lại cảnh này", lịch sử phiên bản (v1/v2), nút
  thêm/xóa/đảo cảnh.
- **Mức 3 — màn SETTINGS riêng (set một lần, ngoài luồng chính):** key AI/9Router,
  giọng đọc, đường xuất, tùy chọn render nâng cao.
- **Mức 0 — KHÔNG BAO GIỜ hiện cho non-tech:** grid N1–N30, determinism, manifest
  JSON, `.tsx`, MCP, tên state kỹ thuật. Chỉ hiện dưới dạng **thông báo thân
  thiện khi cần**: "Cảnh 7 bị tràn chữ — đã tự sửa", không phải "N14 error".

### 9.4 Quản lý dự án (không rối)

- **"Video của tôi"** = lưới thẻ: ảnh đại diện + tiêu đề + **nhãn trạng thái thân
  thiện** + ngày. Bấm thẻ → mở storyboard/review của video đó.
- **Dịch state kỹ thuật → ngôn ngữ người dùng:** `scaffolded/tts/locking/
  rendering` → "Đang dựng…"; `reviewing`/có draft → "Nháp sẵn sàng để duyệt";
  `done` → "Hoàn tất"; `failed` → "Gặp lỗi — thử lại". Không phơi tên kỹ thuật.
- **Bulk/Queue** (tracker) đặt sau một tab **"Hàng loạt / Nâng cao"**, không bày
  ra cho người chỉ làm 1 video.

### 9.5 Settings không rối

- Gom theo **ý định, không theo kỹ thuật:** "Giọng đọc", "Phong cách mặc định",
  "Tài khoản AI (9Router)", "Xuất & Đăng". Mỗi nhóm **thu gọn**; chỉ hiện field
  thật sự cần; **default thông minh** để đa số không cần mở lại settings sau
  onboarding.
- (tùy) **Chế độ Cơ bản / Nâng cao:** mặc định Cơ bản (chỉ nhập + tạo + duyệt);
  bật Nâng cao mới lộ điều khiển style/scene/version — progressive disclosure
  theo trình độ người dùng.

### 9.6 Suy ra: ĐẶT AI vào đâu (giờ mới trả lời được, vì đã có quy trình)

- **Stage 1→3:** AI **author âm thầm** ở backend (worker qua 9Router) +
  **generate-validate-repair** với grid (mục 5, Tầng 3). Người dùng chỉ thấy
  tiến độ + storyboard mọc dần.
- **Stage 4:** AI **chỉ được gọi lại khi người dùng bấm OK** với các ô sửa (gom
  theo batch). Sửa chữ thuần = không AI (tức thì); sửa hình = AI chỉ đụng cảnh
  đó.
- AI **không bao giờ là một ô chat**; nó là "thứ tạo ra và sửa video". Đúng tinh
  thần "không cho chat gì hết" (mục 4).

### 9.7 Nguồn tham khảo (đã đọc, diễn giải lại cho phù hợp giấy phép)

- Progressive disclosure: interaction-design.org/literature/topics/progressive-disclosure;
  ibm.com (Carbon design — progressive disclosure); ui-patterns.com/patterns/ProgressiveDisclosure
- Time to first value / Aha moment: 1capture.io/blog/onboarding-best-practices-saas-trials;
  alexanderjarvis.com (Time to First Value); onboard.io (Days to Launch & TTV)
- Storyboard + text-based revision: info.invideo.io (storyboard review + text-based editing);
  seedance.tv/blog/seedance-storyboard-workflow-2026 (scene-by-scene)

> Nội dung các nguồn đã được diễn giải lại để tuân thủ giấy phép.
