"""API Router cho Statistical Engine - Thống kê mô tả, tương quan, outlier"""
from fastapi import APIRouter, HTTPException
import pandas as pd
from typing import Optional

from app.schemas.statistical import (
    DescriptiveStatsRequest, DescriptiveStatsResponse, ColumnStats,
    CorrelationRequest, CorrelationResponse,
    OutlierRequest, OutlierResponse
)
from app.engine.descriptive import DescriptiveEngine, CorrelationEngine, OutlierEngine
from app.utils.data_loader import DataLoader

router = APIRouter(prefix="/api/stats", tags=["Statistical Analysis"])


@router.post("/descriptive", response_model=DescriptiveStatsResponse,
             response_model_exclude_none=True,
             summary="Tính thống kê mô tả",
             description="Tính toán các chỉ số thống kê mô tả (mean, median, std, quartiles, v.v.) cho các cột số")
async def calculate_descriptive_stats(request: DescriptiveStatsRequest):
    """
    Tính thống kê mô tả cho một hoặc nhiều cột số.

    **Ví dụ Request:**
    ```json
    {
        "dataset_id": "dataset_123",
        "columns": ["revenue", "quantity", "price"]
    }
    ```

    **Response chứa:**
    - Thống kê chi tiết cho từng cột (mean, median, std, min, max, quartiles, skewness, kurtosis)
    - Tóm tắt bằng tiếng Việt
    """
    try:
        # Load dữ liệu từ dataset_id (giả lập - trong thực tế sẽ gọi Spring Boot API)
        df = DataLoader.load_dataset(request.dataset_id)

        # Tính thống kê cho các cột
        stats_list = DescriptiveEngine.calculate_multi_column_stats(df, request.columns)

        # Chuyển sang Pydantic models
        column_stats = [ColumnStats(**stats) for stats in stats_list]

        # Sinh tóm tắt tổng hợp
        summaries = [
            DescriptiveEngine.generate_summary_text(stats.column, stats.model_dump())
            for stats in column_stats
        ]
        overall_summary = " ".join(summaries)

        return DescriptiveStatsResponse(
            dataset_id=request.dataset_id,
            stats=column_stats,
            natural_language_summary=overall_summary
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi tính toán thống kê: {str(e)}")


@router.post("/correlation", response_model=CorrelationResponse,
             response_model_exclude_none=True,
             summary="Tính ma trận tương quan",
             description="Phân tích tương quan Pearson hoặc Spearman giữa các biến số")
async def calculate_correlation(request: CorrelationRequest):
    """
    Tính ma trận tương quan giữa các cột số.

    **Ví dụ Request:**
    ```json
    {
        "dataset_id": "dataset_123",
        "columns": ["revenue", "quantity", "price"],
        "method": "pearson"
    }
    ```

    **Response chứa:**
    - Ma trận tương quan đầy đủ
    - Các cặp biến có tương quan mạnh (|r| > 0.5)
    - Tóm tắt bằng tiếng Việt
    """
    try:
        df = DataLoader.load_dataset(request.dataset_id)

        # Tính tương quan
        result = CorrelationEngine.calculate_correlation(
            df, request.columns, request.method
        )

        # Sinh tóm tắt
        summary = CorrelationEngine.generate_summary_text(result)

        return CorrelationResponse(
            dataset_id=request.dataset_id,
            method=result["method"],
            correlation_matrix=result["correlation_matrix"],
            significant_pairs=result["significant_pairs"],
            natural_language_summary=summary
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi tính toán tương quan: {str(e)}")


@router.post("/outlier", response_model=OutlierResponse,
             response_model_exclude_none=True,
             summary="Phát hiện outlier",
             description="Phát hiện giá trị bất thường bằng phương pháp IQR hoặc Z-score")
async def detect_outliers(request: OutlierRequest):
    """
    Phát hiện outliers trong một cột số.

    **Ví dụ Request:**
    ```json
    {
        "dataset_id": "dataset_123",
        "column": "revenue",
        "method": "iqr",
        "threshold": 1.5
    }
    ```

    **Phương pháp:**
    - **IQR (Interquartile Range):** threshold mặc định 1.5
    - **Z-score:** threshold mặc định 3.0

    **Response chứa:**
    - Số lượng và phần trăm outliers
    - Danh sách index và giá trị outliers
    - Ngưỡng trên/dưới
    - Tóm tắt bằng tiếng Việt
    """
    try:
        df = DataLoader.load_dataset(request.dataset_id)

        if request.column not in df.columns:
            raise ValueError(f"Cột '{request.column}' không tồn tại trong dataset")

        data = pd.to_numeric(df[request.column], errors='coerce')

        # Xác định threshold mặc định
        threshold = request.threshold
        if threshold is None:
            threshold = 1.5 if request.method == "iqr" else 3.0

        # Phát hiện outliers
        if request.method == "iqr":
            result = OutlierEngine.detect_outliers_iqr(data, threshold)
        elif request.method == "zscore":
            result = OutlierEngine.detect_outliers_zscore(data, threshold)
        else:
            raise ValueError(f"Phương pháp '{request.method}' không hợp lệ")

        # Sinh tóm tắt
        summary = OutlierEngine.generate_summary_text(
            request.column, request.method, result
        )

        return OutlierResponse(
            dataset_id=request.dataset_id,
            column=request.column,
            method=request.method,
            threshold=threshold,
            outlier_count=result["outlier_count"],
            outlier_percentage=result["outlier_percentage"],
            outlier_indices=result["outlier_indices"],
            outlier_values=result["outlier_values"],
            bounds={
                "lower_bound": result["lower_bound"],
                "upper_bound": result["upper_bound"]
            },
            natural_language_summary=summary
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi phát hiện outlier: {str(e)}")
