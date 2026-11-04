# BA-25: Dashboard từ template

Hiện có ba template:

- `sales-overview` (Tổng quan doanh thu): đường theo tháng, cột theo vùng, tròn theo danh mục.
- `product-analysis` (Phân tích sản phẩm bán ra): cột doanh thu theo sản phẩm, cột số lượng bán theo sản phẩm, tròn tỷ trọng doanh thu theo danh mục.

- `order-status` (Theo dõi trạng thái đơn hàng): tròn số đơn theo trạng thái, cột doanh thu theo trạng thái, đường số đơn theo tháng.

Các biểu đồ được lưu theo thứ tự này, dùng bố cục dashboard hiện có; người dùng vẫn có thể đổi thứ tự. Chưa tích hợp chat (BA-26).

## Chạy thử

Sau khi thay đổi source, build lại và khởi động theo `DEVELOPMENT.md`; restart JAR cũ không cập nhật code. Vào **Dashboards → Tạo dashboard từ mẫu**, chọn dataset, nhập tên và ánh xạ các trường tương ứng với mẫu. Danh sách chỉ hiện cột đúng kiểu. Khi tạo thành công, dashboard tự mở và có thể tải lại trang để xem tiếp.

| Trường | Kiểu | public.orders | CSV demo |
| --- | --- | --- | --- |
| date | date/timestamp | order_date | c_ngay |
| revenue | số | amount | c_doanh_thu |
| region | văn bản | region | c_khu_vuc |
| category | văn bản | category | c_danh_muc |

Template `product-analysis` yêu cầu `product` (văn bản), `revenue` (số), `quantity` (số), `category` (văn bản). Với dataset Đơn hàng 2025, ánh xạ lần lượt `product/amount/quantity/category`. Dataset Sản phẩm mẫu thiếu doanh thu và số lượng nên không đủ trường để tạo mẫu này. CSV chỉ dùng được khi có đủ các trường tương ứng; CSV doanh thu demo hiện tại thiếu sản phẩm nên không phù hợp với mẫu sản phẩm.

Request mẫu sản phẩm dùng `templateId: "product-analysis"` và `mapping: {"product":"product","revenue":"amount","quantity":"quantity","category":"category"}`. Ba biểu đồ đều tính SUM; biểu đồ số lượng dùng cột quantity, hai biểu đồ doanh thu dùng revenue. NULL bị bỏ qua khi tính SUM.

Với CSV demo, doanh thu theo vùng/danh mục tổng 9.700.000; theo tháng hợp lệ tổng 9.300.000. Ngày NULL bị loại khỏi chart tháng, nhưng doanh thu ở dòng đó vẫn tham gia các chart còn lại. SUM bỏ qua doanh thu NULL. Dataset rỗng vẫn tạo được dashboard với trạng thái không có dữ liệu. Giới hạn hiện có là 100 nhóm/chart, không có KPI tổng hoặc grid tùy chỉnh.

## API tích hợp

Các API đều cần Bearer token hiện tại. ADMIN/ANALYST được tạo; VIEWER chỉ đọc.

- `GET /api/dashboard-templates`: mảng `{id,name,description,fields:[{key,label,kind}]}`.
- `GET /api/datasets/{id}/columns`: mảng `{name,type,kind}`; `type` là kiểu PostgreSQL, `kind` là `date/number/text/other`. Metadata hoạt động với dataset vật lý, ảo và rỗng.
- `POST /api/dashboards/from-template`:

```json
{
  "datasetId": "UUID",
  "templateId": "sales-overview",
  "name": "Tổng quan doanh thu",
  "mapping": {
    "date": "order_date",
    "revenue": "amount",
    "region": "region",
    "category": "category"
  }
}
```

Thành công: `{"dashboardId":"UUID"}`. Lỗi: `{"error":"Thông báo"}`, HTTP 400 cho đầu vào sai, 403 cho Viewer, 404 cho dataset không tồn tại. Tạo chart và dashboard trong cùng transaction; lỗi sẽ rollback, không tạo dataset phụ. BA-26 có thể gọi cùng service/API này sau khi xác định intent và mapping.

API chart nhận thêm `timeGrain: "month"` tùy chọn, chỉ dùng với dimension ngày/thời gian. Bỏ trường này giữ hành vi cũ. Cấu hình được lưu trong cột `charts.time_grain`; `schema.sql` tự thêm cột bằng `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` khi khởi động backend, không cần reset database.

Biểu đồ tháng và API `/datasets/{id}/analyze` cùng quy timestamptz về UTC trước khi chia nhóm. Cột date/timestamp không có múi giờ giữ lịch gốc. Lọc biểu đồ tháng bằng `YYYY-MM`, ví dụ `2025-01`; bộ lọc này không áp dụng sang chart vùng/danh mục có dimension khác. Response chart có `timeGrain: "month"` để client nhận biết cách hiển thị/lọc.

## Kiểm tra

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\smoke-templates.ps1
```

Yêu cầu database mẫu `bi_poc_source`, tài khoản admin/viewer (chạy seed trước). Script tạo dataset ảo riêng để kiểm tra metadata, tổng tháng/vùng/danh mục, doanh thu và số lượng theo sản phẩm, tải lại, đầu vào sai, rollback giữa chừng, dataset rỗng và Viewer; dọn các đối tượng kiểm tra trong `finally`. Script vẫn để lại audit thao tác. Có thể dùng `-BaseUrl http://127.0.0.1:8082/api` khi chạy backend thử nghiệm cổng khác.

Có thể truyền `-SourceHost`, `-SourcePort`, `-SourceDatabase` cho nguồn thử riêng. Kiểm tra tích hợp còn đối chiếu bộ lọc tháng, UTC ở ranh giới tháng với API phân tích và từ chối chia tháng trên cột số.

## Theo dõi trạng thái đơn hàng

`templateId: "order-status"`; mapping gồm `date/revenue/status`. Dataset Đơn hàng 2025 ánh xạ `order_date/amount/status`. Ví dụ:

```json
{"datasetId":"UUID","templateId":"order-status","name":"Theo dõi đơn hàng","mapping":{"date":"order_date","revenue":"amount","status":"status"}}
```

Mỗi dòng là một đơn hàng, dùng COUNT(*) cho số đơn theo trạng thái và theo tháng; không đếm theo mã đơn riêng. SUM(revenue) cho doanh thu theo trạng thái. Doanh thu là số tiền đã lưu, không tự lọc đơn hoàn tất. NULL revenue vẫn được đếm là một đơn. NULL date chỉ bị loại khỏi biểu đồ theo tháng. NULL status được giữ thành nhóm và hiển thị nhãn “—”. Dữ liệu nhiều dòng cho một đơn cần được chuẩn bị thành một dòng/đơn trước khi dùng mẫu này.

Dữ liệu orders sau seed hiện có cùng trạng thái Hoàn tất, nên biểu đồ trạng thái chỉ có một nhóm. Smoke test dùng dữ liệu riêng với nhiều trạng thái và tên cột khác để kiểm chứng ánh xạ, SUM/COUNT và NULL.
