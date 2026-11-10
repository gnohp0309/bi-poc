# Khám phá dữ liệu và thống kê trên dataset thật

Tích hợp PR #5 của Tú, PR #6 của Thanh và phần nền tảng dữ liệu của Phong. Spring Boot quản lý nguồn, xác thực và phạm vi dataset; PostgreSQL chạy profiling; Python/SciPy tính thống kê; React hiển thị cùng một hợp đồng kết quả trên màn hình khám phá và trong chat.

## Luồng thực thi

1. Người dùng chọn dataset đã lưu và gọi API bằng phiên đăng nhập hiện tại.
2. Spring Boot kiểm tra vai trò, tên cột, kiểu dữ liệu, phương pháp và các giới hạn.
3. Profiling tổng hợp trực tiếp trong PostgreSQL. Thống kê nâng cao chỉ đọc các cột cần thiết, toàn bộ dòng thuộc định nghĩa dataset, trong một snapshot chỉ đọc.
4. Spring Boot chuyển dữ liệu đến `/internal/statistics` với khóa nội bộ. Python không nhận mật khẩu database hoặc tự tải một URL do LLM cung cấp.
5. Engine tính số liệu thật, trả envelope `analysis_result` phiên bản 1 để hiển thị. Khi gọi qua chat, kết quả được lưu trong lịch sử và không tính lại khi mở hội thoại.

Đã bỏ cơ chế fallback sang dữ liệu sample/ngẫu nhiên. Dataset không tồn tại hoặc nguồn lỗi phải báo lỗi; không được thay bằng một dataset khác.

## API tổng quan và chất lượng

`GET /api/datasets/{id}/exploration` — tài khoản đã đăng nhập, gồm Viewer.

- `overview`: rowCount, columnCount, sizeBytes, missingRate. Dung lượng là tổng kích thước logic dòng PostgreSQL, không phải kích thước file/đĩa.
- `columns`: kiểu, số NULL/chuỗi trống/thiếu/không hữu hạn, tỷ lệ thiếu, số giá trị duy nhất, mean/median/min/max, phương sai/độ lệch chuẩn mẫu, quartile và top 10 giá trị phổ biến.
- Với CSV, `importMissingCount`, `importInvalidCount`, `importInvalidExamples` ghi riêng lịch sử lỗi ban đầu từng cột.
- `quality`: missingCells, invalidCells, duplicateRows, quy tắc và ảnh chụp lúc nhập CSV. Duplicate là số dòng dư trên toàn bộ cột dữ liệu, loại row_id/record_group do CSV tự sinh.
- Giá trị lỗi CSV đã thành NULL nên không suy ngược nguyên nhân từ NULL hiện tại. File demo 242 dòng có 3 ô thiếu + 3 ô sai kiểu lúc nhập, sau nhập có 6 ô thiếu, 2 dòng trùng dư.
- Báo cáo không tự xóa trùng, điền thiếu hoặc coi ngoại lệ là dữ liệu sai. Chưa có quy tắc nghiệp vụ tùy chỉnh cho email/điện thoại.

## API thống kê

`POST /api/datasets/{id}/statistics` — Admin/Analyst. Viewer nhận 403 trước khi đọc dữ liệu/gọi engine.

```json
{"operation":"descriptive","columns":["c_revenue","c_cost"]}
```

```json
{"operation":"independent_ttest","value_column":"c_revenue","group_column":"c_branch","group_values":["A","B"],"equal_variance":false,"alpha":0.05}
```

| operation | Tham số |
|---|---|
| descriptive | columns 1–10 cột số |
| correlation | columns 2–10 cột số, method pearson/spearman |
| outlier | column, method iqr/zscore, threshold tùy chọn >0 |
| shapiro_wilk | column số, alpha tùy chọn |
| independent_ttest | value_column, group_column, group_values tùy chọn, equal_variance tùy chọn; mặc định Welch |
| paired_ttest | column_before, column_after; cùng đối tượng mỗi dòng |
| anova | value_column, group_column, group_values tùy chọn; ít nhất 3 nhóm |
| chi_square | column1, column2; bảng chéo tối đa 10.000 ô |
| mann_whitney | value_column, group_column, group_values tùy chọn; đúng 2 nhóm |
| kruskal_wallis | value_column, group_column, group_values tùy chọn; ít nhất 3 nhóm |

