# Chat AI - Tổng quan

## Giới thiệu

Chat AI là tính năng cho phép người dùng tương tác với dữ liệu bằng ngôn ngữ tự nhiên (tiếng Việt/tiếng Anh). Thay vì viết SQL hoặc tạo biểu đồ thủ công, người dùng chỉ cần hỏi và AI sẽ xử lý.

## Các tính năng chính

### 1. Truy vấn dữ liệu (Query)

**Mô tả:** Hỏi về dữ liệu và nhận câu trả lời trực tiếp.

**Ví dụ:**
- "Giá trung bình là bao nhiêu?"
- "Top 5 sản phẩm đắt nhất"
- "Tổng số hàng tồn kho"
- "Sản phẩm nào có giá trên 50?"

**Flow:**
```
User: "Giá trung bình là bao nhiêu?"
  ↓
AI: Tạo SQL: SELECT AVG(unit_price) AS avg_price FROM {{table}}
  ↓
Backend: Execute SQL và format kết quả
  ↓
Response: "Giá trung bình: 28,450 VNĐ"
```

**Khả năng:**
- Tính toán aggregate: SUM, AVG, COUNT, MAX, MIN
- Filter và điều kiện: WHERE, HAVING
- Sắp xếp: ORDER BY, LIMIT
- Group by nhiều cột
- Subquery và CTE
- CASE WHEN điều kiện

### 2. Tạo Dashboard

**Mô tả:** Tự động tạo dashboard với nhiều biểu đồ từ yêu cầu ngôn ngữ tự nhiên.

**Ví dụ:**
- "Tạo dashboard phân tích sản phẩm"
- "Làm báo cáo doanh thu"
- "Dashboard tổng quan cho tôi"

**2 Phương pháp:**

#### a) Template-based (Ưu tiên)
Nếu dataset đáp ứng đủ yêu cầu của template, AI sẽ dùng template có sẵn.

**3 Templates:**

1. **sales-overview** - Tổng quan doanh thu
   - Yêu cầu: date, revenue, region, category
   - Charts: Doanh thu theo tháng (line), theo vùng (bar), theo danh mục (pie)

2. **product-analysis** - Phân tích sản phẩm
   - Yêu cầu: product, revenue, quantity, category
   - Charts: Doanh thu theo sản phẩm (bar), số lượng (bar), tỷ trọng theo danh mục (pie)

3. **order-status** - Theo dõi đơn hàng
   - Yêu cầu: date, revenue, status
   - Charts: Số đơn theo trạng thái (pie), doanh thu theo trạng thái (bar), số đơn theo tháng (line)

**Ví dụ:**
```
Dataset: order_date, amount, region, category
User: "Tạo dashboard doanh thu"
→ AI phát hiện khớp template "sales-overview"
→ Tạo dashboard chuẩn với 3 biểu đồ
```

#### b) Custom Charts (Fallback)
Nếu dataset không khớp template, AI tự đề xuất charts phù hợp.

**Ví dụ:**
```
Dataset: product_name, unit_price, units_in_stock, category
User: "Tạo dashboard phân tích sản phẩm"
→ AI đề xuất:
  1. Giá trung bình theo danh mục (bar)
  2. Tồn kho theo danh mục (bar)
  3. Phân bổ sản phẩm (pie)
→ Tạo dashboard custom với 3 charts này
```

**Chart Types AI sử dụng:**
- **bar**: So sánh giữa các nhóm
- **line**: Xu hướng theo thời gian (với timeGrain: "month")
- **pie**: Tỷ lệ phần trăm

**Aggregates:**
- **sum**: Tổng cộng
- **avg**: Trung bình
- **count**: Đếm số lượng (metric: "*")

### 3. Làm rõ (Clarification)

**Mô tả:** AI yêu cầu làm rõ khi câu hỏi không rõ ràng hoặc dataset không đủ thông tin.

**Ví dụ:**
```
Dataset: product_id, price
User: "Tạo dashboard"
→ AI: "Dataset chỉ có 2 cột số. Để tạo dashboard hữu ích, 
      cần thêm các cột như: tên sản phẩm, danh mục, ngày, hoặc vùng."
```

### 4. Quản lý cuộc hội thoại

**Tính năng:**
- Tạo cuộc hội thoại mới cho mỗi dataset
- Lưu lịch sử tin nhắn
- Context aware: AI hiểu ngữ cảnh từ câu hỏi trước
- Conversation summary cho lịch sử dài

**UI:**
- Danh sách cuộc hội thoại
- Chi tiết tin nhắn (user/assistant)
- Metadata: số lượng kết quả, dashboard links
- Scroll riêng cho danh sách và messages

## Kiến trúc kỹ thuật

### 1. AI Service (Python FastAPI)

**Công nghệ:**
- FastAPI
- Google Gemini AI (gemini-3.5-flash-lite)
- Pydantic models

**Endpoint:** `POST /analyze`

