"""Unit Tests cho Hypothesis Testing Engine"""
import unittest
import numpy as np
import pandas as pd
from scipy import stats

from app.engine.hypothesis import HypothesisTestEngine


class TestShapiroWilkTest(unittest.TestCase):
    """Test kiểm định Shapiro-Wilk"""

    def test_normal_distribution(self):
        """Test với dữ liệu phân phối chuẩn"""
        np.random.seed(42)
        normal_data = pd.Series(np.random.normal(100, 15, 100))

        result = HypothesisTestEngine.shapiro_wilk_test(normal_data, alpha=0.05)

        self.assertEqual(result["method_name"], "Shapiro-Wilk Test")
        self.assertTrue(result["assumptions_met"])
        self.assertEqual(result["sample_size"], 100)
        self.assertIsNotNone(result["statistic"])
        self.assertIsNotNone(result["p_value"])

        # So sánh với scipy
        expected_stat, expected_p = stats.shapiro(normal_data)
        self.assertAlmostEqual(result["statistic"], expected_stat, places=6)
        self.assertAlmostEqual(result["p_value"], expected_p, places=6)

    def test_non_normal_distribution(self):
        """Test với dữ liệu không phân phối chuẩn"""
        # Phân phối uniform rõ ràng không chuẩn
        uniform_data = pd.Series(np.random.uniform(0, 100, 100))

        result = HypothesisTestEngine.shapiro_wilk_test(uniform_data, alpha=0.05)

        # Kết quả phải khớp với scipy
        expected_stat, expected_p = stats.shapiro(uniform_data)
        self.assertAlmostEqual(result["statistic"], expected_stat, places=6)
        self.assertAlmostEqual(result["p_value"], expected_p, places=6)

    def test_insufficient_sample_size(self):
        """Test với mẫu quá nhỏ"""
        small_data = pd.Series([1, 2])

        result = HypothesisTestEngine.shapiro_wilk_test(small_data)

        self.assertFalse(result["assumptions_met"])
        self.assertEqual(result["conclusion"], "cannot_test")


class TestIndependentTTest(unittest.TestCase):
    """Test kiểm định Independent T-Test"""

    def test_significant_difference(self):
        """Test với 2 nhóm có sự khác biệt rõ ràng"""
        np.random.seed(42)
        group1 = pd.Series(np.random.normal(100, 10, 50))
        group2 = pd.Series(np.random.normal(120, 10, 50))  # Khác biệt 20 đơn vị

        result = HypothesisTestEngine.independent_ttest(group1, group2, equal_variance=True)

        self.assertEqual(result["method_name"], "Independent T-Test (T-Test tiêu chuẩn)")
        self.assertTrue(result["assumptions_met"])
        self.assertEqual(result["sample_size"]["group1"], 50)
        self.assertEqual(result["sample_size"]["group2"], 50)

        # So sánh với scipy
        expected_stat, expected_p = stats.ttest_ind(group1, group2, equal_var=True)
        self.assertAlmostEqual(result["statistic"], expected_stat, places=6)
        self.assertAlmostEqual(result["p_value"], expected_p, places=6)

        # Với sự khác biệt rõ ràng, p-value nên nhỏ
        self.assertLess(result["p_value"], 0.05)
        self.assertEqual(result["conclusion"], "reject_h0")

    def test_no_difference(self):
        """Test với 2 nhóm giống nhau"""
        np.random.seed(42)
        group1 = pd.Series(np.random.normal(100, 10, 50))
        group2 = pd.Series(np.random.normal(100, 10, 50))  # Cùng phân phối

        result = HypothesisTestEngine.independent_ttest(group1, group2)

        # p-value nên lớn hơn 0.05
        self.assertGreater(result["p_value"], 0.05)
        self.assertEqual(result["conclusion"], "fail_to_reject_h0")

    def test_cohens_d_effect_size(self):
        """Test tính Cohen's d"""
        group1 = pd.Series([1, 2, 3, 4, 5])
        group2 = pd.Series([3, 4, 5, 6, 7])

        result = HypothesisTestEngine.independent_ttest(group1, group2)

        self.assertIsNotNone(result["effect_size"])
        self.assertIsNotNone(result["effect_size_interpretation"])


class TestPairedTTest(unittest.TestCase):
    """Test kiểm định Paired T-Test"""

    def test_significant_change(self):
        """Test với sự thay đổi rõ ràng"""
        np.random.seed(42)
        before = pd.Series(np.random.normal(100, 10, 50))
        after = before + 10 + np.random.normal(0, 2, 50)  # Tăng 10 đơn vị

        result = HypothesisTestEngine.paired_ttest(before, after)

        self.assertEqual(result["method_name"], "Paired T-Test")
        self.assertTrue(result["assumptions_met"])

        # So sánh với scipy
        expected_stat, expected_p = stats.ttest_rel(before, after)
        self.assertAlmostEqual(result["statistic"], expected_stat, places=6)
        self.assertAlmostEqual(result["p_value"], expected_p, places=6)

        self.assertLess(result["p_value"], 0.05)
        self.assertEqual(result["conclusion"], "reject_h0")

    def test_no_change(self):
        """Test với không có thay đổi"""
        np.random.seed(42)
        before = pd.Series(np.random.normal(100, 10, 50))
        after = before + np.random.normal(0, 1, 50)  # Chỉ noise nhỏ

        result = HypothesisTestEngine.paired_ttest(before, after)

        self.assertGreater(result["p_value"], 0.05)
        self.assertEqual(result["conclusion"], "fail_to_reject_h0")


