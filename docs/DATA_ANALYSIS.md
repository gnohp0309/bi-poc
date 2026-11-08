# API dữ liệu phục vụ chat AI và dashboard

Backend cung cấp metadata và phân tích theo cấu hình JSON trên một dataset đã lưu. Hai endpoint dưới đây bổ sung cho API hiện có; không phụ thuộc Gemini/DeepSeek hoặc dịch vụ FastAPI để chạy thử.

Base URL mặc định: `http://127.0.0.1:8081/api`. Dùng Bearer token phiên hiện tại. Phân quyền theo vai trò chung như POC hiện có, chưa có quyền riêng trên từng dataset.

## Đọc cấu trúc dataset

`GET /datasets/{id}/metadata` — mọi tài khoản đã đăng nhập được đọc.

Response gồm:

```json
{
  "datasetId": "UUID-cua-dataset",
  "name": "Đơn hàng 2025",
  "kind": "PHYSICAL",
  "columns": [
    {
      "name": "amount",
      "label": "Doanh thu",
      "type": "numeric",
      "kind": "number",
      "nullable": false,
      "aggregates": ["sum", "avg", "min", "max", "count", "count_distinct"],
      "timeGrains": []
    }
  ],
  "limits": {
    "maxGroups": 3,
    "maxMetrics": 5,
    "maxFilters": 10,
    "maxResultRows": 500,
    "queryTimeoutSeconds": 6,
    "filterOperators": ["eq", "ne", "gt", "gte", "lt", "lte", "in", "is_null", "is_not_null"]
  }
}
```

`columns` chứa toàn bộ cột được nguồn trả về, kể cả dataset ảo/rỗng. API chỉ đọc metadata qua truy vấn `LIMIT 0`, không lấy dòng dữ liệu mẫu. `label` lấy từ alias đã lưu, mặc định bằng tên cột. Không trả mật khẩu, host, connectionId hoặc SQL định nghĩa trong response này.

`kind` của cột là `number/date/text/boolean/other`. Chỉ cột số hỗ trợ SUM/AVG/MIN/MAX; các cột vô hướng khác hỗ trợ COUNT/COUNT DISTINCT. Kiểu khác chỉ hỗ trợ COUNT và kiểm tra NULL, không dùng để chia nhóm. Cột ngày hỗ trợ `day/month/year`. Backend luôn kiểm tra lại cấu hình, không chỉ dựa vào lựa chọn trên giao diện.

## Phân tích theo cấu hình

`POST /datasets/{id}/analyze` — ADMIN/ANALYST, VIEWER nhận HTTP 403.

Ví dụ doanh thu theo tháng, lọc vùng:

```json
{
  "groupBy": [{"column": "order_date", "timeGrain": "month", "alias": "month"}],
  "metrics": [
    {"column": "amount", "aggregate": "sum", "alias": "revenue"},
    {"column": "*", "aggregate": "count", "alias": "orders"}
  ],
  "filters": [{"column": "region", "operator": "eq", "value": "Miền Bắc"}],
  "orderBy": [{"column": "month", "direction": "asc"}],
  "limit": 100
}
```

Ví dụ hỏi tổng doanh thu, không chia nhóm:

```json
{"metrics":[{"column":"amount","aggregate":"sum","alias":"revenue"}]}
```

Response có `datasetId`, `columns`, `rows`, `rowCount`, `rowLimit`, `truncated`. Trong ví dụ đầu, `columns` là `month/revenue/orders`; ngày trả dạng ISO, giá trị số là JSON number. Không trả SQL đã biên dịch hoặc thông tin kết nối. Đọc `truncated` để biết có nhóm kết quả bị giới hạn.

### Quy tắc đầu vào

- `metrics` bắt buộc, từ 1 đến 5 chỉ số. `groupBy`, `filters`, `orderBy` mặc định mảng rỗng. `limit` mặc định 100, số nguyên từ 1 đến 500.
- Chỉ nhận những trường được mô tả, kể cả ở đối tượng con; không nhận `sql`, biểu thức SQL, tên bảng hoặc connectionId tùy ý.
- Tên cột phải có trong dataset; phép tính phải phù hợp kiểu cột. `column: "*"` chỉ dùng với `aggregate: "count"` để đếm dòng.
- Mỗi metric cần `alias`; alias do người gọi đặt gồm 1–63 ký tự chữ ASCII/số/gạch dưới, không bắt đầu bằng số. Alias nhóm không bắt buộc, mặc định bằng tên cột. Các tên đầu ra phải khác nhau.
- Tối đa 3 chiều nhóm, 10 bộ lọc, 8 trường sắp xếp. `orderBy.column` là tên đầu ra/alias, hướng `asc/desc`; nếu không chỉ định thì các nhóm được sắp tăng dần, NULL cuối.
- Các bộ lọc kết hợp bằng AND. `in` nhận mảng 1–50 giá trị cùng kiểu cột. `is_null/is_not_null` không nhận value khác NULL. `eq/ne` không dùng value NULL.
- Số lọc phải là JSON number, tối đa 38 chữ số có nghĩa và trị tuyệt đối scale không quá 12. Văn bản tối đa 500 ký tự; Boolean dùng `true/false`.
- Ngày dùng `YYYY-MM-DD`, timestamp dùng ISO có `T`, timestamptz có offset/Z. So sánh lớn/nhỏ chỉ dùng cho cột số hoặc ngày.
- Chia nhóm ngày theo `timeGrain` bỏ dòng có ngày NULL, phù hợp chart tháng trong template. Timestamp có múi giờ được quy về UTC trước khi chia nhóm; timestamp không có múi giờ giữ giá trị gốc. Lọc trên cột nguồn, không trên alias tháng.

