"""Pydantic Schemas cho Statistical Engine - Các cấu trúc Request/Response chuẩn"""
from typing import Literal, Optional
from pydantic import BaseModel, Field, ConfigDict


class StrictModel(BaseModel):
    """Base model với cấu hình nghiêm ngặt - không cho phép trường thừa"""
    model_config = ConfigDict(extra="forbid")


# ========== Module A: Thống kê Mô tả & Tương quan ==========

class DescriptiveStatsRequest(StrictModel):
    """Request tính toán thống kê mô tả cho một hoặc nhiều cột số"""
    dataset_id: str = Field(description="ID của dataset")
    columns: list[str] = Field(min_length=1, max_length=10, description="Danh sách tên cột cần phân tích")


class ColumnStats(StrictModel):
    """Thống kê mô tả cho một cột"""
    column: str
    count: int = Field(description="Số lượng giá trị hợp lệ")
    missing: int = Field(description="Số lượng giá trị thiếu")
    mean: Optional[float] = Field(default=None, description="Giá trị trung bình")
    median: Optional[float] = Field(default=None, description="Trung vị")
    mode: Optional[float | list[float]] = Field(default=None, description="Giá trị phổ biến nhất")
    std: Optional[float] = Field(default=None, description="Độ lệch chuẩn")
    variance: Optional[float] = Field(default=None, description="Phương sai")
    min: Optional[float] = Field(default=None, description="Giá trị nhỏ nhất")
    max: Optional[float] = Field(default=None, description="Giá trị lớn nhất")
    q1: Optional[float] = Field(default=None, description="Tứ phân vị thứ nhất (25%)")
    q2: Optional[float] = Field(default=None, description="Tứ phân vị thứ hai (50%, median)")
    q3: Optional[float] = Field(default=None, description="Tứ phân vị thứ ba (75%)")
    skewness: Optional[float] = Field(default=None, description="Độ lệch phân phối")
    kurtosis: Optional[float] = Field(default=None, description="Độ nhọn phân phối")


class DescriptiveStatsResponse(StrictModel):
    """Response trả về thống kê mô tả"""
    dataset_id: str
    stats: list[ColumnStats]
    natural_language_summary: str = Field(description="Tóm tắt bằng tiếng Việt")


class CorrelationRequest(StrictModel):
    """Request tính toán ma trận tương quan"""
    dataset_id: str
    columns: list[str] = Field(min_length=2, max_length=10, description="Ít nhất 2 cột số để tính tương quan")
    method: Literal["pearson", "spearman"] = Field(default="pearson", description="Phương pháp tính tương quan")


class CorrelationResponse(StrictModel):
    """Response trả về ma trận tương quan"""
    dataset_id: str
    method: str
    correlation_matrix: dict[str, dict[str, float]] = Field(description="Ma trận tương quan dạng nested dict")
    significant_pairs: list[dict[str, float | str]] = Field(
        description="Các cặp biến có tương quan mạnh (|r| > 0.5)"
    )
    natural_language_summary: str


class OutlierRequest(StrictModel):
    """Request phát hiện outlier"""
    dataset_id: str
    column: str = Field(description="Tên cột cần phát hiện outlier")
    method: Literal["iqr", "zscore"] = Field(default="iqr", description="Phương pháp: IQR hoặc Z-score")
    threshold: Optional[float] = Field(
        default=None,
        description="Ngưỡng tùy chỉnh. IQR: mặc định 1.5, Z-score: mặc định 3.0"
    )


class OutlierResponse(StrictModel):
    """Response trả về kết quả phát hiện outlier"""
    dataset_id: str
    column: str
    method: str
    threshold: float
    outlier_count: int = Field(description="Số lượng outliers phát hiện")
    outlier_percentage: float = Field(description="Phần trăm outliers")
    outlier_indices: list[int] = Field(description="Danh sách index của outliers")
    outlier_values: list[float] = Field(max_length=100, description="Giá trị outliers (tối đa 100)")
    bounds: dict[str, float] = Field(description="Ngưỡng trên/dưới: {lower_bound, upper_bound}")
    natural_language_summary: str


