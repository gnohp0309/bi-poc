"""
FastAPI service for AI-powered data analysis using Gemini.
New approach: AI generates complete SQL instead of config.
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import google.generativeai as genai
import os
import json
from dotenv import load_dotenv

# Load .env file
load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure Gemini
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY environment variable not set")

genai.configure(api_key=GEMINI_API_KEY)

# Models
class ColumnMetadata(BaseModel):
    name: str
    type: str
    sample_values: Optional[List[Any]] = None
    friendly_name: Optional[str] = None


class AnalyzeRequest(BaseModel):
    request_id: str
    dataset_name: str
    columns: List[ColumnMetadata]
    question: str
    conversation_history: Optional[List[Dict[str, str]]] = None
    conversation_summary: Optional[str] = None


class AnalyzeResponse(BaseModel):
    request_id: str
    intent: str  # "query", "clarify"
    sql: Optional[str] = None  # Complete SQL with {{table}} placeholder
    template: Optional[str] = None  # Template with {{column}} placeholders
    clarification: Optional[str] = None
    explanation: Optional[str] = None


def build_prompt(request: AnalyzeRequest) -> str:
    """Build prompt for Gemini."""
    columns_desc = ""
    for col in request.columns:
        columns_desc += f"- {col.name} ({col.type})"
        if col.friendly_name:
            columns_desc += f" → '{col.friendly_name}'"
        if col.sample_values:
            columns_desc += f" | Ví dụ: {col.sample_values[:3]}"
        columns_desc += "\n"

    context_section = ""
    if request.conversation_summary:
        context_section = f"\n📋 Context: {request.conversation_summary}\n"

    if request.conversation_history:
        context_section += "\nLịch sử gần đây:\n"
        for msg in request.conversation_history[-3:]:
            role = "User" if msg["role"] == "user" else "AI"
            content = msg["content"][:80]
            context_section += f"  {role}: {content}\n"

    return f"""
Bạn là AI phân tích dữ liệu. Tạo SQL query để trả lời câu hỏi của user.

**Dataset:** {request.dataset_name}

**Các cột:**
{columns_desc}
{context_section}

**Câu hỏi:** "{request.question}"

---

**NHIỆM VỤ:**

1. Phân tích câu hỏi
2. Viết SQL query hoàn chỉnh với `{{{{table}}}}` thay cho table name
3. Tạo template để format output

**QUY TẮC SQL:**
- Dùng `{{{{table}}}}` thay vì tên table thực
- Alias các cột với lowercase + underscore: price_avg, total_count, revenue_sum
- Có thể dùng: JOIN, subquery, CTE, window functions, CASE WHEN, aggregate functions
- Alias phải rõ nghĩa và nhất quán

**QUY TẮC TEMPLATE:**
- Template format cho MỖI ROW (không phải toàn bộ kết quả)
- Dùng {{{{alias}}}} để reference cột trong SQL
- Alias trong template = alias trong SQL (khớp chính xác, case-insensitive)
- VD: SQL có `AVG(price) AS price_avg` → Template dùng `{{{{price_avg}}}}`

**VÍ DỤ:**

Câu hỏi: "Giá trung bình theo danh mục"
Output:
{{{{
  "intent": "query",
  "sql": "SELECT category_id, AVG(unit_price) AS price_avg FROM {{{{table}}}} GROUP BY category_id ORDER BY category_id",
  "template": "Danh mục {{{{category_id}}}}: {{{{price_avg}}}}",
  "explanation": "Giá trung bình của sản phẩm trong từng danh mục"
}}}}

Câu hỏi: "Có bao nhiêu sản phẩm"
Output:
{{{{
  "intent": "query",
  "sql": "SELECT COUNT(*) AS total_count FROM {{{{table}}}}",
  "template": "Tổng số sản phẩm: {{{{total_count}}}}",
  "explanation": "Đếm tổng số sản phẩm"
}}}}

Câu hỏi: "Tổng doanh thu nếu bán hết hàng tồn"
Output:
{{{{
  "intent": "query",
  "sql": "SELECT SUM(unit_price * units_in_stock) AS total_revenue FROM {{{{table}}}}",
  "template": "Doanh thu dự tính: {{{{total_revenue}}}} VNĐ",
  "explanation": "Tính tổng doanh thu nếu bán hết toàn bộ hàng tồn kho"
}}}}

Câu hỏi: "Top 5 sản phẩm đắt nhất"
Output:
{{{{
  "intent": "query",
  "sql": "SELECT product_name, unit_price FROM {{{{table}}}} ORDER BY unit_price DESC LIMIT 5",
  "template": "{{{{product_name}}}}: {{{{unit_price}}}} VNĐ",
  "explanation": "5 sản phẩm có giá cao nhất"
}}}}

---

**Nếu câu hỏi không rõ ràng:**
{{{{
  "intent": "clarify",
  "clarification": "Bạn muốn...",
  "explanation": null
}}}}

Chỉ trả JSON, không thêm text.
"""


@app.get("/")
def root():
    return {"status": "AI service v2 running", "model": "gemini-3.5-flash-lite"}


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(request: AnalyzeRequest):
    try:
        prompt = build_prompt(request)

        model = genai.GenerativeModel('gemini-3.5-flash-lite')

        response = model.generate_content(
            prompt,
            generation_config=genai.types.GenerationConfig(
                temperature=0.1,
                max_output_tokens=2048,
            )
        )

        response_text = response.text.strip()

        # Remove markdown code blocks if present
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]

        response_text = response_text.strip()

        result = json.loads(response_text)

        return AnalyzeResponse(
            request_id=request.request_id,
            intent=result.get("intent", "clarify"),
            sql=result.get("sql"),
            template=result.get("template"),
            clarification=result.get("clarification"),
            explanation=result.get("explanation")
        )

    except json.JSONDecodeError as e:
        print(f"JSON DECODE ERROR: {e}")
        print(f"Response was: {response_text}")
        raise HTTPException(status_code=500, detail=f"Failed to parse AI response: {str(e)}")
    except Exception as e:
        print(f"EXCEPTION: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