**Input:**
```json
{
  "request_id": "uuid",
  "dataset_name": "Products",
  "columns": [
    {"name": "product_name", "type": "TEXT", "sample_values": [...]},
    {"name": "unit_price", "type": "NUMERIC", "sample_values": [...]}
  ],
  "question": "Giá trung bình là bao nhiêu?",
  "conversation_history": [...],
  "conversation_summary": "..."
}
```

**Output (Query):**
```json
{
  "intent": "query",
  "sql": "SELECT AVG(unit_price) AS avg_price FROM {{table}}",
  "template": "Giá trung bình: {{avg_price}}",
  "explanation": "Tính giá trung bình"
}
```

**Output (Dashboard - Template):**
```json
{
  "intent": "create_dashboard",
  "useTemplate": true,
  "templateId": "sales-overview",
  "dashboard_name": "Dashboard Doanh Thu",
  "mapping": {
    "date": "order_date",
    "revenue": "amount",
    "region": "region",
    "category": "category"
  }
}
```

**Output (Dashboard - Custom):**
```json
{
  "intent": "create_dashboard",
  "useTemplate": false,
  "dashboard_name": "Dashboard Phân Tích",
  "charts": [
    {
      "name": "Giá trung bình theo danh mục",
      "chartType": "bar",
      "dimension": "category",
      "metric": "unit_price",
      "aggregate": "avg"
    }
  ]
}
```

### 2. Backend (Spring Boot)

**Service:** `Chat.java`

**Dependencies:**
- JdbcTemplate (database)
- Datasets, Queries (data access)
- Charts, Dashboards (visualization)
- DashboardTemplates (template-based creation)
- HttpClient (AI service communication)

**Flow xử lý:**

```java
1. Nhận message từ user
2. Get dataset metadata (columns, types, samples)
3. Get aliases cho friendly column names
4. Get conversation history (last 10 messages)
5. Summarize older messages nếu có
6. Gửi request đến AI service
7. Xử lý response theo intent:
   - query: Execute SQL, format answer
   - create_dashboard:
     * useTemplate=true: Gọi DashboardTemplates.create()
     * useTemplate=false: Tạo charts → dashboard → layout
   - clarify: Trả message từ AI
8. Save assistant message với metadata
9. Update conversation timestamp
```

**SQL Safety:**
- Whitelist approach: chỉ cho phép SELECT
- Blacklist keywords: DROP, DELETE, INSERT, UPDATE, etc.
- Validate balanced quotes và parentheses
- Timeout: 30 seconds
- Read-only transaction

**Error Handling:**
- Technical errors ẩn khỏi frontend
- User-friendly messages
- Continue on partial failures (dashboard creation)
- Graceful degradation

### 3. Database Schema

**conversations:**
```sql
id UUID PRIMARY KEY
user_id UUID NOT NULL
dataset_id UUID NOT NULL
title VARCHAR(200)
created_at TIMESTAMP
updated_at TIMESTAMP
```

**chat_messages:**
```sql
id UUID PRIMARY KEY
conversation_id UUID NOT NULL
role VARCHAR(20) -- 'user' | 'assistant'
content TEXT
metadata_json JSONB
created_at TIMESTAMP
```

**Metadata structure:**
```json
{
  "intent": "query",
  "has_data": true,
  "row_count": 5,
  "dashboard_id": "uuid",
  "dashboard_name": "...",
  "chart_count": 3,
  "method": "template" | "custom",
  "template_id": "sales-overview"
}
```

### 4. Frontend (React TypeScript)

**Component:** `chat.tsx`

**Features:**
- Conversation list với scroll riêng
- Chat messages với scroll riêng
- Toggle hide/show sidebar
- Optimistic UI updates
- Error handling (hide technical errors)
- Metadata display (row count, dashboard links)

**State management:**
```typescript
conversations: Conversation[]
selectedConv: Conversation | null
message: string
busy: boolean
status: string
sidebarHidden: boolean
```

**CSS highlights:**
- Two-column layout (wide-left)
- Full-width mode khi sidebar hidden
- Max-height + scroll cho lists
- Responsive (mobile friendly)

## Quy trình sử dụng

### Tạo cuộc hội thoại mới

1. Chọn dataset từ danh sách
2. Click "Tạo mới"
3. Cuộc hội thoại được tạo với title mặc định

### Hỏi về dữ liệu

1. Nhập câu hỏi: "Giá trung bình là bao nhiêu?"
2. AI sinh SQL và execute
3. Nhận câu trả lời: "Giá trung bình: 28,450 VNĐ"

### Tạo dashboard

1. Nhập yêu cầu: "Tạo dashboard phân tích sản phẩm"
2. AI phân tích dataset:
   - Nếu khớp template → dùng template
   - Nếu không → tự tạo charts
3. Dashboard được tạo tự động
4. Click link để xem dashboard

### Context-aware queries

```
User: "Giá trung bình là bao nhiêu?"
AI: "Giá trung bình: 28,450 VNĐ"

User: "Còn giá cao nhất?"
AI: (hiểu "giá cao nhất" dựa vào context)
    "Giá cao nhất: 263,500 VNĐ"
```

## Ưu điểm

