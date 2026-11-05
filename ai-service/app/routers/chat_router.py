"""API Router cho Chat AI - Intent Routing & AI Insights"""
from fastapi import APIRouter, HTTPException
from typing import Optional

from app.schemas.statistical import (
    ChatRequest, ChatResponse, IntentResult,
    AIInsightRequest, AIInsightResponse,
    ChartRecommendation, DashboardMapping
)
from app.llm.intent_router import IntentRouter, AIInsightsGenerator, ChartRecommender

router = APIRouter(prefix="/api/chat", tags=["Chat AI"])


@router.post("/ask", response_model=ChatResponse,
             response_model_exclude_none=True,
             summary="Hỏi đáp thông minh với Chat AI",
             description="Phân tích câu hỏi tiếng Việt, nhận diện ý định và đề xuất hành động")
async def chat_ask(request: ChatRequest):
    """
    Chat AI thông minh - Hiểu ý định câu hỏi và gợi ý hành động phù hợp.

    **Ví dụ câu hỏi:**
    - "Tính trung bình doanh thu"
    - "So sánh doanh thu giữa chi nhánh A và B"
    - "Có outlier nào trong cột giá không?"
    - "Tạo dashboard tổng quan doanh thu"

    **Response chứa:**
    - Ý định người dùng (intent_type, confidence)
    - Tham số trích xuất từ câu hỏi
    - Câu hỏi làm rõ nếu thiếu thông tin
    - Gợi ý API endpoint và parameters
    - Gợi ý biểu đồ/dashboard
    """
    try:
        # Khởi tạo Intent Router
        router_agent = IntentRouter()

        # Phân tích ý định
        intent_result = router_agent.parse_intent(
            question=request.question,
            available_columns=request.available_columns,
            conversation_history=[msg.model_dump() for msg in request.conversation_history]
        )

        # Tạo IntentResult
        intent = IntentResult(
            intent_type=intent_result["intent_type"],
            confidence=intent_result["confidence"],
            extracted_parameters=intent_result["extracted_parameters"],
            missing_parameters=intent_result.get("missing_parameters", [])
        )

        # Xây dựng phản hồi
        ai_response = ""
        clarification_question = None
        suggested_action = None
        dashboard_recommendation = None

        # Nếu cần làm rõ
        if intent_result.get("clarification_needed", False):
            clarification_question = intent_result.get("suggested_question",
                "Bạn có thể cung cấp thêm thông tin về cột dữ liệu và loại phân tích bạn muốn?")
            ai_response = f"Tôi cần thêm thông tin để trả lời chính xác. {clarification_question}"

        # Nếu ý định rõ ràng
        else:
            if intent.intent_type == "descriptive_stats":
                columns = intent.extracted_parameters.get("columns", [])
                ai_response = f"Tôi sẽ tính thống kê mô tả cho các cột: {', '.join(columns)}."
                suggested_action = {
                    "endpoint": "/api/stats/descriptive",
                    "method": "POST",
                    "parameters": {
                        "dataset_id": request.dataset_id,
                        "columns": columns
                    }
                }

            elif intent.intent_type == "correlation":
                columns = intent.extracted_parameters.get("columns", [])
                method = intent.extracted_parameters.get("method", "pearson")
                ai_response = f"Tôi sẽ phân tích tương quan {method} giữa các cột: {', '.join(columns)}."
                suggested_action = {
                    "endpoint": "/api/stats/correlation",
                    "method": "POST",
                    "parameters": {
                        "dataset_id": request.dataset_id,
                        "columns": columns,
                        "method": method
                    }
                }

            elif intent.intent_type == "outlier_detection":
                column = intent.extracted_parameters.get("column")
                method = intent.extracted_parameters.get("method", "iqr")
                ai_response = f"Tôi sẽ phát hiện outlier trong cột '{column}' bằng phương pháp {method.upper()}."
                suggested_action = {
                    "endpoint": "/api/stats/outlier",
                    "method": "POST",
                    "parameters": {
                        "dataset_id": request.dataset_id,
                        "column": column,
                        "method": method
                    }
                }

            elif intent.intent_type == "hypothesis_test":
                test_type = intent.extracted_parameters.get("test_type")
                ai_response = f"Tôi sẽ thực hiện kiểm định {test_type}."

                # Map test type to endpoint
                endpoint_map = {
                    "shapiro_wilk": "/api/hypothesis/shapiro-wilk",
                    "independent_ttest": "/api/hypothesis/independent-ttest",
                    "paired_ttest": "/api/hypothesis/paired-ttest",
                    "anova": "/api/hypothesis/anova",
                    "chi_square": "/api/hypothesis/chi-square",
                    "mann_whitney": "/api/hypothesis/mann-whitney",
                    "kruskal_wallis": "/api/hypothesis/kruskal-wallis"
                }

                suggested_action = {
                    "endpoint": endpoint_map.get(test_type, "/api/hypothesis/independent-ttest"),
                    "method": "POST",
                    "parameters": {
                        "dataset_id": request.dataset_id,
                        "test_type": test_type,
                        **intent.extracted_parameters
                    }
                }

            elif intent.intent_type == "create_dashboard":
                # Gợi ý dashboard template
                template_match = ChartRecommender.match_dashboard_template(request.available_columns)

                if template_match:
                    dashboard_recommendation = DashboardMapping(
                        template_id=template_match["template_id"],
                        template_name=template_match["template_name"],
                        column_mapping=template_match["column_mapping"],
                        recommended_charts=[
                            ChartRecommendation(**chart)
                            for chart in template_match["recommended_charts"]
                        ]
                    )
                    ai_response = f"Tôi gợi ý sử dụng template '{template_match['template_name']}' với ánh xạ cột phù hợp."
                else:
                    # Gợi ý biểu đồ custom
                    chart_suggestions = ChartRecommender.recommend_chart(
                        intent.intent_type,
                        request.available_columns,
                        intent.extracted_parameters
                    )
                    ai_response = "Tôi gợi ý các biểu đồ phù hợp cho dữ liệu của bạn."

        return ChatResponse(
            intent=intent,
            ai_response=ai_response,
            clarification_question=clarification_question,
            suggested_action=suggested_action,
            dashboard_recommendation=dashboard_recommendation
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi xử lý Chat AI: {str(e)}")


@router.post("/insights", response_model=AIInsightResponse,
             response_model_exclude_none=True,
             summary="Sinh AI Insights từ kết quả phân tích",
             description="LLM diễn giải kết quả thống kê thành ngôn ngữ dễ hiểu")
async def generate_insights(request: AIInsightRequest):
    """
    Sinh AI Insights - Diễn giải kết quả phân tích thành văn bản tiếng Việt.

    **Ví dụ Request:**
    ```json
    {
        "analysis_type": "hypothesis_test",
        "analysis_result": {
            "method_name": "Independent T-Test",
            "p_value": 0.023,
            "conclusion": "reject_h0",
            ...
        },
        "context": "So sánh doanh thu giữa 2 chi nhánh"
    }
    ```

    **Response chứa:**
    - Nhận định chính (insights)
    - Các phát hiện quan trọng (key_findings)
    - Gợi ý hành động (recommendations)
    """
    try:
        generator = AIInsightsGenerator()

        result = generator.generate_insights(
            analysis_type=request.analysis_type,
            analysis_result=request.analysis_result,
            context=request.context
        )

        return AIInsightResponse(
            insights=result["insights"],
            key_findings=result["key_findings"],
            recommendations=result.get("recommendations", [])
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi sinh AI Insights: {str(e)}")
