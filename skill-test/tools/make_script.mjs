import fs from 'fs';
import path from 'path';

const slug = 'machine-learning-la-gi';
const topic = 'Machine Learning là gì & Toàn bộ Khái niệm Cốt lõi';
const targetSeconds = 210;
const fps = 30;
const voice = 'Adam';
const stylePack = 'default';

const beats = [
  { id: 'b1', role: 'hook', vo: 'Bạn nghĩ máy tính thông minh vì con người viết sẵn từng dòng lệnh? Hoàn toàn sai.', visual: 'Hero diagram xuất hiện: Mô hình lập trình truyền thống với khối Rules và Data va chạm, nháy đỏ cảnh báo.' },
  { id: 'b2', role: 'hook', vo: 'Lập trình truyền thống bắt bạn nạp Dữ liệu và Quy tắc để máy tính cho ra Đáp án.', visual: 'Sơ đồ Lập trình truyền thống: [Dữ liệu] + [Quy tắc] mũi tên chỉ vào CPU -> [Đáp án].' },
  { id: 'b3', role: 'hook', vo: 'Nhưng nếu bài toán quá phức tạp, không ai có thể tự tay viết hết hàng triệu quy tắc.', visual: 'Khối Quy tắc nổ tung thành mạng lưới ma trận dày đặc quá tải, viền đỏ rung lắc.' },
  { id: 'b4', role: 'context', vo: 'Machine Learning xuất hiện và đảo ngược hoàn toàn: ta nạp Dữ liệu và Đáp án để máy tự tìm ra Quy tắc.', visual: 'Hero Diagram chuyển đổi: [Dữ liệu] + [Đáp án] nạp vào ML Engine -> Tự sinh ra [Quy tắc/Mô hình] sáng rực.' },
  { id: 'b5', role: 'context', vo: 'Năm 1959, Arthur Samuel định nghĩa: Học máy là ngành giúp máy tính tự học mà không cần lập trình chi tiết.', visual: 'Card lịch sử 1959 với tem Arthur Samuel, trích dẫn triết lý máy tính tự học qua kinh nghiệm.' },
  { id: 'b6', role: 'context', vo: 'Hãy hình dung: AI là vũ trụ rộng lớn, Machine Learning là lõi vận hành, còn Deep Learning là mạng nơ-ron chuyên sâu.', visual: 'Sơ đồ 3 vòng tròn đồng tâm: Vòng ngoài AI, vòng giữa Machine Learning, vòng nhân Deep Learning.' },
  { id: 'b7', role: 'context', vo: 'Nhà khoa học Tom Mitchell chuẩn hóa: máy học khi hiệu năng P trong tác vụ T tăng dần nhờ kinh nghiệm E.', visual: 'Khung định nghĩa Mitchell: 3 hộp tham số [Task T], [Performance P], [Experience E] kết nối liên hoàn.' },
  { id: 'b8', role: 'context', vo: 'Nhưng bằng cách nào một cỗ máy có thể tự học từ dữ liệu? Nó chia làm ba trường phái chính.', visual: 'Hero Diagram mở rộng: 3 nhánh lớn mọc ra từ thân cây ML: Supervised, Unsupervised, Reinforcement.' },
  { id: 'b9', role: 'supervised', vo: 'Trường phái thứ nhất: Supervised Learning, tức Học có giám sát. Đây là dạng phổ biến nhất hiện nay.', visual: 'Nhánh 1 [Supervised Learning] sáng bừng màu xanh accent, gắn nhãn huy hiệu [Đã có giám sát].' },
  { id: 'b10', role: 'supervised', vo: 'Giống như học sinh giải bài tập có sẵn sách giải, dữ liệu đầu vào luôn đi kèm nhãn đáp án chính xác.', visual: 'Minh họa dữ liệu có nhãn: Các cặp thẻ [Ảnh Mèo -> Nhãn Mèo], [Ảnh Chó -> Nhãn Chó] ghép đôi hoàn hảo.' },
  { id: 'b11', role: 'supervised', vo: 'Nhánh đầu tiên là Phân loại: giúp máy nhận diện email rác, chẩn đoán ảnh X-quang hoặc quét khuôn mặt.', visual: 'Sơ đồ Phân loại (Classification): Đường ranh giới phân tách rõ ràng 2 cụm điểm nhãn Spam và Inbox.' },
  { id: 'b12', role: 'supervised', vo: 'Nhánh thứ hai là Hồi quy: dự đoán một giá trị số liên tục như giá nhà, nhiệt độ ngày mai hay doanh thu.', visual: 'Sơ đồ Hồi quy (Regression): Đường hồi quy tuyến tính chạy xuyên qua các điểm phân tán giá nhà.' },
  { id: 'b13', role: 'supervised', vo: 'Máy đối chiếu dự đoán của nó với đáp án thật, liên tục sửa lỗi để ngày càng đoán chính xác hơn.', visual: 'Vòng lặp đối chiếu: Mũi tên sai số co ngắn lại, độ chính xác Accuracy tăng từ 65% lên 98%.' },
  { id: 'b14', role: 'unsupervised', vo: 'Nhưng trong thực tế, phần lớn dữ liệu trên thế giới không hề có sẵn nhãn. Đó là lúc ta cần Unsupervised Learning.', visual: 'Nhánh 2 [Unsupervised Learning] kích hoạt: Biển dữ liệu thô toàn các chấm trắng hỗn độn không nhãn.' },
  { id: 'b15', role: 'unsupervised', vo: 'Học không giám sát giống như thả bạn vào hang động lạ tự khám phá mà không có bản đồ hướng dẫn.', visual: 'Khối radar quét không gian dữ liệu đa chiều trong bóng tối, tự dò tìm cấu trúc hình học.' },
  { id: 'b16', role: 'unsupervised', vo: 'Thuật toán sẽ tự động phân tích cấu trúc, đo khoảng cách và tìm ra quy luật ẩn giấu bên trong dữ liệu.', visual: 'Các đường nối đo khoảng cách Euclidean giữa các điểm dữ liệu tự động co kéo và liên kết.' },
  { id: 'b17', role: 'unsupervised', vo: 'Điển hình là Phân cụm: tự động gom nhóm hàng triệu khách hàng theo hành vi mua sắm tương đồng.', visual: 'Thuật toán Clustering: Các điểm dữ liệu tự co cụm thành 3 nhóm màu riêng biệt rõ nét.' },
  { id: 'b18', role: 'unsupervised', vo: 'Hoặc Giảm chiều dữ liệu: nén hàng nghìn thuộc tính phức tạp xuống biểu đồ hai chiều trực quan.', visual: 'Biểu đồ 3D phức tạp thu gọn mượt mà xuống mặt phẳng 2D hiển thị cấu trúc cô đọng.' },
  { id: 'b19', role: 'reinforcement', vo: 'Trường phái thứ ba, độc đáo và mạnh mẽ nhất: Reinforcement Learning, tức Học tăng cường.', visual: 'Nhánh 3 [Reinforcement Learning] bừng sáng với vòng lặp tương tác Agent và Environment.' },
  { id: 'b20', role: 'reinforcement', vo: 'Không cần dữ liệu mẫu hay sách giải, một Agent được thả vào một môi trường để tự mình hành động.', visual: 'Sơ đồ vòng lặp khép kín: Agent thực hiện Action gửi tới Environment, nhận về State mới.' },
  { id: 'b21', role: 'reinforcement', vo: 'Mỗi quyết định đúng sẽ nhận điểm thưởng, mỗi sai lầm sẽ nhận điểm phạt.', visual: 'Thanh điểm thưởng Reward: Số nhảy +100 màu xanh lá khi đi đúng, -50 màu đỏ khi va chạm vật cản.' },
  { id: 'b22', role: 'reinforcement', vo: 'Qua hàng triệu ván thử và sai, Agent tự khám phá ra chiến thuật tối ưu vượt qua cả con người.', visual: 'Bộ đếm ván chơi tăng vọt từ 1 đến 1.000.000, lộ trình di chuyển ngày càng mượt mà hoàn hảo.' },
  { id: 'b23', role: 'reinforcement', vo: 'Đây chính là cách AlphaGo đánh bại kiện tướng thế giới và xe tự hành học cách giữ làn an toàn.', visual: 'Hiển thị hai biểu tượng chiến thắng: Bàn cờ vây AlphaGo và mô hình radar xe tự lái.' },
  { id: 'b24', role: 'mechanism', vo: 'Vậy bên trong cỗ máy, quy trình biến dữ liệu thô thành trí thông minh diễn ra như thế nào?', visual: 'Mở rộng vào trung tâm cỗ máy ML: Bản vẽ kỹ thuật hiển thị đường ống xử lý dữ liệu 4 tầng.' },
  { id: 'b25', role: 'mechanism', vo: 'Đầu tiên là Trích xuất đặc trưng: chuyển hóa hình ảnh, âm thanh thành các vectơ số mà máy tính hiểu được.', visual: 'Ma trận ảnh thô chuyển thành mảng vectơ số đặc trưng [x1, x2, x3, ... xn] ánh xạ rõ nét.' },
  { id: 'b26', role: 'mechanism', vo: 'Tiếp theo là Mô hình toán học: các trọng số Weights ban đầu được khởi tạo hoàn toàn ngẫu nhiên.', visual: 'Các nút mạng nơ-ron liên kết với trọng số ngẫu nhiên W ban đầu mờ nhạt.' },
  { id: 'b27', role: 'mechanism', vo: 'Cốt lõi của việc học nằm ở Hàm mất mát Loss Function: thước đo tính toán xem máy đang đoán sai bao nhiêu.', visual: 'Công thức và biểu đồ Loss Function xuất hiện, vạch đo sai số hiển thị mức Loss cao báo động.' },
  { id: 'b28', role: 'mechanism', vo: 'Mục tiêu tối thượng của quá trình huấn luyện là kéo giá trị Loss Function này về mức thấp nhất có thể.', visual: 'Mũi tên mục tiêu kéo đường cong Loss đi xuống, số đo Loss giảm dần về tiệm cận 0.' },
  { id: 'b29', role: 'mechanism', vo: 'Để làm điều đó, thuật toán Gradient Descent hoạt động như một người mù lần bước xuống đáy thung lũng sương mù.', visual: 'Mô phỏng 3D mặt cong thung lũng: Một viên bi lăn từng bước dò đường xuống điểm đáy lòng chảo.' },
  { id: 'b30', role: 'mechanism', vo: 'Nó tính toán độ dốc và điều chỉnh trọng số ngược hướng dốc, với bước nhảy được kiểm soát bởi Learning Rate.', visual: 'Vectơ Gradient chỉ ngược hướng dốc kèm tham số Learning Rate điều chỉnh kích thước bước nhảy.' },
  { id: 'b31', role: 'pitfall', vo: 'Tuy nhiên, cỗ máy tự học đối mặt với một cạm bẫy chết người: đó là hiện tượng Overfitting, tức học vẹt.', visual: 'Card cảnh báo nguy hiểm: Khái niệm Overfitting xuất hiện với con dấu [CẢNH BÁO HỌC VẸT].' },
  { id: 'b32', role: 'pitfall', vo: 'Khi mô hình quá phức tạp, nó ghi nhớ từng điểm nhiễu của dữ liệu cũ nhưng bất lực trước dữ liệu mới.', visual: 'Đường phân chia uốn lượn ngoằn ngoèo thái quá quanh các điểm nhiễu, kiểm tra dữ liệu mới bị sai lệch.' },
  { id: 'b33', role: 'pitfall', vo: 'Ngược lại, nếu mô hình quá thô sơ, ta gặp Underfitting: máy không nắm bắt nổi bất kỳ quy luật nào.', visual: 'Đường thẳng đơ Underfitting cắt ngang dữ liệu mà không phân tách được cụm nào.' },
  { id: 'b34', role: 'pitfall', vo: 'Cuộc chiến của kỹ sư AI là cân bằng Bias và Variance, giữ mô hình vừa chuẩn xác vừa có tính tổng quát cao.', visual: 'Mô hình cân bằng hoàn hảo (Good Fit): Đường cong mềm mại bao quát đúng quy luật cốt lõi.' },
  { id: 'b35', role: 'takeaway', vo: 'Machine Learning không phải phép thuật huyền bí, mà là sự kết hợp tuyệt mỹ giữa đại số, xác suất và dữ liệu lớn.', visual: 'Biểu tượng ba bánh răng lồng vào nhau: Đại số tuyến tính, Xác suất thống kê, và Dữ liệu lớn.' },
  { id: 'b36', role: 'takeaway', vo: 'Nó đang định hình lại mọi lĩnh vực: từ y tế, tài chính, giao thông đến các mô hình ngôn ngữ lớn hôm nay.', visual: 'Mạng lưới ứng dụng lan tỏa rực rỡ: Y tế, Tài chính xe tự hành và mô hình LLM thông minh.' },
  { id: 'b37', role: 'cta', vo: 'Bạn muốn đi sâu vào thuật toán nào tiếp theo trong các video tới? Hãy để lại bình luận phía dưới!', visual: 'Màn kết thúc CTA: Hộp bình luận tương tác nổi bật kèm mũi tên chỉ dẫn đón xem phần tiếp theo.' }
];

