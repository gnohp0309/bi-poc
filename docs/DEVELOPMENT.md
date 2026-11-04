# Chạy và kiểm tra khi phát triển

Hướng dẫn này dành cho source hiện tại trên Windows. Backend chính là Spring Boot, frontend React/TypeScript và database PostgreSQL. Chat AI chạy thêm FastAPI/Python 3.12 ở cổng 8000 và cần Gemini key riêng; xem [CHAT_AI](CHAT_AI.md). Các màn hình BI khác vẫn chạy độc lập.

## 1. Kiểm tra môi trường

Cần JDK 17 trở lên, Maven, Node.js `^20.19.0` hoặc `>=22.12.0`, npm và PostgreSQL 18. Các lệnh sau phải chạy được trong terminal mới:

```powershell
java -version
mvn -version
node --version
npm --version
```

Nếu script không tìm thấy PostgreSQL, đặt `POC_POSTGRES_BIN` tới thư mục `bin` của bản đã cài. Ví dụ PowerShell:

```powershell
$env:POC_POSTGRES_BIN = 'C:\Program Files\PostgreSQL\18\bin'
```

Script tự tạo cluster PostgreSQL riêng ở `.local/pgdata`, cổng 5433; không dùng database của các project khác trên cổng 5432. Lần chạy đầu cần Internet để tải thư viện.

## 2. Chạy thử sau khi clone

Tại thư mục gốc repo:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\start-demo.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\seed-demo.ps1
```

Mở `http://127.0.0.1:8081`. Seed là tùy chọn: nó tạo dữ liệu bán hàng mẫu và tài khoản analyst/viewer. Nếu muốn nhập CSV từ trạng thái trống, không chạy seed; dùng admin. Không chạy `reset-demo.ps1` để sửa lỗi kết nối vì script đó xóa dữ liệu demo sau khi sao lưu.

## 3. Chạy khi thường xuyên sửa code

Không chạy JAR nền và `spring-boot:run` đồng thời trên cổng 8081. Dừng bản JAR, giữ PostgreSQL:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\stop-demo.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\setup-postgres.ps1
```

Mở hai terminal tại thư mục gốc.

Terminal backend:

```powershell
cd backend
mvn spring-boot:run
```

Terminal frontend:

```powershell
cd frontend
npm ci
npm run dev
```

Mở URL Vite, thường là `http://127.0.0.1:5173`. Vite chuyển `/api` sang Spring Boot cổng 8081. Frontend tự cập nhật khi sửa; với backend, dừng bằng Ctrl+C và chạy lại Maven sau khi sửa Java. Nếu đổi cổng backend, sửa proxy trong `frontend/vite.config.ts` tương ứng.

## 4. Cấu hình máy riêng

Mặc định có thể chạy mà không tạo file cấu hình. Nếu cần ghi đè, copy `backend/application-local.properties.example` thành `backend/application-local.properties`, chỉnh giá trị và chạy backend từ thư mục `backend`. File riêng đã được ignore.

Các script `setup/seed/start/reset-demo.ps1` dùng cổng/database/mật khẩu demo mặc định. Chỉ chỉnh `POC_DB_URL` hoặc file cấu hình backend không làm các script quản lý cluster chuyển sang database khác. Với môi trường tùy chỉnh, tự chuẩn bị database, role `bi_reader`, schema `uploads` và quyền đọc trước khi chạy backend.

Không đổi `poc.secret.key` khi vẫn muốn dùng các kết nối đã lưu: mật khẩu nguồn được mã hóa bằng khóa này. Mỗi máy giữ cấu hình riêng; không gửi database đã lưu kết nối mà thiếu khóa tương ứng.

## 5. Kiểm tra trước khi tạo Pull Request

