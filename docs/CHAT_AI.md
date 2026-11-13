# Chat AI — phiên bản thử nghiệm

Spring Boot giữ phiên đăng nhập, quyền, dataset và database. FastAPI gọi Gemini để đề xuất **cấu hình phân tích**, template hoặc biểu đồ; không sinh/thực thi SQL tự do. React hiển thị kết quả đã thực thi và mở dashboard đã lưu.

## Chạy trên Windows

1. Chạy web/PostgreSQL theo README. Nếu vừa pull code mới, dừng web rồi chạy lại dev/build-demo.ps1 trước khi dev/start-demo.ps1; script khởi động không tự build lại JAR đã tồn tại.
2. Cài Python 3.12 và tạo cấu hình riêng:

~~~powershell
cd ai-service
Copy-Item .env.example .env
~~~

3. Điền Gemini API key của mình vào .env. Không commit hoặc gửi key vào chat. Giữ SERVICE_HOST=127.0.0.1, SERVICE_PORT=8000. GEMINI_MODEL mặc định là gemini-3.5-flash-lite, có thể đổi theo model được tài khoản cho phép dùng.
4. Chạy ở terminal thứ hai:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-ai-service.ps1
~~~

Backend mặc định gọi http://127.0.0.1:8000. Nếu đổi cổng, đặt POC_AI_SERVICE_URL cho backend và SERVICE_PORT cho FastAPI giống nhau, rồi khởi động lại hai dịch vụ.

Chỉ phần chat cần FastAPI/Gemini key. SQL Lab, CSV, Chart Builder và dashboard thủ công vẫn chạy độc lập.

## Luồng demo

1. Đăng nhập Admin hoặc Analyst, vào **Chat AI**.
2. Chọn dataset, bấm **Tạo cuộc hội thoại mới**.
3. Với orders mẫu, hỏi “Tổng doanh thu là bao nhiêu?”, “Doanh thu theo vùng”, rồi “Còn trung bình?”.
4. Hỏi “Tạo dashboard tổng quan doanh thu”. Nếu có đủ ngày/doanh thu/vùng/danh mục, AI chọn sales-overview.
5. Các biểu đồ hiện ngay dưới tin nhắn tạo dashboard. Trong cùng hội thoại, gửi “Thêm KPI tổng doanh thu vào dashboard vừa tạo và lọc chi nhánh A” (hoặc chọn một giá trị có trong dataset). Chat thêm KPI và lưu điều kiện lọc cho dashboard gần nhất của hội thoại trong một giao dịch.
6. Gửi “Xuất dashboard vừa tạo ra Excel” (hoặc PDF, PNG), rồi tải file từ phản hồi. File lấy từ dữ liệu đang hiển thị trong phản hồi lúc tải. Khung **Mở dashboard trong Chat** dùng để xem báo cáo và drill-down. Mở lại hội thoại sẽ tải biểu đồ từ dashboard đã lưu.
7. Với dataset sản phẩm có giá/tồn kho nhưng thiếu doanh thu, hỏi “Tạo dashboard phân tích giá và tồn kho”. AI có thể đề xuất 2–4 biểu đồ custom; không được coi giá là doanh thu để ép vào template.
8. Câu hỏi thiếu thông tin/ngoài hợp đồng sẽ cần làm rõ. Không bảo đảm mọi cách diễn đạt đều được LLM hiểu đúng.

Viewer chỉ đọc danh sách/lịch sử hội thoại của mình; không tạo/xóa hội thoại hoặc gửi yêu cầu phân tích. Không chia sẻ hội thoại giữa các tài khoản.

## Hợp đồng

| Endpoint Spring Boot | Hành vi |
| --- | --- |
| GET /api/chat/conversations | Tối đa 50 hội thoại của tài khoản hiện tại |
| POST /api/chat/conversations | {datasetId,title?} → {id}; Admin/Analyst |
| GET /api/chat/conversations/{id} | Hội thoại và messages; tài khoản sở hữu |
| POST /api/chat/message | {conversationId,message} → {message_id,intent,answer,data?,dashboard_id?}; Admin/Analyst |
| DELETE /api/chat/conversations/{id} | Xóa hội thoại của mình; Admin/Analyst |

