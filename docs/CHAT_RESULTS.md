# Hiển thị kết quả phân tích và kiểm định trong chat

Task giao diện sử dụng một envelope `analysis_result` có phiên bản trong `chat_messages.metadata_json`. Không thêm phép tính kiểm định vào frontend và không nhận p-value do LLM tự viết. Spring Boot hiện tự tạo envelope cho nhánh query từ kết quả SQL đã thực thi; vẫn giữ `data`, `query_config` và response `answer` cũ để tương thích.

**Tích hợp hiện tại:** Statistical Engine đã nối qua Spring Boot trên dataset thật. Nhánh statistical lưu envelope bên dưới từ engine, không nhận kết quả tính toán từ LLM. Xem [API, quy tắc và kiểm thử](EXPLORATION_INTEGRATION.md). Fixture vẫn chỉ phục vụ test renderer.

## Giao diện

- Query mới: tiêu đề/trạng thái, tóm tắt số dòng kết quả, bảng phân trang 25 dòng, biểu đồ từ số liệu thật, cảnh báo giới hạn, nguồn tính toán. Không tự gọi lại AI/SQL khi mở lịch sử.
- Không chia nhóm: KPI cho từng metric; một nhóm: bar hoặc line khi có timeGrain; hai nhóm: stacked bar; nhiều hơn hai nhóm giữ bảng thay vì đoán một biểu đồ sai ý nghĩa. Chỉ tạo biểu đồ cho metric số/NULL.
- Kiểm định: phương pháp, alpha, H0/H1, cỡ mẫu đầu vào/đã dùng/thiếu và từng nhóm, statistic, p-value, CI, effect size, giả định, cảnh báo, kết luận engine và nguồn/lấy mẫu.
- Trạng thái `insufficient_data`, `not_applicable`, `error` có lý do và không hiển thị như thành công. Thiếu trường không coi bằng 0, không mặc định giả định đã đạt. Giao diện không tự kết luận có ý nghĩa thống kê từ p-value.
- Giá trị NULL khác 0; p-value rất nhỏ không làm tròn thành 0. Chuỗi số được giữ nguyên để bảo toàn độ chính xác. Biểu đồ dùng JavaScript number nên có thể mất độ chính xác ở số rất lớn; bảng giữ chuỗi số nguyên gốc khi engine gửi dạng chuỗi.
- Bảng tối đa 500 dòng hiển thị, có phân trang và cảnh báo giới hạn. Không coi số dòng kết quả là cỡ mẫu hay tổng số dòng dataset.
- Tin nhắn cũ với `data`/`dashboard_id` tiếp tục hiển thị bảng/dashboard. JSON lỗi, schema chưa hỗ trợ, bảng/biểu đồ sai cấu trúc báo rõ mà vẫn giữ nội dung văn bản. Biểu đồ lỗi được cô lập khỏi bảng/kết luận.

## Hợp đồng để tích hợp với Tú

```json
{
  "analysis_result": {
    "schemaVersion": 1,
    "kind": "statistical_test",
    "status": "success",
    "title": "So sánh doanh thu hai chi nhánh",
    "method": "Welch Independent T-test",
    "alpha": 0.05,
    "hypotheses": { "h0": "...", "h1": "..." },
    "sample": { "total": 42, "used": 40, "missing": 2, "groups": [{ "name": "A", "count": 20 }, { "name": "B", "count": 20 }] },
    "statistic": { "status": "available", "name": "t", "value": "2.52" },
    "pValue": { "status": "available", "value": "0.016" },
    "confidenceInterval": { "status": "available", "lower": "1.25", "upper": "4.75", "level": 0.95 },
    "effectSize": { "status": "not_computed", "value": null, "reason": "Engine chưa tính chỉ số này." },
    "assumptions": [{ "name": "Tính độc lập", "status": "not_checked", "detail": "Cần xác nhận từ thiết kế dữ liệu." }],
    "warnings": ["Nội dung cảnh báo từ engine"],
    "conclusion": "Kết luận do engine/luồng diễn giải đã kiểm soát cung cấp.",
    "provenance": { "engine": "Tên engine", "version": "Phiên bản", "sampled": false, "missingPolicy": "Quy tắc xử lý dữ liệu thiếu" }
  }
}
```

Các số trên chỉ minh họa cấu trúc, không phải một kết quả thống kê đã được đối chiếu.

- `kind`: `query` hoặc `statistical_test`.
- `status`: `success`, `insufficient_data`, `not_applicable`, `error`. Trạng thái không thành công cần `reason`.
- Metric/CI: `status` là `available/not_applicable/not_computed`; `value` (hoặc lower/upper) là number, chuỗi số hoặc NULL. Trường không áp dụng/chưa tính cần `reason`, không dùng giá trị 0 làm thay thế.
- `assumptions[].status`: `passed/failed/not_checked/not_applicable`. Không để LLM tự xác nhận tính độc lập nếu không có căn cứ.
- `sample` lấy từ engine, không suy ra từ `data.rows.length`. `provenance.sampled` cần chỉ rõ có lấy mẫu không, nếu có thêm `sampleSize`. CI level là tỷ lệ 0..1, không phải số phần trăm.
- `data` tùy chọn: `{columns:["..."], rows:[{...}], truncated:false}`. Ô bảng là string/number/boolean/NULL. Dùng chuỗi số khi cần độ chính xác vượt JavaScript number.
- `charts` tùy chọn: tối đa 6 ChartData đã có dữ liệu tính thật, theo [VISUALIZATIONS](VISUALIZATIONS.md); không gửi SQL. Mỗi chart có `chartType`, `dimension`, `metric`, `aggregate`, `rows`, `name` tùy chọn.
- `summary`, `warnings`, `conclusion` là văn bản thuần; không render HTML. Không tự tạo conclusion khi engine chưa cung cấp.
- JSON giữ trong `metadata_json` nên tải lại hội thoại giữ cùng số liệu/giả định/cảnh báo; chưa có cơ chế tự cập nhật kết quả kiểm định lịch sử.

Fixture chuẩn cho thử giao diện ở `dev/fixtures/chat-statistical-result.json`, gắn nhãn rõ là fixture, không dùng để demo như kết quả engine thật.

## Kiểm tra

```powershell
node --experimental-strip-types --test dev/chat-results.test.mjs
mvn -f backend/pom.xml test
```

Node test cần Node 22.18+ (CI dùng Node 22). Production build giữ yêu cầu Node của repo. Test parser gồm lịch sử cũ, NULL/0/p-value nhỏ/số chính xác cao, không tự kết luận, trạng thái thiếu dữ liệu, phân trang/giới hạn, schema sai và biểu đồ lỗi. Java test đối chiếu biểu đồ từ kết quả query thực thi, giữ alias/decimal/NULL và không sinh trường kiểm định giả.