Dừng JAR nền trước khi đóng gói lại để tránh Windows khóa file:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\stop-demo.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\build-demo.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\start-demo.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\seed-demo.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\smoke.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\smoke-import.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\smoke-templates.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\smoke-analysis.ps1
```

`start-demo.ps1` chỉ tự build khi chưa có JAR. Sau khi pull/sửa source, phải build lại hoặc dùng chế độ phát triển ở trên; chỉ restart JAR cũ sẽ không có code mới.

`smoke.ps1` kiểm tra kết nối, SQL đọc/ghi, dataset vật lý/ảo, chart, dashboard/filter/share, Viewer và audit; xóa đối tượng thử ở cuối khi chạy thành công. `smoke-import.ps1` kiểm tra CSV, số liệu, UTF-8 lỗi, sai cấu trúc và quyền Viewer; dọn import trong `finally`. Các script cần tài khoản demo và source đã seed. Chúng tạo audit/session và có thể giữ kết nối CSV dùng chung; không phải thao tác hoàn toàn không ghi dữ liệu.

Build không thay thế kiểm tra giao diện: mở màn hình đã sửa, chạy luồng dữ liệu thật và tải lại để kiểm tra lưu cấu hình. CI cũng chạy build và smoke API với PostgreSQL thử nghiệm riêng; không kiểm tra mọi thao tác trình duyệt.

## 6. Dữ liệu kiểm chứng chung

| Nguồn | Giá trị mong đợi |
| --- | --- |
| `demo/doanh_thu_poc.csv` | 12 dòng; 2 ô trống; 2 ô sai kiểu |
| Tổng doanh thu CSV | 9.700.000 |
| Theo vùng CSV | Bắc 3.600.000; Nam 4.300.000; Trung 1.800.000 |
| Tổng doanh thu CSV theo tháng hợp lệ | 9.300.000; chênh 400.000 do một dòng sai ngày |
| `public.orders` sau seed mới | 24 dòng; tháng 01/2025 tổng 5.990.000 |
| `public.products` sau seed mới | 7 dòng |

Seed không ghi đè bảng nguồn đã có dữ liệu, nên không dùng số lượng cố định này để kết luận bảng đã được chỉnh tay là lỗi. Tên bảng CSV và mọi UUID khác nhau giữa các máy/lần nhập; lấy ID từ API, không hardcode ID của người khác.

`smoke-analysis.ps1` kiểm tra phân tích trên 500.000 dòng sinh bởi PostgreSQL và đối chiếu tổng/đếm toàn bộ nguồn, không giới hạn nguồn ở 500 dòng kết quả. Đây là kiểm tra dữ liệu sinh, chưa thay thế thử import CSV hoặc dữ liệu thật ở quy mô đó. Script `load-import.ps1 -Rows 500000` có thể dùng trên môi trường thử riêng để đo import; ghi lại máy, thời gian, số dòng và tổng đối chiếu.

## 7. Lỗi thường gặp

| Hiện tượng | Kiểm tra |
| --- | --- |
| Thiếu bảng `public.orders` | Đã seed chưa; SQL Lab có chọn kết nối `bi_poc_source` thay vì `CSV imports` không |
| Cổng đang được dùng | Dừng đúng tiến trình của project; không tắt PostgreSQL của ứng dụng khác |
| `WIN1252`/`UTF8` khi seed | Dùng script setup có `PGCLIENTENCODING=UTF8`; giữ file SQL UTF-8 |
| Tiếng Việt lỗi khi chạy Windows PowerShell 5.1 | Giữ BOM UTF-8 ở script có tiếng Việt; request/response JSON dùng charset UTF-8 |
| Pull xong mà web không thay đổi | JAR cũ; build lại hoặc chạy hai terminal phát triển |
| Không giải mã được nguồn | Kiểm tra khóa mã hóa cấu hình của máy đó |
| Không push được | Đăng nhập đúng tài khoản GitHub và đã chấp nhận lời mời collaborator chưa |

Log JAR ở `.local/app.out.log`, `.local/app.err.log`; log PostgreSQL ở `.local/postgres.log`. Không commit các file này.
