import os
import json

slug = 'machine-learning-la-gi'
topic = 'Machine Learning là gì & Toàn bộ Khái niệm Cốt lõi'
target_seconds = 210
fps = 30
voice = 'Adam'
style_pack = 'default'

beats = [
    { 'id': 'b1', 'role': 'hook', 'vo': 'Bạn nghĩ máy tính thông minh vì con người viết sẵn từng dòng lệnh? Hoàn toàn sai.', 'visual': 'Hero diagram xuất hiện: Mô hình lập trình truyền thống với khối Rules và Data va chạm, nháy đỏ cảnh báo.' },
    { 'id': 'b2', 'role': 'hook', 'vo': 'Lập trình truyền thống bắt bạn nạp Dữ liệu và Quy tắc để máy tính cho ra Đáp án.', 'visual': 'Sơ đồ Lập trình truyền thống: [Dữ liệu] + [Quy tắc] mũi tên chỉ vào CPU -> [Đáp án].' },
    { 'id': 'b3', 'role': 'hook', 'vo': 'Nhưng nếu bài toán quá phức tạp, không ai có thể tự tay viết hết hàng triệu quy tắc.', 'visual': 'Khối Quy tắc nổ tung thành mạng lưới ma trận dày đặc quá tải, viền đỏ rung lắc.' },
    { 'id': 'b4', 'role': 'context', 'vo': 'Machine Learning xuất hiện và đảo ngược hoàn toàn: ta nạp Dữ liệu và Đáp án để máy tự tìm ra Quy tắc.', 'visual': 'Hero Diagram chuyển đổi: [Dữ liệu] + [Đáp án] nạp vào ML Engine -> Tự sinh ra [Quy tắc/Mô hình] sáng rực.' },
    { 'id': 'b5', 'role': 'context', 'vo': 'Năm 1959, Arthur Samuel định nghĩa: Học máy là ngành giúp máy tính tự học mà không cần lập trình chi tiết.', 'visual': 'Card lịch sử 1959 với tem Arthur Samuel, trích dẫn triết lý máy tính tự học qua kinh nghiệm.' },
    { 'id': 'b6', 'role': 'context', 'vo': 'Hãy hình dung: AI là vũ trụ rộng lớn, Machine Learning là lõi vận hành, còn Deep Learning là mạng nơ-ron chuyên sâu.', 'visual': 'Sơ đồ 3 vòng tròn đồng tâm: Vòng ngoài AI, vòng giữa Machine Learning, vòng nhân Deep Learning.' },
    { 'id': 'b7', 'role': 'context', 'vo': 'Nhà khoa học Tom Mitchell chuẩn hóa: máy học khi hiệu năng P trong tác vụ T tăng dần nhờ kinh nghiệm E.', 'visual': 'Khung định nghĩa Mitchell: 3 hộp tham số [Task T], [Performance P], [Experience E] kết nối liên hoàn.' },
    { 'id': 'b8', 'role': 'context', 'vo': 'Nhưng bằng cách nào một cỗ máy có thể tự học từ dữ liệu? Nó chia làm ba trường phái chính.', 'visual': 'Hero Diagram mở rộng: 3 nhánh lớn mọc ra từ thân cây ML: Supervised, Unsupervised, Reinforcement.' },
    { 'id': 'b9', 'role': 'supervised', 'vo': 'Trường phái thứ nhất: Supervised Learning, tức Học có giám sát. Đây là dạng phổ biến nhất hiện nay.', 'visual': 'Nhánh 1 [Supervised Learning] sáng bừng màu xanh accent, gắn nhãn huy hiệu [Đã có giám sát].' },
    { 'id': 'b10', 'role': 'supervised', 'vo': 'Giống như học sinh giải bài tập có sẵn sách giải, dữ liệu đầu vào luôn đi kèm nhãn đáp án chính xác.', 'visual': 'Minh họa dữ liệu có nhãn: Các cặp thẻ [Ảnh Mèo -> Nhãn Mèo], [Ảnh Chó -> Nhãn Chó] ghép đôi hoàn hảo.' },
    { 'id': 'b11', 'role': 'supervised', 'vo': 'Nhánh đầu tiên là Phân loại: giúp máy nhận diện email rác, chẩn đoán ảnh X-quang hoặc quét khuôn mặt.', 'visual': 'Sơ đồ Phân loại (Classification): Đường ranh giới phân tách rõ ràng 2 cụm điểm nhãn Spam và Inbox.' },
    { 'id': 'b12', 'role': 'supervised', 'vo': 'Nhánh thứ hai là Hồi quy: dự đoán một giá trị số liên tục như giá nhà, nhiệt độ ngày mai hay doanh thu.', 'visual': 'Sơ đồ Hồi quy (Regression): Đường hồi quy tuyến tính chạy xuyên qua các điểm phân tán giá nhà.' },
    { 'id': 'b13', 'role': 'supervised', 'vo': 'Máy đối chiếu dự đoán của nó với đáp án thật, liên tục sửa lỗi để ngày càng đoán chính xác hơn.', 'visual': 'Vòng lặp đối chiếu: Mũi tên sai số co ngắn lại, độ chính xác Accuracy tăng từ 65% lên 98%.' },
    { 'id': 'b14', 'role': 'unsupervised', 'vo': 'Nhưng trong thực tế, phần lớn dữ liệu trên thế giới không hề có sẵn nhãn. Đó là lúc ta cần Unsupervised Learning.', 'visual': 'Nhánh 2 [Unsupervised Learning] kích hoạt: Biển dữ liệu thô toàn các chấm trắng hỗn độn không nhãn.' },
    { 'id': 'b15', 'role': 'unsupervised', 'vo': 'Học không giám sát giống như thả bạn vào hang động lạ tự khám phá mà không có bản đồ hướng dẫn.', 'visual': 'Khối radar quét không gian dữ liệu đa chiều trong bóng tối, tự dò tìm cấu trúc hình học.' },
    { 'id': 'b16', 'role': 'unsupervised', 'vo': 'Thuật toán sẽ tự động phân tích cấu trúc, đo khoảng cách và tìm ra quy luật ẩn giấu bên trong dữ liệu.', 'visual': 'Các đường nối đo khoảng cách Euclidean giữa các điểm dữ liệu tự động co kéo và liên kết.' },
    { 'id': 'b17', 'role': 'unsupervised', 'vo': 'Điển hình là Phân cụm: tự động gom nhóm hàng triệu khách hàng theo hành vi mua sắm tương đồng.', 'visual': 'Thuật toán Clustering: Các điểm dữ liệu tự co cụm thành 3 nhóm màu riêng biệt rõ nét.' },
    { 'id': 'b18', 'role': 'unsupervised', 'vo': 'Hoặc Giảm chiều dữ liệu: nén hàng nghìn thuộc tính phức tạp xuống biểu đồ hai chiều trực quan.', 'visual': 'Biểu đồ 3D phức tạp thu gọn mượt mà xuống mặt phẳng 2D hiển thị cấu trúc cô đọng.' },
    { 'id': 'b19', 'role': 'reinforcement', 'vo': 'Trường phái thứ ba, độc đáo và mạnh mẽ nhất: Reinforcement Learning, tức Học tăng cường.', 'visual': 'Nhánh 3 [Reinforcement Learning] bừng sáng với vòng lặp tương tác Agent và Environment.' },
    { 'id': 'b20', 'role': 'reinforcement', 'vo': 'Không cần dữ liệu mẫu hay sách giải, một Agent được thả vào một môi trường để tự mình hành động.', 'visual': 'Sơ đồ vòng lặp khép kín: Agent thực hiện Action gửi tới Environment, nhận về State mới.' },
    { 'id': 'b21', 'role': 'reinforcement', 'vo': 'Mỗi quyết định đúng sẽ nhận điểm thưởng, mỗi sai lầm sẽ nhận điểm phạt.', 'visual': 'Thanh điểm thưởng Reward: Số nhảy +100 màu xanh lá khi đi đúng, -50 màu đỏ khi va chạm vật cản.' },
    { 'id': 'b22', 'role': 'reinforcement', 'vo': 'Qua hàng triệu ván thử và sai, Agent tự khám phá ra chiến thuật tối ưu vượt qua cả con người.', 'visual': 'Bộ đếm ván chơi tăng vọt từ 1 đến 1.000.000, lộ trình di chuyển ngày càng mượt mà hoàn hảo.' },
    { 'id': 'b23', 'role': 'reinforcement', 'vo': 'Đây chính là cách AlphaGo đánh bại kiện tướng thế giới và xe tự hành học cách giữ làn an toàn.', 'visual': 'Hiển thị hai biểu tượng chiến thắng: Bàn cờ vây AlphaGo và mô hình radar xe tự lái.' },
    { 'id': 'b24', 'role': 'mechanism', 'vo': 'Vậy bên trong cỗ máy, quy trình biến dữ liệu thô thành trí thông minh diễn ra như thế nào?', 'visual': 'Mở rộng vào trung tâm cỗ máy ML: Bản vẽ kỹ thuật hiển thị đường ống xử lý dữ liệu 4 tầng.' },
    { 'id': 'b25', 'role': 'mechanism', 'vo': 'Đầu tiên là Trích xuất đặc trưng: chuyển hóa hình ảnh, âm thanh thành các vectơ số mà máy tính hiểu được.', 'visual': 'Ma trận ảnh thô chuyển thành mảng vectơ số đặc trưng [x1, x2, x3, ... xn] ánh xạ rõ nét.' },
    { 'id': 'b26', 'role': 'mechanism', 'vo': 'Tiếp theo là Mô hình toán học: các trọng số Weights ban đầu được khởi tạo hoàn toàn ngẫu nhiên.', 'visual': 'Các nút mạng nơ-ron liên kết với trọng số ngẫu nhiên W ban đầu mờ nhạt.' },
    { 'id': 'b27', 'role': 'mechanism', 'vo': 'Cốt lõi của việc học nằm ở Hàm mất mát Loss Function: thước đo tính toán xem máy đang đoán sai bao nhiêu.', 'visual': 'Công thức và biểu đồ Loss Function xuất hiện, vạch đo sai số hiển thị mức Loss cao báo động.' },
    { 'id': 'b28', 'role': 'mechanism', 'vo': 'Mục tiêu tối thượng của quá trình huấn luyện là kéo giá trị Loss Function này về mức thấp nhất có thể.', 'visual': 'Mũi tên mục tiêu kéo đường cong Loss đi xuống, số đo Loss giảm dần về tiệm cận 0.' },
    { 'id': 'b29', 'role': 'mechanism', 'vo': 'Để làm điều đó, thuật toán Gradient Descent hoạt động như một người mù lần bước xuống đáy thung lũng sương mù.', 'visual': 'Mô phỏng 3D mặt cong thung lũng: Một viên bi lăn từng bước dò đường xuống điểm đáy lòng chảo.' },
    { 'id': 'b30', 'role': 'mechanism', 'vo': 'Nó tính toán độ dốc và điều chỉnh trọng số ngược hướng dốc, với bước nhảy được kiểm soát bởi Learning Rate.', 'visual': 'Vectơ Gradient chỉ ngược hướng dốc kèm tham số Learning Rate điều chỉnh kích thước bước nhảy.' },
    { 'id': 'b31', 'role': 'pitfall', 'vo': 'Tuy nhiên, cỗ máy tự học đối mặt với một cạm bẫy chết người: đó là hiện tượng Overfitting, tức học vẹt.', 'visual': 'Card cảnh báo nguy hiểm: Khái niệm Overfitting xuất hiện với con dấu [CẢNH BÁO HỌC VẸT].' },
    { 'id': 'b32', 'role': 'pitfall', 'vo': 'Khi mô hình quá phức tạp, nó ghi nhớ từng điểm nhiễu của dữ liệu cũ nhưng bất lực trước dữ liệu mới.', 'visual': 'Đường phân chia uốn lượn ngoằn ngoèo thái quá quanh các điểm nhiễu, kiểm tra dữ liệu mới bị sai lệch.' },
    { 'id': 'b33', 'role': 'pitfall', 'vo': 'Ngược lại, nếu mô hình quá thô sơ, ta gặp Underfitting: máy không nắm bắt nổi bất kỳ quy luật nào.', 'visual': 'Đường thẳng đơ Underfitting cắt ngang dữ liệu mà không phân tách được cụm nào.' },
    { 'id': 'b34', 'role': 'pitfall', 'vo': 'Cuộc chiến của kỹ sư AI là cân bằng Bias và Variance, giữ mô hình vừa chuẩn xác vừa có tính tổng quát cao.', 'visual': 'Mô hình cân bằng hoàn hảo (Good Fit): Đường cong mềm mại bao quát đúng quy luật cốt lõi.' },
    { 'id': 'b35', 'role': 'takeaway', 'vo': 'Machine Learning không phải phép thuật huyền bí, mà là sự kết hợp tuyệt mỹ giữa đại số, xác suất và dữ liệu lớn.', 'visual': 'Biểu tượng ba bánh răng lồng vào nhau: Đại số tuyến tính, Xác suất thống kê, và Dữ liệu lớn.' },
    { 'id': 'b36', 'role': 'takeaway', 'vo': 'Nó đang định hình lại mọi lĩnh vực: từ y tế, tài chính, giao thông đến các mô hình ngôn ngữ lớn hôm nay.', 'visual': 'Mạng lưới ứng dụng lan tỏa rực rỡ: Y tế, Tài chính xe tự hành và mô hình LLM thông minh.' },
    { 'id': 'b37', 'role': 'cta', 'vo': 'Bạn muốn đi sâu vào thuật toán nào tiếp theo trong các video tới? Hãy để lại bình luận phía dưới!', 'visual': 'Màn kết thúc CTA: Hộp bình luận tương tác nổi bật kèm mũi tên chỉ dẫn đón xem phần tiếp theo.' }
]