Câu hỏi dài tối đa 4.000 ký tự; tên hội thoại 200, tên dashboard/biểu đồ 120. Thiếu quyền trả 403, sai sở hữu trả 404. Lỗi AI/config trả 502, gián đoạn 503, timeout 504; lỗi cột/cấu hình phân tích trả 400.

Gemini được chờ tối đa 50 giây mỗi yêu cầu; Spring Boot chờ AI service tối đa 60 giây. Đặt timeout trực tiếp trên Interactions API, không chỉ cấu hình HTTP client. Không tự retry/continuation yêu cầu có thể tính phí, giới hạn 4.096 token đầu ra. Khi provider hết thời gian chờ, web báo timeout riêng; log chỉ ghi loại lỗi và request ID, không ghi key hoặc nội dung exception của provider.

Spring Boot → POST /analyze của FastAPI:

~~~json
{
  "request_id":"request-uuid",
  "dataset_name":"Đơn hàng",
  "question":"Doanh thu theo vùng",
  "columns":[
    {"name":"region","type":"text","kind":"text","friendly_name":"Vùng","aggregates":["count","count_distinct"],"timeGrains":[]},
    {"name":"amount","type":"numeric","kind":"number","friendly_name":"Doanh thu","aggregates":["sum","avg","min","max","count","count_distinct"],"timeGrains":[]}
  ],
  "conversation_history":[]
}
~~~

FastAPI → Spring Boot:

~~~json
{
  "request_id":"request-uuid",
  "intent":"query",
  "query_config":{
    "groupBy":[{"column":"region"}],
    "metrics":[{"column":"amount","aggregate":"sum","alias":"revenue"}],
    "orderBy":[{"column":"revenue","direction":"desc"}],
    "limit":100
  }
}
~~~

query_config dùng đúng [DATA_ANALYSIS](DATA_ANALYSIS.md): tối đa 3 chiều, 5 chỉ số, 10 bộ lọc AND, 500 dòng đầu ra; tổng hợp trên toàn bộ dataset trước khi giới hạn. SQL bên trong dataset ảo vẫn quyết định phạm vi nguồn. Không nhận sql, table, computed_metrics hay hàm tùy ý từ AI. Phân tích dữ liệu thô từng dòng/công thức ngoài hợp đồng cần hỏi rõ hoặc dùng SQL Lab thủ công.

Intent create_dashboard dùng dashboard_name, useTemplate=true, templateId, mapping theo [DASHBOARD_TEMPLATES](DASHBOARD_TEMPLATES.md); hoặc useTemplate=false, charts từ 2–4 cấu hình {name,chartType,dimension,metric,aggregate,timeGrain?}. Không cho biểu đồ tự đổi dataset. Kiểm tra toàn bộ trước khi lưu, và rollback cả chart/dashboard/message nếu có lỗi lưu.

Intent clarify dùng clarification. Câu trả lời **query** được dựng từ các dòng kết quả thật, không dùng nội dung số liệu AI tự viết. Số BigDecimal giữ phần lẻ/độ chính xác; NULL hiển thị NULL. metadata_json của tin nhắn lưu dữ liệu kết quả hoặc dashboard_id để mở lại.

Intent `dashboard_action` hỗ trợ `add_kpi`, `filters` và `export_format`. Đích lấy từ hội thoại và kiểm tra quyền sở hữu ở backend. Điều kiện lọc mới thay điều kiện đã lưu trên cùng cột, còn điều kiện của cột khác vẫn áp dụng. Yêu cầu xuất đơn lẻ lấy định dạng từ câu người dùng và trả nút tải qua metadata `dashboard_export`. Test luồng này bằng `python dev/smoke-chat-first.py --live --dashboard-actions` trên môi trường thử.

Ở giao tiếp nội bộ với Gemini, kết quả được bọc trong decision và có schema riêng cho query, template, custom, clarify. Mỗi nhánh bắt buộc đủ trường ngay khi sinh JSON; template cần tên/cách tạo/mẫu/ánh xạ, custom cần tên/cách tạo/2–4 biểu đồ. FastAPI chuẩn hóa lại thành response phẳng ở trên, nên frontend/Spring Boot không đổi hợp đồng.

Lỗi cấu hình AI không hợp lệ được phân biệt với lỗi key/provider bằng header nội bộ X-AI-Error-Code. Web hiển thị thông báo phù hợp, không chuyển nguyên chẩn đoán riêng của provider ra trình duyệt.

