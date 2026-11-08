"""Unit Tests cho Descriptive Statistics Engine"""
import unittest
import numpy as np
import pandas as pd
from scipy import stats

from app.engine.descriptive import DescriptiveEngine, CorrelationEngine, OutlierEngine


class TestDescriptiveEngine(unittest.TestCase):
    """Test thống kê mô tả"""

    def setUp(self):
        """Chuẩn bị dữ liệu test"""
        np.random.seed(42)
        self.data = pd.Series([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
        self.data_with_nan = pd.Series([1, 2, np.nan, 4, 5, np.nan, 7, 8, 9, 10])

    def test_calculate_stats_basic(self):
        """Test tính toán thống kê cơ bản"""
        result = DescriptiveEngine.calculate_stats(self.data)

        self.assertEqual(result["count"], 10)
        self.assertEqual(result["missing"], 0)
        self.assertAlmostEqual(result["mean"], 5.5, places=2)
        self.assertAlmostEqual(result["median"], 5.5, places=2)
        self.assertAlmostEqual(result["std"], self.data.std(), places=4)
        self.assertAlmostEqual(result["min"], 1.0)
        self.assertAlmostEqual(result["max"], 10.0)
        self.assertAlmostEqual(result["q1"], 3.25, places=2)
        self.assertAlmostEqual(result["q3"], 7.75, places=2)

    def test_calculate_stats_with_missing(self):
        """Test với dữ liệu thiếu"""
        result = DescriptiveEngine.calculate_stats(self.data_with_nan)

        self.assertEqual(result["count"], 8)
        self.assertEqual(result["missing"], 2)
        self.assertIsNotNone(result["mean"])

    def test_calculate_stats_empty(self):
        """Test với dữ liệu rỗng"""
        empty_data = pd.Series([np.nan, np.nan, np.nan])
        result = DescriptiveEngine.calculate_stats(empty_data)

        self.assertEqual(result["count"], 0)
        self.assertEqual(result["missing"], 3)
        self.assertIsNone(result["mean"])

    def test_skewness_kurtosis(self):
        """Test tính skewness và kurtosis"""
        # Dữ liệu lệch phải
        right_skewed = pd.Series([1, 1, 1, 2, 2, 3, 10, 20, 30])
        result = DescriptiveEngine.calculate_stats(right_skewed)

        # So sánh với scipy
        expected_skew = stats.skew(right_skewed)
        expected_kurt = stats.kurtosis(right_skewed)

        self.assertAlmostEqual(result["skewness"], expected_skew, places=4)
        self.assertAlmostEqual(result["kurtosis"], expected_kurt, places=4)

    def test_generate_summary_text(self):
        """Test sinh văn bản tóm tắt"""
        result = DescriptiveEngine.calculate_stats(self.data)
        summary = DescriptiveEngine.generate_summary_text("test_column", result)

        self.assertIsInstance(summary, str)
        self.assertIn("test_column", summary)
        self.assertIn("10 giá trị hợp lệ", summary)


class TestCorrelationEngine(unittest.TestCase):
    """Test phân tích tương quan"""

    def setUp(self):
        """Chuẩn bị dữ liệu test"""
        np.random.seed(42)
        self.df = pd.DataFrame({
            "x": np.arange(100),
            "y": np.arange(100) * 2 + np.random.normal(0, 10, 100),  # Tương quan mạnh
            "z": np.random.normal(0, 1, 100)  # Không tương quan
        })

    def test_pearson_correlation(self):
        """Test tương quan Pearson"""
        result = CorrelationEngine.calculate_correlation(
            self.df, ["x", "y"], method="pearson"
        )

        self.assertIn("correlation_matrix", result)
        self.assertIn("x", result["correlation_matrix"])
        self.assertIn("y", result["correlation_matrix"])

        # Kiểm tra tính đối xứng
        r_xy = result["correlation_matrix"]["x"]["y"]
        r_yx = result["correlation_matrix"]["y"]["x"]
        self.assertAlmostEqual(r_xy, r_yx, places=6)

        # Đường chéo phải bằng 1
        self.assertAlmostEqual(result["correlation_matrix"]["x"]["x"], 1.0, places=6)

    def test_spearman_correlation(self):
        """Test tương quan Spearman"""
        result = CorrelationEngine.calculate_correlation(
            self.df, ["x", "y", "z"], method="spearman"
        )

        self.assertEqual(result["method"], "spearman")
        self.assertEqual(len(result["correlation_matrix"]), 3)

    def test_significant_pairs(self):
        """Test tìm các cặp tương quan mạnh"""
        result = CorrelationEngine.calculate_correlation(
            self.df, ["x", "y", "z"], method="pearson"
        )

        # x và y nên có tương quan mạnh
        significant = result["significant_pairs"]
        self.assertGreater(len(significant), 0)

        # Kiểm tra cặp x-y
        xy_pair = next((p for p in significant if
                       (p["column1"] == "x" and p["column2"] == "y") or
                       (p["column1"] == "y" and p["column2"] == "x")), None)
        self.assertIsNotNone(xy_pair)
        self.assertGreater(abs(xy_pair["correlation"]), 0.5)

    def test_insufficient_data(self):
        """Test với dữ liệu không đủ"""
        small_df = pd.DataFrame({"a": [1, 2], "b": [3, 4]})

        with self.assertRaises(ValueError):
            CorrelationEngine.calculate_correlation(small_df, ["a", "b"])


class TestOutlierEngine(unittest.TestCase):
    """Test phát hiện outlier"""

    def setUp(self):
        """Chuẩn bị dữ liệu test"""
        # Dữ liệu bình thường + outliers rõ ràng
        normal = list(range(1, 21))
        outliers = [100, 200, -50]
        self.data_with_outliers = pd.Series(normal + outliers)
        self.data_clean = pd.Series(range(1, 21))

    def test_iqr_method(self):
        """Test phương pháp IQR"""
        result = OutlierEngine.detect_outliers_iqr(self.data_with_outliers, threshold=1.5)

        self.assertIn("outlier_count", result)
        self.assertIn("lower_bound", result)
        self.assertIn("upper_bound", result)

        # Phải phát hiện được outliers
        self.assertGreater(result["outlier_count"], 0)
        self.assertGreater(result["outlier_percentage"], 0)

    def test_iqr_no_outliers(self):
        """Test IQR với dữ liệu sạch"""
        result = OutlierEngine.detect_outliers_iqr(self.data_clean, threshold=1.5)

        # Không nên có outliers
        self.assertEqual(result["outlier_count"], 0)

    def test_zscore_method(self):
        """Test phương pháp Z-score"""
        result = OutlierEngine.detect_outliers_zscore(self.data_with_outliers, threshold=3.0)

        self.assertIn("outlier_count", result)
        self.assertIn("mean", result)
        self.assertIn("std", result)

        # Phải phát hiện được outliers
        self.assertGreater(result["outlier_count"], 0)

    def test_zscore_custom_threshold(self):
        """Test Z-score với threshold khác nhau"""
        result_strict = OutlierEngine.detect_outliers_zscore(self.data_with_outliers, threshold=2.0)
        result_loose = OutlierEngine.detect_outliers_zscore(self.data_with_outliers, threshold=4.0)

        # Threshold thấp hơn nên phát hiện nhiều outliers hơn
        self.assertGreaterEqual(result_strict["outlier_count"], result_loose["outlier_count"])

    def test_generate_summary(self):
        """Test sinh văn bản tóm tắt"""
        result = OutlierEngine.detect_outliers_iqr(self.data_with_outliers)
        summary = OutlierEngine.generate_summary_text("revenue", "iqr", result)

        self.assertIsInstance(summary, str)
        self.assertIn("revenue", summary)
        self.assertIn("IQR", summary)

    def test_insufficient_data(self):
        """Test với dữ liệu quá ít"""
        small_data = pd.Series([1, 2, 3])

        with self.assertRaises(ValueError):
            OutlierEngine.detect_outliers_iqr(small_data)


class TestCorrectnessAgainstScipy(unittest.TestCase):
    """Test đối chiếu kết quả với scipy để đảm bảo tính chính xác"""

    def test_mean_matches_scipy(self):
        """Đảm bảo mean khớp với numpy/scipy"""
        data = pd.Series([1.5, 2.3, 4.7, 8.9, 3.2])
        result = DescriptiveEngine.calculate_stats(data)

        expected = np.mean(data)
        self.assertAlmostEqual(result["mean"], expected, places=10)

    def test_std_matches_scipy(self):
        """Đảm bảo std khớp với pandas/numpy"""
        data = pd.Series([1.5, 2.3, 4.7, 8.9, 3.2])
        result = DescriptiveEngine.calculate_stats(data)

        expected = data.std()
        self.assertAlmostEqual(result["std"], expected, places=10)

    def test_quartiles_match_numpy(self):
        """Đảm bảo quartiles khớp với numpy.percentile"""
        data = pd.Series(range(1, 101))
        result = DescriptiveEngine.calculate_stats(data)

        expected_q1 = np.percentile(data, 25)
        expected_q2 = np.percentile(data, 50)
        expected_q3 = np.percentile(data, 75)

        self.assertAlmostEqual(result["q1"], expected_q1, places=2)
        self.assertAlmostEqual(result["q2"], expected_q2, places=2)
        self.assertAlmostEqual(result["q3"], expected_q3, places=2)


if __name__ == "__main__":
    unittest.main()
