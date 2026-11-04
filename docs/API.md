# API hiện có của Pythera POC

Đây là hợp đồng của backend Spring Boot hiện tại, dùng để nối các phần trong nhóm. Base URL mặc định: `http://127.0.0.1:8081/api`. ID là chuỗi UUID. Các đường dẫn trong bảng được viết tương đối với base URL.

## Quy ước

- JSON cho các request thông thường; upload dùng `multipart/form-data`.
- Đăng nhập trả `token` phiên opaque, không phải JWT. Gửi `Authorization: Bearer <token>` cho API cần xác thực. Không dùng bộ giải mã JWT của repo khác để kiểm tra token này.
- Lỗi nghiệp vụ có dạng `{"error":"Thông báo"}`. Một số lỗi framework có thể dùng dạng khác; client cần có thông báo dự phòng.
- Request dùng camelCase (`connectionId`, `datasetId`, `chartType`); nhiều response metadata dùng snake_case (`connection_id`, `database_name`, `chart_type`). Dùng kiểu đang có trong `frontend/src/api.ts`.
- ADMIN/ANALYST được tạo/sửa dữ liệu; VIEWER đọc. Người dùng, nhóm và audit chỉ dành ADMIN. Quyền hiện theo vai trò chung, chưa theo từng đối tượng.

## Đăng nhập

`POST /auth/login`, không cần Bearer:

```json
{"username":"admin","password":"Demo2026!"}
```

Response gồm `token` và `user` với `id`, `username`, `role`. Các ví dụ dùng mật khẩu demo công khai, chỉ chạy cục bộ.

| Method | Đường dẫn | Mục đích |
| --- | --- | --- |
| GET | `/health` | Không cần đăng nhập; trả `{"status":"ok"}` |
| GET | `/auth/me` | Người dùng hiện tại |
| POST | `/auth/logout` | Thu hồi token đang gửi |

## Nguồn dữ liệu và dataset

| Method | Đường dẫn | Mục đích |
| --- | --- | --- |
| GET / POST | `/connections` | Liệt kê / lưu nguồn PostgreSQL |
| POST | `/connections/test` | Kiểm tra cấu hình trước khi lưu |
| GET | `/connections/{id}/tables` | Danh sách `{schema, table}` |
| GET | `/connections/{id}/columns?schema=public&table=orders` | Danh sách `{name, type}` |
| DELETE | `/connections/{id}` | Xóa; có thể xóa các đối tượng phụ thuộc |
| GET / POST | `/datasets` | Liệt kê / tạo dataset |
| GET | `/datasets/{id}/preview` | Xem trước tối đa 20 dòng |
| GET | `/datasets/{id}/metadata` | Metadata có kiểu cột, nhãn và phép tổng hợp được hỗ trợ |
| GET | `/datasets/{id}/columns` | Danh sách cột tối giản `{name,type,kind}` để ánh xạ template |
| POST | `/datasets/{id}/analyze` | Phân tích theo cấu hình JSON; ADMIN/ANALYST |
| PUT | `/datasets/{id}/aliases` | Lưu `{"aliases":{"amount":"Doanh thu"}}` |
| DELETE | `/datasets/{id}` | Xóa dataset và phụ thuộc |

Payload kiểm tra/lưu kết nối:

```json
{"name":"Bán hàng","host":"127.0.0.1","port":5433,"database":"bi_poc_source","username":"bi_reader","password":"Reader2026!"}
```

Tạo dataset vật lý: `connectionId`, `name`, `kind: "PHYSICAL"`, `sourceName: "public.orders"`. Dataset ảo thay hai trường cuối bằng `kind: "VIRTUAL"`, `sql: "SELECT region, amount FROM public.orders"`. Các thao tác tạo đối tượng trả `{"id":"UUID"}`.

Xem [hợp đồng phân tích dữ liệu](DATA_ANALYSIS.md) để ghép phần AI: `/metadata` không lấy dữ liệu mẫu/credentials; `/analyze` nhận nhóm, chỉ số, bộ lọc có kiểm soát và tổng hợp ở PostgreSQL, không nhận SQL từ AI.

## SQL

| Method | Đường dẫn | Mục đích |
| --- | --- | --- |
| POST | `/sql/execute` | Chạy `{connectionId, sql}`; yêu cầu ADMIN/ANALYST |
| GET | `/sql/saved` | Liệt kê truy vấn đã lưu |
| POST | `/sql/saved` | Lưu `{connectionId, name, sql}` |

Response chạy SQL: `{columns, rows, truncated}`. Chỉ một SELECT/WITH, tối đa 10.000 ký tự; transaction chỉ đọc, timeout 6 giây, tối đa 500 dòng kết quả. Đây là giới hạn kết quả, không phải chỉ tổng hợp 500 dòng nguồn. Lưu query chỉ kiểm tra hình thức SQL, không chứng minh query chạy thành công.

