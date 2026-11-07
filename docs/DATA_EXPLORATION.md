# Khám phá dữ liệu

Mở **Khám phá dữ liệu**, chọn dataset vật lý hoặc ảo (gồm CSV), rồi xem các tab Tổng quan, Profiling, Dữ liệu thiếu, Chất lượng, Thống kê cột. Bấm **Tải lại báo cáo** để cập nhật số liệu. Mọi tài khoản đã đăng nhập, kể cả Viewer, được đọc báo cáo theo mô hình quyền chung của repo. Không thay đổi quyền của API `/analyze` và không sửa dữ liệu nguồn.

## API

`GET /api/datasets/{id}/exploration` cần Bearer token. API mới nằm riêng trong `DatasetExploration.java`; các API metadata/analyze của phần dữ liệu và dịch vụ FastAPI không thay đổi. Có thể thay lớp gọi frontend `exploration-api.ts` bằng API của nhóm sau khi thống nhất hợp đồng.

Response gồm:

- `datasetId`, `name`, `kind`, `generatedAt`, `scope: "full-dataset"`, `sampled: false`.
- `overview`: `rowCount` của nguồn, `columnCount`, `sizeBytes`, `sizeDescription`, `missingRate` tính theo số ô.
- `columns`: tên/nhãn/kiểu; `nullCount`, `blankCount`, `missingCount`, `missingRate` (%), `validCount`, `invalidCount`, `distinctCount`; `topValues`, `topValuesTruncated`, `mode` và ghi chú.
- Cột số có `min`, `max`, `mean`, `median`, `standardDeviation`, `variance`, `q1`, `q3`. Cột ngày có min/max. Thống kê không áp dụng hoặc không có dữ liệu trả NULL/không có trường, giao diện hiển thị “—”, không đổi thành 0.
- `quality`: tổng ô thiếu, ô số không hữu hạn, số dòng trùng dư, quy tắc và ảnh chụp import CSV nếu có.
- `warnings`: giới hạn và cách diễn giải dữ liệu.

Không nhận SQL/cột tự do trong request. ID không hợp lệ trả 400, không tìm thấy dataset trả 404, chưa đăng nhập trả 401. Timeout trả 504; quá 128 cột dữ liệu trả 422. Lỗi truy vấn trả thông báo chung, không trả SQL/mật khẩu nguồn.

## Quy tắc tính

- Toàn bộ dữ liệu theo định nghĩa dataset, không lấy mẫu và không dùng preview 20 dòng. Giới hạn kết quả 500 dòng của SQL Lab không được dùng làm phạm vi thống kê.
- Mọi truy vấn báo cáo chạy trong một transaction chỉ đọc, repeatable read. Mỗi truy vấn tối đa 6 giây, tổng phần truy vấn báo cáo khoảng 30 giây (metadata đọc trước đó có timeout riêng). Báo cáo timeout không giả thành kết quả thành công/0. Dataset lớn có thể cần thu hẹp hoặc cơ chế job ở bước sau.
- `sizeBytes` là tổng `pg_column_size` của các dòng, **dung lượng logic**, không phải kích thước file, index hay dung lượng chiếm đĩa. Không làm tròn thành kích thước đĩa của dataset ảo.
- Thiếu là NULL hoặc chuỗi chỉ gồm dấu cách U+0020 sau `btrim`. Chuỗi chữ "NaN" trong cột văn bản không tự coi là NULL. NaN/Infinity/-Infinity trong cột số là không hợp lệ, không tham gia thống kê hoặc top values.
- `validCount` là số ô còn lại sau thiếu và số không hữu hạn, không có nghĩa đã đạt mọi quy tắc nghiệp vụ. Với kiểu `other`, distinct/top dùng biểu diễn văn bản PostgreSQL; chưa đánh giá tính hợp lệ theo nghiệp vụ của kiểu này.
- Mean/min/max tính trên số hợp lệ; variance/std là **mẫu**, cần ít nhất 2 giá trị. Median/Q1/Q3 dùng `percentile_cont`, nội suy bằng số thực; dữ liệu số độ chính xác rất cao có thể mất độ chính xác ở percentile. Đây là thống kê mô tả từ PostgreSQL, không phải Hypothesis Testing hay engine của Tú.
- Mode chọn giá trị tần suất cao nhất, đồng hạng chọn thứ tự văn bản tăng dần. Top values có tối đa 10 nhóm, hiển thị nhãn rút gọn còn 200 ký tự. Đây là bảng phân phối tần suất giá trị, chưa phải histogram theo khoảng.
- Dòng trùng dư = tổng (số lần xuất hiện - 1) của các dòng có cùng giá trị toàn bộ cột, so sánh bằng JSONB. CSV bỏ hai cột hệ thống `row_id/record_group` khỏi profiling và nhận diện trùng; dung lượng logic vẫn gồm chúng. Dataset khác giữ toàn bộ cột, bao gồm ID nếu có. SQL của dataset ảo có thể đã lọc/tổng hợp dữ liệu trước báo cáo.
- Thống kê chất lượng CSV lúc import là lịch sử; ô sai kiểu đã chuyển NULL. Báo cáo hiện tại không khôi phục giá trị CSV gốc. Không có quy tắc tùy chỉnh về email, số điện thoại, giá trị âm, ngưỡng chất lượng; không tự kết luận pass/fail hoặc sửa dữ liệu.
- Dữ liệu rỗng có count=0, tỷ lệ/mean/median… là NULL. Không áp dụng hiển thị khác với giá trị số 0 hợp lệ.

## Kiểm chứng

Sau khi chạy PostgreSQL/backend và seed tài khoản demo:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\smoke-exploration.ps1
```

Có thể thêm `-BaseUrl http://127.0.0.1:8082/api`. Script tạo và dọn fixture riêng: dataset vật lý, ảo, tên cột chứa dấu cách, dataset rỗng, NULL/blank/NaN/Infinity, hơn 500 dòng, thống kê đối chiếu, CSV trùng có ID tự sinh, lịch sử sai kiểu, Viewer và xác thực. Script vẫn tạo audit thao tác. Bộ kiểm thử không chứng minh hiệu năng ở mọi quy mô dữ liệu.


Cột số có nút xem histogram theo khoảng, tổng hợp trực tiếp trên toàn dataset; xem [VISUALIZATIONS](VISUALIZATIONS.md). Bảng top values vẫn tách riêng với histogram.
