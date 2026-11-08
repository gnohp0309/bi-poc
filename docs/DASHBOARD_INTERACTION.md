# Bộ lọc, drill-down và làm mới dashboard

## Thao tác trên giao diện

1. Mở **Dashboards**, chọn dashboard.
2. Trong **Bộ lọc dashboard**, bấm **Thêm điều kiện**, chọn dataset và cột thật. Dùng **Bằng giá trị** cho khu vực/danh mục, **Khoảng ngày** cho cột ngày hoặc **Dữ liệu trống (NULL)**. Có thể kết hợp tối đa 12 điều kiện bằng AND.
3. Bấm **Áp dụng bộ lọc**. Các biểu đồ cùng dataset đều nhận điều kiện trước khi tổng hợp, kể cả KPI, histogram, scatter, heatmap và map. Dataset khác giữ nguyên. **Xóa bộ lọc** trả về toàn bộ dữ liệu. Chọn dashboard khác hoặc tải lại trang đặt lại bộ lọc; điều kiện đang áp dụng không được lưu vào cấu hình dashboard.
4. Bấm vào điểm/cột/miếng biểu đồ để xem các dòng dữ liệu tạo nên nhóm đó. Với KPI hoặc khi cần thao tác bằng bàn phím, dùng **Xem dữ liệu chi tiết**; hộp thoại có danh sách nhóm/điểm. Heatmap mở các dòng có đủ hai giá trị số hữu hạn của cặp được chọn, không diễn giải hệ số tương quan như một tổng.
5. Bảng chi tiết phân trang 25 dòng, tối đa 500 dòng từ nguồn; hiển thị rõ khi bị giới hạn. Dữ liệu gốc không bị sửa. Hai điểm scatter trùng X/Y có thể trả nhiều dòng.
6. **Làm mới dữ liệu** truy vấn lại nguồn với điều kiện đã áp dụng, giữ tên, cấu hình biểu đồ và bố cục. Thời điểm cập nhật hiển thị sau khi thành công. CSV là dữ liệu đã nhập; thay file CSV bên ngoài không cập nhật bảng đã nhập.

Ngày kết thúc bao gồm cả ngày; timestamp có múi giờ được quy về UTC. Bộ lọc bằng giá trị so sánh dạng văn bản, phân biệt hoa/thường. Nguồn nhiều dataset cần thêm điều kiện riêng cho từng dataset; không suy diễn tên cột tương đương.

Drill-down truy vấn nguồn hiện tại. Server kiểm tra khóa nhóm/điểm với kết quả đã hiển thị; khi nhóm hoặc giá trị đã đổi thì yêu cầu làm mới, tránh mở nhầm nhóm. Các truy vấn biểu đồ và dữ liệu chi tiết chạy riêng, không bảo đảm một snapshot database chung nếu nguồn đang thay đổi liên tục.

Các thao tác đọc dành cho ADMIN/ANALYST/VIEWER đã đăng nhập; các API mới không mở cho liên kết chia sẻ công khai. Quy tắc phân quyền theo vai trò hiện có được giữ nguyên.

## API

- `GET /api/dashboards/{id}/filters`: `{datasets:[{id,name,columns:[{name,kind}]}]}` chỉ gồm dataset đang được dashboard sử dụng.
- `POST /api/dashboards/{id}/query`: gửi `{filters:[...]}`; trả thông tin dashboard, `charts`, `refreshedAt`. Mỗi chart có `datasetId`, `rowKeys` và tọa độ/kích thước đã lưu. `rowKeys[i]` gắn với `rows[i]`.
- `POST /api/dashboards/{id}/charts/{chartId}/drill`: gửi `{filters:[...],rowIndex:0,rowKey:"..."}`; trả `{columns,rows,truncated,note}`. KPI không cần rowIndex/rowKey. Chart phải là thành viên dashboard. Khóa cũ/điểm ngoài phạm vi trả 400; chart ngoài dashboard trả 404.

```json
{
  "filters": [
    {"datasetId":"UUID", "column":"region", "op":"eq", "value":"Miền Bắc"},
    {"datasetId":"UUID", "column":"order_date", "op":"date", "value":"2025-01-01", "end":"2025-01-31"}
  ]
}
```

`op: "null"` không cần value/end. Kiểm tra dataset thuộc dashboard, tên/kiểu cột từ metadata và khoảng ngày trước khi chạy. Giá trị dùng PreparedStatement; truy vấn chỉ đọc với giới hạn 6 giây và 500 dòng của module Queries. API GET dashboard/filterDimension cũ vẫn hoạt động cho các client cũ.

## Kiểm tra

```powershell
./dev/smoke-dashboard-interaction.ps1 -BaseUrl http://127.0.0.1:8081/api
```

Script tạo fixture riêng và dọn sau khi chạy: đối chiếu AND/khoảng ngày/NULL, KPI và đa nguồn, chống chèn SQL, các đường drill-down, ranh giới histogram, timestamp, khóa lựa chọn cũ, quyền Viewer, giữ layout và truy vấn nguồn có giá trị thay đổi theo thời gian khi refresh.
