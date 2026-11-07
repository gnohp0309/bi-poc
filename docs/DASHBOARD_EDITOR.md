# Chỉnh sửa dashboard

Task 5 bổ sung đổi tên dashboard, sửa tiêu đề/loại/cấu hình biểu đồ và lưu vị trí/kích thước trên lưới 12 cột. Tái sử dụng Chart Builder để kiểm tra và cấu hình tất cả các dạng biểu đồ đã hỗ trợ. Không bổ sung bộ lọc toàn cục, drill-down hoặc auto refresh trong task này.

## Thao tác

1. Mở **Dashboards**, chọn dashboard.
2. Nhập **Tên dashboard** mới, bấm **Lưu tên**.
3. Bấm **Sửa biểu đồ** trên một ô. Đổi tiêu đề hoặc loại, chọn lại các cột cần thiết, **Xem trước** rồi **Lưu thay đổi**. Dataset bị khóa; muốn đổi dataset hãy thêm biểu đồ khác. Loại mới không đủ cấu hình thì không lưu. **Hủy** hoặc Esc đóng form mà không ghi cấu hình; không đóng khi đang gửi thao tác lưu.
4. Bấm **Chỉnh bố cục**. Kéo nút **Di chuyển** để đổi vị trí; kéo góc **↘** để đổi kích thước. Ô khác bị va chạm được đẩy xuống. Có thể mở **Vị trí & kích thước**, nhập X/Y/Rộng/Cao và **Áp dụng ô** để thao tác bằng bàn phím hoặc trên thiết bị cảm ứng.
5. Bấm **Lưu bố cục** để ghi database. **Hủy bố cục** khôi phục bản đã lưu. Chuyển dashboard khi còn thay đổi cần xác nhận bỏ nháp. Trong khi sửa bố cục, các thao tác đổi tên/chỉnh biểu đồ/thêm/bỏ được khóa để không mất nháp.
6. **Thêm** lấy biểu đồ đã lưu, đặt ở ô trống đầu tiên. **Bỏ** chỉ gỡ khỏi dashboard, không xóa biểu đồ khỏi thư viện. Tối đa 24 ô.

Viewer và liên kết công khai không có chức năng sửa. Bản chia sẻ dùng cùng tọa độ đã lưu. Màn hình nhỏ tự hiển thị một cột theo thứ tự hình học, không ghi đè bố cục desktop; kéo/resize trực tiếp được tắt ở chế độ này, vẫn có form nhập tọa độ. Preview trong chat giữ bố cục gọn của chat, nút mở đầy đủ dùng bố cục đã lưu.

## Biểu đồ dùng chung

Tiêu đề/cấu hình chart là dữ liệu chung nếu nhiều dashboard tham chiếu một chart. Khi sửa từ dashboard, backend kiểm tra số tham chiếu: nếu dùng chung, tạo chart riêng rồi thay tham chiếu chỉ trong dashboard đang sửa; nếu chỉ một dashboard dùng chart thì cập nhật chart đó. Vị trí/kích thước được giữ nguyên. Giao diện thông báo khi đã tạo bản riêng. Đây là thao tác trong transaction; cấu hình sai không ghi hoặc tạo chart dở dang.

## API

- `GET /api/charts/{id}`: định nghĩa camelCase để mở editor: `id/datasetId/name/chartType/dimension/metric/aggregate/timeGrain` và các trường mở rộng (`numericColumns/seriesDimension/binCount/latitude/longitude/labelColumn`). Chỉ tài khoản đã đăng nhập.
- `PUT /api/dashboards/{id}` với `{"name":"Tên mới"}`. ADMIN/ANALYST, tên sau trim tối đa 200 ký tự, không rỗng.
- `PUT /api/dashboards/{id}/charts/{chartId}`: gửi đầy đủ cấu hình chart như POST `/charts`, không đổi dataset. Tiêu đề tối đa 120 ký tự. Trả `{"chartId":"UUID","copied":true|false}`; chart phải đang nằm trong dashboard, không hợp lệ trả 400, không có dashboard/chart/membership trả 404, Viewer trả 403.
- `PUT /api/dashboards/{id}/layout` hỗ trợ payload mới:

```json
{
  "items": [
    {"chartId":"UUID-1","x":0,"y":0,"w":12,"h":10},
    {"chartId":"UUID-2","x":0,"y":10,"w":6,"h":9}
  ]
}
```

Tọa độ bắt đầu từ 0, đều là số nguyên JSON; x>=0, y>=0, w từ 3 đến 12, h từ 6 đến 24, x+w<=12, y+h<=1000. Không trùng chart, không chồng ô, tối đa 24 chart; `items:[]` gỡ toàn bộ. Một hàng CSS cao 32px, khoảng cách 16px. Nhãn/hình nhỏ có thể cuộn trong ô khi ô quá thấp.

Payload cũ `{"chartIds":["UUID-1","UUID-2"]}` vẫn dùng được và giữ ngữ nghĩa đổi thứ tự: đặt lại lưới hai cột, mỗi ô w=6/h=9. Không gửi đồng thời `items` và `chartIds`. Client mới luôn gửi `items` để giữ geometry khi thêm/bỏ chart. GET dashboard/share trả `x/y/w/h` trên từng chart. Lỗi bố cục không xóa bố cục đang lưu.

`schema.sql` thêm `dashboard_charts.grid_x/grid_y/grid_w/grid_h` bằng ADD COLUMN IF NOT EXISTS, không reset dữ liệu. Hàng cũ chưa có tọa độ được đọc theo `position` thành lưới hai cột. Các API hiện vẫn dùng quyền theo vai trò chung của POC, chưa có ACL theo dashboard. Các thao tác ghi được tuần tự bằng lock; chưa có cơ chế revision/merge nháp nếu hai người cùng sửa một dashboard.

## Kiểm chứng

```powershell
node --experimental-strip-types --test dev/dashboard-layout.test.mjs
mvn -f backend/pom.xml test
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\smoke-dashboard-editor.ps1
```

Node test cần 22.18+. Smoke cần backend, source `bi_poc_source` và tài khoản admin/viewer; dùng fixture riêng, tự dọn đối tượng thử trong finally, còn audit thao tác. Có thể truyền `-BaseUrl http://127.0.0.1:8082/api`. Kiểm tra đổi tên, lưu/mở lại geometry, từ chối overlap/số lẻ/vượt biên, rollback lỗi, cô lập chart dùng chung, đổi loại/config, share layout, legacy reorder và quyền Viewer.