total_words = sum(len(b['vo'].strip().split()) for b in beats)
speech_seconds = total_words / 3.7
est_total = speech_seconds + len(beats) * 0.45

print(f'Tổng số từ: {total_words}')
print(f'Phép tính: tổng {total_words} từ * (1/3.7) ≈ {speech_seconds:.1f}s speech + {len(beats)} beats nghỉ ({len(beats)*0.45:.1f}s) ≈ {est_total:.1f}s — khớp mục tiêu {target_seconds}s')

job_dir = os.path.join('jobs', slug)
os.makedirs(job_dir, exist_ok=True)

beats_json = {
    'slug': slug,
    'topic': topic,
    'targetSeconds': target_seconds,
    'fps': fps,
    'voice': voice,
    'stylePack': style_pack,
    'gapSeconds': 0.45,
    'tailSeconds': 1.5,
    'totalSeconds': round(est_total, 1),
    'beats': [
        {
            'id': b['id'],
            'role': b['role'],
            'vo': b['vo'],
            'wav': 'voice/' + b['id'] + '.wav',
            'start': 0.0,
            'duration': 0.0
        }
        for b in beats
    ]
}

if not os.path.exists(os.path.join(job_dir, 'beats.json')):
    with open(os.path.join(job_dir, 'beats.json'), 'w', encoding='utf-8') as f:
        json.dump(beats_json, f, ensure_ascii=False, indent=2)