Alpha trong 0.01–0.1, mặc định 0.05. Không nhận SQL, biểu thức, script, URL hoặc dữ liệu kết quả thống kê do client/LLM cung cấp. Giới hạn 1.000.000 dòng, 10 cột, payload 100 MB, đọc nguồn 30 giây, gọi engine 60 giây. Vượt giới hạn trả lỗi rõ, không âm thầm lấy mẫu. Thống kê dùng số thực float64 của SciPy/pandas; không phải công cụ số học tài chính chính xác tùy ý.

Response là envelope dùng chung: `schemaVersion`, `kind`, `status`, `title`, `summary`, `sample`, `data`, `charts`, `warnings`, `provenance`; kiểm định có `method`, `hypotheses`, `statistic`, `pValue`, `confidenceInterval`, `effectSize`, `assumptions`, `conclusion`. Trường không xác định dùng NULL và lý do, không thay bằng 0. Bảng/ngoại lệ hiển thị giới hạn nhưng số tổng hợp vẫn tính toàn bộ dữ liệu hợp lệ.

Cỡ mẫu tách `total` (nguồn), `used`, `missing` và `excluded` (ngoài nhóm được chọn). Không lấy số dòng kết quả tổng hợp làm cỡ mẫu. Với paired test loại thiếu theo cặp, statistic/CI/effect theo hướng Sau − Trước. Welch CI dùng kết quả SciPy với phương sai không bằng nhau. Tính độc lập/thiết kế ghép cặp không được tự khẳng định. P ≥ alpha nghĩa là chưa đủ bằng chứng bác bỏ H0, không chứng minh hai nhóm bằng nhau. Shapiro–Wilk không tự chạy trên hơn 5000 quan sát; trả trạng thái không đủ điều kiện kèm lý do. Cột hằng có tương quan không xác định thay vì tương quan 0.

## Chat và Gemini

Giữ các nhánh query/create_dashboard/clarify, thêm explore và statistical. Bước lập kế hoạch trả cấu hình. PostgreSQL và engine thống kê tính số liệu, sau đó Gemini có thể chọn và diễn giải các bằng chứng đã tính. Schema provider dùng chuỗi JSON cho cấu hình custom chart/statistical để giới hạn độ phức tạp, sau giải mã vẫn kiểm tra bằng Pydantic và Spring Boot. Bước diễn giải gọi provider riêng và có đường trả kết quả engine khi lỗi. Hệ thống không tự retry trả phí.

Giao diện Khám phá dữ liệu có form chạy engine trực tiếp, không cần Gemini. Các route Python `/api/stats/*` cũ không còn tự sinh dữ liệu khi chưa được cấp dataset; luồng tích hợp dùng API Spring Boot phía trên. Cổng AI mặc định thống nhất 8000. Nếu đổi `POC_SECRET_KEY`, đặt cùng giá trị ở Spring Boot và môi trường AI; không đưa khóa vào frontend.

## Chạy và kiểm tra

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\start-demo.ps1
```

CMD khác, từ thư mục `ai-service` đã cài requirements:

```cmd
venv\Scripts\python.exe main.py
```

Unit tests:

```powershell
mvn -f backend/pom.xml verify
ai-service\venv\Scripts\python.exe -m unittest discover -s ai-service -p 'test*.py' -v
node --experimental-strip-types --test dev/chat-results.test.mjs dev/dashboard-layout.test.mjs dev/template-mapping.test.mjs dev/dashboard-export.test.mjs
```

Integration cần app + engine + tài khoản viewer; tự tạo/dọn fixture, không gọi Gemini:

```powershell
ai-service\venv\Scripts\python.exe dev\smoke-statistics.py
```

`--keep` giữ dataset để xem UI. `--large-file` kiểm tra thêm file CSV 500.000 dòng có c_amount. `dev/smoke-live-statistics.py` là kiểm tra chủ động với Gemini thật trên CSV giả lập 242 dòng, có dùng hạn mức API; không chạy trong CI.

Tham khảo cơ chế kiểm định: [SciPy ttest_ind](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.ttest_ind.html), [ttest_rel](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.ttest_rel.html), [Shapiro](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.shapiro.html).
