"""API Router cho Hypothesis Testing - Các kiểm định giả thuyết"""
from fastapi import APIRouter, HTTPException
import pandas as pd

from app.schemas.statistical import (
    HypothesisTestRequest, HypothesisTestResponse,
    ShapiroWilkRequest, IndependentTTestRequest, PairedTTestRequest,
    AnovaRequest, ChiSquareRequest, MannWhitneyRequest, KruskalWallisRequest
)
from app.engine.hypothesis import HypothesisTestEngine
from app.utils.data_loader import DataLoader

router = APIRouter(prefix="/api/hypothesis", tags=["Hypothesis Testing"])


@router.post("/shapiro-wilk", response_model=HypothesisTestResponse,
             response_model_exclude_none=True,
             summary="Kiểm định phân phối chuẩn Shapiro-Wilk",
             description="Kiểm tra xem dữ liệu có tuân theo phân phối chuẩn không")
async def shapiro_wilk_test(request: ShapiroWilkRequest):
    """
    Kiểm định Shapiro-Wilk: Kiểm tra phân phối chuẩn.

    - **H0:** Dữ liệu tuân theo phân phối chuẩn
    - **H1:** Dữ liệu không tuân theo phân phối chuẩn

    **Khi nào dùng:** Trước khi chạy T-Test, ANOVA để kiểm tra giả định phân phối chuẩn.
    """
    try:
        df = DataLoader.load_dataset(request.dataset_id)
        data = pd.to_numeric(df[request.column], errors='coerce')

        result = HypothesisTestEngine.shapiro_wilk_test(data, request.alpha)

        return HypothesisTestResponse(dataset_id=request.dataset_id, **result)

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi kiểm định: {str(e)}")


@router.post("/independent-ttest", response_model=HypothesisTestResponse,
             response_model_exclude_none=True,
             summary="Kiểm định T-Test 2 nhóm độc lập",
             description="So sánh trung bình của 2 nhóm độc lập")
async def independent_ttest(request: IndependentTTestRequest):
    """
    Kiểm định Independent T-Test: So sánh trung bình 2 nhóm độc lập.

    - **H0:** μ1 = μ2 (trung bình 2 nhóm bằng nhau)
    - **H1:** μ1 ≠ μ2 (trung bình 2 nhóm khác nhau)

    **Ví dụ:** So sánh doanh thu giữa chi nhánh A và chi nhánh B.
    """
    try:
        df = DataLoader.load_dataset(request.dataset_id)

        # Tách dữ liệu thành 2 nhóm
        groups = df.groupby(request.group_column)[request.value_column]
        unique_groups = df[request.group_column].unique()

        if len(unique_groups) != 2:
            raise ValueError(f"Cột '{request.group_column}' phải có đúng 2 nhóm, hiện có {len(unique_groups)}")

        group1 = pd.to_numeric(groups.get_group(unique_groups[0]), errors='coerce')
        group2 = pd.to_numeric(groups.get_group(unique_groups[1]), errors='coerce')

        result = HypothesisTestEngine.independent_ttest(
            group1, group2, request.equal_variance, request.alpha
        )

        return HypothesisTestResponse(dataset_id=request.dataset_id, **result)

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi kiểm định: {str(e)}")


@router.post("/paired-ttest", response_model=HypothesisTestResponse,
             response_model_exclude_none=True,
             summary="Kiểm định T-Test dữ liệu cặp",
             description="So sánh trung bình trước/sau trên cùng đối tượng")
async def paired_ttest(request: PairedTTestRequest):
    """
    Kiểm định Paired T-Test: So sánh trước/sau.

    - **H0:** μ_diff = 0 (không có sự thay đổi)
    - **H1:** μ_diff ≠ 0 (có sự thay đổi)

    **Ví dụ:** So sánh doanh thu trước và sau chiến dịch marketing.
    """
    try:
        df = DataLoader.load_dataset(request.dataset_id)

        before = pd.to_numeric(df[request.column_before], errors='coerce')
        after = pd.to_numeric(df[request.column_after], errors='coerce')

        result = HypothesisTestEngine.paired_ttest(before, after, request.alpha)

        return HypothesisTestResponse(dataset_id=request.dataset_id, **result)

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi kiểm định: {str(e)}")


@router.post("/anova", response_model=HypothesisTestResponse,
             response_model_exclude_none=True,
             summary="Kiểm định ANOVA một chiều",
             description="So sánh trung bình của 3 nhóm trở lên")
