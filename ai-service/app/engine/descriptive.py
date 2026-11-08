"""Module A: Thống kê Mô tả - Tính toán chính xác bằng scipy, pandas, numpy"""
import numpy as np
import pandas as pd
from scipy import stats
from typing import Optional


class DescriptiveEngine:
    """
    Bộ máy tính toán thống kê mô tả.
    LLM KHÔNG BAO GIỜ tính toán - chỉ module này được phép tính.
    """

    @staticmethod
    def calculate_stats(data: pd.Series) -> dict:
        """
        Tính toán đầy đủ các chỉ số thống kê mô tả cho một cột.

        Args:
            data: pandas Series chứa dữ liệu số

        Returns:
            dict chứa tất cả các chỉ số thống kê
        """
        # Loại bỏ giá trị thiếu để tính toán
        clean_data = data.dropna()

        if len(clean_data) == 0:
            return {
                "count": 0,
                "missing": len(data),
                "mean": None,
                "median": None,
                "mode": None,
                "std": None,
                "variance": None,
                "min": None,
                "max": None,
                "q1": None,
                "q2": None,
                "q3": None,
                "skewness": None,
                "kurtosis": None
            }

        # Tính mode - có thể có nhiều mode
        mode_result = stats.mode(clean_data, keepdims=True)
        mode_value = mode_result.mode[0] if len(mode_result.mode) > 0 else None

        # Tính các quartiles
        q1, q2, q3 = np.percentile(clean_data, [25, 50, 75])

        result = {
            "count": len(clean_data),
            "missing": len(data) - len(clean_data),
            "mean": float(clean_data.mean()),
            "median": float(clean_data.median()),
            "mode": float(mode_value) if mode_value is not None else None,
            "std": float(clean_data.std()),
            "variance": float(clean_data.var()),
            "min": float(clean_data.min()),
            "max": float(clean_data.max()),
            "q1": float(q1),
            "q2": float(q2),  # q2 = median
            "q3": float(q3),
            "skewness": float(stats.skew(clean_data)),
            "kurtosis": float(stats.kurtosis(clean_data))
        }

        return result

    @staticmethod
    def generate_summary_text(column_name: str, stats_dict: dict) -> str:
        """
        Sinh văn bản tóm tắt bằng tiếng Việt từ kết quả tính toán.

        Args:
            column_name: Tên cột
            stats_dict: Dict chứa các chỉ số thống kê

        Returns:
            Chuỗi tóm tắt tiếng Việt
        """
        if stats_dict["count"] == 0:
            return f"Cột '{column_name}' không có dữ liệu hợp lệ (tất cả đều thiếu)."

        mean = stats_dict["mean"]
        median = stats_dict["median"]
        std = stats_dict["std"]
        min_val = stats_dict["min"]
        max_val = stats_dict["max"]
        missing = stats_dict["missing"]
        skew = stats_dict["skewness"]

        # Đánh giá độ lệch phân phối
        if abs(skew) < 0.5:
            dist_desc = "phân phối gần như cân đối"
        elif skew > 0:
            dist_desc = "phân phối lệch phải (có giá trị cao bất thường)"
        else:
            dist_desc = "phân phối lệch trái (có giá trị thấp bất thường)"

        summary = (
            f"Cột '{column_name}' có {stats_dict['count']} giá trị hợp lệ"
            + (f" ({missing} giá trị thiếu)" if missing > 0 else "")
            + f". Trung bình: {mean:.2f}, trung vị: {median:.2f}, "
            f"độ lệch chuẩn: {std:.2f}. "
            f"Giá trị dao động từ {min_val:.2f} đến {max_val:.2f}. "
            f"Dữ liệu có {dist_desc}."
        )

        return summary

    @staticmethod
    def calculate_multi_column_stats(df: pd.DataFrame, columns: list[str]) -> list[dict]:
        """
        Tính thống kê cho nhiều cột.

        Args:
            df: DataFrame chứa dữ liệu
            columns: Danh sách tên cột cần phân tích

        Returns:
            List các dict thống kê cho từng cột
        """
        results = []

        for col in columns:
            if col not in df.columns:
                raise ValueError(f"Cột '{col}' không tồn tại trong dataset")

            # Chuyển sang numeric, ép kiểu nếu cần
            try:
                data = pd.to_numeric(df[col], errors='coerce')
            except Exception:
                raise ValueError(f"Cột '{col}' không phải dạng số, không thể tính thống kê mô tả")

            stats_dict = DescriptiveEngine.calculate_stats(data)
            stats_dict["column"] = col
            results.append(stats_dict)

        return results


