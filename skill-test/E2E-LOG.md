# E2E Log — sac-pin-qua-dem (Phase 4, 25/08/2026)

Agent thực hiện: opencode (ox-alpha) đóng vai agent lạ được gọi skill
make-video. Chủ đề do người vận hành chọn thay vì truyền qua lệnh.

## Kết quả

- Thành phẩm: `V:\downloads\sac-pin-qua-dem.mp4` (35.27s, 1080×1920@30,
  giọng Adam, 6 beat, caption sync theo từ).
- Pipeline chạy thông suốt Stage 0→6 không chết step nào.

## Lỗi gặp phải & cách đã xử lý tại chỗ

| # | Lỗi | Xử lý lúc chạy | Cần vá vào skill/tool? |
| --- | --- | --- | --- |
| 1 | Composition mới ra font SERIF vì quên set `fontFamily` ở root AbsoluteFill (SampleVideo có, composition mới không) | Sửa: set fontFamily ở root + Captions | CÓ — scene-authoring cần luật: "root AbsoluteFill luôn khai báo fontFamily" |
| 2 | Viết `transform: opacity(...)` — CSS không tồn tại | QA frame bắt được, sửa thành `opacity` | Không cần (QA đã chặn đúng) |
| 3 | **TTS Việt nói ~4.2 từ/giây**, không phải 2.7 wps như skill ghi (số của tiếng Anh) → 107 từ chỉ ra 35s thay vì 45s | Chấp nhận video 35s cho lần đầu | CÓ — voice-vieneu/make-video cần bảng wps theo ngôn ngữ (Việt ~4.0-4.3), công thức đếm từ theo tier sửa lại: 45s ≈ 160-180 từ |
| 4 | Video 35.25s < tier 45s (hệ quả của #3) | Chấp nhận lần đầu | CÓ — make-video nên có cảnh báo under-budget khi <80% tier |
| 5 | HF_TOKEN warning in mỗi lần chạy gen_voice | Bỏ qua (cosmetic); offline dùng HF_HUB_OFFLINE=1 | Đã ghi README voice-vieneu rồi — không cần vá |
| 6 | Audio stream 33.45s < video 35.27s (đuôi lặng sau câu cuối) | Chấp nhận — player xử lý tốt | Tùy chọn: apad trong filter cho audio dài bằng video |
| 7 | Stamp hook "KHÔNG HỎNG PIN" xuất hiện ở 0.93s, frame 0 chỉ có title + pin | Chấp nhận — frame 0 vẫn "composed" theo định nghĩa | Không cần |
| 8 | gen_voice đọc "%" thành gì không kiểm chứng được bằng tai (không nghe được) | Phòng ngừa: viết "phần trăm" trong tts_text | CẦN NGƯỜI THẬT NGHE kiểm tra chất lượng giọng + cách đọc số |

## Nhận xét quy trình (agent góc nhìn người dùng skill)

- Skill đủ rõ để chạy không cần hỏi lại: artifact contract + stages +
  Done= hoạt động đúng như thiết kế.
- `gen-job-data.mjs` (machinery sinh data TS từ beats.json) là bước
  skill KHÔNG nhắc tới — agent phải tự chế. Nên đưa vào scene-authoring
  làm bước chuẩn ("chạy generator trước khi viết composition").
- ffmpeg lấy từ hệ thống (winget). Cần ghi fallback: Remotion bundle có
  sẵn ffmpeg trong node_modules nếu máy không có.
- Word-sync hoạt động chính xác: checklist b6 xuất hiện đúng từ
  "bật"/"tháo"/"nóng" (đã QA bằng mắt 7 frame).

## Vòng feedback 2 (25/08, sau khi user xem bản "báo giấy")

| # | Phản hồi | Nguyên nhân gốc | Đã xử lý |
| --- | --- | --- | --- |
| 9 | Chữ caption nhấp nháy liên tục | (a) cửa sổ caption trượt theo từ active → cả dòng reflow mỗi từ; (b) giữa các từ có gap → caption biến mất rồi hiện lại | ✅ Viết lại Captions kiểu karaoke: nhóm 4 từ/thành dòng CỐ ĐỊNH, dòng giữ đến khi dòng mới bắt đầu (không gap), fade-in 1 lần/dòng |
| 10 | Dấu sắc nhích lên xuống liên tục | Đổi fontWeight 600→900 + scale trên từ active làm thay đổi metric glyph → baseline dịch | ✅ Highlight bằng MÀU thôi (weight cố định 700, bỏ scale) |
| 11 | "Style vẫn y hệt, chỉ đổi màu nền" — checklist, pin... không khác | Đợt trước chỉ swap palette+font, không đổi NGÔN NGỮ component | ✅ Thêm structural tokens vào Theme (radius, control pill/square, listStyle check/numbered, cardTopRule); checklist bao-giay giờ là danh sách số serif + kẻ mảnh, toggle vuông viền mực, card có thanh mực trên |
| 12 | Caption mong muốn: câu hiện ra, từ nào nói đến thì hiệu ứng từ đó | Đúng, đã làm đúng ý sau fix #9 | ✅ |

## Câu hỏi HyperFrames (user đặt ra vòng này)

- HyperFrames = framework HTML-to-video của HeyGen (Apache 2.0, 3/2026,
  ~42k sao): HTML + data-attributes + GSAP, render Puppeteer+ffmpeg,
  phát hành dạng Agent Skill. Luận điểm: LLM biết HTML/CSS 25+ năm →
  first-draft tốt hơn TSX.
- Đánh giá sơ bộ: vấn đề "lần 1 luôn xấu, lần 2 mới đẹp" của tool gốc
  là bài toán MÙ (AI không thấy output), không thuần syntax — HyperFrames
  cũng mù như Remotion. NHƯNG syntax quen + GSAP nổi tiếng có thể nâng
  sàn chất lượng code first-draft và giảm lỗi crash.
- Quyết định: KHÔNG rewrite ngay. Làm spike so sánh: dựng lại chính
  video sac-pin-qua-dem bằng HyperFrames (skill `npx skills add
  heygen-com/hyperframes`), đo: chất lượng first-draft, tỉ lệ lỗi,
  effort. Kiến trúc toolbox của ta vốn framework-agnostic ở tầng skill
  (chỉ scene-authoring + starter là gắn Remotion) — swap rẻ nếu spike
  thắng.

## Vòng feedback 3 (25/08, bản "báo giấy" v2)

| # | Phản hồi | Điều tra | Kết luận / xử lý |
| --- | --- | --- | --- |
| 13 | "Chữ NỘI DUNG nhấp nháy + dấu nhích" | PSNR frame liền kề vùng chữ tĩnh = 62dB (giống hệt nhau) → file render MỚI không giật. File cũ `sac-pin-qua-dem.mp4` trong downloads vẫn là bản caption cũ (trượt + đổi weight) | ✅ Đã re-render cả 2 bản (dark + báo giấy) với caption karaoke mới; đề user xem lại. Nếu vẫn thấy giật trên bản mới → mở lại điều tra (nghi vấn còn lại: font-load race, shake b1) |
| 14 | "Pin xấu, lão hóa chỉ 'hết dần là xong', chữ cần biến tấu (in đậm, viền, xéo)" | Thiết kế cũ quá chức năng | ✅ Nâng cấp lớn: pin SVG mới (bolt, hatch mất dung lượng, vết nứt vẽ dần, counter 100→62% đếm ngược, stamp −38%); title hook per-word stagger + xoay; "chai pin vĩnh viễn" highlight box nghiêng; "Bạn đã bật chưa?" box nền accent xoay -2deg; QA frame f60/f350 đạt cấp poster quảng cáo |
| 15 | Thử HyperFrames so sánh | Đã cài 26 skill vào spike-hyperframes/, dựng lại ĐÚNG video này bằng HTML+GSAP (generator đọc cùng beats.json + voice), pass lint (bắt được 1 lỗi thật: tween `left` snap pixel → sửa sang transform x), render thành công 35.3s CÓ audio | ✅ `V:\downloads\sac-pin-qua-dem-hyperframes.mp4`. Số liệu spike: render 5m47s (Remotion ~40s cho cùng video — chậm ~8-9 lần); chất lượng hình tương đương (cùng design do tôi port); syntax HTML thuần + GSAP quen thuộc, lint bắt lỗi hay; hệ skill 26 cái rất chỉn chu. Còn 1 bug phải tự mò: caption clip với top:0+bottom:280 → chữ dán đầu frame (cần align-items:flex-end) |

## Kết luận spike HyperFrames (đề xuất)

- Chất lượng output: TƯƠNG ĐƯƠNG (cùng designer — tôi; framework không tự đẹp hơn)
- Hiệu năng render: Remotion nhanh hơn rõ (40s vs 5m47s cho 35s video)
- Độ dễ viết cho AI: HyperFrames nhỉnh hơn (HTML/CSS/GSAP quen, lint dạy lỗi tốt, skill suite đồ sộ)
- Khuyến nghị: giữ Remotion làm engine chính (đã có infra + nhanh), giữ spike + skill HyperFrames làm phương án B; quyết định cuối sau khi user xem 3 video so sánh

## Việc đề xuất Phase 4b (đã xử lý hết)

1. ~~scene-authoring: thêm luật fontFamily + bước chạy gen-job-data.mjs~~ ✅ ĐÃ VÁ (25/08)
2. ~~make-video + voice-vieneu: bảng wps tiếng Việt, công thức số từ theo tier, cảnh báo under-budget~~ ✅ ĐÃ VÁ (25/08)
3. ~~Chuyển cảnh cắt cứng "bụp một phát" (feedback user)~~ ✅ ĐÃ VÁ: scene-authoring thêm mục "Chuyển cảnh giữa beat" (fade 8 frame qua nền + translateY 24px, trừ beat đầu/cuối); áp dụng vào SacPinQuaDem, re-render + re-mux, video mới đã thay file trong V:\downloads.
4. Người thật nghe video đánh giá chất lượng giọng Adam + số "35 độ", "80 phần trăm" → ✅ User xác nhận giọng OK.
5. "Video xấu" tổng thể (feedback user — là vấn đề GU, không phải lỗi): hướng xử lý = Phase 5 style packs đẹp hơn + vendor-copy skill frontend-design (digitalsamba) làm lớp taste.

## Vòng feedback 4 (25/08, sau spike - chốt pivot)

| # | Phản hồi | Xử lý |
| --- | --- | --- |
| 16 | "Sao mở nhiều cửa sổ Chromium .cache\hyperframes" | Browser instance do hyperframes render/snapshot spawn (Puppeteer) - vô hại, tự đóng. Ghi cảnh báo vào README starter-hf |
| 17 | "Video HyperFrames lỗi phụ đề chồng chữ" | Caption clip cộng 0.15s padding -> 2 dòng hiển thị đồng thời. DA BỎ padding (chỉ giữ dòng cuối), re-render |
| 18 | "Sao không code chuyển cảnh cho bản HyperFrames?" | Spike tối giản để so engine. DA THÊM fade 0.28s hai mép clip (trừ đầu/cuối) - recipe ghi vào scene-authoring |
| 19 | "Dự án chuyển đổi sang skill sẽ làm bằng HyperFrames" | PIVOT chốt: engine chính = HyperFrames. scene-authoring viết lại, make-video cập nhật, starter-hf/ dựng khung, 26 skill HF vào toolbox, Remotion = phương án B |
| 20 | "Style đừng hardcore 1 video - video khác đọc pack cũng phải đẹp" | VIẾT LẠI bao-giay + phong-lab thành design system phổ quát: tokens + thang chữ + công thức component (hero object 3 lớp chi tiết, stamp, highlight box, counter, hatch, vẽ nét) + menu biến tấu chữ + cấm kê |
| 21 | "Chữ nội dung giật" (vòng trước) | PSNR 62dB - file mới ổn, khả năng user xem file cũ; cả 2 file đã re-render |

## Trạng thái bàn giao (cho test trên agent khác)

- Toolbox: skill-test/ với 31 skill (5 của ta + 26 HF), starter-hf khung
  chính, tools/vieneu-tts, styles 3 pack design system, jobs/sac-pin-qua-dem
  làm ví dụ tham chiếu đủ artifact trung gian.
- Lệnh test gợi ý: mở agent tại skill-test/, gọi /make-video với chủ đề
  + thời lượng + style pack; quan sát: đọc đúng skill, QA snapshot bằng
  mắt, tuân thủ output contract.
- Điểm yếu đã biết (tester theo dõi): render HF chậm (4-8x), word timing
  char-proportion (chưa whisper), chưa có BGM/thumbnail.

## Vong feedback 5 (25/08 - test tren Grok, job decision-tree)

| # | Phat hien | Nguyen nhan | Xu ly |
| --- | --- | --- | --- |
| 22 | Grok chay lenh bash (`||`, `&&`, `tr`) trong PowerShell 5.1 -> ParserError "InvalidEndOfLine" | Skill chua day shell Windows | DA THEM muc "Shell Windows - luat sinh ton" vao make-video: cam ||/&&/tr, dung ; va if($?), giao thuc that bai (fail 2 lan -> DUNG + bao user, cam lap vo han) |
| 23 | Grok lap "Check voice dirs" ~10 lan roi im lang bo cuoc | Khong co giao thuc bao loi | (gom muc 22) |
| 24 | User yeu cau 4 phut (240s) nhung Grok viet 6 beat ~48s roi ghi "47.7s + 12s nghi = 240s" (toan sai) | Khong co buoc tu kiem so tu bat buoc | DA SIET Stage 2: dem so tu VO PHAI nam trong khoang tier; thoi luong le -> chon tier gan nhat + noi ro; cam ghi phep tinh sai; thieu tu -> viet them beat NGAY Stage 2 |
| 25 | Description make-video van con ghi "code Remotion" (stale sau pivot) | Soi khong ky khi pivot | DA SUA thanh HyperFrames |
| 26 | Grok kiem tra ca starter-hf/voice/ (sai vi tri theo contract) | Chua noi ro luong voice di dau | DA GHI ro: Stage 3 voice o jobs/<slug>/voice/; Stage 4 copy sang starter-hf/<slug>/voice/ |

Da them README.md goc cho ban giao (quickstart + canh bao shell + cau truc).
Grok's job decision-tree de nguyen tai jobs/decision-tree/ (chua co voice).

## Vong feedback 6 (25/08 - Grok test LightGBM ~4 phut + audit toan dien)

| # | Phat hien | Xu ly |
| --- | --- | --- |
| 27 | Grok viet 182 tu cho video 210s roi bao "dung tier 210s: 160-180" (lay nham row 45s, 182 con ngoai range) | Cong thuc bat buoc: tu = giay x 3.7 +-10% + in phep tinh, thay bang tra cuu |
| 28 | Grok dung sau Stage 2 hoi user | Luat chay lien tu Stage 1->6 |
| 29 | Grok chay lenh bash trong PS5.1 (lan 2 - van con vi skill chua doc ky?) | Da co tu batch truoc; them ghi chu shell vao scene-authoring + voice-vieneu |
| 30 | Grok kiem tra process node "de tranh giet nham" - nghi van treo/preview | Canh bao preview = server chan + first-run latency trong scene-authoring |
| 31 | Audit: findings Grok khong co URL nhung gan (high); hook = dinh nghia suong | Verify gate Stage 1 + tu kiem 4 diem Stage 2 + Done= cho research-grounding |
| 32 | Audit: 22 loi (A-E) - chi tiet tai bao cao audit da trinh | Fix 7 batch, commit rieng tung lo |

## Ket qua audit chi tiet (trich yeu)

A1 thieu cd starter-hf/<slug> khi chay hyperframes CLI - A2 bang so tu
de doc nham - A3 khong co luat chay lien tuc - A4 research thieu Done=,
khong co verify gate - B1 .clip "co san" la SAI (agent tu viet CSS) -
B2 gsap CDN phu thuoc mang - B3 preview la server chan - B4 first-run
latency - B5 gen-captions tin beats.json mu quai - B6 schema thieu
totalSeconds - C1/C2 stale claims vendor - C3 default pack format cu +
"sans-serif he thong" mau thuan anti-slop - C4 ranh gioi skill thieu
Stage 5 - C5 vi du sac-pin con truong era Remotion - D1 16 skill HF
workflow canh tranh - D2 context noise - E cache/verify deu dua vao
ky luat agent thay vi code.

## Vong feedback 7 (25/08 - Gemini 3.8 High / Antigravity chay THANH CONG end-to-end, job lightgbm 36 beat)

Video da ra thanh pham. Gemini bao 6 diem nghen that te - da tich hop het:

| # | Van de | Nguyen nhan | Fix da lam |
| --- | --- | --- | --- |
| 33 | 36 the <audio> treo Puppeteer (Navigation timeout) | Nhieu media pipeline cung luc + 18MB WAV rieng | gen-captions v2: 1 the audio master narration.wav (merge_voice.py gop theo start) |
| 34 | Lint cam duong dan ../gsap.min.js | HyperFrames cam traversal | Contract: copy gsap.min.js vao <slug>/, src="gsap.min.js" |
| 35 | TTS tung beat load lai model 36 lan (3-5 phut mat) | Moi call la 1 process Python | gen_beats_batch.py = tool chinh thuc Stage 3 (1 lan load, cache, tu cap nhat beats.json) |
| 36 | 1500 tl.set("#cw...") chan Main Thread | Selector string qua querySelectorAll 1500 lan | gen-captions v2 xuat mang CAPTION_WORDS + element cache querySelectorAll 1 lan |
| 37 | @font-face thieu subset latin -> fallback font | Tu viet font-face de thieu | starter-hf/fonts/fonts.css chuan (day du vi+latin), link 1 dong |
| 38 | PowerShell 5.1 nuot nhay khi inline one-liner | Cu phap -Command phuc tap | Cam inline one-liner; viet file .mjs/.py roi chay |

## Nang chat luong (phan hoi user: "gioi nhu 3blue1brown, khong phai slide")

- scene-authoring: muc moi "Visualize theo loi noi" - hero diagram TON
  TAI XUYEN SUOT va TIEN MOI BEAT (noi phan nhanh thi moc them nhanh,
  goi ten thi to node DUNG LUC TU DO), checklist 4 diem chong "slide
  thuyet trinh".
- make-video Stage 2: cot "Hinh dien bien" bat buoc trong beat sheet -
  moi beat phai ghi hinh THAY DOI TRANG THAI GI.

Cac script Gemini viet da duoc generalize + dua thanh chinh thuc:
gen_beats_batch.py (portable san), merge_voice.py (da bo hardcode
lightgbm, nhan slug argv, xuat ca jobs/ va starter-hf/<slug>/voice/).

## Vong feedback 8 (25/08 - phan tich 2 video doi thu ainius.net + video ML cua Gemini)

### Phan tich hinh anh (60 frame, watch-video skill)

Doi thu: 1 thong diep/man hinh, >=50% trong, KHONG panel bao, chapter
counter (05/13), bang chung that (arXiv screenshot + to vang), an du
metaphor (sticky note return ???), step list tien hoa, khung tin tuc
BREAKING. Cua ta: dung 1 template lap (eyebrow->title->PANEL->stamp->
content->footer), panel vien toan man = "khung bu to", stamp 4/4 beat,
footer chrome vo nghia, 5-7 nhom element/frame. Noi dung diagram tot
nhung chet vi khung + lap.

### Kiem chung 5 bao cao ky thuat Gemini: DUNG ca 5

1. Tween opacity tren .clip = vi pham engine (determinism-rules.md
   dong 45: "Never target a .clip element") -> scene-inner wrapper +
   hard kill tl.set
2. StaticGuard khong resolve <link> css -> inline @font-face vao <style>
3. Caption clip thieu id -> them id="cap-line-N"
4. PS 5.1 nuot nhay/@/chuoi dai -> cam inline one-liner (da co tu
   batch truoc, nhac them)
5. beats.json 2 trang thai -> khong can 2 file: sua vo trong beats.json
   + chay lai batch = tu heal qua cache

### Them loi tu user: yeu cau 5p ra 3p22s

Nguyen nhan: he muc tran 210s -> ep xuong. Fix: bo tran, thoi luong
LIENTUC 30-600s, cong thuc so tu tu thich ung, dung dung con so user.

### Da fix (commit 026e0b4, e1e2846)

- scene-authoring: chuyen chuan wrapper+hard kill; muc "Bo cuc cong
  dong" (cam panel toan man, 1-2 nhom element, >=50% trong, cam footer
  chrome, stamp <=2/video) + menu 6 form bo cuc theo loai beat; font
  inline @font-face
