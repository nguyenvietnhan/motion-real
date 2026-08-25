# Findings: Machine Learning là gì & Toàn bộ Khái niệm Cốt lõi

## Tóm tắt

Machine Learning (Học máy) là phân ngành cốt lõi của Trí tuệ Nhân tạo (AI), cho phép hệ thống máy tính tự động học hỏi quy luật và cải thiện hiệu năng từ dữ liệu mà không cần được lập trình từng dòng lệnh cứng. Nếu như lập trình truyền thống nhận Dữ liệu và Quy tắc để đưa ra Đáp án (Data + Rules = Answers), thì Học máy đảo ngược hoàn toàn quy trình này: đưa Dữ liệu và Đáp án để thuật toán tự sinh ra Quy tắc (Data + Answers = Rules).

Cấu trúc của Machine Learning xoay quanh 3 trường phái học chính: Học có giám sát (Supervised Learning), Học không giám sát (Unsupervised Learning) và Học tăng cường (Reinforcement Learning). Trọng tâm cơ chế tự học bên trong là vòng lặp tối ưu hóa: dữ liệu đi qua hàm dự đoán, hàm mất mát (Loss Function) đo lường sai số, và thuật toán tối ưu hóa (tiêu biểu là Gradient Descent) điều chỉnh các trọng số (weights) theo hướng giảm thiểu sai số. Thách thức lớn nhất trong huấn luyện là giải quyết mâu thuẫn giữa Bias và Variance, tránh cạm bẫy học vẹt (Overfitting) để mô hình có khả năng tổng quát hóa trên dữ liệu thực tế.

## Key Points

1. Khái niệm Machine Learning lần đầu được đặt nền móng bởi Arthur Samuel vào năm 1959 với định nghĩa máy tính tự học qua trải nghiệm — [Arthur Samuel 1959 Checkers](https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFxBEqrCMuI0GwOYzED6XRShEfQ3kQwn-KdIj_ydBWarcwqRRLk9VtEG0ll42swPfvS1queE02iRCWmGmZMNdYGxD3SqHz2x-hpUCLi-hN4TDJZfafRN3ej0Cjmwa6iDlI-6UA=) (high)
2. Định nghĩa hình thức chuẩn hóa của Tom Mitchell (1997): Một chương trình học từ kinh nghiệm E đối với tác vụ T và thước đo P nếu hiệu năng P trên T tăng lên nhờ E — [Tom Mitchell Machine Learning 1997](https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQG7AslWmxHK7M5a_VVffi_YXX22Up9T40J3STdKlfZ-RJknkC5-nS2svDO2fSRTwe4wO8lixepGkbuN10TXvhPs9hOMT2TfJBVNzqqR0BDzwTMTZ6eb-kdMKYnmJ5yR8AMIDwCV0XpO) (high)
3. Sự chuyển dịch mô hình tư duy do Pedro Domingos đúc kết: Lập trình truyền thống (Data + Rules → Answers) chuyển thành Học máy (Data + Answers → Rules) — [Pedro Domingos The Master Algorithm](https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHODshA6KIGqEJPskjudwgPZ43MLHn8CryDXRz7u3n1Y1_AiN6xGrgt0WJTpZHuet3cwMLb5Z3wRrQC2KKY4JXYcqE0HTxA-h6l2abdMpqH2J78X3oFxDRryYXzZEMkLJAOgOPnvOU2Dtork1JY55yGhndEmqcmHXNBHZA=) (high)
4. Ba trường phái chính: Supervised (Phân loại, Hồi quy có nhãn), Unsupervised (Phân cụm, Gom nhóm dữ liệu không nhãn), Reinforcement (Học qua phần thưởng/phạt và môi trường) — [IBM Machine Learning Guide](https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQF0JNI9Z9bfeJoR79KFmDWpfdPisJXyFTkjIWdIMoWciqEbu1p_T_6DaJFRAbQUocbxiq5Lk287vIP9jjSg4KjSXQ5YFroo1UYN0hqw4x-LKOob2bhUkFCjZdMNyurB1QqKiee7Bg==) (high)
5. Cỗ máy tối ưu hóa: Loss Function đo sai số, Gradient Descent điều chỉnh trọng số ngược chiều gradient, Learning Rate quyết định độ dài bước nhảy — [IBM Gradient Descent & Loss](https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFooo_robhksXMxlPo8dXokSfNr1-V5KXz_IndGXDwdT3vTd7KFBRkz-XLaQkizSXuoUPjzcDCXaDeHckgx9HGOwqRXvvsxnmZV3egntpz4bDpXuCUKvwmwWUM9wABo7heYt1SbehE=) (high)
6. Đánh đổi Bias-Variance & Overfitting: Quá khớp dữ liệu huấn luyện dẫn tới mất khả năng dự đoán dữ liệu mới (tổng quát hóa kém) — [IBM Overfitting & Bias-Variance](https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFN7pFXhYTzw4bkrqVFCp4ADR1RPChW4m19Hpa3VgL9Y43ncAjoGLW7NaO74vfLIGsJ5B6KrvZenVnIONo3YqTSmRom9LmAAzBPCI9AQSf-vxrGnFAdn0u3UPGCxRxyu5137zxLgMs3tszj4Zw=) (high)

## Claim Ledger

| Claim | Giá trị | Nguồn (URL) | Ngày nguồn | Độ tin cậy |
| --- | --- | --- | --- | --- |
| Thuật ngữ và định nghĩa sơ khởi của Machine Learning | Arthur Samuel (1959) | https://github.com/aitskadapa/machine-learning | 1959-07 | high |
| Khung định nghĩa Task T, Performance P, Experience E | Tom M. Mitchell (1997) | https://eliassi.org/mitchell-ml-defn.pdf | 1997-03 | high |
| So sánh Traditional Programming vs Machine Learning | Data+Rules vs Data+Answers | https://machinelearningmastery.com/ | 2015-09 | high |
| 3 trụ cột phân loại học máy | Supervised, Unsupervised, Reinforcement | https://www.ibm.com/topics/machine-learning | 2024-01 | high |
| Cơ chế tối ưu tham số và tốc độ học | Loss Function + Gradient Descent + Learning Rate | https://www.ibm.com/topics/gradient-descent | 2024-03 | high |
| Vấn đề Overfitting và Bias-Variance Tradeoff | Cân bằng khái quát hóa và độ phức tạp | https://www.ibm.com/topics/overfitting | 2024-02 | high |

## Mâu thuẫn & giới hạn

- Một số tài liệu trích dẫn câu định nghĩa nổi tiếng của Arthur Samuel là xuất hiện trong bài báo 1959, nhưng các nhà nghiên cứu lưu ý câu trích phổ biến hiện nay là tóm lược tinh thần nghiên cứu chứ không nguyên văn từng chữ trong bài gốc.
- Nhiều người nhầm lẫn Machine Learning, Deep Learning và AI là một: Cần làm rõ quan hệ bao hàm (AI là tập cha, Machine Learning là tập con, Deep Learning là tập con dùng mạng nơ-ron nhiều lớp của Machine Learning).
