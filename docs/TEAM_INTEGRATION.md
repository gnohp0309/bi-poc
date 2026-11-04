# Đề xuất tích hợp chat AI và dashboard theo template

Tài liệu này mô tả hướng ghép ba phần việc để nhóm thống nhất. Chat AI, dịch vụ FastAPI và API template chưa được triển khai trong repo hiện tại. Không coi đây là tính năng đã nghiệm thu hoặc yêu cầu đã được leader duyệt chi tiết.

Phần dữ liệu đã bổ sung `GET /api/datasets/{id}/metadata` và `POST /api/datasets/{id}/analyze`, theo [hợp đồng dữ liệu](DATA_ANALYSIS.md). Dịch vụ AI có thể dùng metadata và trả cấu hình phân tích có cấu trúc; các endpoint chat/template bên dưới vẫn cần ghép riêng.

## Ranh giới công việc

| Phần | Trách nhiệm | Công nghệ đề xuất |
| --- | --- | --- |
| Nền và dữ liệu | Xác thực, quyền truy cập, metadata, kiểm tra/thực thi truy vấn, lưu chart/dashboard | Spring Boot + PostgreSQL |
| Hỏi đáp AI | Giao diện chat, hiểu câu hỏi, đề xuất phân tích, trả lời dựa trên kết quả thực | React chung + dịch vụ FastAPI gọi LLM |
| Template dashboard | Danh mục mẫu cố định, ánh xạ cột, hiển thị, lưu và mở lại dashboard | React/ECharts + API Spring Boot |

Đề xuất một frontend chung. Trình duyệt gọi Spring Boot bằng phiên hiện tại; Spring Boot gọi FastAPI nội bộ. Không bắt FastAPI dùng cơ chế JWT của repo cá nhân vì phiên hiện tại là token opaque của Spring Boot.

## Dòng xử lý đề xuất

1. Người dùng chọn dataset và nhập câu hỏi.
2. Spring Boot xác thực, đọc metadata được phép dùng; chỉ gửi schema, chỉ số đã định nghĩa và dữ liệu kết quả cần thiết cho AI, không chuyển mật khẩu nguồn hoặc toàn bộ 500.000 dòng.
3. FastAPI phân loại yêu cầu: hỏi số liệu, tạo dashboard hoặc cần làm rõ. AI đề xuất cấu hình truy vấn/phân tích.
4. Spring Boot kiểm tra dataset/cột/phép tính/quyền và thực thi truy vấn chỉ đọc. Không tin SQL do AI sinh chỉ vì nó bắt đầu bằng SELECT.
5. Với hỏi đáp, AI dùng kết quả truy vấn để diễn giải. Với dashboard, hệ thống chọn template trong danh sách có sẵn, kiểm tra ánh xạ và tạo chart/dashboard qua phần lưu chung.
6. Frontend hiển thị câu trả lời, số liệu và liên kết dashboard; thiếu dữ liệu hoặc ánh xạ mơ hồ thì hỏi lại, không tự bịa kết quả.

## Hợp đồng cần chốt trước khi code

Tên đường dẫn sau là **đề xuất**, chưa phải API đã có:

| Giao tiếp | Payload tối thiểu đề xuất |
| --- | --- |
| Frontend → `POST /api/chat` Spring Boot | `datasetId`, `message`, `conversationId` tùy chọn |
| Spring Boot → `POST /internal/analyze` FastAPI | `requestId`, câu hỏi, metadata dataset, template được phép |
| FastAPI → Spring Boot | `intent`, phân tích có cấu trúc hoặc `clarification`; `templateId`/ánh xạ nếu tạo dashboard |
| Spring Boot → Frontend | `requestId`, `status`, `answer`, dữ liệu kết quả, `dashboardId` nếu đã tạo |
| Frontend → `GET /api/dashboard-templates` | Lấy danh sách mẫu và các trường bắt buộc |
| Frontend → `POST /api/dashboards/from-template` | `datasetId`, `templateId`, `name`, `mapping` |

Nhóm cùng ghi JSON mẫu thành công/lỗi trước khi triển khai. Với FastAPI, thống nhất port nội bộ, timeout, cách xác thực service và vị trí cấu hình URL/key. Không để frontend gọi thẳng cổng AI hoặc giữ API key thật trong trình duyệt.

## Template cho luồng đầu tiên

Đề xuất bắt đầu bằng mẫu tổng quan bán hàng: doanh thu theo tháng, theo vùng và theo danh mục. Các trường cần ánh xạ là ngày, doanh thu, vùng và danh mục. Không cố định tên cột vì CSV có `c_ngay/c_doanh_thu/c_khu_vuc/c_danh_muc`, còn bảng nguồn có `order_date/amount/region/category`.

Ngày sai/NULL được loại khỏi chart theo tháng nhưng doanh thu hợp lệ vẫn có thể tính vào tổng chung. Phải nêu khác biệt này khi đối chiếu số liệu. Tự tạo chart khi import CSV hiện tại không đồng nghĩa đã triển khai template chọn từ chat.

## Các tình huống cần chứng minh

- Hỏi tổng doanh thu và doanh thu theo vùng/tháng; đối chiếu SQL độc lập trên dữ liệu mẫu.
- Tạo dashboard từ một template được phép, lưu và tải lại không mất cấu hình.
- Thiếu cột bắt buộc, sai dataset hoặc câu hỏi mơ hồ: trả lỗi/yêu cầu làm rõ, không tạo dashboard rỗng giả thành công.
- Viewer không thực hiện chức năng bị cấm; API key sai, hết hạn mức, timeout: có thông báo và không lưu một dashboard dở dang.
- Với dữ liệu lớn, tổng hợp trên toàn bộ nguồn ở database, chỉ giới hạn kết quả trả về. Đo với số dòng được leader xác nhận; chưa coi mốc 500.000 dòng là đã đạt.

## Điểm cần nhóm/leader xác nhận

Chọn LLM và ngân sách; số template; quy mô dữ liệu; câu hỏi demo; người phụ trách từng phần; giờ demo/báo cáo. Mỗi phần có nhánh riêng, tạo Pull Request sớm để ghép một luồng hoạt động trước khi mở rộng.