class CorrelationEngine:
    """Bộ máy tính toán tương quan giữa các biến"""

    @staticmethod
    def calculate_correlation(df: pd.DataFrame, columns: list[str], method: str = "pearson") -> dict:
        """
        Tính ma trận tương quan.

        Args:
            df: DataFrame chứa dữ liệu
            columns: Danh sách cột cần tính tương quan
            method: 'pearson' hoặc 'spearman'

        Returns:
            dict chứa ma trận tương quan và các cặp có tương quan mạnh
        """
        # Kiểm tra và chuẩn bị dữ liệu
        numeric_df = pd.DataFrame()
        for col in columns:
            if col not in df.columns:
                raise ValueError(f"Cột '{col}' không tồn tại")
            numeric_df[col] = pd.to_numeric(df[col], errors='coerce')

        # Loại bỏ dòng có giá trị thiếu
        clean_df = numeric_df.dropna()

        if len(clean_df) < 3:
            raise ValueError("Cần ít nhất 3 mẫu hợp lệ để tính tương quan")

        # Tính ma trận tương quan
        if method == "pearson":
            corr_matrix = clean_df.corr(method='pearson')
        elif method == "spearman":
            corr_matrix = clean_df.corr(method='spearman')
        else:
            raise ValueError(f"Phương pháp '{method}' không hợp lệ. Chỉ hỗ trợ 'pearson' hoặc 'spearman'")

        # Chuyển ma trận thành nested dict
        matrix_dict = {}
        for col1 in columns:
            matrix_dict[col1] = {}
            for col2 in columns:
                matrix_dict[col1][col2] = float(corr_matrix.loc[col1, col2])

        # Tìm các cặp có tương quan mạnh (|r| > 0.5 và không phải chéo chính)
        significant_pairs = []
        for i, col1 in enumerate(columns):
            for j, col2 in enumerate(columns):
                if i < j:  # Chỉ lấy nửa trên tam giác, tránh trùng lặp
                    r_value = matrix_dict[col1][col2]
                    if abs(r_value) > 0.5:
                        significant_pairs.append({
                            "column1": col1,
                            "column2": col2,
                            "correlation": round(r_value, 4),
                            "strength": CorrelationEngine._interpret_correlation(r_value)
                        })

        # Sắp xếp theo độ mạnh tương quan
        significant_pairs.sort(key=lambda x: abs(x["correlation"]), reverse=True)

        return {
            "correlation_matrix": matrix_dict,
            "significant_pairs": significant_pairs,
            "method": method,
            "sample_size": len(clean_df)
        }

    @staticmethod
    def _interpret_correlation(r: float) -> str:
        """Diễn giải độ mạnh tương quan bằng tiếng Việt"""
        abs_r = abs(r)
        if abs_r >= 0.9:
            strength = "rất mạnh"
        elif abs_r >= 0.7:
            strength = "mạnh"
        elif abs_r >= 0.5:
            strength = "trung bình"
        elif abs_r >= 0.3:
            strength = "yếu"
        else:
            strength = "rất yếu"

        direction = "thuận" if r > 0 else "nghịch"
        return f"{strength} ({direction})"

    @staticmethod
    def generate_summary_text(result: dict) -> str:
        """Sinh văn bản tóm tắt ma trận tương quan"""
        method_name = "Pearson" if result["method"] == "pearson" else "Spearman"
        n_pairs = len(result["significant_pairs"])

        if n_pairs == 0:
            return (
                f"Phân tích tương quan {method_name} trên {result['sample_size']} mẫu. "
                f"Không phát hiện cặp biến nào có tương quan mạnh (|r| > 0.5)."
            )

        top_pair = result["significant_pairs"][0]
        summary = (
            f"Phân tích tương quan {method_name} trên {result['sample_size']} mẫu. "
            f"Phát hiện {n_pairs} cặp biến có tương quan mạnh. "
            f"Tương quan mạnh nhất: '{top_pair['column1']}' và '{top_pair['column2']}' "
            f"với hệ số r={top_pair['correlation']:.3f} ({top_pair['strength']})."
        )

        return summary