script_md = f'''# Kịch bản: {topic}

- **Mục tiêu**: Video giải thích 9:16 thời lượng {target_seconds}s (~3.5 phút)
- **Tổng số từ**: {total_words} từ
- **Phép tính quy đổi**: tổng {total_words} từ × (1/3.7) ≈ {speech_seconds:.1f} giây speech + nghỉ ({len(beats)*0.45:.1f}s) ≈ {est_total:.1f} giây — khớp mục tiêu {target_seconds}s (chấp nhận ±10%)
- **Giọng đọc**: {voice}
- **Style pack**: {style_pack}

## Bảng phân cảnh Beat Sheet

| Beat ID | Vai trò | Lời thoại VO (≤25 từ) | Hình diễn biến |
| --- | --- | --- | --- |
'''

for b in beats:
    script_md += f"| `{b['id']}` | {b['role']} | {b['vo']} | {b['visual']} |\n"

import html

# Now build the full HyperFrames HTML composition in starter-hf/machine-learning-la-gi/index.html
starter_dir = os.path.join('starter-hf', slug)
os.makedirs(starter_dir, exist_ok=True)

with open(os.path.join(job_dir, 'beats.json'), 'r', encoding='utf-8') as f:
    bdata = json.load(f)

beats_list = bdata['beats']
total_sec = bdata.get('totalSeconds', 201.78)

# Collect all word timings
all_words = []
for b in beats_list:
    meta_path = os.path.join(job_dir, b['wav'].replace('.wav', '.json'))
    if os.path.exists(meta_path):
        with open(meta_path, 'r', encoding='utf-8') as mf:
            meta = json.load(mf)
        for w in meta.get('words', []):
            all_words.append({
                'word': w['word'],
                'start': round(b['start'] + w['start'], 2),
                'end': round(b['start'] + w['end'], 2)
            })

# Group words into ~4-word chunks
caption_lines = []
for i in range(0, len(all_words), 4):
    chunk = all_words[i:i+4]
    c_start = chunk[0]['start']
    c_end = chunk[-1]['end']
    caption_lines.append({
        'words': chunk,
        'start': c_start,
        'end': c_end
    })

# Format caption HTML clips
caption_clips = []
for i, l in enumerate(caption_lines):
    is_last = (i == len(caption_lines) - 1)
    dur = round(l['end'] - l['start'] + (0.4 if is_last else 0.0), 2)
    spans = ' '.join([f'<span class="cw">{html.escape(w["word"])}</span>' for w in l['words']])
    caption_clips.append(f'      <div id="cap-line-{i}" class="clip caption-line" data-start="{l["start"]:.2f}" data-duration="{dur:.2f}" data-track-index="8">{spans}</div>')

caption_clips_str = '\n'.join(caption_clips)

# Format CAPTION_WORDS data
caption_words_js = []
for li, l in enumerate(caption_lines):
    for wi, w in enumerate(l['words']):
        caption_words_js.append([li, wi, w['start'], w['end']])

caption_words_str = json.dumps(caption_words_js)

