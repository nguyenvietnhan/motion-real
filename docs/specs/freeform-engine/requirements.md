# Requirements — Freeform Engine (cuộc "thay máu")

> Tài liệu nền móng. Đây là bản **thay máu** toàn hệ thống, KHÔNG phải vá thêm.
> Nhánh táo bạo trở thành dự án CHÍNH (greenfield). Mọi quyết định đã chốt với
> chủ dự án nằm ở §0. Requirements viết theo EARS để pha Design map thẳng được.
>
> Trạng thái: **ĐÃ TRIỂN KHAI PHẦN LỚN CHO ĐƯỜNG TIKTOK**. A–I + K + L đã được
> hiện thực trong repo hiện tại; J (YouTube author-by-segment / true long-form
> main-video path) vẫn chưa xong. Tài liệu này giữ vai trò requirements gốc +
> checklist đối chiếu, không phải lời hứa mọi mục đều production-ready.

## 0. Quyết định đã chốt (binding)

| # | Quyết định | Hệ quả |
| --- | --- | --- |
| D0 | **Greenfield.** Nhánh freeform thành dự án chính; commit gọn rồi đi tiếp. Dự án DỌC cũ bị bỏ, không migrate. | Không có lớp tương thích ngược cho project cũ. |
| D1 | **Xoá hẳn `@news/design`** (lớp style/design-language). Lỗi tới đâu dựng **theme trung tính** tới đó. | `@news/blocks` phải hết phụ thuộc design; mọi style đa-ngôn-ngữ biến mất. |
| D2 | **Amended thực tế:** `@news/blocks` chỉ còn là runtime nội bộ + `SceneImage`; authored scenes KHÔNG được import blocks/theme. | Layout-block toolkit bị xoá khỏi whitelist để tránh mọi video một khuôn; scene viết raw JSX/SVG. |
| D3 | **2 format:** TikTok = **9:16 dọc**, YouTube = **16:9 ngang**. CANVAS thành tham số theo format. | Mở khoá aspect-ratio là phần LÕI, không còn "phase sau". |
| D4 | **Thời lượng khoá theo mức.** TikTok: 45s / 1p30 / 2p30. YouTube: 5p / 7p30 / 10p (cảnh báo render rất lâu + tốn quota). | Là ĐÍCH để viết tới (ngân sách từ), lệch cho phép ≤ 20s, KHÔNG cắt câu cho đủ giây. |
| D5 | **YouTube author theo ĐOẠN** (chia 8–12 cảnh/lượt rồi ghép), KHÔNG one-shot. Làm RIÊNG, không song song TikTok. | Pha YT là khối lớn riêng; tối ưu render/ghép cảnh là việc liên tục. |
| D6 | **Refine ngầm mặc định 2 pass**, settings 0–5, cảnh báo tốn quota + tăng thời gian. YT refine **chỉ trên cảnh bị QA gắn cờ**. | Người dùng chỉ thấy bản đã đẹp. |
| D7 | **Chỉ giữ oracle "không-bay-khỏi-khung"** + lớp chống-vỡ. Còn lại hạ warning / gỡ. Cẩn thận đừng xích lại. | Oracle layout thành **theo-format**. |
| D8 | **YouTube KHÔNG burn caption** (YT có phụ đề sẵn). TikTok giữ karaoke cháy-chữ. | Caption band chỉ áp cho dọc. |
| D9 | **Tự sinh tiêu đề** + dùng làm tên dự án. TikTok < 100 ký tự (kèm hashtag), YouTube < 200. Cho đổi tên. Trùng → thêm hậu tố. | Tên dự án hết là link/prompt dài. |
| D10 | **Ngôn ngữ tiêu đề/hashtag** người dùng chọn: full Việt / full Anh / trộn. | Áp cho title + hashtag, KHÔNG đổi ngôn ngữ kịch bản. |
| D11 | **BGM người dùng quản lý** (chọn/thêm/xoá). **SFX** phát triển sau. | BGM thành tài nguyên có UI. |
| D12 | **Thumbnail/cover cho cả 2 format** sinh tự động bằng brand card sạch (theme wash + title), không overlay lên frame cảnh thật. | Tránh lỗi chồng 2 khối text lớn; artifact riêng `review/thumbnail.png`. |
| D13 | **Calib tốc độ đọc Vivibe bằng SỐ LIỆU** (đo đi đo lại), không đoán. | Giữ lệch ≤ 20s ở D4. |