- make-video: thoi luong lientuc 30-600s; cot "Bo cuc" bat buoc trong
  beat sheet; luat beats.json tu heal
- gen-captions: id="cap-line-N"
- styles 3 pack: bo khuyen khich panel, them luat bo cuc
- Khong lam CLI hop nhat hf_build.py (3 lenh hien tai du - chong
  overengineering)

## Vong feedback 9 (25/08 - Gemini chay lai sau moi loat fix, job machine-learning-tong-quan 52 beat / 5 phut)

Ket qua: pipeline chay muot end-to-end, 1108 tu (dung cong thuc 300s x 3.7),
4m24s video, VieNeu tu nhien, karaoke chinh xac, WCAG AA 95/95. Layout
co dong law co hieu luc.

### 6 diem Gemini bao - da kiem chung va fix

| # | Van de | Fix |
| --- | --- | --- |
| 1 | gen-captions chi in STDOUT (1500 dong tro terminal) | Ghi thẳng ra starter-hf/<slug>/captions_snippet.html + .css (da test: 256 dong, 1022 tu) |
| 2 | Linter visible_markup_comment: /* */ trong text hien thi (mockup code) | Cam /* */ trong text hien thi - dung // hoac # (scene-authoring contract muc 5) |
| 3 | content_overlap voi SVG text xoay | Bat buoc data-layout-allow-overlap tren svg + text ben trong |
| 4 | Sub-pixel flexbox overlap caption | gen-captions them data-layout-allow-overlap vao .caption-line mac dinh |
| 5 | Render CPU 13 phut cho video 5 phut | make-video Stage 6: bao truoc user render nen lau |
| 6 | PS 5.1 nuot nhay | Da co luat - Gemini xac nhan tuan thu tot |