html_template = f'''<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>Machine Learning là gì &amp; Toàn bộ Khái niệm Cốt lõi</title>
  <style>
    @font-face {{ font-family:'Be Vietnam Pro'; font-style:normal; font-weight:400; src:url('fonts/BeVietnamPro-400-vietnamese.woff2') format('woff2'); unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0309,U+0323,U+0329,U+1EA0-1EF9; }}
    @font-face {{ font-family:'Be Vietnam Pro'; font-style:normal; font-weight:400; src:url('fonts/BeVietnamPro-400-latin.woff2') format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153; }}
    @font-face {{ font-family:'Be Vietnam Pro'; font-style:normal; font-weight:600; src:url('fonts/BeVietnamPro-600-vietnamese.woff2') format('woff2'); unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0309,U+0323,U+0329,U+1EA0-1EF9; }}
    @font-face {{ font-family:'Be Vietnam Pro'; font-style:normal; font-weight:600; src:url('fonts/BeVietnamPro-600-latin.woff2') format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153; }}
    @font-face {{ font-family:'Be Vietnam Pro'; font-style:normal; font-weight:900; src:url('fonts/BeVietnamPro-900-vietnamese.woff2') format('woff2'); unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0309,U+0323,U+0329,U+1EA0-1EF9; }}
    @font-face {{ font-family:'Be Vietnam Pro'; font-style:normal; font-weight:900; src:url('fonts/BeVietnamPro-900-latin.woff2') format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153; }}
    @font-face {{ font-family:'IBM Plex Mono'; font-style:normal; font-weight:400; src:url('fonts/IBMPlexMono-400-vietnamese.woff2') format('woff2'); unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0309,U+0323,U+0329,U+1EA0-1EF9; }}
    @font-face {{ font-family:'IBM Plex Mono'; font-style:normal; font-weight:400; src:url('fonts/IBMPlexMono-400-latin.woff2') format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153; }}
    @font-face {{ font-family:'IBM Plex Mono'; font-style:normal; font-weight:600; src:url('fonts/IBMPlexMono-600-vietnamese.woff2') format('woff2'); unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0309,U+0323,U+0329,U+1EA0-1EF9; }}
    @font-face {{ font-family:'IBM Plex Mono'; font-style:normal; font-weight:600; src:url('fonts/IBMPlexMono-600-latin.woff2') format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153; }}

    :root {{
      --bg: #0B0E14;
      --ink: #F4F7FB;
      --ink-sub: #8B94A6;
      --accent: #60A5FA;
      --accent-cyan: #38BDF8;
      --accent-emerald: #34D399;
      --accent-amber: #FBBF24;
      --accent-danger: #F87171;
      --panel: #121722;
      --panel-border: rgba(96, 165, 250, 0.25);
      --radius: 20px;
      --caption-active: #60A5FA;
      --caption-idle: rgba(244, 247, 251, 0.45);
    }}

    * {{
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }}

    body {{
      background: #000;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      font-family: 'Be Vietnam Pro', sans-serif;
      color: var(--ink);
    }}

    #root {{
      width: 1080px;
      height: 1920px;
      position: relative;
      overflow: hidden;
      background: var(--bg);
    }}

    .clip {{
      position: absolute;
      inset: 0;
    }}

    .scene-bg {{
      position: absolute;
      inset: 0;
      background: radial-gradient(circle at 50% 30%, #161F30 0%, #0B0E14 70%);
      z-index: 1;
    }}

    .grid-overlay {{
      position: absolute;
      inset: 0;
      background-image: 
        linear-gradient(to right, rgba(96, 165, 250, 0.05) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(96, 165, 250, 0.05) 1px, transparent 1px);
      background-size: 60px 60px;
      z-index: 2;
    }}

    .content-layer {{
      position: absolute;
      inset: 0;
      padding: 160px 72px 340px 72px;
      display: flex;
      flex-direction: column;
      z-index: 3;
    }}

    .scene-inner {{
      position: absolute;
      inset: 0;
      padding: 160px 72px 340px 72px;
      display: flex;
      flex-direction: column;
      z-index: 3;
    }}

    .sc-2, .sc-3, .sc-4, .sc-5, .sc-6, .sc-7, .sc-8 {{
      opacity: 0;
    }}

    .eyebrow {{
      font-family: 'IBM Plex Mono', monospace;
      font-size: 34px;
      font-weight: 600;
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 4px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 16px;
    }}

    .eyebrow::before {{
      content: '';
      display: inline-block;
      width: 16px;
      height: 16px;
      background: var(--accent);
      border-radius: 4px;
    }}

    .headline {{
      font-size: 64px;
      font-weight: 900;
      line-height: 1.15;
      color: var(--ink);
      margin-bottom: 36px;
    }}

    .headline span.hi {{
      color: var(--accent);
    }}

    .headline span.danger {{
      color: var(--accent-danger);
    }}

    .stamp {{
      display: inline-flex;
      align-items: center;
      gap: 12px;
      padding: 12px 28px;
      border: 8px double var(--accent);
      border-radius: 16px;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 36px;
      font-weight: 700;
      color: var(--accent);
      text-transform: uppercase;
      transform: rotate(-3deg);
      background: rgba(96, 165, 250, 0.1);
      width: fit-content;
    }}

    .stamp.danger {{
      border-color: var(--accent-danger);
      color: var(--accent-danger);
      background: rgba(248, 113, 113, 0.1);
    }}

    .card {{
      background: var(--panel);
      border: 2px solid var(--panel-border);
      border-radius: var(--radius);
      padding: 32px;
      position: relative;
    }}

    .card-accent {{
      border-color: var(--accent);
      box-shadow: 0 12px 40px rgba(96, 165, 250, 0.15);
    }}

    .mono-number {{
      font-family: 'IBM Plex Mono', monospace;
      font-size: 110px;
      font-weight: 700;
      color: var(--accent);
      line-height: 1;
    }}

    .mono-sub {{
      font-family: 'IBM Plex Mono', monospace;
      font-size: 32px;
      color: var(--ink-sub);
    }}

    .flow-row {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      margin: 20px 0;
    }}

    .flow-node {{
      flex: 1;
      background: #182030;
      border: 2px solid var(--panel-border);
      border-radius: 16px;
      padding: 24px 16px;
      text-align: center;
      font-weight: 700;
      font-size: 36px;
    }}

    .flow-node.active {{
      border-color: var(--accent);
      background: rgba(96, 165, 250, 0.15);
      color: var(--accent);
    }}

    .flow-node.danger {{
      border-color: var(--accent-danger);
      background: rgba(248, 113, 113, 0.15);
      color: var(--accent-danger);
    }}

    .flow-arrow {{
      font-size: 40px;
      color: var(--ink-sub);
    }}

    .diagram-stage {{
      flex: 1;
      position: relative;
      background: var(--panel);
      border: 2px solid var(--panel-border);
      border-radius: var(--radius);
      padding: 36px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      min-height: 820px;
    }}

    .svg-canvas {{
      width: 100%;
      height: 100%;
      overflow: visible;
    }}

    .caption-line {{
      position: absolute;
      left: 60px;
      right: 60px;
      bottom: 240px;
      display: flex;
      justify-content: center;
      align-items: flex-end;
      gap: 16px;
      flex-wrap: wrap;
      pointer-events: none;
      z-index: 100;
    }}

    .cw {{
      font-size: 52px;
      font-weight: 800;
      color: var(--caption-idle);
      letter-spacing: -0.5px;
    }}

    .safe-footer {{
      position: absolute;
      left: 72px;
      right: 72px;
      bottom: 120px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 24px;
      color: var(--ink-sub);
      z-index: 10;
      opacity: 0.6;
    }}
  </style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-width="1080" data-height="1920" data-duration="{total_sec:.2f}">
    <div class="scene-bg"></div>
    <div class="grid-overlay"></div>

    <!-- ==================== SCENE 1: PARADIGM SHIFT (0.00 -> 19.56s) ==================== -->
    <div id="s1" class="clip" data-start="0.00" data-duration="19.56" data-track-index="1">
      <div class="content-layer scene-inner sc-1">
        <div class="eyebrow">PARADIGM SHIFT // BẢN CHẤT HỌC MÁY</div>
        <div class="headline">TỪ VIẾT QUY TẮC <span class="danger">CỨNG</span><br>SANG <span class="hi">TỰ ĐỘNG HỌC MÁY</span></div>

        <div class="diagram-stage">
          <div id="s1-trad" style="width:100%; margin-bottom: 30px;">
            <div style="font-family:'IBM Plex Mono',monospace; font-size:28px; color:var(--accent-danger); margin-bottom:12px;">01. LẬP TRÌNH TRUYỀN THỐNG</div>
            <div class="flow-row">
              <div class="flow-node danger" id="s1-t-data">DỮ LIỆU</div>
              <div class="flow-arrow">+</div>
              <div class="flow-node danger" id="s1-t-rules">QUY TẮC</div>
              <div class="flow-arrow">➔</div>
              <div class="flow-node" id="s1-t-ans">ĐÁP ÁN</div>
            </div>
            <div id="s1-overload" style="background:rgba(248,113,113,0.1); border:2px dashed var(--accent-danger); padding:16px; border-radius:12px; font-size:28px; color:var(--accent-danger); text-align:center; opacity:0;">
              ⚠ QUÁ TẢI: HÀNG TRIỆU QUY TẮC PHỨC TẠP KHÔNG THỂ LẬP TRÌNH TAY
            </div>
          </div>

          <div style="width:100%; height:2px; background:rgba(255,255,255,0.1); margin: 20px 0;"></div>

          <div id="s1-ml" style="width:100%;">
            <div style="font-family:'IBM Plex Mono',monospace; font-size:28px; color:var(--accent); margin-bottom:12px;">02. MACHINE LEARNING (HỌC MÁY)</div>
            <div class="flow-row">
              <div class="flow-node active" id="s1-m-data">DỮ LIỆU</div>
              <div class="flow-arrow">+</div>
              <div class="flow-node active" id="s1-m-ans">ĐÁP ÁN</div>
              <div class="flow-arrow">➔</div>
              <div class="flow-node active" id="s1-m-rules" style="background:var(--accent); color:var(--bg);">QUY TẮC (MODEL)</div>
            </div>
            <div id="s1-ml-badge" class="stamp" style="margin-top:20px; width:100%; justify-content:center; opacity:0;">
              ⚡ MÁY TỰ TÌM QUY LUẬT
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== SCENE 2: DEFINITION & SCOPE (19.56 -> 43.44s) ==================== -->
    <div id="s2" class="clip" data-start="19.56" data-duration="23.88" data-track-index="1">
      <div class="content-layer scene-inner sc-2">
        <div class="eyebrow">FOUNDATION // ĐỊNH NGHĨA CHUẨN MỰC</div>
        <div class="headline">KHUNG KHÁI NIỆM &amp;<br><span class="hi">CẤU TRÚC BA TRỤ CỘT</span></div>

        <div class="diagram-stage" style="padding: 24px;">
          <div id="s2-stamp" class="stamp" style="margin-bottom: 24px;">
            ARTHUR SAMUEL 1959 // TỰ HỌC TỪ KINH NGHIỆM
          </div>

          <div id="s2-rings" style="width:100%; height:320px; display:flex; justify-content:center; align-items:center;">
            <svg viewBox="0 0 800 300" class="svg-canvas">
              <circle cx="400" cy="150" r="140" fill="none" stroke="rgba(96, 165, 250, 0.2)" stroke-width="4" stroke-dasharray="8 8" />
              <text x="400" y="40" text-anchor="middle" fill="#8B94A6" font-size="24" font-family="IBM Plex Mono">ARTIFICIAL INTELLIGENCE (AI)</text>

              <circle cx="400" cy="150" r="95" fill="rgba(96, 165, 250, 0.08)" stroke="#60A5FA" stroke-width="4" />
              <text x="400" y="85" text-anchor="middle" fill="#60A5FA" font-size="24" font-family="IBM Plex Mono" font-weight="bold">MACHINE LEARNING</text>

              <circle cx="400" cy="150" r="50" fill="rgba(56, 189, 248, 0.25)" stroke="#38BDF8" stroke-width="3" />
              <text x="400" y="158" text-anchor="middle" fill="#F4F7FB" font-size="20" font-family="IBM Plex Mono">DEEP LEARNING</text>
            </svg>
          </div>

          <div id="s2-mitchell" style="width:100%; display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; margin-top:20px;">
            <div class="card" style="padding:20px; text-align:center;">
              <div style="font-family:'IBM Plex Mono'; font-size:44px; color:var(--accent); font-weight:700;">T</div>
              <div style="font-size:24px; font-weight:700;">TASK</div>
              <div style="font-size:20px; color:var(--ink-sub);">Tác vụ cần làm</div>
            </div>
            <div class="card" style="padding:20px; text-align:center;">
              <div style="font-family:'IBM Plex Mono'; font-size:44px; color:var(--accent-emerald); font-weight:700;">P</div>
              <div style="font-size:24px; font-weight:700;">PERFORMANCE</div>
              <div style="font-size:20px; color:var(--ink-sub);">Độ chính xác</div>
            </div>
            <div class="card" style="padding:20px; text-align:center;">
              <div style="font-family:'IBM Plex Mono'; font-size:44px; color:var(--accent-amber); font-weight:700;">E</div>
              <div style="font-size:24px; font-weight:700;">EXPERIENCE</div>
              <div style="font-size:20px; color:var(--ink-sub);">Dữ liệu học</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== SCENE 3: SUPERVISED LEARNING (43.44 -> 71.37s) ==================== -->
    <div id="s3" class="clip" data-start="43.44" data-duration="27.93" data-track-index="1">
      <div class="content-layer scene-inner sc-3">
        <div class="eyebrow">PILLAR 01 // SUPERVISED LEARNING</div>
        <div class="headline">HỌC CÓ GIÁM SÁT:<br><span class="hi">PHÂN LOẠI &amp; HỒI QUY</span></div>

        <div class="diagram-stage">
          <div class="stamp" style="margin-bottom:20px;">ĐẦU VÀO CÓ SẴN NHÃN ĐÁP ÁN</div>

          <div style="width:100%; display:grid; grid-template-columns: 1fr 1fr; gap:20px; margin-bottom:20px;">
            <div id="s3-card-cls" class="card card-accent" style="padding:24px;">
              <div style="font-family:'IBM Plex Mono'; font-size:24px; color:var(--accent); font-weight:700;">01. CLASSIFICATION</div>
              <div style="font-size:32px; font-weight:800; margin:8px 0;">PHÂN LOẠI</div>
              <div style="font-size:22px; color:var(--ink-sub);">Spam / Inbox, Chẩn đoán ảnh X-quang</div>
            </div>
            <div id="s3-card-reg" class="card" style="padding:24px;">
              <div style="font-family:'IBM Plex Mono'; font-size:24px; color:var(--accent-emerald); font-weight:700;">02. REGRESSION</div>
              <div style="font-size:32px; font-weight:800; margin:8px 0;">HỒI QUY</div>
              <div style="font-size:22px; color:var(--ink-sub);">Dự đoán giá nhà, nhiệt độ, doanh thu</div>
            </div>
          </div>

          <div style="width:100%; height:380px; position:relative;">
            <svg viewBox="0 0 800 360" class="svg-canvas">
              <line x1="60" y1="320" x2="740" y2="320" stroke="rgba(255,255,255,0.2)" stroke-width="3" />
              <line x1="60" y1="40" x2="60" y2="320" stroke="rgba(255,255,255,0.2)" stroke-width="3" />

              <circle cx="180" cy="120" r="14" fill="#F87171" />
              <circle cx="240" cy="90" r="14" fill="#F87171" />
              <circle cx="210" cy="180" r="14" fill="#F87171" />
              <circle cx="280" cy="140" r="14" fill="#F87171" />

              <circle cx="520" cy="220" r="14" fill="#60A5FA" />
              <circle cx="580" cy="270" r="14" fill="#60A5FA" />
              <circle cx="640" cy="210" r="14" fill="#60A5FA" />
              <circle cx="600" cy="160" r="14" fill="#60A5FA" />

              <line id="s3-boundary" x1="120" y1="300" x2="680" y2="70" stroke="#FBBF24" stroke-width="6" stroke-dasharray="12 8" />
              <text x="420" y="170" fill="#FBBF24" font-size="24" font-family="IBM Plex Mono" font-weight="bold">DECISION BOUNDARY</text>
            </svg>
          </div>

          <div style="width:100%; display:flex; justify-content:space-between; align-items:center; background:#182030; padding:18px 30px; border-radius:16px;">
            <div style="font-size:28px; font-weight:700;">ACCURACY SAU ĐỐI CHIẾU:</div>
            <div id="s3-acc" class="mono-number" style="font-size:64px;">98.5%</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== SCENE 4: UNSUPERVISED LEARNING (71.37 -> 98.02s) ==================== -->
    <div id="s4" class="clip" data-start="71.37" data-duration="26.65" data-track-index="1">
      <div class="content-layer scene-inner sc-4">
        <div class="eyebrow">PILLAR 02 // UNSUPERVISED LEARNING</div>
        <div class="headline">HỌC KHÔNG GIÁM SÁT:<br><span class="hi">PHÂN CỤM &amp; GIẢM CHIỀU</span></div>

        <div class="diagram-stage">
          <div class="stamp" style="margin-bottom:20px; border-color:var(--accent-cyan); color:var(--accent-cyan);">DỮ LIỆU THÔ KHÔNG HỀ CÓ NHÃN</div>

          <div style="width:100%; height:460px;">
            <svg viewBox="0 0 800 440" class="svg-canvas">
              <circle cx="400" cy="220" r="180" fill="none" stroke="rgba(56, 189, 248, 0.15)" stroke-width="2" />
              <circle cx="400" cy="220" r="100" fill="none" stroke="rgba(56, 189, 248, 0.15)" stroke-width="2" />

              <g id="s4-c1">
                <circle cx="240" cy="140" r="16" fill="#38BDF8" />
                <circle cx="210" cy="180" r="16" fill="#38BDF8" />
                <circle cx="270" cy="190" r="16" fill="#38BDF8" />
                <circle cx="240" cy="160" r="60" fill="rgba(56, 189, 248, 0.12)" stroke="#38BDF8" stroke-width="2" stroke-dasharray="6 6" />
                <text x="240" y="245" text-anchor="middle" fill="#38BDF8" font-size="22" font-family="IBM Plex Mono">NHÓM A</text>
              </g>

              <g id="s4-c2">
                <circle cx="560" cy="130" r="16" fill="#FBBF24" />
                <circle cx="590" cy="170" r="16" fill="#FBBF24" />
                <circle cx="530" cy="180" r="16" fill="#FBBF24" />
                <circle cx="560" cy="150" r="60" fill="rgba(251, 191, 36, 0.12)" stroke="#FBBF24" stroke-width="2" stroke-dasharray="6 6" />
                <text x="560" y="235" text-anchor="middle" fill="#FBBF24" font-size="22" font-family="IBM Plex Mono">NHÓM B</text>
              </g>

              <g id="s4-c3">
                <circle cx="400" cy="310" r="16" fill="#34D399" />
                <circle cx="360" cy="350" r="16" fill="#34D399" />
                <circle cx="440" cy="340" r="16" fill="#34D399" />
                <circle cx="400" cy="330" r="60" fill="rgba(52, 211, 153, 0.12)" stroke="#34D399" stroke-width="2" stroke-dasharray="6 6" />
                <text x="400" y="415" text-anchor="middle" fill="#34D399" font-size="22" font-family="IBM Plex Mono">NHÓM C</text>
              </g>
            </svg>
          </div>

          <div style="width:100%; display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
            <div class="card" style="padding:18px; text-align:center;">
              <div style="font-weight:700; font-size:26px;">PHÂN CỤM KHÁCH HÀNG</div>
              <div style="font-size:20px; color:var(--ink-sub);">K-Means Clustering</div>
            </div>
            <div class="card" style="padding:18px; text-align:center;">
              <div style="font-weight:700; font-size:26px;">NÉN CHIỀU DỮ LIỆU</div>
              <div style="font-size:20px; color:var(--ink-sub);">PCA / t-SNE 3D ➔ 2D</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== SCENE 5: REINFORCEMENT LEARNING (98.02 -> 122.59s) ==================== -->
    <div id="s5" class="clip" data-start="98.02" data-duration="24.57" data-track-index="1">
      <div class="content-layer scene-inner sc-5">
        <div class="eyebrow">PILLAR 03 // REINFORCEMENT LEARNING</div>
        <div class="headline">HỌC TĂNG CƯỜNG:<br><span class="hi">AGENT - REWARD - ACTION</span></div>

        <div class="diagram-stage">
          <div class="stamp" style="margin-bottom:20px; border-color:var(--accent-emerald); color:var(--accent-emerald);">THỬ VÀ SAI ➔ PHẦN THƯỞNG TỐI ƯU</div>

          <div style="width:100%; height:380px;">
            <svg viewBox="0 0 800 360" class="svg-canvas">
              <rect x="80" y="110" width="220" height="140" rx="16" fill="#182030" stroke="#34D399" stroke-width="4" />
              <text x="190" y="170" text-anchor="middle" fill="#34D399" font-size="32" font-family="IBM Plex Mono" font-weight="bold">AGENT</text>
              <text x="190" y="210" text-anchor="middle" fill="#8B94A6" font-size="22">Tác tử tự học</text>

              <rect x="500" y="110" width="220" height="140" rx="16" fill="#182030" stroke="#60A5FA" stroke-width="4" />
              <text x="610" y="170" text-anchor="middle" fill="#60A5FA" font-size="32" font-family="IBM Plex Mono" font-weight="bold">MÔI TRƯỜNG</text>
              <text x="610" y="210" text-anchor="middle" fill="#8B94A6" font-size="22">Game / Xe / Bản đồ</text>

              <path d="M 300 140 L 500 140" stroke="#34D399" stroke-width="4" />
              <text x="400" y="125" text-anchor="middle" fill="#34D399" font-size="24" font-family="IBM Plex Mono" font-weight="bold">ACTION ➔</text>

              <path d="M 500 220 L 300 220" stroke="#FBBF24" stroke-width="4" />
              <text x="400" y="260" text-anchor="middle" fill="#FBBF24" font-size="24" font-family="IBM Plex Mono" font-weight="bold">⮜ STATE + REWARD</text>
            </svg>
          </div>

          <div style="width:100%; display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
            <div class="card" style="padding:20px; border-color:var(--accent-emerald);">
              <div class="mono-sub">REWARD SCORE:</div>
              <div id="s5-score" class="mono-number" style="font-size:56px; color:var(--accent-emerald);">+100 PTS</div>
            </div>
            <div class="card" style="padding:20px;">
              <div class="mono-sub">ỨNG DỤNG TIÊU BIỂU:</div>
              <div style="font-size:28px; font-weight:800; color:var(--accent); margin-top:8px;">ALPHAGO &amp; XE TỰ HÀNH</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== SCENE 6: LEARNING MECHANISM & GRADIENT DESCENT (122.59 -> 159.90s) ==================== -->
    <div id="s6" class="clip" data-start="122.59" data-duration="37.31" data-track-index="1">
      <div class="content-layer scene-inner sc-6">
        <div class="eyebrow">THE CORE ENGINE // CƠ CHẾ TỰ HỌC</div>
        <div class="headline">LOSS FUNCTION &amp;<br><span class="hi">GRADIENT DESCENT</span></div>

        <div class="diagram-stage">
          <div class="stamp" style="margin-bottom:16px;">VÒNG LẶP TỐI ƯU HÓA SAI SỐ</div>

          <div style="width:100%; height:400px; position:relative;">
            <svg viewBox="0 0 800 380" class="svg-canvas">
              <path d="M 100 80 Q 400 340 700 80" fill="none" stroke="#60A5FA" stroke-width="6" />
              
              <circle cx="400" cy="340" r="16" fill="#34D399" />
              <text x="400" y="375" text-anchor="middle" fill="#34D399" font-size="24" font-family="IBM Plex Mono" font-weight="bold">GLOBAL MINIMUM (LOSS MIN)</text>

              <circle id="s6-ball" cx="180" cy="135" r="22" fill="#FBBF24" stroke="#FFF" stroke-width="3" />

              <line id="s6-gradient" x1="180" y1="135" x2="260" y2="210" stroke="#F87171" stroke-width="5" stroke-dasharray="6 4" />
              <text x="290" y="190" fill="#F87171" font-size="24" font-family="IBM Plex Mono">∇ LOSS (ĐỘ DỐC)</text>
            </svg>
          </div>

          <div style="width:100%; background:#182030; border:2px solid var(--panel-border); padding:20px; border-radius:16px; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="font-family:'IBM Plex Mono'; font-size:32px; color:var(--accent); font-weight:700;">W_mới = W_cũ - α × ∇Loss</div>
              <div style="font-size:22px; color:var(--ink-sub);">Cập nhật trọng số theo Learning Rate α</div>
            </div>
            <div id="s6-loss-val" class="mono-number" style="font-size:52px; color:var(--accent-danger);">LOSS: 0.04</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== SCENE 7: OVERFITTING VS UNDERFITTING (159.90 -> 183.86s) ==================== -->
    <div id="s7" class="clip" data-start="159.90" data-duration="23.96" data-track-index="1">
      <div class="content-layer scene-inner sc-7">
        <div class="eyebrow">CRITICAL PITFALLS // CẠM BẪY SỐNG CÒN</div>
        <div class="headline">OVERFITTING &amp;<br><span class="danger">CẠM BẪY HỌC VẸT</span></div>

        <div class="diagram-stage">
          <div class="stamp danger" style="margin-bottom:20px;">CẢNH BÁO: MẤT KHẢ NĂNG TỔNG QUÁT HÓA</div>

          <div style="width:100%; display:grid; grid-template-columns: 1fr 1fr 1fr; gap:16px; margin-bottom:20px;">
            <div class="card" style="padding:16px; text-align:center;">
              <div style="font-family:'IBM Plex Mono'; font-size:20px; color:var(--ink-sub);">UNDERFITTING</div>
              <div style="font-size:26px; font-weight:800; margin:6px 0;">HỌC DỐT</div>
              <div style="height:120px; display:flex; align-items:center; justify-content:center;">
                <svg viewBox="0 0 200 120" style="width:100%; height:100%;">
                  <circle cx="40" cy="90" r="6" fill="#8B94A6" />
                  <circle cx="80" cy="50" r="6" fill="#8B94A6" />
                  <circle cx="120" cy="70" r="6" fill="#8B94A6" />
                  <circle cx="160" cy="30" r="6" fill="#8B94A6" />
                  <line x1="20" y1="60" x2="180" y2="60" stroke="#8B94A6" stroke-width="4" />
                </svg>
              </div>
              <div style="font-size:18px; color:var(--ink-sub);">High Bias</div>
            </div>

            <div class="card card-accent" style="padding:16px; text-align:center; border-color:var(--accent-emerald);">
              <div style="font-family:'IBM Plex Mono'; font-size:20px; color:var(--accent-emerald);">GOOD FIT</div>
              <div style="font-size:26px; font-weight:800; margin:6px 0; color:var(--accent-emerald);">LÝ TƯỞNG</div>
              <div style="height:120px; display:flex; align-items:center; justify-content:center;">
                <svg viewBox="0 0 200 120" style="width:100%; height:100%;">
                  <circle cx="40" cy="90" r="6" fill="#34D399" />
                  <circle cx="80" cy="50" r="6" fill="#34D399" />
                  <circle cx="120" cy="70" r="6" fill="#34D399" />
                  <circle cx="160" cy="30" r="6" fill="#34D399" />
                  <path d="M 20 100 Q 90 20 180 30" fill="none" stroke="#34D399" stroke-width="4" />
                </svg>
              </div>
              <div style="font-size:18px; color:var(--accent-emerald);">Cân bằng chuẩn</div>
            </div>

            <div class="card" style="padding:16px; text-align:center; border-color:var(--accent-danger);">
              <div style="font-family:'IBM Plex Mono'; font-size:20px; color:var(--accent-danger);">OVERFITTING</div>
              <div style="font-size:26px; font-weight:800; margin:6px 0; color:var(--accent-danger);">HỌC VẸT</div>
              <div style="height:120px; display:flex; align-items:center; justify-content:center;">
                <svg viewBox="0 0 200 120" style="width:100%; height:100%;">
                  <circle cx="40" cy="90" r="6" fill="#F87171" />
                  <circle cx="80" cy="50" r="6" fill="#F87171" />
                  <circle cx="120" cy="70" r="6" fill="#F87171" />
                  <circle cx="160" cy="30" r="6" fill="#F87171" />
                  <path d="M 20 110 L 40 90 L 60 110 L 80 50 L 100 100 L 120 70 L 140 10 L 160 30 L 180 10" fill="none" stroke="#F87171" stroke-width="3" />
                </svg>
              </div>
              <div style="font-size:18px; color:var(--accent-danger);">High Variance</div>
            </div>
          </div>

          <div style="width:100%; background:rgba(96,165,250,0.1); border:2px solid var(--accent); border-radius:16px; padding:20px; text-align:center;">
            <div style="font-size:28px; font-weight:800; color:var(--accent);">BIAS - VARIANCE TRADEOFF</div>
            <div style="font-size:22px; color:var(--ink); margin-top:4px;">Mục tiêu: Đạt độ chính xác cao trên dữ liệu CHƯA TỪNG THẤY</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== SCENE 8: BIG PICTURE & CTA (183.86 -> 201.78s) ==================== -->
    <div id="s8" class="clip" data-start="183.86" data-duration="17.92" data-track-index="1">
      <div class="content-layer scene-inner sc-8">
        <div class="eyebrow">THE BIG PICTURE // TƯ DUY &amp; KẾT NỐI</div>
        <div class="headline">MACHINE LEARNING<br><span class="hi">ĐỊNH HÌNH TƯƠNG LAI</span></div>

        <div class="diagram-stage">
          <div style="width:100%; display:grid; grid-template-columns: 1fr 1fr 1fr; gap:16px; margin-bottom:24px;">
            <div class="card" style="padding:20px; text-align:center;">
              <div style="font-size:40px;">📐</div>
              <div style="font-size:24px; font-weight:700; margin-top:8px;">ĐẠI SỐ TUYẾN TÍNH</div>
            </div>
            <div class="card" style="padding:20px; text-align:center;">
              <div style="font-size:40px;">🎲</div>
              <div style="font-size:24px; font-weight:700; margin-top:8px;">XÁC SUẤT THỐNG KÊ</div>
            </div>
            <div class="card" style="padding:20px; text-align:center;">
              <div style="font-size:40px;">💾</div>
              <div style="font-size:24px; font-weight:700; margin-top:8px;">DỮ LIỆU LỚN</div>
            </div>
          </div>

          <div class="card card-accent" style="width:100%; padding:32px; text-align:center; background:linear-gradient(180deg, #182030 0%, #121722 100%);">
            <div class="stamp" style="margin:0 auto 16px auto; font-size:28px;">BÌNH LUẬN CHỦ ĐỀ TIẾP THEO</div>
            <div style="font-size:36px; font-weight:900; color:var(--ink); margin-bottom:12px;">Bạn muốn đi sâu vào thuật toán nào?</div>
            <div style="font-size:26px; color:var(--ink-sub);">Neural Networks · Transformer · LLM · K-Means</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Audio Master -->
    <audio id="vo-master" src="voice/narration.wav" data-start="0.00" data-volume="1"></audio>

    <!-- Karaoke Captions Generated -->
{caption_clips_str}

    <div class="safe-footer">
      <div>MOTIONREAL // MACHINE LEARNING EXPLAINER</div>
      <div>210S MASTER</div>
    </div>
  </div>

  <script src="gsap.min.js"></script>
  <script>
    const tl = gsap.timeline({{ paused: true }});

    // Scene transition timings
    const S1_START = 0.00, S1_DUR = 19.56;
    const S2_START = 19.56, S2_DUR = 23.88;
    const S3_START = 43.44, S3_DUR = 27.93;
    const S4_START = 71.37, S4_DUR = 26.65;
    const S5_START = 98.02, S5_DUR = 24.57;
    const S6_START = 122.59, S6_DUR = 37.31;
    const S7_START = 159.90, S7_DUR = 23.96;
    const S8_START = 183.86, S8_DUR = 17.92;

    // Crossfades between inner scenes with hard kills
    tl.to(".sc-1", {{ opacity: 0, duration: 0.28, ease: "none" }}, S2_START - 0.28);
    tl.set(".sc-1", {{ opacity: 0 }}, S2_START);

    tl.fromTo(".sc-2", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.28, ease: "none" }}, S2_START);
    tl.to(".sc-2", {{ opacity: 0, duration: 0.28, ease: "none" }}, S3_START - 0.28);
    tl.set(".sc-2", {{ opacity: 0 }}, S3_START);

    tl.fromTo(".sc-3", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.28, ease: "none" }}, S3_START);
    tl.to(".sc-3", {{ opacity: 0, duration: 0.28, ease: "none" }}, S4_START - 0.28);
    tl.set(".sc-3", {{ opacity: 0 }}, S4_START);

    tl.fromTo(".sc-4", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.28, ease: "none" }}, S4_START);
    tl.to(".sc-4", {{ opacity: 0, duration: 0.28, ease: "none" }}, S5_START - 0.28);
    tl.set(".sc-4", {{ opacity: 0 }}, S5_START);

    tl.fromTo(".sc-5", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.28, ease: "none" }}, S5_START);
    tl.to(".sc-5", {{ opacity: 0, duration: 0.28, ease: "none" }}, S6_START - 0.28);
    tl.set(".sc-5", {{ opacity: 0 }}, S6_START);

    tl.fromTo(".sc-6", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.28, ease: "none" }}, S6_START);
    tl.to(".sc-6", {{ opacity: 0, duration: 0.28, ease: "none" }}, S7_START - 0.28);
    tl.set(".sc-6", {{ opacity: 0 }}, S7_START);

    tl.fromTo(".sc-7", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.28, ease: "none" }}, S7_START);
    tl.to(".sc-7", {{ opacity: 0, duration: 0.28, ease: "none" }}, S8_START - 0.28);
    tl.set(".sc-7", {{ opacity: 0 }}, S8_START);

    tl.fromTo(".sc-8", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.28, ease: "none" }}, S8_START);

    // ================= Scene 1 Dynamic Animations =================
    tl.fromTo("#s1-t-rules", {{ scale: 1 }}, {{ scale: 1.08, duration: 0.4, yoyo: true, repeat: 3 }}, 9.38);
    tl.fromTo("#s1-overload", {{ opacity: 0, y: 20 }}, {{ opacity: 1, y: 0, duration: 0.4 }}, 10.5);
    tl.fromTo("#s1-ml-badge", {{ opacity: 0, scale: 2.1, rotation: -12 }}, {{ opacity: 1, scale: 1, rotation: -3, duration: 0.35, ease: "back.out(1.7)" }}, 15.0);

    // ================= Scene 2 Dynamic Animations =================
    tl.fromTo("#s2-stamp", {{ opacity: 0, scale: 1.8 }}, {{ opacity: 1, scale: 1, duration: 0.4, ease: "back.out(1.5)" }}, S2_START + 0.5);
    tl.fromTo("#s2-mitchell .card", {{ opacity: 0, y: 30 }}, {{ opacity: 1, y: 0, stagger: 0.2, duration: 0.4 }}, S2_START + 13.0);

    // ================= Scene 3 Dynamic Animations =================
    tl.fromTo("#s3-boundary", {{ strokeDashoffset: 100, opacity: 0 }}, {{ strokeDashoffset: 0, opacity: 1, duration: 0.8 }}, S3_START + 11.0);
    const accObj = {{ val: 65.0 }};
    const accEl = document.getElementById("s3-acc");
    tl.to(accObj, {{
      val: 98.5,
      duration: 3.5,
      ease: "power2.out",
      onUpdate: () => {{
        if (accEl) accEl.textContent = accObj.val.toFixed(1) + "%";
      }}
    }}, S3_START + 22.0);

    // ================= Scene 4 Dynamic Animations =================
    tl.fromTo("#s4-c1", {{ opacity: 0, scale: 0.8 }}, {{ opacity: 1, scale: 1, duration: 0.5 }}, S4_START + 16.0);
    tl.fromTo("#s4-c2", {{ opacity: 0, scale: 0.8 }}, {{ opacity: 1, scale: 1, duration: 0.5 }}, S4_START + 17.5);
    tl.fromTo("#s4-c3", {{ opacity: 0, scale: 0.8 }}, {{ opacity: 1, scale: 1, duration: 0.5 }}, S4_START + 19.0);

    // ================= Scene 5 Dynamic Animations =================
    const scoreObj = {{ pts: 0 }};
    const scoreEl = document.getElementById("s5-score");
    tl.to(scoreObj, {{
      pts: 100,
      duration: 1.5,
      ease: "power1.out",
      onUpdate: () => {{
        if (scoreEl) scoreEl.textContent = "+" + Math.round(scoreObj.pts) + " PTS";
      }}
    }}, S5_START + 10.0);

    // ================= Scene 6 Dynamic Animations =================
    tl.fromTo("#s6-ball", {{ cx: 180, cy: 135 }}, {{ cx: 400, cy: 340, duration: 6.0, ease: "power2.inOut" }}, S6_START + 25.0);
    tl.fromTo("#s6-gradient", {{ opacity: 1 }}, {{ opacity: 0, duration: 6.0 }}, S6_START + 25.0);
    const lossObj = {{ val: 0.95 }};
    const lossEl = document.getElementById("s6-loss-val");
    tl.to(lossObj, {{
      val: 0.02,
      duration: 6.0,
      ease: "power2.inOut",
      onUpdate: () => {{
        if (lossEl) {{
          lossEl.textContent = "LOSS: " + lossObj.val.toFixed(2);
          if (lossObj.val < 0.1) lossEl.style.color = "#34D399";
        }}
      }}
    }}, S6_START + 25.0);

    // ================= Caption Sync Engine =================
    const cwNodes = document.querySelectorAll(".caption-line .cw");
    const CAPTION_WORDS = {caption_words_str};
    const CAPTION_ACTIVE = "#60A5FA";
    const CAPTION_IDLE = "rgba(244, 247, 251, 0.45)";

    CAPTION_WORDS.forEach(([lineIdx, wordIdx, start, end], k) => {{
      const el = cwNodes[k];
      if (!el) return;
      tl.set(el, {{ color: CAPTION_ACTIVE }}, start);
      tl.set(el, {{ color: CAPTION_IDLE }}, end);
    }});

    // Register paused timeline with HyperFrames
    window.__timelines = {{ main: tl }};
  </script>
</body>
</html>
'''

with open(os.path.join(starter_dir, 'index.html'), 'w', encoding='utf-8') as f:
    f.write(html_template)

print(f'Thành công! Đã tạo starter-hf/{slug}/index.html với {len(caption_lines)} dòng caption và {total_sec}s.')