---

## R1 — Thả xích A.I (gỡ style)

**Story:** Là người dùng, tôi muốn A.I tự do quyết định toàn bộ hình ảnh, để mỗi
video là sáng tạo riêng chứ không bị ép vào một "look" cố định.

1.1. THE SYSTEM SHALL gỡ bỏ `@news/design` và mọi khái niệm style-pack / design-language khỏi đường quyết-định-hình-ảnh và khỏi UI.
1.2. WHEN một scene được author, THE SYSTEM SHALL KHÔNG áp bất kỳ palette/bo góc/surface/backdrop định-sẵn nào; A.I tự quyết trong chính code scene.
1.3. THE SYSTEM SHALL cung cấp một **theme trung tính** tối thiểu (nền/chữ/1 màu nhấn mặc định) CHỈ để `@news/blocks` còn chạy được; A.I được phép phủ định hoàn toàn.
1.4. THE SYSTEM SHALL giữ `@news/blocks` chỉ cho runtime render (`Captions`,
`LayoutProbe`, timing/motion/fonts/chrome internals) và `SceneImage`. Authored
scenes SHALL NOT import `@news/blocks`/`@news/theme`; chúng viết JSX/SVG/CSS tay
100%.
1.5. WHERE giao diện trước đây cho chọn style/look, THE SYSTEM SHALL loại bỏ lựa chọn đó.
1.6. THE SYSTEM SHALL bỏ mọi prompt-rule ép "đọc style từ theme" trong contract authoring.

## R2 — Chỉ giữ oracle cốt lõi

**Story:** Là người dùng, tôi muốn hệ thống chỉ chặn những lỗi khiến video KHÔNG
ra được hoặc bay khỏi khung, còn lại để A.I tự do, để thoát vòng "lỗi đẻ ra lỗi".

2.1. THE SYSTEM SHALL giữ **hard-block** đúng lớp chống-vỡ: N2 (component lạ), N9 (media remote), N11 (bundle), N12/N13 (timing/audio lock), N16 (determinism), trùng scene-id, spec rỗng.
2.2. THE SYSTEM SHALL giữ **một** oracle layout "không-bay-khỏi-khung" THEO FORMAT (dọc và ngang có ngưỡng riêng) ở mức tối thiểu — đủ chặn nội dung tràn hẳn ra ngoài canvas, KHÔNG nhặt sạn bố cục.
2.3. THE SYSTEM SHALL hạ mọi oracle thẩm mỹ/bố cục còn lại xuống **advisory (warning)** hoặc gỡ hẳn; warning vẫn hiện trong report để refine dùng.
2.4. WHERE một oracle bị hạ/gỡ, THE SYSTEM SHALL giữ self-test của nó (chứng minh nó còn fire khi cần) — không xoá lưới kiểm thử.
2.5. IF một oracle là Vietnamese-only (phiên âm/viết tắt), THEN THE SYSTEM SHALL để nó advisory (không chặn).

## R3 — Kiến trúc tự chữa lành

**Story:** Là người dùng, tôi muốn một scene lỗi không bao giờ làm hỏng cả video,
và hệ thống tự sửa mà không thụt lùi.

3.1. WHEN một scene throw lúc render, THE SYSTEM SHALL hiện fallback an toàn cho scene đó và vẫn render mọi scene khác (video LUÔN ra).
3.2. WHEN reauthor một scene, THE SYSTEM SHALL chỉ NHẬN bản viết lại NẾU scene đó render được; nếu không, giữ nguyên bản trước đó (không bao giờ thụt lùi).
3.3. THE SYSTEM SHALL vá **reply bị cắt cụt** cho đường reauthor (nối tiếp khi `finish_reason:"length"`), giống đường author đã có — hết lỗi `no-code` do reply đứt giữa block.
3.4. IF reauthor thất bại sau số lần thử cho phép, THEN THE SYSTEM SHALL khôi phục code gốc và ghi log có scope-tag (không nuốt lỗi).
3.5. THE SYSTEM SHALL coi fallback là hàm thuần (deterministic), không phá N16.

## R4 — Vòng nhìn-sửa ẩn (refine ngầm)

**Story:** Là người dùng, tôi muốn bản nháp ĐẦU TIÊN tôi thấy đã đẹp, không phải
tự bấm sửa nhiều lần.