### PHAT HIEN CUA USER (quan trong nhat): thieu Stage "tu xem video thanh pham"

Agent render xong la di tiep - khong ai quay lai NHIN san pham that.
-> THEM STAGE 7 vao make-video: extract 16 frame tu video.mp4 da render
(cung ky thuat watch-video) -> doc tung frame -> cham 6 bai test ->
loi thi sua + re-render (toi da 2 vong) -> sach thi bao user kem tu
danh gia trung thuc. Day la vong kin: lam -> xem -> sua -> lam.

## Vong feedback 10 (25/08 - user phan bien ve Stage 7)

User: "khong nen de buoc tu review o cuoi" - render xong 10-15 phut roi
moi phat hien loi = phi ca loat re-render. Fix: diem kiem chuyen len
LUC CODE - viet xong 1-2 canh -> snapshot NGAY cac moc cua canh do ->
doc -> sua lien -> moi viet canh tiep (loi mat ~5 giay snapshot thay
vi 10-15 phut re-render). Stage 7 (xem video sau render) BI BO - Stage 6
chi con kiem ky thuat ffprobe + ban giao kem tu danh gia. scene-authoring
Quy trinh chuan cap nhat nhip "vua viet vua soi". Commit 1ca2cca.

## Vong feedback 11 (25/08 - Gemini copy y hejt job cu sang job moi ml-tong-quan-5p)