## Chart

| Method | Đường dẫn | Mục đích |
| --- | --- | --- |
| GET / POST | `/charts` | Danh sách / tạo biểu đồ |
| POST | `/charts/preview` | Xem trước từ cấu hình |
| GET | `/charts/{id}/data` | Dữ liệu biểu đồ; có query `filter` tùy chọn |
| DELETE | `/charts/{id}` | Xóa biểu đồ |

Payload tạo/xem trước:

```json
{"datasetId":"UUID-lấy-từ-API","name":"Doanh thu theo vùng","chartType":"bar","dimension":"region","metric":"amount","aggregate":"sum"}
```

`chartType`: `bar/line/pie`. `aggregate`: `sum/count/avg`; `metric: "*"` chỉ dùng với `count`. Preview trả cấu hình và `rows: [{label, value}]`, `columns`. Tổng hợp diễn ra tại PostgreSQL; chart hiện giới hạn 100 nhóm kết quả. Chưa có grid `x/y/w/h`, metric tự do hoặc bộ lọc nhiều điều kiện.

`timeGrain: "month"` tùy chọn chỉ dùng với dimension ngày/thời gian; response trả `timeGrain` tương ứng hoặc NULL. Với timestamptz, tháng được tính theo UTC, thống nhất API phân tích. Bộ lọc của chart tháng nhận `YYYY-MM`; các chart không chia tháng vẫn lọc theo giá trị gốc.

## Dashboard

| Method | Đường dẫn | Mục đích |
| --- | --- | --- |
| GET / POST | `/dashboards` | Danh sách / tạo mới với `{name}` |
| GET | `/dashboard-templates` | Ba template cùng các trường cần ánh xạ |
| POST | `/dashboards/from-template` | Tạo dashboard bằng `{datasetId,templateId,name,mapping}`; trả `{dashboardId}` |
| GET | `/dashboards/{id}` | Chi tiết, gồm danh sách chart và dữ liệu |
| PUT | `/dashboards/{id}/layout` | Gửi `{chartIds: ["UUID", "UUID"]}` để lưu thứ tự |
| POST / DELETE | `/dashboards/{id}/share` | Tạo token mới / thu hồi chia sẻ |
| GET | `/share/{token}` | Không cần đăng nhập; dữ liệu dashboard được chia sẻ |
| DELETE | `/dashboards/{id}` | Xóa dashboard |

Chi tiết có query `filterDimension=region&filter=<giá-trị-URL-encoded>`. Chỉ chart có dimension tương ứng được lọc; hiện lọc bằng phép bằng trên một giá trị. Tối đa 24 chart/dashboard. API layout hiện chỉ lưu thứ tự; chưa lưu tọa độ/kích thước lưới. Nếu bổ sung grid, giữ tương thích hoặc cập nhật các client/script liên quan.

## CSV và quản lý

| Method | Đường dẫn | Mục đích |
| --- | --- | --- |
| GET / POST | `/imports` | Liệt kê / upload multipart `file`, `title` tùy chọn |
| GET / DELETE | `/imports/{id}` | Chi tiết / xóa import và đối tượng được sinh |
| GET / POST | `/users` | Danh sách / tạo `{username, password, role}` |
| GET / POST | `/groups` | Danh sách / tạo `{name}` |
| POST | `/groups/{id}/members` | Thêm `{userId}` |
| GET | `/audit` | Tối đa 100 nhật ký gần nhất |

CSV tối đa 200 MB, 32 cột, 1.000.000 dòng; UTF-8, dấu phẩy, ngày `YYYY-MM-DD`. Suy luận kiểu trên tối đa 200 dòng đầu, ô trống/sai kiểu chuyển NULL. Import trả `id`, `dataset_id`, `dashboard_id`, `row_count`, `missing_count`, `invalid_count`, `columns`, `analysis`. Muốn biết bảng CSV hiện tại, lấy dataset theo `dataset_id`, đọc `source_name`; không dự đoán UUID/tên bảng.

Dataset/dashboard do CSV sinh cần xóa qua `/imports/{id}`, không xóa trực tiếp từng đối tượng. Xóa kết nối/dataset khác có thể cascade xuống chart; kiểm tra phụ thuộc trước khi thao tác.

## Chat AI

Đã có GET/POST /chat/conversations, GET/DELETE /chat/conversations/{id} và POST /chat/message. Chat dùng phiên Bearer hiện tại; tạo/xóa/gửi yêu cầu cần Admin/Analyst, lịch sử chỉ cho chủ sở hữu. Xem [hợp đồng hiện hành, ví dụ và cách chạy FastAPI](CHAT_AI.md). API phân tích có cấu trúc và template vẫn giữ nguyên hợp đồng cũ.