class TestANOVA(unittest.TestCase):
    """Test kiểm định ANOVA"""

    def test_significant_difference_three_groups(self):
        """Test với 3 nhóm có sự khác biệt"""
        np.random.seed(42)
        group1 = pd.Series(np.random.normal(100, 10, 30))
        group2 = pd.Series(np.random.normal(110, 10, 30))
        group3 = pd.Series(np.random.normal(120, 10, 30))

        groups = [group1, group2, group3]
        group_names = ["A", "B", "C"]

        result = HypothesisTestEngine.anova_oneway(groups, group_names)

        self.assertEqual(result["method_name"], "One-way ANOVA")
        self.assertTrue(result["assumptions_met"])

        # So sánh với scipy
        expected_stat, expected_p = stats.f_oneway(group1, group2, group3)
        self.assertAlmostEqual(result["statistic"], expected_stat, places=6)
        self.assertAlmostEqual(result["p_value"], expected_p, places=6)

    def test_insufficient_groups(self):
        """Test với ít hơn 3 nhóm"""
        group1 = pd.Series([1, 2, 3])
        group2 = pd.Series([4, 5, 6])

        result = HypothesisTestEngine.anova_oneway([group1, group2], ["A", "B"])

        self.assertFalse(result["assumptions_met"])


class TestChiSquareTest(unittest.TestCase):
    """Test kiểm định Chi-Square"""

    def test_independence(self):
        """Test kiểm định độc lập"""
        # Tạo contingency table giả định
        contingency = pd.DataFrame({
            "Cat1": [10, 20, 30],
            "Cat2": [15, 25, 35],
            "Cat3": [5, 10, 15]
        })

        result = HypothesisTestEngine.chi_square_test(contingency)

        self.assertEqual(result["method_name"], "Chi-Square Test of Independence")
        self.assertIsNotNone(result["statistic"])
        self.assertIsNotNone(result["p_value"])

        # So sánh với scipy
        expected_chi2, expected_p, expected_dof, _ = stats.chi2_contingency(contingency)
        self.assertAlmostEqual(result["statistic"], expected_chi2, places=6)
        self.assertAlmostEqual(result["p_value"], expected_p, places=6)


class TestMannWhitneyTest(unittest.TestCase):
    """Test kiểm định Mann-Whitney U"""

    def test_non_parametric_comparison(self):
        """Test so sánh phi tham số"""
        np.random.seed(42)
        # Dữ liệu không phân phối chuẩn
        group1 = pd.Series(np.random.exponential(10, 50))
        group2 = pd.Series(np.random.exponential(15, 50))

        result = HypothesisTestEngine.mann_whitney_test(group1, group2)

        self.assertEqual(result["method_name"], "Mann-Whitney U Test")
        self.assertTrue(result["assumptions_met"])

        # So sánh với scipy
        expected_stat, expected_p = stats.mannwhitneyu(group1, group2, alternative='two-sided')
        self.assertAlmostEqual(result["statistic"], expected_stat, places=6)
        self.assertAlmostEqual(result["p_value"], expected_p, places=6)


class TestKruskalWallisTest(unittest.TestCase):
    """Test kiểm định Kruskal-Wallis"""

    def test_non_parametric_multiple_groups(self):
        """Test so sánh phi tham số nhiều nhóm"""
        np.random.seed(42)
        group1 = pd.Series(np.random.exponential(10, 30))
        group2 = pd.Series(np.random.exponential(12, 30))
        group3 = pd.Series(np.random.exponential(15, 30))

        groups = [group1, group2, group3]
        group_names = ["A", "B", "C"]

        result = HypothesisTestEngine.kruskal_wallis_test(groups, group_names)

        self.assertEqual(result["method_name"], "Kruskal-Wallis Test")
        self.assertTrue(result["assumptions_met"])

        # So sánh với scipy
        expected_stat, expected_p = stats.kruskal(group1, group2, group3)
        self.assertAlmostEqual(result["statistic"], expected_stat, places=6)
        self.assertAlmostEqual(result["p_value"], expected_p, places=6)


class TestEffectSizeInterpretations(unittest.TestCase):
    """Test các hàm diễn giải effect size"""

    def test_cohens_d_interpretation(self):
        """Test diễn giải Cohen's d"""
        self.assertEqual(HypothesisTestEngine._interpret_cohens_d(0.1), "không đáng kể")
        self.assertEqual(HypothesisTestEngine._interpret_cohens_d(0.3), "nhỏ")
        self.assertEqual(HypothesisTestEngine._interpret_cohens_d(0.6), "trung bình")
        self.assertEqual(HypothesisTestEngine._interpret_cohens_d(1.0), "lớn")

    def test_eta_squared_interpretation(self):
        """Test diễn giải Eta-squared"""
        self.assertEqual(HypothesisTestEngine._interpret_eta_squared(0.005), "không đáng kể")
        self.assertEqual(HypothesisTestEngine._interpret_eta_squared(0.03), "nhỏ")
        self.assertEqual(HypothesisTestEngine._interpret_eta_squared(0.10), "trung bình")
        self.assertEqual(HypothesisTestEngine._interpret_eta_squared(0.20), "lớn")


if __name__ == "__main__":
    unittest.main()