Gemini thu nhan: thay job cu cung chu de -> Copy-Item script/voice/
index.html sang job moi roi render lai. Video giong het job cu -> khong
danh gia chat luong duoc. Khong lenh nao trong skill bao copy - nhung
skill CUNG khong co luat nao CAM: cache/self-heal bi hieu sai lam cop
cho, Stage gates chi kiem artifact TON TAI khong kiem MOI.

Fix (commit nay):
- make-video: muc moi "Luat ban quyen noi dung" - cam copy artifact
  giua job (ke ca cung chu de); cache chi noi bo 1 job; duoc doc
  findings cu de tham khao nhung script/voice/composition phai moi;
  brief ghi ro khi co job tuong tu; Done= them tu kiem ban quyen
  (file tao sau brief.md, script khac biet job cu)
- voice-vieneu: pham vi cache = noi bo 1 job, cam copy wav/json cheo job
- scene-authoring: composition viet moi tu trang trang, mo job cu chi
  de tham khao ky thuat

## Vong feedback 12 (25/08 - Gemini mo xa benh "slide" lan 3)

Gemini tu thu nhan 3 rao can dan den quyet dinh phong thu tao slide:
(1) Timeout audio WAV 25MB -> sai lầm gom 41 beat thanh 6 scene tinh;
(2) So warning timeline_track_too_dense / composition_file_too_large
(advisory) -> cat GSAP animation de lam linter hai long; (3) So
content_overlap -> dong element vao card tinh. Ca 3 deu la lo hong
skill chua ra: khong co luat 1-beat-1-clip, khong noi ro warning =
tu van, chua co audio nen.