### Ý nghĩa kết quả và giới hạn

SUM/AVG/MIN/MAX bỏ qua NULL; COUNT(cột) đếm giá trị khác NULL, COUNT(*) đếm dòng, COUNT DISTINCT không đếm NULL. Trên nguồn rỗng và không chia nhóm, COUNT trả 0, SUM/AVG/MIN/MAX trả NULL. Không tự đổi NULL thành doanh thu 0.

Tổng hợp thực hiện trong PostgreSQL trên toàn bộ nguồn theo định nghĩa dataset. LIMIT chỉ áp dụng lên nhóm kết quả cuối. Nếu chính SQL định nghĩa dataset có LIMIT thì đó là phạm vi nguồn đã lưu. API chạy transaction chỉ đọc, timeout 6 giây và giới hạn kết quả; không nhận SQL tự do từ AI. SQL Lab hiện có vẫn là luồng riêng với giới hạn của nó.

Lỗi đầu vào HTTP 400, chưa đăng nhập 401, Viewer gọi analyze 403, dataset không tồn tại 404; lỗi nghiệp vụ có `{"error":"Thông báo"}`. Lỗi cú pháp JSON/framework có thể dùng response khác, client cần thông báo dự phòng. Phân tích thành công ghi audit `ANALYZE` cho dataset.

## Ghép với phần AI và template

1. Spring Boot lấy metadata dataset được chọn, chuyển context này cho dịch vụ AI.
2. AI trả cấu hình `groupBy/metrics/filters/orderBy/limit` theo đúng hợp đồng.
3. Spring Boot gọi service phân tích, kiểm tra và chạy truy vấn; chỉ gửi kết quả cần thiết cho bước diễn giải.
4. Với yêu cầu dashboard, dùng templateId và mapping của phần dashboard, không biến SQL hoặc HTML do AI sinh thành mã thực thi.

Metadata ở đây là đối tượng giàu thông tin để dùng chung cho phân tích. Nhánh dashboard-template có hợp đồng `/datasets/{id}/columns` riêng trả mảng tối giản; endpoint mới `/metadata` không ghi đè đường dẫn đó. Chat orchestration, danh mục template và tạo dashboard vẫn do các phần tương ứng tích hợp.

Frontend có sẵn kiểu dữ liệu và hàm gọi trong `frontend/src/analysis-api.ts`. Ví dụ tại component chat:

```typescript
import { getDatasetMetadata, analyzeDataset } from './analysis-api'

const metadata = await getDatasetMetadata(selectedDatasetId)
const result = await analyzeDataset(selectedDatasetId, {
  metrics: [{ column: 'amount', aggregate: 'sum', alias: 'revenue' }],
})
```

Điều chỉnh đường dẫn import theo vị trí component; chọn tên cột thực tế từ metadata. Hàm dùng phiên đăng nhập hiện tại qua lớp API chung.

## Kiểm tra

Sau khi chạy backend và seed tài khoản/source mẫu:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\smoke-analysis.ps1
```

Có thể truyền `-BaseUrl`, `-SourceHost`, `-SourcePort`, `-SourceDatabase` cho môi trường riêng. Script tạo dataset vật lý/ảo, nhập CSV mẫu, so sánh với số liệu mẫu/SQL độc lập, kiểm tra NULL, kiểu dữ liệu, bộ lọc, UTC, quyền và chống chèn lệnh qua giá trị lọc. Nó cũng tổng hợp dataset ảo được PostgreSQL tạo từ 500.000 dòng, đối chiếu COUNT=500.000 và SUM=25.250.000, kiểm tra giới hạn kết quả, ghi thời gian request và dọn kết nối/dataset/import thử trong `finally`. Kết nối CSV dùng chung và audit/session vẫn được giữ lại.

Đây là kiểm tra tính đúng của phân tích trên dữ liệu sinh; không thay thế phép đo import CSV 500.000 dòng hoặc benchmark dữ liệu thật. JUnit kiểm tra thêm các ranh giới đầu vào và tham số hóa; CI chạy cả JUnit và smoke API với PostgreSQL riêng.


Báo cáo tổng quan/profiling/chất lượng và thống kê mô tả chỉ đọc dùng endpoint riêng; xem [Khám phá dữ liệu](DATA_EXPLORATION.md).
