# AI Service - Chat AI cho BI POC

Service FastAPI sử dụng Gemini API để phân tích câu hỏi người dùng và trả về cấu hình truy vấn có cấu trúc.

## Yêu cầu

- Python 3.8+
- Gemini API Key (lấy tại https://aistudio.google.com/app/apikey)

## Cài đặt

1. Tạo môi trường ảo và cài đặt dependencies:

```bash
cd ai-service
python -m venv venv
venv\Scripts\activate  # Windows
# source venv/bin/activate  # Linux/Mac
pip install -r requirements.txt
```

2. Tạo file `.env` từ template:

```bash
copy .env.example .env  # Windows
# cp .env.example .env  # Linux/Mac
```

3. Mở `.env` và điền Gemini API Key:

```
GEMINI_API_KEY=your_actual_api_key_here
```

## Chạy service

```bash
python main.py
```

Service sẽ chạy tại http://127.0.0.1:8082

## API Endpoints

### `GET /`
Health check

### `POST /analyze`
Phân tích câu hỏi người dùng

**Request:**
```json
{
  "request_id": "uuid",
  "question": "Tổng doanh thu là bao nhiêu?",
  "dataset_name": "Doanh thu bán hàng",
  "columns": [
    {"name": "region", "type": "TEXT", "sample_values": ["Bắc", "Nam"]},
    {"name": "amount", "type": "NUMERIC", "sample_values": [100000, 200000]}
  ]
}
```

**Response:**
```json
{
  "request_id": "uuid",
  "intent": "query",
  "query_config": {
    "dimension": null,
    "metric": "amount",
    "aggregate": "sum",
    "chart_type": null
  },
  "explanation_template": "Tổng doanh thu là {{value}}"
}
```

## Tích hợp với Spring Boot

Backend Spring Boot gọi service này qua endpoint `/analyze`. URL cấu hình qua biến môi trường `POC_AI_SERVICE_URL` (mặc định http://127.0.0.1:8082).
