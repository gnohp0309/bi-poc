# Task 7: Xuất dashboard PNG, PDF và Excel

## Sử dụng

1. Vào **Dashboards**, chọn dashboard và áp dụng bộ lọc cần dùng.
2. Nếu đang sửa bố cục, lưu hoặc hủy bản nháp trước.
3. Tại **Xuất dashboard**, chọn **Xuất PNG**, **Xuất PDF** hoặc **Xuất Excel**. File tải về qua trình duyệt.

File dùng snapshot dữ liệu đã tải thành công trên màn hình, không gọi lại API query/export hoặc AI. Thay đổi ở ô lọc chưa bấm Áp dụng không đi vào file. Muốn lấy dữ liệu nguồn mới, dùng Làm mới trước khi xuất. Trong lúc xuất, các điều khiển của trang dashboard được khóa để giữ snapshot; chuyển khỏi trang sẽ hủy việc tải file còn đang tạo.

## Định dạng

- **PNG:** ảnh toàn bộ khu vực dashboard (kể cả phần dưới màn hình), gồm tên, thời điểm dữ liệu được tải, bộ lọc và các biểu đồ. Không kèm sidebar, form chỉnh sửa, nút thao tác, token hoặc mã chia sẻ. Bố cục responsive và trạng thái legend/zoom được giữ theo màn hình lúc xuất. Tooltip rê chuột được ẩn.
- **PDF:** A4 ngang, chèn ảnh dashboard thành nhiều trang; ưu tiên ngắt tại ranh giới giữa các hàng biểu đồ. Biểu đồ cao hơn một trang có thể được chia tiếp. Có số trang và thời điểm xuất UTC. Nội dung tiếng Việt trong dashboard là ảnh raster nên không bị phụ thuộc font PDF; đây không phải báo cáo text có thể tìm kiếm/copy toàn bộ nội dung.
- **Excel (.xlsx):** sheet **Thông tin** ghi dashboard, thời điểm xuất/cập nhật, bộ lọc và phạm vi; một sheet riêng cho mỗi biểu đồ theo thứ tự hiển thị. Bảng bắt đầu từ dòng 8 (header), dữ liệu từ dòng 9; có freeze header, auto-filter, metadata và lưu ý giới hạn. Xuất cả histogram bounds, cặp tương quan, tọa độ bản đồ và nhóm chuỗi stacked. Ẩn legend hoặc zoom chỉ thay đổi hình vẽ, không lọc các dòng trong Excel.

Excel giữ số 0 là số, NULL thành ô trống, boolean và chuỗi giữ nguyên. Chuỗi số có độ chính xác cao và số vượt khả năng 15 chữ số của Excel được lưu văn bản; không biến chuỗi bắt đầu bằng `=` thành công thức. Tên sheet có tiền tố duy nhất, được làm sạch và giới hạn 31 ký tự. Tên file được làm sạch ký tự không hợp lệ.

Các file chỉ chứa dữ liệu biểu đồ đã tải sau bộ lọc, giữ giới hạn 100 nhóm hoặc 500 điểm/nhóm của API hiện có; không phải export toàn bộ dataset gốc. Sheet thông tin và từng sheet biểu đồ nêu phạm vi này. Dashboard rỗng/kết quả không có dữ liệu vẫn xuất được với trạng thái tương ứng.

## Thực hiện

- `dashboard-export.tsx`: toolbar, snapshot, download, trạng thái và context bộ lọc.
- `dashboard-export-image.ts`: chờ font/biểu đồ render xong; html-to-image chụp DOM/canvas, jsPDF tạo PDF phân trang. Không cần backend hoặc dịch vụ ngoài.
- `dashboard-export-excel.ts`: ExcelJS ghi XLSX từ dữ liệu snapshot.
- `dashboard-export-model.ts`: tên file/sheet, kiểu ô, danh sách cột, mô tả lọc và phân trang.

Các thư viện export tải theo yêu cầu qua dynamic import. Snapshot không chứa token đăng nhập/share trong phần metadata xuất. API/kiểm soát quyền hiện có được giữ nguyên; ADMIN, ANALYST và VIEWER đã xem được dashboard đều có thể xuất snapshot. Trang share công khai chưa có toolbar export.

PNG/PDF được kiểm tra trên Chrome headless; Edge Chromium dùng cùng cơ chế canvas/foreignObject. Font web ngoài không được tải thêm khi xuất, dùng font sẵn có/fallback. Giới hạn ảnh khoảng 24 triệu pixel, cạnh không quá 16384 pixel; tự giảm tỷ lệ khi cần, báo lỗi nếu giảm dưới 0,5 để tránh file quá mờ hoặc hết bộ nhớ. Chờ biểu đồ tối đa 8 giây; lỗi tải map hoặc lỗi tạo file hiển thị trong toolbar, mở lại điều khiển để thử lại. Bố cục có khoảng trống quá lớn cần thu gọn trước khi xuất.

Phụ thuộc trực tiếp: html-to-image, jsPDF, ExcelJS. `overrides.uuid` dùng bản đã vá tương thích API v4 mà ExcelJS sử dụng. `npm audit` tại thời điểm triển khai không còn cảnh báo.

## Kiểm thử

```powershell
node --experimental-strip-types --test dev/dashboard-export.test.mjs
```

Kiểm tra tên sheet/file, kiểu ô, số chính xác, phân trang, round-trip XLSX, công thức dạng chuỗi và dashboard rỗng.

Để kiểm tra tải file thật, chạy demo và Chrome riêng với CDP:

```powershell
Start-Process -FilePath 'C:\Program Files\Google\Chrome\Application\chrome.exe' -ArgumentList @('--headless=new','--remote-debugging-port=9226','--user-data-dir=D:\Project\bi-poc\.local\dashboard-export-browser','--no-first-run','http://127.0.0.1:8081') -WindowStyle Hidden
$env:POC_BASE_URL='http://127.0.0.1:8081'
$env:POC_CDP_URL='http://127.0.0.1:9226'
node dev/smoke-export.cjs
```

Script tạo fixture riêng, đối chiếu từng ô Excel của 11 dạng biểu đồ với API sau lọc; kiểm tra download PNG/PDF/XLSX thật, PDF nhiều trang, không query lại khi xuất, lọc đã áp dụng so với bản nháp, khóa export khi sửa bố cục, lỗi ảnh quá lớn, mobile, nguồn rỗng và quyền Viewer. Fixture được dọn trong finally; file kiểm thử giữ trong `.local/export-qa-*` (gitignored). Đóng Chrome kiểm thử sau khi chạy.

Mở PNG và render PDF bằng `pdftoppm -png report.pdf page` để kiểm tra ảnh/tiếng Việt/bố cục thực tế; chỉ kiểm tra chữ ký file không đủ chứng minh biểu đồ đã được chụp.