class OutlierEngine:
    """Bộ máy phát hiện outlier"""

    @staticmethod
    def detect_outliers_iqr(data: pd.Series, threshold: float = 1.5) -> dict:
        """
        Phát hiện outlier bằng phương pháp IQR (Interquartile Range).

        Args:
            data: pandas Series chứa dữ liệu số
            threshold: Hệ số nhân IQR (mặc định 1.5)

        Returns:
            dict chứa thông tin outliers
        """
        clean_data = data.dropna()

        if len(clean_data) < 4:
            raise ValueError("Cần ít nhất 4 mẫu để phát hiện outlier bằng IQR")

        # Tính Q1, Q3, IQR
        q1 = clean_data.quantile(0.25)
        q3 = clean_data.quantile(0.75)
        iqr = q3 - q1

        # Xác định ngưỡng trên/dưới
        lower_bound = q1 - threshold * iqr
        upper_bound = q3 + threshold * iqr

        # Tìm outliers
        outlier_mask = (clean_data < lower_bound) | (clean_data > upper_bound)
        outliers = clean_data[outlier_mask]

        return {
            "outlier_count": len(outliers),
            "outlier_percentage": (len(outliers) / len(clean_data)) * 100,
            "outlier_indices": outliers.index.tolist(),
            "outlier_values": outliers.tolist()[:100],  # Giới hạn 100 giá trị
            "lower_bound": float(lower_bound),
            "upper_bound": float(upper_bound),
            "q1": float(q1),
            "q3": float(q3),
            "iqr": float(iqr)
        }

    @staticmethod
    def detect_outliers_zscore(data: pd.Series, threshold: float = 3.0) -> dict:
        """
        Phát hiện outlier bằng phương pháp Z-score.

        Args:
            data: pandas Series chứa dữ liệu số
            threshold: Ngưỡng Z-score (mặc định 3.0)

        Returns:
            dict chứa thông tin outliers
        """
        clean_data = data.dropna()

        if len(clean_data) < 3:
            raise ValueError("Cần ít nhất 3 mẫu để phát hiện outlier bằng Z-score")

        # Tính Z-score
        mean = clean_data.mean()
        std = clean_data.std()

        if std == 0:
            raise ValueError("Độ lệch chuẩn bằng 0, không thể tính Z-score")

        z_scores = np.abs((clean_data - mean) / std)

        # Tìm outliers
        outlier_mask = z_scores > threshold
        outliers = clean_data[outlier_mask]

        # Tính ngưỡng tương đương
        lower_bound = mean - threshold * std
        upper_bound = mean + threshold * std

        return {
            "outlier_count": len(outliers),
            "outlier_percentage": (len(outliers) / len(clean_data)) * 100,
            "outlier_indices": outliers.index.tolist(),
            "outlier_values": outliers.tolist()[:100],
            "lower_bound": float(lower_bound),
            "upper_bound": float(upper_bound),
            "mean": float(mean),
            "std": float(std),
            "threshold_zscore": threshold
        }

    @staticmethod
    def generate_summary_text(column: str, method: str, result: dict) -> str:
        """Sinh văn bản tóm tắt phát hiện outlier"""
        count = result["outlier_count"]
        pct = result["outlier_percentage"]

        if count == 0:
            return f"Cột '{column}' không phát hiện outlier bằng phương pháp {method.upper()}."

        method_desc = "IQR" if method == "iqr" else "Z-score"
        summary = (
            f"Cột '{column}' phát hiện {count} outliers ({pct:.2f}%) bằng phương pháp {method_desc}. "
            f"Ngưỡng hợp lệ: [{result['lower_bound']:.2f}, {result['upper_bound']:.2f}]. "
        )

        if count <= 5:
            values_str = ", ".join([f"{v:.2f}" for v in result["outlier_values"][:5]])
            summary += f"Các giá trị outlier: {values_str}."
        else:
            summary += f"Xem danh sách đầy đủ trong trường 'outlier_values'."

        return summary
