# FastAPI Statistical Engine & Chat AI Service

Service Python FastAPI cho phân tích thống kê chính xác và Chat AI thông minh, hỗ trợ POC tính năng "Khám phá dữ liệu" cho ứng dụng BI.

## 🎯 Mục tiêu

1. **Phân tách trách nhiệm tuyệt đối:** LLM KHÔNG BAO GIỜ tự tính toán số liệu thống kê. LLM CHỈ dùng để hiểu ý định, trích xuất tham số và diễn giải kết quả.
2. **Tính toán chính xác 100%:** Tất cả phép tính được xử lý bởi Statistical Engine dựa trên scipy, statsmodels, pandas, numpy, pingouin.
3. **Đa ngôn ngữ:** Toàn bộ kết luận, giải thích, phản hồi Chat đều bằng **tiếng Việt**.

## 🏗️ Kiến trúc Hệ thống

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│  Frontend (UI)  │ ───> │ Spring Boot API  │ ───> │ FastAPI Service │
│   (Thành)       │      │  (Backend - 't') │      │   (Tú - Python) │
└─────────────────┘      └──────────────────┘      └─────────────────┘
                                                            │
                                  ┌─────────────────────────┴─────────────────────────┐
                                  │                                                   │
                         ┌────────▼────────┐                              ┌──────────▼────────┐
                         │ Statistical     │                              │  Chat AI &        │
                         │ Engine          │                              │  Intent Routing   │
                         │ (scipy, numpy)  │                              │  (Gemini LLM)     │
                         └─────────────────┘                              └───────────────────┘
```

## 📦 Modules

### Module A: Thống kê Mô tả, Tương quan & Outlier
- **Thống kê mô tả:** mean, median, mode, std, variance, quartiles, skewness, kurtosis
- **Tương quan:** Pearson, Spearman correlation matrix
- **Phát hiện Outlier:** IQR method, Z-score method

### Module B: Kiểm định Giả thuyết (Hypothesis Testing)
- **Shapiro-Wilk:** Kiểm định phân phối chuẩn
- **Independent T-Test:** So sánh trung bình 2 nhóm độc lập
- **Paired T-Test:** So sánh trước/sau
- **ANOVA:** So sánh 3+ nhóm (tham số)
- **Chi-Square:** Kiểm định mối liên hệ biến phân loại
- **Mann-Whitney U:** So sánh 2 nhóm (phi tham số)
- **Kruskal-Wallis:** So sánh 3+ nhóm (phi tham số)

### Module C: Chat AI & Dashboard Routing
- **Intent Recognition:** Nhận diện ý định câu hỏi tiếng Việt
- **AI Insights:** Diễn giải kết quả thống kê thành ngôn ngữ dễ hiểu
- **Chart Recommendations:** Gợi ý loại biểu đồ phù hợp
- **Dashboard Template Mapping:** Ánh xạ cột vào template có sẵn

## 🚀 Cài đặt & Chạy

### Yêu cầu
- Python 3.12+
- Gemini API Key (lấy tại https://aistudio.google.com/app/apikey)

### Cài đặt

```powershell
# 1. Clone repository (nếu chưa có)
cd D:\Code\bi-poc\ai-service

# 2. Tạo virtual environment
python -m venv venv

# 3. Kích hoạt virtual environment
.\venv\Scripts\Activate.ps1

# 4. Cài đặt dependencies
pip install -r requirements.txt

# 5. Cấu hình môi trường
Copy-Item .env.example .env
# Sửa file .env: Điền GEMINI_API_KEY của bạn
```

### Chạy Service

**Option 1: Chạy service**
```powershell
python main.py
```

**Option 2: Dùng script tự động**
```powershell
.\start-ai-service.ps1
```

Service sẽ chạy tại: http://127.0.0.1:8082

- **API Documentation:** http://127.0.0.1:8082/docs
- **ReDoc:** http://127.0.0.1:8082/redoc
- **Health Check:** http://127.0.0.1:8082/health

## 🧪 Chạy Tests

```powershell
# Cài đặt test dependencies
pip install -r requirements-test.txt

# Chạy tất cả tests
python -m unittest discover -s app/tests -p "test_*.py" -v