# ========== Module B: Hypothesis Testing ==========

class HypothesisTestRequest(StrictModel):
    """Base request cho các kiểm định giả thuyết"""
    dataset_id: str
    test_type: Literal[
        "shapiro_wilk",
        "independent_ttest",
        "paired_ttest",
        "anova",
        "chi_square",
        "mann_whitney",
        "kruskal_wallis"
    ]
    alpha: float = Field(default=0.05, ge=0.01, le=0.1, description="Mức ý nghĩa (thường 0.05)")


class ShapiroWilkRequest(HypothesisTestRequest):
    """Kiểm định phân phối chuẩn Shapiro-Wilk"""
    test_type: Literal["shapiro_wilk"] = "shapiro_wilk"
    column: str = Field(description="Tên cột cần kiểm tra phân phối chuẩn")


class IndependentTTestRequest(HypothesisTestRequest):
    """Kiểm định T-Test cho 2 nhóm độc lập"""
    test_type: Literal["independent_ttest"] = "independent_ttest"
    value_column: str = Field(description="Cột chứa giá trị số cần so sánh")
    group_column: str = Field(description="Cột phân nhóm (2 giá trị duy nhất)")
    equal_variance: bool = Field(default=True, description="Giả định phương sai bằng nhau")


class PairedTTestRequest(HypothesisTestRequest):
    """Kiểm định T-Test cho dữ liệu cặp (trước/sau)"""
    test_type: Literal["paired_ttest"] = "paired_ttest"
    column_before: str = Field(description="Cột giá trị trước")
    column_after: str = Field(description="Cột giá trị sau")


class AnovaRequest(HypothesisTestRequest):
    """Kiểm định ANOVA (3+ nhóm)"""
    test_type: Literal["anova"] = "anova"
    value_column: str
    group_column: str = Field(description="Cột phân nhóm (3 giá trị trở lên)")


class ChiSquareRequest(HypothesisTestRequest):
    """Kiểm định Chi-Square cho biến phân loại"""
    test_type: Literal["chi_square"] = "chi_square"
    column1: str = Field(description="Biến phân loại thứ nhất")
    column2: str = Field(description="Biến phân loại thứ hai")


class MannWhitneyRequest(HypothesisTestRequest):
    """Kiểm định Mann-Whitney U (phi tham số, 2 nhóm)"""
    test_type: Literal["mann_whitney"] = "mann_whitney"
    value_column: str
    group_column: str


class KruskalWallisRequest(HypothesisTestRequest):
    """Kiểm định Kruskal-Wallis (phi tham số, 3+ nhóm)"""
    test_type: Literal["kruskal_wallis"] = "kruskal_wallis"
    value_column: str
    group_column: str


class HypothesisTestResponse(StrictModel):
    """Response chuẩn cho tất cả kiểm định giả thuyết"""
    dataset_id: str
    method_name: str = Field(description="Tên phương pháp kiểm định")
    null_hypothesis: str = Field(description="Giả thuyết H0 bằng tiếng Việt")
    alt_hypothesis: str = Field(description="Giả thuyết H1 bằng tiếng Việt")
    assumptions_met: bool = Field(description="Các giả định có được thỏa mãn không")
    assumption_details: dict[str, bool | str] = Field(
        description="Chi tiết kiểm tra giả định (cỡ mẫu, phân phối, v.v.)"
    )
    sample_size: int | dict[str, int] = Field(description="Cỡ mẫu (số hoặc dict nếu nhiều nhóm)")
    statistic: float = Field(description="Giá trị thống kê kiểm định")
    p_value: float = Field(description="Giá trị p-value")
    confidence_interval: Optional[tuple[float, float]] = Field(
        default=None,
        description="Khoảng tin cậy (nếu có)"
    )
    effect_size: Optional[float] = Field(default=None, description="Kích thước hiệu ứng (Cohen's d, Cramér's V, v.v.)")
    effect_size_interpretation: Optional[str] = Field(default=None, description="Giải thích kích thước hiệu ứng")
    conclusion: str = Field(description="Kết luận: 'reject_h0' hoặc 'fail_to_reject_h0'")
    natural_language_conclusion: str = Field(description="Kết luận bằng tiếng Việt dễ hiểu")


