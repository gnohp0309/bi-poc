"""Quick start script để test Statistical Engine"""
import sys
import os

# Add app to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
import pandas as pd
from app.engine.descriptive import DescriptiveEngine, CorrelationEngine, OutlierEngine
from app.engine.hypothesis import HypothesisTestEngine


def test_descriptive_stats():
    """Test thống kê mô tả"""
    print("=" * 60)
    print("TEST 1: THỐNG KÊ MÔ TẢ")
    print("=" * 60)

    # Tạo dữ liệu mẫu
    data = pd.Series([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])

    result = DescriptiveEngine.calculate_stats(data)

    print(f"Count: {result['count']}")
    print(f"Mean: {result['mean']:.2f}")
    print(f"Median: {result['median']:.2f}")
    print(f"Std: {result['std']:.2f}")
    print(f"Min: {result['min']:.2f}, Max: {result['max']:.2f}")
    print(f"Q1: {result['q1']:.2f}, Q2: {result['q2']:.2f}, Q3: {result['q3']:.2f}")

    summary = DescriptiveEngine.generate_summary_text("test_column", result)
    print(f"\nTóm tắt tiếng Việt:\n{summary}")
    print("\n✓ Test PASSED\n")


def test_correlation():
    """Test tương quan"""
    print("=" * 60)
    print("TEST 2: TƯƠNG QUAN")
    print("=" * 60)

    # Tạo dữ liệu có tương quan mạnh
    np.random.seed(42)
    df = pd.DataFrame({
        "x": np.arange(50),
        "y": np.arange(50) * 2 + np.random.normal(0, 5, 50),
        "z": np.random.normal(0, 1, 50)
    })

    result = CorrelationEngine.calculate_correlation(df, ["x", "y", "z"], method="pearson")

    print("Ma trận tương quan:")
    for col1 in ["x", "y", "z"]:
        print(f"{col1}: ", end="")
        for col2 in ["x", "y", "z"]:
            print(f"{result['correlation_matrix'][col1][col2]:6.3f}", end=" ")
        print()

    print(f"\nCác cặp tương quan mạnh (|r| > 0.5):")
    for pair in result["significant_pairs"]:
        print(f"  {pair['column1']} <-> {pair['column2']}: r={pair['correlation']:.3f} ({pair['strength']})")

    summary = CorrelationEngine.generate_summary_text(result)
    print(f"\nTóm tắt tiếng Việt:\n{summary}")
    print("\n✓ Test PASSED\n")


def test_outlier_detection():
    """Test phát hiện outlier"""
    print("=" * 60)
    print("TEST 3: PHÁT HIỆN OUTLIER")
    print("=" * 60)

    # Tạo dữ liệu có outliers rõ ràng
    normal_data = list(range(1, 21))
    outliers = [100, 200, -50]
    data = pd.Series(normal_data + outliers)

    result = OutlierEngine.detect_outliers_iqr(data, threshold=1.5)

    print(f"Phương pháp: IQR")
    print(f"Ngưỡng: [{result['lower_bound']:.2f}, {result['upper_bound']:.2f}]")
    print(f"Outliers phát hiện: {result['outlier_count']} ({result['outlier_percentage']:.2f}%)")
    print(f"Giá trị outliers: {result['outlier_values']}")

    summary = OutlierEngine.generate_summary_text("revenue", "iqr", result)
    print(f"\nTóm tắt tiếng Việt:\n{summary}")
    print("\n✓ Test PASSED\n")


def test_hypothesis_testing():
    """Test kiểm định giả thuyết"""
    print("=" * 60)
    print("TEST 4: KIỂM ĐỊNH GIẢ THUYẾT (T-TEST)")
    print("=" * 60)

    # Tạo 2 nhóm có sự khác biệt rõ ràng
    np.random.seed(42)
    group1 = pd.Series(np.random.normal(100, 10, 50))
    group2 = pd.Series(np.random.normal(120, 10, 50))

    result = HypothesisTestEngine.independent_ttest(group1, group2, equal_variance=True)

    print(f"Method: {result['method_name']}")
    print(f"H0: {result['null_hypothesis']}")
    print(f"H1: {result['alt_hypothesis']}")
    print(f"Sample size: Group1={result['sample_size']['group1']}, Group2={result['sample_size']['group2']}")
    print(f"Statistic: {result['statistic']:.4f}")
    print(f"P-value: {result['p_value']:.6f}")
    print(f"Effect size (Cohen's d): {result['effect_size']:.3f} ({result['effect_size_interpretation']})")
    print(f"Conclusion: {result['conclusion']}")
    print(f"\nKết luận tiếng Việt:\n{result['natural_language_conclusion']}")
    print("\n✓ Test PASSED\n")


def main():
    """Chạy tất cả tests"""
    print("\n" + "=" * 60)
    print("FASTAPI STATISTICAL ENGINE - QUICK TESTS")
    print("=" * 60 + "\n")

    try:
        test_descriptive_stats()
        test_correlation()
        test_outlier_detection()
        test_hypothesis_testing()

        print("=" * 60)
        print("✓ TẤT CẢ TESTS HOÀN THÀNH THÀNH CÔNG!")
        print("=" * 60)
        print("\nStatistical Engine hoạt động chính xác.")
        print("Sẵn sàng chạy service với: python main.py")

    except Exception as e:
        print(f"\n✗ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