# Chạy test cụ thể
python -m unittest app.tests.test_hypothesis -v
python -m unittest app.tests.test_descriptive -v
```

## 📚 API Endpoints

### Module A: Statistical Analysis

#### POST `/api/stats/descriptive`
Tính thống kê mô tả cho các cột số.

**Request:**
```json
{
  "dataset_id": "sample_sales",
  "columns": ["revenue", "quantity", "price"]
}
```

**Response:**
```json
{
  "dataset_id": "sample_sales",
  "stats": [
    {
      "column": "revenue",
      "count": 100,
      "missing": 0,
      "mean": 10000.5,
      "median": 9800.2,
      "std": 2000.3,
      "min": 5000.0,
      "max": 15000.0,
      "q1": 8000.0,
      "q3": 12000.0,
      "skewness": 0.23,
      "kurtosis": -0.45
    }
  ],
  "natural_language_summary": "Cột 'revenue' có 100 giá trị hợp lệ..."
}
```

#### POST `/api/stats/correlation`
Tính ma trận tương quan.

#### POST `/api/stats/outlier`
Phát hiện outliers.

### Module B: Hypothesis Testing

#### POST `/api/hypothesis/shapiro-wilk`
Kiểm định phân phối chuẩn.

#### POST `/api/hypothesis/independent-ttest`
So sánh 2 nhóm độc lập.

**Request:**
```json
{
  "dataset_id": "sample_sales",
  "test_type": "independent_ttest",
  "value_column": "revenue",
  "group_column": "region",
  "alpha": 0.05
}
```

**Response:**
```json
{
  "dataset_id": "sample_sales",
  "method_name": "Independent T-Test",
  "null_hypothesis": "Trung bình của 2 nhóm bằng nhau (μ1 = μ2)",
  "alt_hypothesis": "Trung bình của 2 nhóm khác nhau (μ1 ≠ μ2)",
  "assumptions_met": true,
  "statistic": -2.456,
  "p_value": 0.023,
  "effect_size": 0.65,
  "effect_size_interpretation": "trung bình",
  "conclusion": "reject_h0",
  "natural_language_conclusion": "Với mức ý nghĩa 0.05, p-value = 0.023 < 0.05..."
}
```

#### POST `/api/hypothesis/anova`
So sánh 3+ nhóm.

#### POST `/api/hypothesis/chi-square`
Kiểm định biến phân loại.

#### POST `/api/hypothesis/mann-whitney`
So sánh 2 nhóm phi tham số.

### Module C: Chat AI

#### POST `/api/chat/ask`
Hỏi đáp thông minh với Chat AI.

**Request:**
```json
{
  "dataset_id": "sample_sales",
  "question": "Doanh thu chi nhánh A và B có khác nhau không?",
  "available_columns": [
    {"name": "revenue", "type": "float64", "kind": "number"},
    {"name": "region", "type": "object", "kind": "text"}
  ]
}
```

**Response:**
```json
{
  "intent": {
    "intent_type": "hypothesis_test",
    "confidence": 0.95,
    "extracted_parameters": {
      "test_type": "independent_ttest",
      "value_column": "revenue",
      "group_column": "region"
    },
    "missing_parameters": []
  },
  "ai_response": "Tôi sẽ thực hiện kiểm định independent_ttest.",
  "suggested_action": {
    "endpoint": "/api/hypothesis/independent-ttest",
    "method": "POST",
    "parameters": {...}
  }
}
```

#### POST `/api/chat/insights`
Sinh AI Insights từ kết quả phân tích.

## 🎨 Ví dụ Workflow

```python
import requests

base_url = "http://127.0.0.1:8082"

# 1. Hỏi Chat AI
chat_response = requests.post(f"{base_url}/api/chat/ask", json={
    "dataset_id": "sample_sales",
    "question": "So sánh doanh thu giữa khu vực Bắc và Nam",
    "available_columns": [...]
})

intent = chat_response.json()
suggested_endpoint = intent["suggested_action"]["endpoint"]
params = intent["suggested_action"]["parameters"]

# 2. Gọi Statistical Engine theo gợi ý
stats_response = requests.post(f"{base_url}{suggested_endpoint}", json=params)
result = stats_response.json()

print(result["natural_language_conclusion"])
# "Với mức ý nghĩa 0.05, p-value = 0.023 < 0.05, chúng ta bác bỏ giả thuyết H0..."

# 3. Sinh AI Insights
insights_response = requests.post(f"{base_url}/api/chat/insights", json={
    "analysis_type": "hypothesis_test",
    "analysis_result": result,
    "context": "So sánh doanh thu khu vực"
})

insights = insights_response.json()
print(insights["insights"])
print(insights["key_findings"])
```

## 🔧 Cấu trúc Thư mục

```
ai-service/
├── app/
│   ├── engine/           # Statistical Engine core
│   │   ├── descriptive.py    # Thống kê mô tả, tương quan, outlier
│   │   └── hypothesis.py     # Kiểm định giả thuyết
│   ├── llm/              # LLM Agent modules
│   │   └── intent_router.py  # Intent routing, insights, chart recommender
│   ├── routers/          # FastAPI routers
│   │   ├── stats_router.py
│   │   ├── hypothesis_router.py
│   │   └── chat_router.py
│   ├── schemas/          # Pydantic schemas
│   │   └── statistical.py
│   ├── utils/            # Utilities
│   │   └── data_loader.py
│   └── tests/            # Unit tests
│       ├── test_descriptive.py
│       └── test_hypothesis.py
├── sample_data/          # Sample CSV files for testing
├── main.py               # Main service
├── requirements.txt      # Dependencies
└── .env                  # Configuration
```

## 📖 Nguyên tắc Kỹ thuật

1. **LLM KHÔNG BAO GIỜ tự tính toán.** LLM chỉ:
   - Hiểu ý định câu hỏi
   - Trích xuất tham số
   - Diễn giải kết quả thành tiếng Việt
   
2. **Statistical Engine đảm bảo chính xác tuyệt đối:**
   - Sử dụng scipy, numpy, pandas, statsmodels
   - Có unit tests đối chiếu với các thư viện chuẩn
   
3. **Kiểm tra giả định trước khi tính:**
   - Cỡ mẫu đủ lớn
   - Phân phối dữ liệu
   - Xử lý dữ liệu thiếu

## 🤝 Tích hợp với Spring Boot

FastAPI service này được thiết kế để tích hợp với Spring Boot backend:

1. Spring Boot cung cấp dataset qua API endpoint
2. FastAPI nhận `dataset_id`, load dữ liệu và thực hiện phân tích
3. Kết quả trả về dạng JSON chuẩn cho Frontend hiển thị
