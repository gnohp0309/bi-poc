# Pythera Data Studio — phiên bản thử nghiệm

Đây là **phiên bản thử nghiệm (POC)** của phần mềm khai thác và trực quan hóa dữ liệu. Mục đích là cho thấy nhóm có thể đưa dữ liệu vào, phân tích cơ bản và trình bày kết quả bằng dashboard theo yêu cầu đã nhận. Ứng dụng chạy cục bộ để xem và đánh giá hướng triển khai; **chưa phải sản phẩm hoàn chỉnh hoặc dịch vụ đã triển khai trên Internet**.

## Có thể xem gì trong bản thử nghiệm?

- **Từ file CSV:** tải file lên, xem số dòng và các ô trống/sai kiểu, sau đó mở dashboard và biểu đồ được tạo tự động.
- **Từ PostgreSQL:** kết nối bảng dữ liệu, tạo dataset vật lý hoặc dataset ảo bằng SQL, chạy truy vấn trong SQL Lab và tự tạo biểu đồ trong Chart Builder.
- **Trên dashboard:** thêm và sắp xếp biểu đồ, lọc dữ liệu cơ bản, tạo liên kết hoặc mã nhúng để xem trên cùng máy chạy POC.
- **Quản lý:** tài khoản Admin/Analyst/Viewer và nhật ký thao tác cơ bản.

Mã nguồn sử dụng Spring Boot, React/TypeScript, ECharts và PostgreSQL. [File CSV mẫu](demo/doanh_thu_poc.csv) có sẵn để thử luồng đầu tiên.

## Tải về và chạy thử

Quy trình dưới đây dành cho **Windows**. Cần cài Git, **JDK 17**, Maven, **PostgreSQL 18** và Node.js `^20.19.0` hoặc `>=22.12.0`. Các lệnh `git`, `java`, `mvn`, `npm` cần hoạt động trong CMD/PowerShell; lần đầu cần Internet để tải thư viện. Cổng **8081** và **5433** cần còn trống.

```powershell
git clone https://github.com/gnohp0309/bi-poc.git
cd bi-poc
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\start-demo.ps1
```

Lần chạy đầu, script tự build frontend/backend và tạo PostgreSQL riêng trong `.local/pgdata`. Khi hiện `POC ready`, mở **http://127.0.0.1:8081/** và đăng nhập:

| Tài khoản | Mật khẩu | Vai trò |
| --- | --- | --- |
| `admin` | `Demo2026!` | Quản trị |
| `analyst` | `Demo2026!` | Tạo và sửa; được tạo khi chạy `seed-demo.ps1` |
| `viewer` | `Demo2026!` | Chỉ xem; được tạo khi chạy `seed-demo.ps1` |

Nếu PostgreSQL được cài ở đường dẫn khác và script không tìm thấy, đặt biến `POC_POSTGRES_BIN` trỏ đến thư mục `bin` của PostgreSQL trước khi chạy. Đây là **mật khẩu mẫu công khai**, chỉ dùng với dữ liệu giả lập trên máy cá nhân.

## Hai cách thử nhanh

**1. Tải CSV:** vào **Tải file & phân tích**, chọn `demo/doanh_thu_poc.csv`, rồi bấm **Nhập file và tạo dashboard**. Kết quả mẫu có **12 dòng, 2 ô trống, 2 ô sai kiểu**. Bấm **Mở dashboard** để xem biểu đồ; thử lọc `c_khu_vuc` theo `Miền Bắc`.

**2. Dùng bảng PostgreSQL mẫu:** sau khi web đã chạy, mở terminal khác trong thư mục repo và chạy:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\seed-demo.ps1
```

Script nạp `public.orders` và `public.products` vào database `bi_poc_source`, rồi tạo kết nối **PostgreSQL · Bán hàng mẫu**, dataset, biểu đồ và dashboard mẫu. Trong **SQL Lab**, chọn kết nối này khi truy vấn `public.orders`. Kết nối **CSV imports (read-only)** dùng database khác; bảng CSV có tên `uploads.csv_...` mới sau mỗi lần nhập.

## Khám phá dữ liệu và thống kê

Vào **Chat AI**, chọn dataset rồi mở **Khám phá dataset trong Chat** để xem profiling, dữ liệu thiếu, trùng lặp và sai kiểu CSV. Gửi câu hỏi trong hội thoại để chạy thống kê mô tả, Pearson/Spearman, IQR/Z-score, kiểm định hoặc nhận định từ số liệu thực. Kết quả được lưu cùng hội thoại. Dashboard do Chat tạo có thể mở lại trong Chat để chỉnh sửa, lọc, xem chi tiết, chia sẻ và xuất file.

Xem [hợp đồng tích hợp và giới hạn](docs/EXPLORATION_INTEGRATION.md). File [CSV giả lập có dữ liệu bẩn](demo/exploration_dirty_242.csv) có **242 dòng, 3 ô thiếu và 3 ô sai kiểu lúc nhập, 2 dòng trùng dư, một ngoại lệ doanh thu 999999**. Sau nhập, ô sai kiểu chuyển NULL nên báo cáo hiện tại có 6 ô thiếu. Không tự xóa dòng hoặc sửa dữ liệu gốc.

## Phát triển cùng nhóm

Mỗi người clone repo về máy riêng, tạo nhánh chức năng và gửi Pull Request vào `main`. Xem [quy trình làm nhóm](CONTRIBUTING.md), [cách chạy khi sửa code](docs/DEVELOPMENT.md) và [API hiện có](docs/API.md).

Phần backend có [API metadata và phân tích dataset](docs/DATA_ANALYSIS.md) để tích hợp hỏi đáp dữ liệu: đọc cấu trúc cột và tổng hợp/lọc theo cấu hình JSON có kiểm soát.

**Dashboard theo template có ba mẫu: Tổng quan doanh thu, Phân tích sản phẩm bán ra và Theo dõi trạng thái đơn hàng**, xem [hướng dẫn BA-25](docs/DASHBOARD_TEMPLATES.md).

**Chat AI** cho Admin/Analyst hỏi số liệu và đề xuất dashboard theo template hoặc 2–4 biểu đồ custom. Phần này cần chạy thêm FastAPI/Python 3.12 và cấu hình Gemini API key riêng; các màn hình BI khác vẫn chạy độc lập. Xem [cách chạy, hợp đồng và giới hạn kiểm chứng Chat AI](docs/CHAT_AI.md). Bộ test tự động dùng provider giả lập, không thay thế việc chạy thử Gemini bằng key thật.

## Giới hạn của bản thử nghiệm

Bản này tập trung kiểm chứng luồng chính. Hiện chỉ nhận **CSV UTF-8** và kết nối **PostgreSQL**; bộ lọc, thiết kế biểu đồ và phân quyền còn ở mức cơ bản. Link chia sẻ chứa `127.0.0.1` chỉ mở trên máy đang chạy ứng dụng. Không nhập dữ liệu nhạy cảm hoặc mở ứng dụng ra Internet với cấu hình và mật khẩu mẫu.

Để dừng web, chạy `powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\stop-demo.ps1`. Nếu muốn dừng cả PostgreSQL, chạy tiếp `powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\stop-postgres.ps1`. Dữ liệu vẫn được giữ trong `.local`. Lệnh `dev\reset-demo.ps1` sẽ **xóa dữ liệu demo và bảng mẫu** sau khi tạo bản sao lưu; chỉ dùng khi muốn thử lại từ trạng thái trống.
