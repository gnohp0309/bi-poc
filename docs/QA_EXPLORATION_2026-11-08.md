# Kết quả kiểm tra tích hợp khám phá dữ liệu ngày 8 tháng 11 năm 2026

Phạm vi: ghép engine của Tú trong PR #5, giao diện/dashboard của Thanh trong PR #6 và API dữ liệu của Phong. Đã kiểm tra trên PostgreSQL thật, Spring Boot, FastAPI/SciPy và trình duyệt. Dữ liệu thử nghiệm là dữ liệu giả lập; đây là bằng chứng cho POC, không phải chứng nhận sẵn sàng production.

## Kết quả

| Nhóm kiểm tra | Kết quả quan sát |
|---|---|
| Java | 57 tests đạt, không lỗi hoặc bỏ qua |
| Python | 67 tests đạt, gồm cấu hình Gemini, dữ liệu thật, biên NULL/cột hằng, CI Welch, hướng paired test và alias hỏi lại của provider |
| Frontend | Build đạt; 30 tests hợp đồng dữ liệu, template, bố cục và xuất file đạt |
| Hồi quy API | 8 bộ smoke PowerShell đạt: chức năng gốc, CSV, template, analysis, exploration, editor, interaction, visualizations |
| Chat tích hợp | Smoke dùng provider xác định đạt; gồm lưu lịch sử, quyền, cấu hình sai và rollback giao dịch |
| Thống kê nguồn thật | 15 ca đạt; đối chiếu mô tả, Pearson/Spearman, IQR/Z-score và 7 kiểm định với phép tính tham chiếu độc lập |
| Gemini thật | 7 ca đạt: profiling, mô tả, Welch, Spearman, IQR, tạo dashboard và hỏi lại khi thiếu cột |
| Trình duyệt | Tổng quan, dữ liệu thiếu, thống kê, Welch, lịch sử chat, quyền Viewer, bộ lọc và drill-down đạt |
| Xuất file thật | PNG 1874 × 2292; PDF 3 trang; Excel 4 sheet; tổng sau lọc A khớp 26.880 trên cả 3 bảng biểu đồ |
| CI GitHub | [Build and API smoke trên 8f0b924](https://github.com/gnohp0309/bi-poc/actions/runs/42450052413) đạt, bao gồm tải PNG/PDF/Excel bằng trình duyệt và engine thật |

## Dữ liệu đối chiếu

`demo/exploration_dirty_242.csv`: 242 dòng, 10 cột dữ liệu, 3 ô thiếu và 3 ô sai kiểu khi nhập; sau nhập 6 ô thiếu, 2 dòng trùng dư. Revenue có 238 giá trị hợp lệ, tổng 1.079.769, median 340; IQR tìm 1 ngoại lệ 999999. Welch A/B dùng 79 quan sát mỗi nhóm, loại 81 dòng ngoài nhóm và 3 dòng thiếu; p-value 0,8682721788129366. Không tự xóa hoặc điền dữ liệu.

Đã nhập file 500.000 dòng rồi chạy profiling và engine toàn bộ dữ liệu: count 500.000, mean amount 50,5, tổng 25.250.000. Lần kiểm tra cuối trên máy này: nhập khoảng 12,64 giây, thống kê engine 1,094 giây, profiling 4,81 giây. Đây là số đo một lần tại máy thử, không phải SLA. File giả lập lặp 300 tổ hợp nên 499.700 dòng trùng dư là kết quả mong đợi.

## Lỗi tích hợp đã sửa

- Bỏ fallback sang dữ liệu ngẫu nhiên khi không tải được dataset; nguồn lỗi phải báo lỗi.
- Chuyển đúng cột và toàn bộ dòng từ Spring Boot sang Python bằng route có khóa nội bộ; không đưa thông tin database vào frontend hoặc LLM.
- Sửa schema Gemini bị quá nhiều trạng thái; vẫn kiểm tra cấu hình đầy đủ sau giải mã và ở backend.
- Khi thử lại trên cổng demo, Gemini có lần dùng intent `clarification` thay cho `clarify`. Đã tái hiện phản hồi, thêm chuyển đổi duy nhất cho alias không thực thi dữ liệu này và kiểm tra SQL/trường lạ vẫn bị từ chối. Không retry ngầm trả phí.
- Sửa khoảng tin cậy Welch và thống nhất hướng Sau trừ Trước cho paired test.
- Tách số thiếu hiện tại, lỗi lúc nhập và số dòng ngoài nhóm phân tích; giữ NULL khi kết quả không xác định.
- Thống nhất cổng AI 8000, giữ đầy đủ schema các loại biểu đồ sau merge.

## Giới hạn cần trình bày đúng

- Báo cáo phát hiện vấn đề; chưa tự làm sạch theo quy tắc nghiệp vụ hoặc tự xóa ngoại lệ/trùng.
- Engine giới hạn 1.000.000 dòng, 10 cột, payload 100 MB; không tự lấy mẫu. Shapiro–Wilk chỉ nhận 3–5000 quan sát hợp lệ.
- SciPy dùng số thực float64. Giả định độc lập/thiết kế ghép cặp cần người dùng xác nhận; p lớn không chứng minh hai nhóm tương đương.
- Gemini cần key/hạn mức và dịch vụ ngoài. Form thống kê trực tiếp không phụ thuộc Gemini. CI dùng provider giả lập cho ý định, nhưng engine thống kê và database là thật.

## Tái hiện

Hướng dẫn API và lệnh kiểm tra: [EXPLORATION_INTEGRATION.md](EXPLORATION_INTEGRATION.md). Kịch bản thao tác cùng lời nói: [DEMO_EXPLORATION.md](DEMO_EXPLORATION.md).

Các kết quả chi tiết và file xuất khi kiểm tra cục bộ nằm trong `.local/integration-20261108/` và thư mục Downloads, không đưa log riêng tư hoặc khóa API vào Git.