### So với cách truyền thống:

| Truyền thống | Chat AI |
|--------------|---------|
| Viết SQL thủ công | Hỏi bằng ngôn ngữ tự nhiên |
| Tạo từng chart thủ công | Tạo dashboard tự động |
| Phải biết cấu trúc database | Chỉ cần biết muốn gì |
| Mất nhiều thời gian | Nhanh chóng, tức thì |
| Cần kỹ năng technical | Ai cũng dùng được |

### Template vs Custom:

| Template | Custom |
|----------|--------|
| ✅ Layout chuẩn, đẹp | ⚠️ Layout tùy AI |
| ✅ Nhanh (predefined) | ⚠️ Chậm hơn (tạo từng chart) |
| ❌ Chỉ 3 templates | ✅ Vô hạn possibilities |
| ❌ Cần dataset phù hợp | ✅ Linh hoạt mọi dataset |

## Hạn chế & tương lai

### Hạn chế hiện tại:

1. **AI không hoàn hảo:**
   - Đôi khi hiểu sai câu hỏi
   - Có thể tạo SQL không tối ưu
   - Cần prompt engineering tốt

2. **Template hạn chế:**
   - Chỉ 3 templates
   - Cần thêm nhiều templates cho nhiều use cases

3. **Chart types:**
   - Chỉ bar, line, pie
   - Chưa có scatter, area, heatmap

4. **Filters:**
   - Chưa có auto-suggest filters
   - Chưa có cross-chart filtering

### Tương lai:

1. **Thêm chart types:**
   - Scatter plot
   - Area chart
   - Heatmap
   - Gauge, KPI cards

2. **Advanced features:**
   - Multi-dataset queries (JOIN)
   - Saved queries/reports
   - Scheduled reports
   - Export to PDF/Excel

3. **Collaboration:**
   - Share conversations
   - Comment on dashboards
   - Team workspaces

4. **AI improvements:**
   - Better context understanding
   - Learn from user feedback
   - Suggest next questions
   - Auto-detect anomalies

## Testing

### Test cases cơ bản:

**Query:**
```
1. "Giá trung bình là bao nhiêu?"
   → Expect: SQL với AVG(), trả về số

2. "Top 5 sản phẩm đắt nhất"
   → Expect: SQL với ORDER BY ... DESC LIMIT 5

3. "Sản phẩm có giá trên 50"
   → Expect: SQL với WHERE unit_price > 50
```

**Dashboard - Template:**
```
Dataset: order_date, amount, region, category
Question: "Tạo dashboard doanh thu"
Expected: useTemplate=true, templateId="sales-overview"
Result: Dashboard với 3 charts (line + bar + pie)
```

**Dashboard - Custom:**
```
Dataset: product_name, unit_price, units_in_stock, category
Question: "Dashboard phân tích sản phẩm"
Expected: useTemplate=false, 2-4 custom charts
Result: Dashboard với charts AI đề xuất
```

**Clarification:**
```
Dataset: id, value (chỉ 2 cột số)
Question: "Tạo dashboard"
Expected: intent="clarify"
Result: AI yêu cầu thêm cột
```

### Test edge cases:

1. Dataset không có cột TEXT → không tạo được pie/bar
2. Dataset không có cột DATE → không tạo được line chart
3. Câu hỏi mơ hồ → AI clarify
4. SQL phức tạp → test performance
5. Dataset rất lớn → test timeout

## Monitoring & Logs

### Backend logs:

```
=== SENDING TO AI ===
Columns metadata: 11 columns
  - product_name (TEXT)
  - unit_price (NUMERIC)
  ...

=== SQL FROM AI ===
Template: SELECT AVG(unit_price) AS avg_price FROM {{table}}
Actual SQL: SELECT AVG(unit_price) AS avg_price FROM products
Template: Giá trung bình: {{avg_price}}

=== RESULT ===
Rows: 1
Answer: Giá trung bình: 28,450

=== USING TEMPLATE ===
Template: sales-overview
Mapping: {date=order_date, revenue=amount, ...}

=== CREATING CUSTOM DASHBOARD ===
Dashboard name: Dashboard Phân Tích
Charts: 3
Creating chart: Giá trung bình theo danh mục
  Created chart: uuid
```

### Metrics cần theo dõi:

- Response time AI service
- SQL execution time
- Success rate (query vs clarify)
- Dashboard creation success rate
- Template vs custom ratio
- User engagement (messages per conversation)

## Kết luận

Chat AI là bước tiến lớn trong việc dân chủ hóa data analysis. Người dùng không cần biết SQL hay cách tạo biểu đồ, chỉ cần hỏi và AI sẽ lo.

**Key takeaways:**
- ✅ Natural language interface
- ✅ Auto SQL generation với safety
- ✅ Smart dashboard creation (template + custom)
- ✅ Context-aware conversations
- ✅ User-friendly error handling
- ✅ Graceful degradation

**Next steps:**
- Thêm chart types
- Cải thiện AI prompts
- Thêm templates
- Advanced filtering
- Collaboration features
