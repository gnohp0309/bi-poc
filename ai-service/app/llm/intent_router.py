"""Module C: LLM Agent - Intent Routing & AI Insights Generation"""
import os
import json
from typing import Optional
from google import genai
from google.genai import types
from pydantic import ValidationError


class IntentRouter:
    """
    LLM Agent nhận diện ý định từ câu hỏi tiếng Việt.
    LLM KHÔNG tính toán số liệu - chỉ phân tích ý định và trích xuất tham số.
    """

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        """
        Khởi tạo Intent Router.

        Args:
            api_key: Gemini API key (lấy từ env nếu không truyền)
            model: Model name (mặc định từ env)
        """
        self.api_key = api_key or os.getenv("GEMINI_API_KEY", "")
        self.model = model or os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")

        if not self.api_key or self.api_key == "your_gemini_api_key_here":
            raise ValueError("Chưa cấu hình GEMINI_API_KEY")

    def parse_intent(self, question: str, available_columns: list[dict],
                    conversation_history: list[dict] = None) -> dict:
        """
        Phân tích ý định câu hỏi và trích xuất tham số.

        Args:
            question: Câu hỏi tiếng Việt từ người dùng
            available_columns: Metadata cột dataset [{"name": "...", "type": "...", "kind": "..."}]
            conversation_history: Lịch sử hội thoại (context)

        Returns:
            dict {
                "intent_type": "descriptive_stats" | "correlation" | "hypothesis_test" | ...,
                "confidence": 0.0-1.0,
                "extracted_parameters": {...},
                "missing_parameters": [...],
                "clarification_needed": bool
            }
        """
        prompt = self._build_intent_prompt(question, available_columns, conversation_history)

        with genai.Client(api_key=self.api_key, http_options=types.HttpOptions(
                timeout=30000, retry_options=types.HttpRetryOptions(attempts=1))) as client:
            response = client.interactions.create(
                model=self.model,
                input=prompt,
                timeout=30.0,
                automatic_continuation=False,
                generation_config={"max_output_tokens": 2048, "temperature": 0.1},
                response_format={"type": "text", "mime_type": "application/json"},
            )

        result = json.loads(response.output_text)
        return result

    def _build_intent_prompt(self, question: str, columns: list[dict],
                            history: Optional[list[dict]]) -> str:
        """Xây dựng prompt phân tích ý định"""

        columns_info = "\n".join([
            f"- {col['name']}: {col['type']} ({col['kind']})"
            for col in columns
        ])

        history_text = ""
        if history:
            history_text = "\nLịch sử hội thoại:\n" + "\n".join([
                f"{msg['role']}: {msg['content']}" for msg in history[-3:]  # 3 tin nhắn gần nhất
            ])

        prompt = f"""
Bạn là trợ lý phân tích dữ liệu thống kê. Nhiệm vụ: Phân tích câu hỏi tiếng Việt và xác định ý định người dùng.

CÁC LOẠI Ý ĐỊNH HỖ TRỢ:
1. descriptive_stats: Thống kê mô tả (trung bình, median, độ lệch chuẩn, phân phối)
2. correlation: Phân tích tương quan giữa các biến
3. outlier_detection: Phát hiện giá trị bất thường
4. hypothesis_test: Kiểm định giả thuyết (so sánh nhóm, kiểm định phân phối)
   - Các phương pháp: shapiro_wilk, independent_ttest, paired_ttest, anova, chi_square, mann_whitney, kruskal_wallis
5. create_dashboard: Tạo dashboard/biểu đồ
6. clarify: Cần làm rõ câu hỏi (thiếu thông tin, mơ hồ)

METADATA CỘT DATASET:
{columns_info}
{history_text}

CÂU HỎI: {question}

YÊU CẦU PHÂN TÍCH:
1. Xác định intent_type chính xác (1 trong 6 loại trên)
2. Trích xuất extracted_parameters dựa trên intent:
   - descriptive_stats: {{"columns": ["tên_cột1", "tên_cột2"]}}
   - correlation: {{"columns": ["cột1", "cột2", ...], "method": "pearson" hoặc "spearman"}}
   - outlier_detection: {{"column": "tên_cột", "method": "iqr" hoặc "zscore"}}
   - hypothesis_test: {{"test_type": "...", "value_column": "...", "group_column": "...", ...}}
     + independent_ttest/mann_whitney: value_column (số), group_column (2 nhóm)
     + paired_ttest: column_before, column_after
     + anova/kruskal_wallis: value_column (số), group_column (3+ nhóm)
     + chi_square: column1, column2 (cả 2 đều categorical)
     + shapiro_wilk: column (kiểm tra phân phối chuẩn)
   - create_dashboard: {{"chart_types": ["bar", "line", ...], "dimensions": [...], "metrics": [...]}}
3. Liệt kê missing_parameters nếu thiếu thông tin quan trọng
4. confidence: 0.0-1.0 (độ tin cậy nhận diện ý định)
5. clarification_needed: true nếu câu hỏi mơ hồ hoặc thiếu tham số bắt buộc

QUY TẮC QUAN TRỌNG:
- CHỈ dùng tên cột có trong metadata, KHÔNG tự bịa tên cột
- Nếu câu hỏi nhắc đến "so sánh 2 nhóm" → independent_ttest hoặc mann_whitney
- Nếu "so sánh 3+ nhóm" → anova hoặc kruskal_wallis
- Nếu "trước/sau" hoặc "paired" → paired_ttest
- Nếu "tương quan" hoặc "liên hệ giữa biến số" → correlation
- Nếu "outlier" hoặc "bất thường" → outlier_detection
- Nếu không rõ cột nào → clarification_needed = true
- Nếu yêu cầu "biểu đồ" hoặc "dashboard" → create_dashboard

ĐỊNH DẠNG OUTPUT (JSON):
{{
  "intent_type": "...",
  "confidence": 0.95,
  "extracted_parameters": {{...}},
  "missing_parameters": ["tham_số_thiếu"],
  "clarification_needed": false,
  "suggested_question": "Câu hỏi gợi ý nếu cần làm rõ (tiếng Việt)"
}}

Phân tích câu hỏi trên và trả về JSON theo đúng format.
"""
        return prompt


