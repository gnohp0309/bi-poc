# BI Dashboard POC

Bản demo để trình bày hai luồng: **CSV → phân tích chất lượng/số liệu → dashboard tự động** và **PostgreSQL → dataset → SQL/biểu đồ → dashboard**. Backend dùng Spring Boot 3.5, frontend dùng React + TypeScript + ECharts 6, dữ liệu cấu hình và file nhập được lưu trong PostgreSQL. Đây là bản chạy cục bộ, chưa phải hệ thống triển khai thật.

## Chạy trên máy này

Máy đã có Java 17, Maven, Node.js và PostgreSQL 18. Mở PowerShell tại thư mục `bi-poc`, chạy một lệnh:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\start-demo.ps1
```

Trong **CMD**, chạy `cd /d D:\SE01C\TT\ThucTap\bi-poc` rồi dùng đúng lệnh `powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\start-demo.ps1` ở trên.

Script tạo cụm PostgreSQL riêng trong `.local/pgdata` tại `127.0.0.1:5433`, hai CSDL `bi_poc_app` và `bi_poc_source`, tài khoản chỉ đọc `bi_reader`, rồi chạy file `.jar` ở chế độ nền. **Lần khởi động mới không tự nạp đơn hàng hoặc dashboard mẫu** để bạn có thể thử từ màn hình trống. Chạy lại không xóa dữ liệu bạn đã nhập. Nó không thay đổi dịch vụ PostgreSQL đang có trên cổng 5432.

Nếu muốn xem log ứng dụng trực tiếp, thay lệnh trên bằng `powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\setup-postgres.ps1`, rồi chạy:

```powershell
cd .\backend
java -jar .\target\bi-poc-0.1.0.jar
```

Mở [http://127.0.0.1:8081/](http://127.0.0.1:8081/). Nếu **muốn chủ động nạp dữ liệu PostgreSQL mẫu** để thử luồng kết nối database, khi backend đã lên hãy mở terminal khác tại thư mục `bi-poc` và chạy:

```powershell
pwsh -NoProfile -File .\dev\seed-demo.ps1
```

Script này nạp bảng `orders`/`products`, tạo kết nối chỉ đọc, dataset vật lý/ảo, truy vấn lưu, ba biểu đồ và dashboard “Tổng quan bán hàng 2025”. Chạy lại không tạo trùng dashboard. Khi sửa mã giao diện, build lại bằng `npm run build` trong `frontend`, sau đó `mvn -q -DskipTests package` trong `backend` để tạo file `.jar` mới.

Để **xóa dữ liệu demo và thử nhập lại từ đầu**, chạy ở thư mục `bi-poc`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\reset-demo.ps1
```

Lệnh này sao lưu hai database vào `.local/backups`, xóa file nhập, các bảng đã nhập, kết nối, dataset, truy vấn, biểu đồ, dashboard, nhóm và nhật ký; giữ các tài khoản `admin`, `analyst`, `viewer`. Sau đó nó khởi động lại web ở trạng thái trống. File CSV trên ổ đĩa và mã nguồn vẫn được giữ nguyên.

| Tài khoản | Mật khẩu | Vai trò |
| --- | --- | --- |
| `admin` | `Demo2026!` | Quản trị, xem nhật ký |
| `analyst` | `Demo2026!` | Tạo kết nối, dataset, truy vấn, biểu đồ, dashboard |
| `viewer` | `Demo2026!` | Chỉ xem |

Mật khẩu của kết nối dữ liệu mẫu trong biểu mẫu là `Reader2026!`. Tất cả thông tin đăng nhập trên chỉ dùng cho dữ liệu giả lập cục bộ. Không mở cổng ra mạng hoặc dùng dữ liệu thật trước khi đổi mật khẩu, khóa mã hóa và thiết kế lại cơ chế bảo mật.

## Kịch bản trình bày 5–7 phút

1. Đăng nhập `admin`; trang **Tổng quan** ban đầu có 0 kết nối, 0 dataset, 0 biểu đồ và 0 dashboard.
2. Vào **Tải file & phân tích**. Chọn `demo/doanh_thu_poc.csv`, đặt tên “Doanh thu bán hàng mẫu 2025” và bấm **Nhập file và tạo dashboard**.
3. Đối chiếu kết quả: **12 dòng**, **2 ô trống**, **2 ô sai kiểu**, tổng `doanh_thu` **9.700.000**. Hai ô sai kiểu và quy tắc chuyển thành `NULL` được nêu trong bảng kết quả.
4. Bấm **Mở dashboard**. Hệ thống tạo biểu đồ cột theo `khu_vuc`, tròn theo `danh_muc`, đường theo tháng. Chọn chiều lọc `c_khu_vuc`, nhập `Miền Bắc`, bấm **Áp dụng**: biểu đồ khu vực còn **3.600.000**.
5. Vào **Kết nối dữ liệu** và **Datasets** để xem bảng CSV đã được nhập vào PostgreSQL. Dùng **Chart Builder** tạo thêm biểu đồ từ dataset này nếu muốn chứng minh luồng thủ công. Để chạy câu SQL mẫu `public.orders` trong **SQL Lab**, chọn kết nối **PostgreSQL · Bán hàng mẫu** tới `bi_poc_source`.
6. Vào **Bảo mật & nhật ký** để xem thao tác nhập; có thể đăng nhập `viewer` để xác nhận tài khoản này không được tải file. Chỉ chạy `dev/seed-demo.ps1` nếu muốn trình bày thêm luồng nguồn PostgreSQL mẫu.

## Phạm vi đã làm và giới hạn