async def anova_test(request: AnovaRequest):
    """
    Kiểm định ANOVA (Analysis of Variance): So sánh 3+ nhóm.

    - **H0:** Tất cả các nhóm có trung bình bằng nhau
    - **H1:** Ít nhất một nhóm có trung bình khác biệt

    **Ví dụ:** So sánh doanh thu giữa 5 khu vực.
    """
    try:
        df = DataLoader.load_dataset(request.dataset_id)

        groups_data = df.groupby(request.group_column)[request.value_column]
        unique_groups = df[request.group_column].unique()

        if len(unique_groups) < 3:
            raise ValueError("ANOVA yêu cầu ít nhất 3 nhóm")

        groups = [pd.to_numeric(groups_data.get_group(g), errors='coerce') for g in unique_groups]
        group_names = [str(g) for g in unique_groups]

        result = HypothesisTestEngine.anova_oneway(groups, group_names, request.alpha)

        return HypothesisTestResponse(dataset_id=request.dataset_id, **result)

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi kiểm định: {str(e)}")


@router.post("/chi-square", response_model=HypothesisTestResponse,
             response_model_exclude_none=True,
             summary="Kiểm định Chi-Square",
             description="Kiểm tra mối liên hệ giữa 2 biến phân loại")
async def chi_square_test(request: ChiSquareRequest):
    """
    Kiểm định Chi-Square: Kiểm tra độc lập giữa 2 biến phân loại.

    - **H0:** Hai biến độc lập (không có mối liên hệ)
    - **H1:** Hai biến có mối liên hệ

    **Ví dụ:** Kiểm tra mối liên hệ giữa khu vực và danh mục sản phẩm.
    """
    try:
        df = DataLoader.load_dataset(request.dataset_id)

        # Tạo bảng chéo (contingency table)
        contingency_table = pd.crosstab(df[request.column1], df[request.column2])

        result = HypothesisTestEngine.chi_square_test(contingency_table, request.alpha)

        return HypothesisTestResponse(dataset_id=request.dataset_id, **result)

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi kiểm định: {str(e)}")


@router.post("/mann-whitney", response_model=HypothesisTestResponse,
             response_model_exclude_none=True,
             summary="Kiểm định Mann-Whitney U (phi tham số)",
             description="So sánh 2 nhóm khi dữ liệu không tuân theo phân phối chuẩn")
async def mann_whitney_test(request: MannWhitneyRequest):
    """
    Kiểm định Mann-Whitney U: So sánh 2 nhóm phi tham số.

    - **H0:** Hai nhóm có phân phối giống nhau
    - **H1:** Hai nhóm có phân phối khác nhau

    **Khi nào dùng:** Thay thế T-Test khi dữ liệu không tuân theo phân phối chuẩn.
    """
    try:
        df = DataLoader.load_dataset(request.dataset_id)

        groups = df.groupby(request.group_column)[request.value_column]
        unique_groups = df[request.group_column].unique()

        if len(unique_groups) != 2:
            raise ValueError(f"Mann-Whitney yêu cầu đúng 2 nhóm")

        group1 = pd.to_numeric(groups.get_group(unique_groups[0]), errors='coerce')
        group2 = pd.to_numeric(groups.get_group(unique_groups[1]), errors='coerce')

        result = HypothesisTestEngine.mann_whitney_test(group1, group2, request.alpha)

        return HypothesisTestResponse(dataset_id=request.dataset_id, **result)

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi kiểm định: {str(e)}")


@router.post("/kruskal-wallis", response_model=HypothesisTestResponse,
             response_model_exclude_none=True,
             summary="Kiểm định Kruskal-Wallis (phi tham số)",
             description="So sánh 3+ nhóm khi dữ liệu không tuân theo phân phối chuẩn")
async def kruskal_wallis_test(request: KruskalWallisRequest):
    """
    Kiểm định Kruskal-Wallis: So sánh 3+ nhóm phi tham số.

    - **H0:** Tất cả các nhóm có phân phối giống nhau
    - **H1:** Ít nhất một nhóm có phân phối khác biệt

    **Khi nào dùng:** Thay thế ANOVA khi dữ liệu không tuân theo phân phối chuẩn.
    """
    try:
        df = DataLoader.load_dataset(request.dataset_id)

        groups_data = df.groupby(request.group_column)[request.value_column]
        unique_groups = df[request.group_column].unique()

        if len(unique_groups) < 3:
            raise ValueError("Kruskal-Wallis yêu cầu ít nhất 3 nhóm")

        groups = [pd.to_numeric(groups_data.get_group(g), errors='coerce') for g in unique_groups]
        group_names = [str(g) for g in unique_groups]

        result = HypothesisTestEngine.kruskal_wallis_test(groups, group_names, request.alpha)

        return HypothesisTestResponse(dataset_id=request.dataset_id, **result)

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi kiểm định: {str(e)}")