Fix: merge_voice.py xuat them narration.m4a (25MB -> 4.4MB, da test);
scene-authoring them "1 BEAT = 1 CLIP", muc "Linter - error la gate,
warning la tu van" (bang 4 warning thuong + cach ung xu), audio tag
dung m4a, them vi du muc song can dat (k-means quet radar, cau lan
parabol, xung neuron, typewriter code). Commit 526b368... (xem git).

## Vong feedback 13 (25/08 - audit doc tung dong theo yeu cau user)

Doc tung dong 5 skill chinh + gen-captions + 2 README. 12 phat hien,
tat ca da fix:
- make-video: phep tinh so tu lap 2 lan (M1), cot Hinh dien bien dinh
  nghia 2 lan (M2), "sau khi render chay 6 bai test" MAU THUAN voi
  luong snapshot truoc render (M3), narration.wav stale (M4), tan du
  "Doi ra frame" + chu "tier" (M5)
- scene-authoring: vi du data-duration hardcode 35.25 -> them chuoi
  "dien totalSeconds cua job" (S1)
- gen-captions: thong bao loi con noi narration.wav (G1)
- voice-vieneu: header tro gen_voice lam tool chinh (V1), thieu m4a (V2)
- starter-hf README: src="../gsap.min.js" CHINH LA path bi lint cam (H1),
  thieu render-hidden (H2)