| Phân hệ | Đã thể hiện trong POC | Chưa làm/giới hạn |
| --- | --- | --- |
| Tải file & phân tích | CSV UTF-8 tối đa 200 MB, 32 cột, 1 triệu dòng; đọc theo luồng; suy kiểu từ 200 dòng đầu; đếm ô trống/sai kiểu; thống kê cột số; tạo dataset, 1–3 biểu đồ và dashboard; xóa cả dữ liệu nhập | Chỉ CSV dấu phẩy; ngày `YYYY-MM-DD`, số thập phân dấu chấm; sai kiểu thành `NULL` và giữ dòng; chưa có Excel, tự nhận dạng dấu phân cách, công thức phân tích nâng cao, AI hoặc xử lý nền/progress chính xác |
| Kết nối CSDL | Kiểm tra, lưu mã hóa mật khẩu, duyệt bảng PostgreSQL | Chưa hỗ trợ MySQL/SQLite; chỉ cho phép máy chủ CSDL `127.0.0.1`/`localhost` theo cấu hình |
| Dataset | Bảng vật lý, SQL ảo, xem trước, lưu nhãn cột | Nhãn cột chưa được áp dụng tự động vào biểu đồ; chưa có kho metric dùng chung |
| SQL Lab | Chạy SELECT/WITH chỉ đọc, lưu truy vấn, giới hạn 500 dòng/6 giây | SQL gắn với bảng của kết nối được chọn; câu mẫu `public.orders` dùng `bi_poc_source`, không dùng kết nối CSV. Chưa có gợi ý mã, lịch sử phiên hoặc phân tích truy vấn |
| Chart Builder | Cột, đường, tròn; dimension, SUM/COUNT/AVG; lưu biểu đồ | Chưa có nhiều trục, công thức metric, lọc nhiều điều kiện |
| Dashboard | Gắn biểu đồ, kéo đổi thứ tự, lọc một chiều, liên kết và iframe | Chưa có lưới kéo-thả tự do; bộ lọc khớp chính xác và chỉ tác động biểu đồ cùng chiều |
| Bảo mật | Đăng nhập, Admin/Analyst/Viewer, nhóm/thành viên, nhật ký cơ bản | Quyền đang ở mức vai trò toàn hệ thống, chưa có ACL riêng từng dashboard/chart/dataset; chưa có SSO, quản lý vòng đời người dùng, chính sách bảo mật sản xuất |

Link chia sẻ là công khai đối với ai cầm token và mở được máy chủ; không dùng với dữ liệu nhạy cảm. Bản xem công khai chỉ trả tên và dữ liệu biểu đồ, không trả thông tin chủ sở hữu hoặc token trong phản hồi API.

## Kiểm tra

```powershell
cd .\frontend
npm run build
npm audit
```

```powershell
cd ..\backend
mvn -q -DskipTests package
```

Khi backend đang chạy, từ thư mục `bi-poc`:

```powershell
pwsh -NoProfile -File .\dev\smoke.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\smoke-import.ps1
```

`smoke.ps1` kiểm tra các phân hệ cũ và cần chạy `dev/seed-demo.ps1` trước để có bảng nguồn mẫu. `smoke-import.ps1` kiểm tra nhập CSV, số liệu, dashboard, file lỗi, quyền Viewer và xóa dữ liệu. Các script xóa dữ liệu kiểm thử do chúng tạo; để trở lại màn hình hoàn toàn trống sau khi test, dùng `reset-demo.ps1`.

Để thử tải nặng bằng file tổng hợp và tự xóa sau khi kiểm tra:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\load-import.ps1 -Rows 1000000
```

Trên máy demo này, file kiểm thử 5 cột, 1.000.000 dòng (31.586.708 byte) nhập và tạo 3 biểu đồ trong **30,8 giây**, tổng `amount` đối chiếu **50.500.000**. Đây là một phép đo cục bộ, không phải cam kết tốc độ cho mọi file/máy. Giới hạn 200 MB có thể chặn file 1 triệu dòng có nhiều cột hoặc ô văn bản dài.

## Cấu hình

Các biến môi trường trong `backend/src/main/resources/application.properties` cho phép đổi cổng, địa chỉ bind, CSDL, mật khẩu admin, khóa mã hóa, mật khẩu đọc dữ liệu nhập và danh sách host dữ liệu. Mặc định cả backend và frontend chỉ nghe trên `127.0.0.1`. `dev/setup-postgres.ps1` giả định PostgreSQL 18 ở `C:\Program Files\PostgreSQL\18\bin`; nếu máy khác cài bản/đường dẫn khác, sửa `$bin` trong script hoặc cấu hình kết nối PostgreSQL của riêng mình. Script đặt `PGCLIENTENCODING=UTF8` để CMD/Windows PowerShell không làm hỏng dữ liệu tiếng Việt khi nạp `source.sql`. Chỉ khi truyền `-WithSampleData`, script mới nạp bảng `orders` và `products`.

Trước khi build lại JAR trên Windows, chạy `powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\stop-demo.ps1` vì tiến trình Java đang chạy sẽ khóa JAR cũ. Sau khi build frontend và backend, chạy lại `start-demo.ps1`.

Để dừng cụm PostgreSQL mẫu sau buổi demo:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -D .\.local\pgdata stop
```

Nếu chạy bằng `start-demo.ps1`, dùng `powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\stop-demo.ps1` để dừng app nền; nếu chạy `java -jar` trực tiếp, dùng `Ctrl+C`. Nếu đang phát triển giao diện, có thể chạy riêng `npm run dev` ở `frontend` để dùng máy chủ Vite tại `127.0.0.1:5173`; Vite chuyển `/api` sang Spring Boot tại cổng 8081. Không xóa `.local/pgdata` nếu muốn giữ dashboard và dữ liệu đã tạo.
