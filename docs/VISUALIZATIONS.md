# Các dạng trực quan hóa

Chart Builder hiện hỗ trợ line, bar, pie, donut, KPI card, histogram, scatter, heatmap tương quan, bản đồ điểm, stacked bar và stacked area. Chọn dataset, dạng biểu đồ, các cột có kiểu phù hợp, **Xem trước** rồi đặt tên và **Lưu biểu đồ**. Thêm biểu đồ đã lưu vào dashboard như trước. Renderer dùng chung cho Chart Builder, dashboard, dashboard công khai và dashboard trong chat.

Khám phá dữ liệu → Thống kê cột có nút **Xem histogram** cho cột số, dùng cùng API và renderer. Không suy ra histogram từ top 10 giá trị hay preview 20 dòng.

## Hợp đồng API

Giữ các endpoint `/api/charts/preview`, `/api/charts`, `/api/charts/{id}/data`; request có `datasetId`, `name` khi lưu, `chartType`, `aggregate` (`sum/avg/count`) và các trường theo dạng. ADMIN/ANALYST được lưu, Viewer chỉ xem/xem trước. Server luôn kiểm tra metadata, không nhận biểu thức SQL từ cấu hình.

| chartType | Cấu hình và ý nghĩa |
| --- | --- |
| bar, line, pie, donut | `dimension`, `metric`, `aggregate`; line có `timeGrain: "month"` tùy chọn cho cột ngày. Pie là tròn đầy, donut là vòng. |
| kpi | `metric`, `aggregate`; không cần dimension. COUNT(*) là số dòng. SUM/AVG trên nguồn không có giá trị hợp lệ trả NULL, giao diện hiển thị “—”. |
| histogram | `metric` là cột số, `aggregate: "count"`, `binCount` số nguyên 2–50 (mặc định 10). Khoảng đều, tính trên toàn bộ nguồn, khoảng cuối gồm cận trên; nguồn hằng trả một khoảng, nguồn rỗng trả không có khoảng. |
| scatter | `dimension` là X số, `metric` là Y số; cần `aggregate` hợp lệ cho tương thích payload nhưng không tổng hợp điểm. Chỉ lấy cặp đủ hai số hữu hạn. |
| heatmap | `numericColumns` gồm 2–8 cột số khác nhau; `aggregate: "count"`; không cần dimension/metric. Ma trận Pearson do PostgreSQL `corr` tính trên toàn nguồn, xử lý thiếu theo từng cặp. Cột hằng/không đủ cặp trả NULL; không coi là tương quan 0. Mỗi ô có `pairedCount`. Chưa tính Spearman/p-value/kiểm định ở renderer này. |
| map | `latitude`, `longitude` là tên cột số; `metric`, `aggregate`, `labelColumn` tùy chọn. Tổng hợp theo tọa độ và nhãn; vĩ độ [-90,90], kinh độ [-180,180]. Không geocode tên vùng, không có tọa độ phù hợp thì yêu cầu bổ sung dữ liệu. |
| stacked-bar | `dimension`, `seriesDimension`, `metric`, `aggregate`; nhóm theo tháng tùy chọn trên cột ngày. |
| stacked-area | Như stacked-bar nhưng dimension bắt buộc kiểu ngày/thời gian. |

Ví dụ histogram:

```json
{"datasetId":"UUID","name":"Phân phối doanh thu","chartType":"histogram","metric":"amount","aggregate":"count","binCount":10}
```

Ví dụ heatmap:

```json
{"datasetId":"UUID","name":"Tương quan","chartType":"heatmap","numericColumns":["amount","quantity"],"aggregate":"count"}
```

Ví dụ stacked theo tháng:

```json
{"datasetId":"UUID","name":"Cơ cấu doanh thu","chartType":"stacked-area","dimension":"order_date","timeGrain":"month","seriesDimension":"region","metric":"amount","aggregate":"sum"}
```

## Response và lưu cấu hình

- Giữ `chartType/dimension/metric/aggregate/timeGrain/rows/columns`, thêm các trường cấu hình liên quan, `notes` và `truncated` cho dạng mới.
- KPI: `rows:[{value}]`; histogram: `bin/lower_bound/upper_bound/value`; scatter: `x/y`; heatmap: `x/y/value/pairedCount`; map: `x` (kinh độ), `y` (vĩ độ), `label/value`; stacked: `label/series/value`.
- Histogram, KPI và heatmap tổng hợp trên toàn bộ nguồn; không lấy mẫu. Scatter tối đa 500 điểm đầu theo X/Y, không phải mẫu ngẫu nhiên. Map và stacked tối đa 500 nhóm; `truncated=true` cảnh báo bị giới hạn. Không diễn giải phần bị giới hạn là tổng đầy đủ.
- Dạng mới bỏ số không hữu hạn khỏi tổng hợp; histogram/scatter bỏ giá trị thiếu cần thiết. Map bỏ tọa độ thiếu/ngoài phạm vi. Stacked bỏ dòng thiếu trục. Bảng ghi chú trên màn hình giải thích từng trường hợp. Dữ liệu số rất lớn có thể mất độ chính xác khi chuyển số thực để vẽ/tính corr.
- Stacked tạo chuỗi theo nhóm màu; nhóm/trục không có dòng được điền 0 để xếp chồng. Không biến giá trị NULL đã trả về thành 0.
- Migration bổ sung `charts.config_json` và mở rộng constraint `chart_type` khi backend khởi động. Giữ chart/dashboard cũ; không cần reset database. Không sửa schema lưu lưới x/y/w/h trong task này.
- Bộ lọc dashboard hiện có vẫn là lọc theo một dimension. Stacked hỗ trợ lọc trục, gồm tháng UTC; KPI/histogram/heatmap/map chưa tích hợp bộ lọc dashboard toàn cục. Đây là phạm vi task bộ lọc tiếp theo, không tự giả vờ đã áp dụng bộ lọc cho tất cả chart.

## Chat và bản đồ

FastAPI `ChartSpec` và Spring Boot nhận các trường mở rộng, kiểm tra kiểu của `numericColumns/binCount`. Prompt mô tả lựa chọn theo cột thực tế và hỏi rõ khi thiếu dữ liệu. Chỉ mở rộng hợp đồng/renderer, không chứng minh Gemini chọn đúng mọi cách diễn đạt; cần API key và chạy demo thực tế để nghiệm thu AI. Cấu hình dashboard trong chat được lưu và tải bằng API dashboard chung.

Nền map là Natural Earth 1:110m, public domain, đóng gói cục bộ và lazy-load; không gửi dữ liệu tọa độ sang dịch vụ tile. Có thể kéo/zoom. Đây là bản đồ điểm, chưa có choropleth, geocoding hay phân chia hành chính tùy chỉnh. Nguồn và điều khoản trong `frontend/src/assets/WORLD_MAP_SOURCE.md`.

## Kiểm tra

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev\smoke-visualizations.ps1
```

Script cần nguồn demo `bi_poc_source` và tài khoản admin/viewer, tạo fixture riêng rồi dọn. Kiểm tra tám dạng mới, số liệu, NULL/nguồn rỗng/cột hằng, histogram hơn 500 dòng, Pearson theo cặp, tọa độ sai, lưu/mở lại, dashboard/chia sẻ, lọc stacked, đầu vào sai và quyền Viewer. Có thể truyền `-BaseUrl http://127.0.0.1:8082/api`.


Chỉnh sửa chart đã lưu và bố cục dashboard được bổ sung trong task 5; xem [DASHBOARD_EDITOR](DASHBOARD_EDITOR.md).