4.1. WHEN author xong (bản "mù", chỉ text), THE SYSTEM SHALL tự chạy refine NGẦM trước khi lộ bản nháp cho người dùng.
4.2. THE SYSTEM SHALL render **stills** (1 PNG/scene) cho refine bằng đường KHÔNG-TTS, KHÔNG-MP4-encode, KHÔNG-oracle-nặng — chỉ admit + bundle-một-lần + renderStill.
4.3. WHEN refine sửa MỘT scene, THE SYSTEM SHALL render lại CHỈ 1 PNG của scene đó (không render lại cả bộ).
4.4. THE SYSTEM SHALL chạy refine theo số pass cấu hình (mặc định 2; settings 0–5). Pass đầu = "làm táo bạo/đẹp hơn"; pass sau = "nhìn lỗi sửa lỗi".
4.5. WHEN một pass QA-vision báo hết lỗi đáng kể, THE SYSTEM SHALL **dừng sớm** (không đốt hết số pass).
4.6. WHERE format là YouTube, THE SYSTEM SHALL chỉ refine các scene bị QA gắn cờ (không refine toàn bộ) và cảnh báo quota.
4.7. THE SYSTEM SHALL chỉ ghi đè scene khi bản refine còn render được (kế thừa 3.2).

## R5 — Nhanh hơn, chính xác hơn

**Story:** Là người dùng, tôi muốn quá trình (kể cả refine ngầm) đủ nhanh để
không cảm thấy chờ đợi.

5.1. THE SYSTEM SHALL bundle Remotion MỘT LẦN cho mỗi loạt render stills, tái dùng cho mọi scene trong loạt.
5.2. WHERE đã có audio đo từ lần trước và scene không đổi narration, THE SYSTEM SHALL tái dùng audio (không gọi lại Vivibe).
5.3. THE SYSTEM SHALL hỗ trợ render tập-con scene (theo danh sách sceneIds) ở mọi đường stills.
5.4. THE SYSTEM SHALL có một bộ **calib tốc độ đọc Vivibe** (đo bằng số liệu thật) để ước thời lượng; sai số mục tiêu ≤ 20s (D4/D13).
5.5. WHERE format là YouTube, THE SYSTEM SHALL tối ưu render/ghép cảnh liên tục như một mục tiêu kỹ thuật riêng (D5).

## R6 — Vô hình với người dùng

6.1. THE SYSTEM SHALL KHÔNG lộ bản nháp thô (trước refine) cho người dùng.
6.2. THE SYSTEM SHALL giữ luật draft-trước-full: full chỉ chạy sau khi đã có draft (đã refine).
6.3. WHEN người dùng "Dừng", THE SYSTEM SHALL dừng giữa các pass/scene và khôi phục stage xem-được gần nhất.

## R7 — Hai format video

**Story:** Là người dùng, tôi muốn chọn làm video TikTok hay YouTube, mỗi loại có
khung hình và độ dài phù hợp nền tảng.

7.1. THE SYSTEM SHALL cho chọn format: **TikTok (9:16)** hoặc **YouTube (16:9)**.
7.2. THE SYSTEM SHALL đặt CANVAS theo format: TikTok 1080×1920, YouTube 1920×1080.
7.3. THE SYSTEM SHALL khoá mức thời lượng theo format:
  - TikTok: **45s / 1p30 / 2p30**.
  - YouTube: **5p / 7p30 / 10p** (kèm cảnh báo render rất lâu + tốn quota).
7.4. THE SYSTEM SHALL nhắm tổng lời đọc trúng mức đã chọn; cho lệch **≤ 20s**, KHÔNG cắt câu để ép đúng giây.
7.5. WHERE format là YouTube, THE SYSTEM SHALL author theo ĐOẠN (8–12 scene/lượt, ghép lại), không one-shot (D5).
7.6. THE SYSTEM SHALL áp oracle layout + caption theo format (dọc có caption-band/karaoke; ngang không — D8).

## R8 — Input & ảnh

8.1. THE SYSTEM SHALL cho nhập **link** HOẶC **nội dung chữ** ở cả hai format.
8.2. THE SYSTEM SHALL cho nhập **ảnh kèm** + **cào ảnh** từ link (giữ như cũ) ở cả hai format.
8.3. WHEN có ảnh người dùng đính kèm, THE SYSTEM SHALL bắt buộc dùng tối thiểu một ảnh (giữ luật cũ), tối đa 1 ảnh/scene.
8.4. THE SYSTEM SHALL cấm media remote tại render-time (N9) ở cả hai format.