# ========== Module C: Chat AI & Dashboard Routing ==========

class ChatMessage(StrictModel):
    """Tin nhắn trong cuộc hội thoại"""
    role: Literal["user", "assistant", "system"]
    content: str = Field(max_length=4000)


class ChatRequest(StrictModel):
    """Request gửi câu hỏi đến Chat AI"""
    dataset_id: str
    question: str = Field(min_length=1, max_length=2000, description="Câu hỏi tiếng Việt từ người dùng")
    conversation_history: list[ChatMessage] = Field(default_factory=list, max_length=10)
    available_columns: list[dict[str, str]] = Field(
        description="Metadata cột: [{name, type, kind}]"
    )


class IntentResult(StrictModel):
    """Kết quả nhận diện ý định"""
    intent_type: Literal[
        "descriptive_stats",
        "correlation",
        "outlier_detection",
        "hypothesis_test",
        "create_dashboard",
        "clarify"
    ]
    confidence: float = Field(ge=0.0, le=1.0, description="Độ tin cậy nhận diện")
    extracted_parameters: dict = Field(description="Tham số trích xuất từ câu hỏi")
    missing_parameters: list[str] = Field(default_factory=list, description="Tham số còn thiếu")


class ChartRecommendation(StrictModel):
    """Gợi ý biểu đồ phù hợp"""
    chart_type: Literal[
        "line", "bar", "pie", "donut", "histogram",
        "scatter", "heatmap", "kpi_card", "map",
        "stacked_area", "stacked_bar"
    ]
    reason: str = Field(description="Lý do gợi ý biểu đồ này")
    dimension_column: Optional[str] = None
    metric_column: Optional[str] = None
    additional_config: dict = Field(default_factory=dict)


class DashboardMapping(StrictModel):
    """Ánh xạ cột vào dashboard template"""
    template_id: str = Field(description="ID template dashboard")
    template_name: str = Field(description="Tên template")
    column_mapping: dict[str, str] = Field(description="Ánh xạ vai trò -> tên cột thực tế")
    recommended_charts: list[ChartRecommendation]


class ChatResponse(StrictModel):
    """Response từ Chat AI"""
    intent: IntentResult
    ai_response: str = Field(description="Phản hồi bằng tiếng Việt")
    clarification_question: Optional[str] = Field(default=None, description="Câu hỏi làm rõ nếu cần")
    suggested_action: Optional[dict] = Field(
        default=None,
        description="Hành động gợi ý (API endpoint + parameters)"
    )
    dashboard_recommendation: Optional[DashboardMapping] = Field(default=None)
    ai_insights: Optional[str] = Field(default=None, description="Nhận định xu hướng/bất thường")


class AIInsightRequest(StrictModel):
    """Request sinh AI Insights từ kết quả thống kê"""
    analysis_type: str = Field(description="Loại phân tích: descriptive, hypothesis_test, correlation, v.v.")
    analysis_result: dict = Field(description="Kết quả phân tích từ Statistical Engine")
    context: Optional[str] = Field(default=None, description="Ngữ cảnh nghiệp vụ (nếu có)")


class AIInsightResponse(StrictModel):
    """Response chứa AI Insights"""
    insights: str = Field(description="Nhận định xu hướng/bất thường bằng tiếng Việt")
    key_findings: list[str] = Field(description="Các phát hiện chính")
    recommendations: list[str] = Field(default_factory=list, description="Gợi ý hành động")
