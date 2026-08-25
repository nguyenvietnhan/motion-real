# Findings: Machine Learning là gì & Toàn bộ Khái niệm Cốt lõi

## Tóm tắt

Machine Learning (Học máy) là phân ngành cốt lõi của Trí tuệ Nhân tạo (AI), cho phép hệ thống máy tính tự động đúc rút quy luật, học hỏi từ dữ liệu và nâng cao độ chính xác theo thời gian mà không cần con người lập trình tường minh từng dòng quy tắc. Thay vì mô hình lập trình truyền thống (nạp Dữ liệu + Quy tắc → sinh Đáp án), Machine Learning đảo ngược quy trình (nạp Dữ liệu + Đáp án/Mục tiêu → máy tự tìm ra Quy tắc và Mô hình).

Toàn bộ vũ trụ Machine Learning được chia làm 3 trường phái kinh điển: Học có giám sát (Supervised Learning), Học không giám sát (Unsupervised Learning), và Học tăng cường (Reinforcement Learning), cùng với nhánh phát triển chuyên sâu là Deep Learning (Học sâu dựa trên Mạng nơ-ron nhiều tầng). Quá trình huấn luyện cốt lõi vận hành dựa trên chu trình: Trích xuất đặc trưng (Features) → Khởi tạo trọng số (Weights) → Tính toán sai số qua Hàm mất mát (Loss Function) → Tối ưu hóa trọng số ngược chiều gradient bằng thuật toán Gradient Descent và Backpropagation.

Để triển khai thành công vào thế giới thực, kỹ sư Machine Learning phải giải quyết bài toán cân bằng sinh tử giữa Overfitting (học vẹt, khớp quá mức dữ liệu huấn luyện) và Underfitting (mô hình quá thô sơ), tối ưu thế cân bằng Bias-Variance Tradeoff, và đánh giá mô hình bằng các thước đo chuẩn xác (Accuracy, Precision, Recall, F1-Score, ROC-AUC, MAE, MSE) trước khi đưa vào sản phẩm thực tế.

## Key Points

1. **Khái niệm & Bản chất đảo ngược**: Năm 1959, Arthur Samuel đưa ra định nghĩa kinh điển về Machine Learning: khả năng giúp máy tính tự học mà không cần lập trình chi tiết từng bước — [IBM Journal of R&D / IEEE](https://doi.org/10.1147/rd.33.0210) (high).
2. **Định nghĩa toán học của Tom Mitchell (1997)**: Một chương trình học từ kinh nghiệm \(E\) đối với tập tác vụ \(T\) và thước đo hiệu năng \(P\), nếu hiệu năng tại \(T\) (đo bằng \(P\)) tăng dần theo kinh nghiệm \(E\) — [CMU CS / McGraw-Hill](http://www.cs.cmu.edu/~tom/mlbook.html) (high).
3. **Ba trường phái Machine Learning nền tảng**: Phân loại chuẩn mực thành Supervised Learning (dữ liệu có nhãn), Unsupervised Learning (dữ liệu không nhãn, tự dò cấu trúc/phân cụm), và Reinforcement Learning (Agent tương tác môi trường nhận thưởng/phạt) — [Stanford CS229](https://cs229.stanford.edu/main_notes.pdf) & [MIT Press / Sutton & Barto](http://incompleteideas.net/book/the-book-2nd.html) (high).
4. **Cột mốc lịch sử Reinforcement Learning**: Tháng 3/2016, hệ thống AlphaGo của DeepMind kết hợp Reinforcement Learning và Mạng nơ-ron sâu đã đánh bại kiện tướng cờ vây thế giới Lee Sedol với tỉ số 4-1 sau hàng triệu ván tự đấu — [Nature](https://doi.org/10.1038/nature16961) (high).
5. **Cơ chế tối ưu hóa Gradient Descent & Backpropagation**: Tối ưu hóa trọng số mô hình bằng cách tính đạo hàm riêng của hàm mất mát và cập nhật ngược hướng gradient theo nhịp Learning Rate — [Nature / Rumelhart, Hinton & Williams](https://doi.org/10.1038/323533a0) (high).
6. **Thế lưỡng nan Bias-Variance & Overfitting**: Cân bằng sai số mô hình hóa (Bias) và độ nhạy nhiễu dữ liệu (Variance) là nguyên lý tối hậu để tránh Overfitting và Underfitting trong học máy — [Neural Computation / Geman et al.](https://doi.org/10.1162/neco.1992.4.1.1) (high).
7. **Quy mô và tác động kinh tế toàn cầu**: Báo cáo Stanford AI Index 2024 chỉ ra rằng các hệ thống Machine Learning và AI tạo sinh đã thâm nhập hơn 70% doanh nghiệp toàn cầu trong phân tích dữ liệu, tự động hóa và y tế — [Stanford HAI AI Index Report 2024](https://aiindex.stanford.edu/report/) (high).

## Claim Ledger

| Claim | Giá trị | Nguồn (URL) | Ngày nguồn | Độ tin cậy |
| --- | --- | --- | --- | --- |
| Năm Arthur Samuel định nghĩa Machine Learning | 1959 | https://doi.org/10.1147/rd.33.0210 | 1959-07 | high |
| Công thức định nghĩa Học máy (T, P, E) của Tom Mitchell | E, T, P | http://www.cs.cmu.edu/~tom/mlbook.html | 1997-03 | high |
| Năm AlphaGo đánh bại Lee Sedol với tỉ số 4-1 | 2016 (4-1) | https://doi.org/10.1038/nature16961 | 2016-01 | high |
| Bài báo nền tảng Backpropagation của Hinton | 1986 | https://doi.org/10.1038/323533a0 | 1986-10 | high |
| Lý thuyết phân rã Bias-Variance Dilemma | 1992 | https://doi.org/10.1162/neco.1992.4.1.1 | 1992-01 | high |
| Tỉ lệ doanh nghiệp tích hợp ML/AI trong báo cáo Stanford AI Index 2024 | >70% | https://aiindex.stanford.edu/report/ | 2024-04 | high |
| Bản chất toán học của Machine Learning | Tối ưu hóa, Xác suất thống kê, Đại số tuyến tính | https://cs229.stanford.edu/main_notes.pdf | 2023-09 | high |

## Mâu thuẫn & giới hạn

- **Định nghĩa AI vs ML vs Deep Learning**: Một số tài liệu đại chúng thường nhầm lẫn coi AI và Machine Learning là một. Nghiên cứu học thuật chuẩn khẳng định: AI là khái niệm bao trùm (mọi cỗ máy thông minh), Machine Learning là phương pháp học từ dữ liệu, và Deep Learning là tập con của Machine Learning sử dụng mạng nơ-ron sâu nhiều tầng.
- **Giới hạn của dữ liệu**: Machine Learning không phải cây đũa thần; nếu dữ liệu huấn luyện bị thiên kiến (bias) hoặc chứa quá nhiều nhiễu (noise), mô hình sẽ suy luận sai lệch nghiêm trọng ("Garbage In, Garbage Out").