## R9 — Tiêu đề & tên dự án

**Story:** Là người dùng, tôi muốn được tạo sẵn tiêu đề đăng tải và tên dự án dễ
đọc, copy được ngay.

9.1. WHEN sinh kịch bản, THE SYSTEM SHALL sinh KÈM một **tiêu đề đăng tải**:
  - TikTok: **< 100 ký tự, có hashtag**.
  - YouTube: **< 200 ký tự**.
9.2. THE SYSTEM SHALL cho người dùng chọn ngôn ngữ tiêu đề/hashtag: **full Việt / full Anh / trộn** (D10); KHÔNG đổi ngôn ngữ kịch bản.
9.3. THE SYSTEM SHALL đặt **tên dự án = tiêu đề** (slug hoá); IF trùng, THEN thêm hậu tố ngắn (D9/H).
9.4. THE SYSTEM SHALL cho người dùng **đổi tên** dự án.
9.5. WHEN bản full render xong, THE SYSTEM SHALL hiện tiêu đề (+hashtag) ở màn cuối kèm nút **Copy**.

## R10 — Danh sách dự án (phân trang)

10.1. THE SYSTEM SHALL phân trang danh sách dự án, mặc định **12 dự án/trang** (lưới 3×4); con số cuối chốt ở design.
10.2. THE SYSTEM SHALL hiển thị tên dự án (tiêu đề) thay cho link/prompt dài.
10.3. THE SYSTEM SHALL cho điều hướng trang (trang 2, 3…).

## R11 — Nhạc nền (BGM)

**Story:** Là người dùng, tôi muốn tự chọn/thêm/xoá nhạc nền cho video.

11.1. THE SYSTEM SHALL cho người dùng **chọn** một BGM từ thư viện cho dự án.
11.2. THE SYSTEM SHALL cho **thêm** (import) và **xoá** BGM khỏi thư viện.
11.3. WHERE không chọn BGM, THE SYSTEM SHALL render không nhạc nền (không tự ép).
11.4. SFX: ngoài phạm vi đợt này, phát triển sau (D11).

## R12 — Thumbnail / cover (CẢ HAI format)

12.1. WHERE format là TikTok, THE SYSTEM SHALL sinh một **cover 9:16** (1 PNG)
bằng brand card riêng: theme wash + publish title, không lấy frame cảnh thật làm
nền.
12.2. WHERE format là YouTube, THE SYSTEM SHALL sinh một **thumbnail 16:9** (1
PNG) bằng cùng brand card, canvas theo `geometry("youtube")`.
12.3. THE SYSTEM SHALL cho người dùng xem + tạo lại thumbnail/cover. Không có
scene picker trong hiện trạng, vì cover không dựa vào scene frame.

---

## Phạm vi & phi-phạm-vi

**Trong phạm vi đã triển khai chính:** thay máu engine (greenfield), format
plumbing + canvas geometry, thả xích A.I (gỡ design), oracle hạ advisory, tự chữa
lành + vá reply-cụt, refine ngầm + stills nhanh, tiêu đề/tên dự án/phân trang,
BGM có UI, thumbnail/cover brand-card, calib Vivibe.

**Phi phạm vi (đợt này):** migrate dự án dọc cũ (D0 bỏ); SFX nâng cao (D11);
đa-ngôn-ngữ kịch bản (chỉ tiêu đề/hashtag có chọn ngôn ngữ).

## Mở (chốt ở design, không chặn duyệt requirements)

- O1. Theme trung tính: hằng số cứng hay cho người dùng chỉnh 1 màu nhấn?
- O2. YouTube ghép-đoạn: đã chốt trong design là ghép ở tầng manifest, nhưng
  implementation J chưa làm.
- O3. Số dự án/trang chính xác (12/9/15) + bố cục lưới.
- O4. Thư viện BGM đã chốt/triển khai theo máy:
  `VIDEO_TOOL_HOME/.video-tool/bgm/`, định dạng `.mp3/.m4a/.wav`.
- O5. Oracle layout-ngang: ngưỡng "bay khỏi khung" cho 16:9.