class AIInsightsGenerator:
    """
    Sinh AI Insights từ kết quả phân tích thống kê.
    LLM CHỈ diễn giải kết quả đã tính - KHÔNG tự tính toán.
    """

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        self.api_key = api_key or os.getenv("GEMINI_API_KEY", "")
        self.model = model or os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")

        if not self.api_key or self.api_key == "your_gemini_api_key_here":
            raise ValueError("Chưa cấu hình GEMINI_API_KEY")

    def generate_insights(self, analysis_type: str, analysis_result: dict,
                         context: Optional[str] = None) -> dict:
        """
        Sinh nhận định xu hướng/bất thường từ kết quả Statistical Engine.

        Args:
            analysis_type: Loại phân tích (descriptive, hypothesis_test, correlation, outlier)
            analysis_result: Kết quả từ Statistical Engine (đã tính sẵn)
            context: Ngữ cảnh nghiệp vụ (tùy chọn)

        Returns:
            dict {
                "insights": "Nhận định chính bằng tiếng Việt",
                "key_findings": ["Phát hiện 1", "Phát hiện 2", ...],
                "recommendations": ["Gợi ý hành động 1", ...]
            }
        """
        prompt = self._build_insights_prompt(analysis_type, analysis_result, context)

        with genai.Client(api_key=self.api_key, http_options=types.HttpOptions(
                timeout=30000, retry_options=types.HttpRetryOptions(attempts=1))) as client:
            response = client.interactions.create(
                model=self.model,
                input=prompt,
                timeout=30.0,
                automatic_continuation=False,
                generation_config={"max_output_tokens": 1024, "temperature": 0.3},
                response_format={"type": "text", "mime_type": "application/json"},
            )

        result = json.loads(response.output_text)
        return result

    def _build_insights_prompt(self, analysis_type: str, result: dict,
                               context: Optional[str]) -> str:
        """Xây dựng prompt sinh insights"""

        context_text = f"\nNgữ cảnh nghiệp vụ: {context}" if context else ""

        prompt = f"""
Bạn là chuyên gia phân tích dữ liệu. Nhiệm vụ: Diễn giải kết quả phân tích thống kê thành ngôn ngữ dễ hiểu.

LOẠI PHÂN TÍCH: {analysis_type}

KẾT QUẢ TÍNH TOÁN (ĐÃ ĐƯỢC STATISTICAL ENGINE TÍNH CHÍNH XÁC):
{json.dumps(result, indent=2, ensure_ascii=False)}
{context_text}

YÊU CẦU:
1. Viết nhận định chính (insights) bằng tiếng Việt, ngắn gọn, dễ hiểu
2. Liệt kê các phát hiện quan trọng (key_findings): 2-4 điểm
3. Đưa ra gợi ý hành động (recommendations) nếu phù hợp

QUY TẮC QUAN TRỌNG:
- KHÔNG tự tính toán lại số liệu, chỉ diễn giải kết quả đã có
- KHÔNG thay đổi giá trị statistic, p-value, effect size
- Sử dụng thuật ngữ thống kê chính xác nhưng giải thích đơn giản
- Tập trung vào ý nghĩa thực tiễn, không chỉ nói kỹ thuật
- Nếu p-value < 0.05: nhấn mạnh "có ý nghĩa thống kê"
- Nếu p-value >= 0.05: "không có đủ bằng chứng"
- Đề cập effect size để đánh giá tầm quan trọng thực tế

ĐỊNH DẠNG OUTPUT (JSON):
{{
  "insights": "Nhận định tổng quan 2-3 câu, tiếng Việt",
  "key_findings": [
    "Phát hiện 1: ...",
    "Phát hiện 2: ..."
  ],
  "recommendations": [
    "Gợi ý 1: ...",
    "Gợi ý 2: ..."
  ]
}}

Tạo insights từ kết quả trên và trả về JSON.
"""
        return prompt