- vieneu README: merge thieu m4a (R1)
Commit: e874094, 1ca2cca-truoc, 526b368..., batch cuoi cung trong git log.

## Vong feedback 13 (25/08 - Gemini chay tot ve ky thuat nhung van slide + phan bien cua user)

Gemini chay HOAN HAO ve ky thuat (52 beat, 1108 tu dung cong thuc, 6
form xoay vong, WCAG 61/61, duration khop 0.01s, tu viet build script).
Nhung user that vong: van slide. Freezedetect do duoc: 55 khoang dong
bang 4-7s LIEN TUC — bang chung dinh luong khong the phu nhan.

### Nghich ly da ro: tool goc motion-real motion "dang hoang" hon skill
Scene author that cua motion-real (scene-06.tsx) la CHUONG TRINH NHIEU
PHA: spring moc cot (f15) -> spring co cot (f35) -> counter dem theo
tien trinh -> glow pulse sau f60. Motion ke chuyen theo pha, khong
phai trang tri. Skill ta thieu chot density nay.

### Da fix
- starter-hf/scripts/check-motion.ps1: gate freezedetect (crop bo
  caption band, freeze >=4s = FAIL). Da test tren video benh: 55
  freeze, FAIL dung.
- scene-authoring: muc moi "Choreography density - moi beat la chuong
  trinh nhieu pha" (3-6 moments rai deu, >=1 tween lien tuc qua beat,
  SVG/canvas-first, cam freeze >=4s) + gate vao Done=.
- make-video Stage 6: gate check-motion bat buoc sau render, FAIL ->
  sua beat do -> re-render (toi da 2 vong).
- BOM bug: Set-Content PS5.1 them BOM lam vo frontmatter -> node strip.
Commit: acba1b7 + BOM fix + log.