Ở bước lập kế hoạch, gửi metadata và tối đa 10 tin nhắn gần nhất, kèm cấu hình và tóm tắt kết quả đã tính để nối ngữ cảnh. Với lượt phân tích thành công, Spring Boot gọi `/internal/interpret` để Gemini chọn và diễn giải một phần kết quả đã tính. Số liệu trong câu trả lời được chèn từ bằng chứng. Nếu bước diễn giải lỗi hoặc hết thời gian chờ, Chat vẫn trả kết quả từ engine. Không gửi mật khẩu kết nối hoặc toàn bộ bảng nguồn sang Gemini. Hội thoại cũ hơn 10 tin nhắn có thể mất ngữ cảnh đối với model.

Trên file `demo/exploration_dirty_242.csv`, thử hỏi “Phân tích doanh thu giúp tui, có tháng nào bất thường không?”, rồi “Tạm bỏ ngoại lệ đó ra rồi so lại với tháng 3 đi.” Phép tính so sánh giữ cùng dataset và tạm loại ngoại lệ theo IQR, không cập nhật dữ liệu nguồn. Chỉ yêu cầu rõ như “Tạo dashboard doanh thu tháng 3 năm 2025” mới lưu dashboard mới. Chạy kiểm thử hội thoại với `python dev/smoke-chat-first.py --live --conversation --base-url http://127.0.0.1:8081/api` trên môi trường thử.

## Schema và nâng cấp

schema.sql tự tạo conversations, chat_messages khi Spring Boot khởi động. Có thể tham khảo cùng DDL ở schema-chat.sql; không cần chạy thủ công nếu khởi động bình thường.

chat_messages.metadata_json là TEXT chứa JSON, không phải cột JSONB. Bổ sung sequence BIGINT GENERATED ALWAYS AS IDENTITY bằng ALTER TABLE ... IF NOT EXISTS để sắp xếp ổn định khi user/assistant cùng timestamp. Lịch sử/dữ liệu demo cũ được giữ.

## Kiểm thử và phần chưa kiểm chứng

~~~powershell
python -m pip install -r ai-service/requirements-test.txt
python -m unittest discover -s ai-service -p test_main.py -v
mvn -f backend/pom.xml verify
~~~

CI còn chạy Spring Boot + PostgreSQL + FastAPI thật với provider **giả lập** dev/chat-test-ai.py, rồi dev/smoke-chat.py trên database dùng riêng. Kiểm tra tổng hợp, nối hội thoại, số lẻ, ký tự đặc biệt, chặn SQL/cột ngoài dataset, metadata rỗng/NULL, template/custom, quyền/sở hữu, lỗi provider và rollback sau khi dashboard đã được insert.

Không chạy smoke-chat.py vào database đang dùng để demo: bài rollback có trigger thử lỗi. Không dùng chat-test-ai.py cho video demo rồi coi đó là Gemini thật.

**Kiểm thử provider giả lập không chứng minh chất lượng Gemini, quyền truy cập model, key, quota hoặc độ trễ thực tế.** Cần điền key riêng và chạy các câu hỏi demo trên trước khi báo cáo rằng luồng Gemini đã được xác nhận. API/schema validation cũng không bảo đảm AI chọn đúng ý nghĩa cột; phải đối chiếu phép tính và biểu đồ.

AI service dùng Google GenAI SDK và JSON Schema theo [tài liệu thư viện chính thức](https://ai.google.dev/gemini-api/docs/libraries) và [structured outputs](https://ai.google.dev/gemini-api/docs/structured-output). main_v2.py chỉ là entry point tương thích cho cùng implementation, không còn đường chạy SQL khác.


ChartSpec hỗ trợ thêm KPI, histogram, scatter, heatmap, map, donut và stacked; xem [hợp đồng cấu hình](VISUALIZATIONS.md). Các bộ kiểm thử schema không thay thế demo provider Gemini thật.


Hiển thị bảng/biểu đồ query và hợp đồng kết quả kiểm định có cấu trúc: [CHAT_RESULTS](CHAT_RESULTS.md). Statistical Engine kiểm định chưa có trong repo; frontend không tự tính hoặc lấy p-value từ LLM.