class ChartRecommender:
    """Gợi ý loại biểu đồ và dashboard template phù hợp"""

    CHART_RULES = {
        "line": {
            "conditions": ["có cột date/time", "xem xu hướng theo thời gian"],
            "description": "Biểu đồ đường - phù hợp cho xu hướng thời gian"
        },
        "bar": {
            "conditions": ["so sánh giữa các nhóm", "có cột categorical"],
            "description": "Biểu đồ cột - phù hợp để so sánh"
        },
        "pie": {
            "conditions": ["xem tỷ trọng", "phân bố phần trăm"],
            "description": "Biểu đồ tròn - hiển thị tỷ trọng"
        },
        "histogram": {
            "conditions": ["xem phân phối dữ liệu", "tần suất"],
            "description": "Histogram - phân phối một biến số"
        },
        "scatter": {
            "conditions": ["tương quan 2 biến số", "mối quan hệ"],
            "description": "Biểu đồ phân tán - tương quan 2 biến"
        },
        "heatmap": {
            "conditions": ["ma trận tương quan", "nhiều biến"],
            "description": "Heatmap - ma trận tương quan"
        }
    }

    DASHBOARD_TEMPLATES = {
        "sales-overview": {
            "name": "Tổng quan Doanh thu",
            "required_columns": ["date", "revenue", "region", "category"],
            "column_types": {
                "date": "date",
                "revenue": "number",
                "region": "text",
                "category": "text"
            },
            "charts": ["line", "bar", "pie", "kpi_card"]
        },
        "product-analysis": {
            "name": "Phân tích Sản phẩm",
            "required_columns": ["product", "revenue", "quantity", "category"],
            "column_types": {
                "product": "text",
                "revenue": "number",
                "quantity": "number",
                "category": "text"
            },
            "charts": ["bar", "scatter", "pie"]
        },
        "order-status": {
            "name": "Trạng thái Đơn hàng",
            "required_columns": ["date", "revenue", "status"],
            "column_types": {
                "date": "date",
                "revenue": "number",
                "status": "text"
            },
            "charts": ["line", "stacked_bar", "kpi_card"]
        }
    }

    @staticmethod
    def recommend_chart(intent: str, columns: list[dict],
                       extracted_params: dict) -> list[dict]:
        """
        Gợi ý loại biểu đồ dựa trên ý định và cột dữ liệu.

        Args:
            intent: Loại ý định (correlation, descriptive_stats, v.v.)
            columns: Metadata cột
            extracted_params: Tham số trích xuất

        Returns:
            List các gợi ý biểu đồ
        """
        recommendations = []

        # Tìm kiểu dữ liệu cột
        col_types = {col["name"]: col["kind"] for col in columns}

        # Logic gợi ý theo intent
        if intent == "correlation":
            if len(extracted_params.get("columns", [])) == 2:
                recommendations.append({
                    "chart_type": "scatter",
                    "reason": "Biểu đồ phân tán hiển thị tương quan giữa 2 biến số",
                    "dimension_column": extracted_params["columns"][0],
                    "metric_column": extracted_params["columns"][1]
                })
            else:
                recommendations.append({
                    "chart_type": "heatmap",
                    "reason": "Heatmap hiển thị ma trận tương quan nhiều biến",
                    "additional_config": {"columns": extracted_params.get("columns", [])}
                })

        elif intent == "descriptive_stats":
            target_cols = extracted_params.get("columns", [])
            # Gợi ý histogram cho phân phối
            for col in target_cols:
                if col_types.get(col) == "number":
                    recommendations.append({
                        "chart_type": "histogram",
                        "reason": f"Histogram hiển thị phân phối của '{col}'",
                        "dimension_column": col,
                        "metric_column": None
                    })

        elif intent == "hypothesis_test":
            test_type = extracted_params.get("test_type")
            if test_type in ["independent_ttest", "mann_whitney", "anova", "kruskal_wallis"]:
                recommendations.append({
                    "chart_type": "bar",
                    "reason": "Biểu đồ cột so sánh trung bình/median giữa các nhóm",
                    "dimension_column": extracted_params.get("group_column"),
                    "metric_column": extracted_params.get("value_column")
                })

        elif intent == "outlier_detection":
            recommendations.append({
                "chart_type": "scatter",
                "reason": "Biểu đồ phân tán làm nổi bật các outliers",
                "dimension_column": "index",
                "metric_column": extracted_params.get("column")
            })

        return recommendations

    @staticmethod
    def match_dashboard_template(columns: list[dict]) -> Optional[dict]:
        """
        Tìm template dashboard phù hợp nhất với cột hiện có.

        Args:
            columns: Metadata cột dataset

        Returns:
            dict template match hoặc None
        """
        col_dict = {col["name"].lower(): col for col in columns}

        best_match = None
        best_score = 0

        for template_id, template in ChartRecommender.DASHBOARD_TEMPLATES.items():
            score = 0
            mapping = {}

            # Kiểm tra từng cột bắt buộc
            for role, required_type in template["column_types"].items():
                # Tìm cột phù hợp theo tên và kiểu
                for col_name, col_meta in col_dict.items():
                    if role in col_name or col_name in role:
                        if col_meta["kind"] == required_type:
                            mapping[role] = col_meta["name"]
                            score += 1
                            break

            # Nếu đủ cột bắt buộc
            if score >= len(template["required_columns"]) * 0.75:  # 75% match
                if score > best_score:
                    best_score = score
                    best_match = {
                        "template_id": template_id,
                        "template_name": template["name"],
                        "column_mapping": mapping,
                        "recommended_charts": [
                            {"chart_type": ct, "reason": f"Phù hợp với template {template['name']}"}
                            for ct in template["charts"]
                        ],
                        "match_score": score / len(template["required_columns"])
                    }

        return best_match
