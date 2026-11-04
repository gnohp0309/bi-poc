"""
FastAPI service for AI-powered data analysis using Gemini.
Supports query generation and dashboard creation.
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


class ChartSpec(BaseModel):
    name: str
    chartType: str  # "bar", "line", "pie"
    dimension: str
    metric: str
    aggregate: str  # "sum", "avg", "count"
    timeGrain: Optional[str] = None  # "month" for date dimensions


class AnalyzeRequest(BaseModel):
    request_id: str
    dataset_name: str
    columns: List[ColumnMetadata]
    question: str
    conversation_history: Optional[List[Dict[str, str]]] = None
    conversation_summary: Optional[str] = None


class AnalyzeResponse(BaseModel):
    request_id: str
    intent: str  # "query", "clarify", "create_dashboard"
    sql: Optional[str] = None
    template: Optional[str] = None
    clarification: Optional[str] = None
    explanation: Optional[str] = None
    dashboard_name: Optional[str] = None
    useTemplate: Optional[bool] = None
    templateId: Optional[str] = None
    mapping: Optional[Dict[str, str]] = None
    charts: Optional[List[Dict[str, Any]]] = None


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
Bạn là AI phân tích dữ liệu. Phân tích câu hỏi và quyết định hành động.

**Dataset:** {request.dataset_name}

**Các cột:**
{columns_desc}
{context_section}

**Câu hỏi:** "{request.question}"

---

**CÁC INTENT:**

1. **query**: Trả lời câu hỏi bằng SQL query đơn giản
2. **create_dashboard**: Tạo dashboard với nhiều biểu đồ
3. **clarify**: Câu hỏi không rõ, cần làm rõ

---

**INTENT: query**

Dùng khi user hỏi về dữ liệu cụ thể, đơn giản.

VÍ DỤ: "Giá trung bình là bao nhiêu?", "Top 5 sản phẩm đắt nhất", "Tổng số đơn hàng"

**QUY TẮC SQL:**
- LUÔN LUÔN dùng `{{{{table}}}}` cho table name, KHÔNG BAO GIỜ dùng tên dataset
- SAI: `FROM Sản phẩm` hoặc `FROM products`
- ĐÚNG: `FROM {{{{table}}}}`

**VÍ DỤ:**

Câu hỏi: "Tổng số hàng tồn kho"
Output:
{{{{
  "intent": "query",
  "sql": "SELECT SUM(units_in_stock) AS total FROM {{{{table}}}}",
  "template": "Tổng hàng tồn kho: {{{{total}}}}",
  "explanation": "Tính tổng units_in_stock"
}}}}

Câu hỏi: "Giá trung bình là bao nhiêu"
Output:
{{{{
  "intent": "query",
  "sql": "SELECT AVG(unit_price) AS avg_price FROM {{{{table}}}}",
  "template": "Giá trung bình: {{{{avg_price}}}}",
  "explanation": "Tính giá trung bình"
}}}}

---

**INTENT: create_dashboard**

Dùng khi user yêu cầu: "tạo dashboard", "làm báo cáo", "phân tích tổng quan", "dashboard doanh thu", v.v.

**DASHBOARD TEMPLATES CÓ SẴN (ƯU TIÊN SỬ DỤNG NÊU DATASET ĐÁP ỨNG):**

1. **sales-overview** - Tổng quan doanh thu
   Yêu cầu: date (DATE), revenue (NUMBER), region (TEXT), category (TEXT)
   Charts: Doanh thu theo tháng (line), theo vùng (bar), theo danh mục (pie)

2. **product-analysis** - Phân tích sản phẩm
   Yêu cầu: product (TEXT), revenue (NUMBER), quantity (NUMBER), category (TEXT)
   Charts: Doanh thu theo sản phẩm (bar), số lượng (bar), tỷ trọng theo danh mục (pie)

3. **order-status** - Theo dõi đơn hàng
   Yêu cầu: date (DATE), revenue (NUMBER), status (TEXT)
   Charts: Số đơn theo trạng thái (pie), doanh thu theo trạng thái (bar), số đơn theo tháng (line)

**QUY TẮC CHỌN TEMPLATE:**
- Nếu dataset CÓ ĐỦ các cột phù hợp với 1 template → DÙNG TEMPLATE (trả useTemplate=true và templateId)
- Nếu dataset KHÔNG đủ hoặc không phù hợp → TỰ TẠO CHARTS (trả useTemplate=false)

**NHIỆM VỤ:**
1. Kiểm tra xem dataset có đáp ứng template nào không
2. Nếu có: dùng template với mapping phù hợp
3. Nếu không: tự đề xuất 2-4 charts hữu ích

**Chart specs cần:**
- name: tên chart
- chartType: "bar", "line", "pie"
- dimension: cột để nhóm (TEXT cho bar/pie, DATE cho line)
- metric: cột để tính toán (NUMBER cho sum/avg, "*" cho count)
- aggregate: "sum", "avg", "count"
- timeGrain: "month" (chỉ khi dimension là DATE và cần nhóm theo tháng)

**VÍ DỤ create_dashboard:**

Câu hỏi: "Tạo dashboard doanh thu"
Dataset có: order_date (DATE), amount (NUMBER), region (TEXT), category (TEXT)
Output:
{{{{
  "intent": "create_dashboard",
  "useTemplate": true,
  "templateId": "sales-overview",
  "dashboard_name": "Dashboard Doanh Thu",
  "mapping": {{{{
    "date": "order_date",
    "revenue": "amount",
    "region": "region",
    "category": "category"
  }}}},
  "explanation": "Dùng template sales-overview phù hợp với dataset"
}}}}

Câu hỏi: "Làm báo cáo phân tích sản phẩm"
Dataset có: product_name (TEXT), total_sales (NUMBER), units_sold (NUMBER), category (TEXT)
Output:
{{{{
  "intent": "create_dashboard",
  "useTemplate": true,
  "templateId": "product-analysis",
  "dashboard_name": "Báo Cáo Sản Phẩm",
  "mapping": {{{{
    "product": "product_name",
    "revenue": "total_sales",
    "quantity": "units_sold",
    "category": "category"
  }}}},
  "explanation": "Dùng template product-analysis"
}}}}

Câu hỏi: "Tạo dashboard phân tích sản phẩm"
Dataset có: product_name (TEXT), unit_price (NUMBER), units_in_stock (NUMBER), category (TEXT)
Output:
{{{{
  "intent": "create_dashboard",
  "useTemplate": false,
  "dashboard_name": "Dashboard Phân Tích Sản Phẩm",
  "charts": [
    {{{{
      "name": "Giá trung bình theo danh mục",
      "chartType": "bar",
      "dimension": "category",
      "metric": "unit_price",
      "aggregate": "avg"
    }}}},
    {{{{
      "name": "Tồn kho theo danh mục",
      "chartType": "bar",
      "dimension": "category",
      "metric": "units_in_stock",
      "aggregate": "sum"
    }}}},
    {{{{
      "name": "Phân bổ sản phẩm",
      "chartType": "pie",
      "dimension": "category",
      "metric": "*",
      "aggregate": "count"
    }}}}
  ],
  "explanation": "Dataset không có revenue/quantity riêng, tự tạo charts phù hợp"
}}}}

Câu hỏi: "Dashboard doanh thu theo thời gian"
Dataset có: sale_date (DATE), total_amount (NUMBER), store_location (TEXT)
Output:
{{{{
  "intent": "create_dashboard",
  "useTemplate": false,
  "dashboard_name": "Dashboard Doanh Thu",
  "charts": [
    {{{{
      "name": "Doanh thu theo tháng",
      "chartType": "line",
      "dimension": "sale_date",
      "metric": "total_amount",
      "aggregate": "sum",
      "timeGrain": "month"
    }}}},
    {{{{
      "name": "Doanh thu theo cửa hàng",
      "chartType": "bar",
      "dimension": "store_location",
      "metric": "total_amount",
      "aggregate": "sum"
    }}}},
    {{{{
      "name": "Phân bổ đơn hàng",
      "chartType": "pie",
      "dimension": "store_location",
      "metric": "*",
      "aggregate": "count"
    }}}}
  ],
  "explanation": "Dataset không có region/category chuẩn, tự tạo charts"
}}}}

Câu hỏi: "Tạo dashboard"
Dataset có: product_id (NUMBER), price (NUMBER)
Output:
{{{{
  "intent": "clarify",
  "clarification": "Dataset chỉ có 2 cột số (product_id, price). Để tạo dashboard hữu ích, cần thêm các cột như: tên sản phẩm, danh mục, ngày, hoặc vùng.",
  "explanation": null
}}}}

---

**INTENT: clarify**

Dùng khi câu hỏi không rõ hoặc dataset không đủ thông tin.

---

Chỉ trả JSON, không thêm text.
"""


@app.get("/")
def root():
    return {"status": "AI service running", "model": "gemini-3.5-flash-lite"}


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
            explanation=result.get("explanation"),
            dashboard_name=result.get("dashboard_name"),
            useTemplate=result.get("useTemplate"),
            templateId=result.get("templateId"),
            mapping=result.get("mapping"),
            charts=result.get("charts")
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