let totalWords = 0;
beats.forEach(b => {
  const w = b.vo.trim().split(/\s+/).length;
  totalWords += w;
});

const speechSeconds = totalWords / 3.7;
const estTotal = speechSeconds + beats.length * 0.45;

console.log('Tổng số từ:', totalWords);
console.log(Phép tính:  từ * (1/3.7) ≈ s speech +  beats nghỉ (s) ≈ s — khớp mục tiêu 210s);

// Tạo beats.json ban đầu
const beatsJson = {
  slug,
  topic,
  targetSeconds,
  fps,
  voice,
  stylePack,
  gapSeconds: 0.45,
  tailSeconds: 1.5,
  totalSeconds: Number(estTotal.toFixed(1)),
  beats: beats.map((b, i) => ({
    id: b.id,
    role: b.role,
    vo: b.vo,
    wav: oice/.wav,
    start: 0,
    duration: 0
  }))
};

const jobDir = path.resolve('jobs', slug);
if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });

fs.writeFileSync(path.join(jobDir, 'beats.json'), JSON.stringify(beatsJson, null, 2), 'utf-8');

// Tạo script.md
let scriptMd = # Kịch bản: \n\n;
scriptMd += - **Mục tiêu**: Video giải thích 9:16 thời lượng s (~3.5 phút)\n;
scriptMd += - **Tổng số từ**:  từ\n;
scriptMd += - **Phép tính quy đổi**:  từ × (1/3.7) ≈ s speech + nghỉ ≈ s — khớp mục tiêu s (chấp nhận ±10%)\n;
scriptMd += - **Giọng đọc**: \n;
scriptMd += - **Style pack**: \n\n;
scriptMd += ## Bảng phân cảnh Beat Sheet\n\n;
scriptMd += | Beat ID | Vai trò | Lời thoại VO (≤25 từ) | Hình diễn biến |\n;
scriptMd += | --- | --- | --- | --- |\n;
beats.forEach(b => {
  scriptMd += | \${b.id}\ |  |  |  |\n;
});

fs.writeFileSync(path.join(jobDir, 'script.md'), scriptMd, 'utf-8');
console.log('Đã tạo thành công script.md và beats.json!');
