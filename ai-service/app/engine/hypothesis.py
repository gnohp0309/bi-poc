"""Module B: Hypothesis Testing - Kiểm định giả thuyết với scipy, statsmodels, pingouin"""
import numpy as np
import pandas as pd
from scipy import stats
from typing import Optional, Union
import warnings


class HypothesisTestEngine:
    """
    Bộ máy kiểm định giả thuyết.
    Kiểm tra giả định trước khi chạy, tính chính xác statistic, p-value, effect size.
    """

    @staticmethod
    def shapiro_wilk_test(data: pd.Series, alpha: float = 0.05) -> dict:
        """
        Kiểm định phân phối chuẩn Shapiro-Wilk.
        H0: Dữ liệu tuân theo phân phối chuẩn.
        H1: Dữ liệu không tuân theo phân phối chuẩn.

        Args:
            data: pandas Series chứa dữ liệu số
            alpha: Mức ý nghĩa (mặc định 0.05)

        Returns:
            dict chứa kết quả kiểm định đầy đủ
        """
        clean_data = data.dropna()
        n = len(clean_data)

        # Kiểm tra giả định
        assumptions = {
            "min_sample_size": n >= 3,
            "max_sample_size": n <= 5000,  # Shapiro-Wilk nhạy với mẫu lớn
            "no_constant": clean_data.std() > 0
        }

        if not all(assumptions.values()):
            return {
                "method_name": "Shapiro-Wilk Test",
                "null_hypothesis": "Dữ liệu tuân theo phân phối chuẩn",
                "alt_hypothesis": "Dữ liệu không tuân theo phân phối chuẩn",
                "assumptions_met": False,
                "assumption_details": assumptions,
                "sample_size": n,
                "statistic": None,
                "p_value": None,
                "conclusion": "cannot_test",
                "natural_language_conclusion": (
                    f"Không thể thực hiện kiểm định Shapiro-Wilk. "
                    f"Cỡ mẫu: {n} (yêu cầu 3-5000). "
                    f"Độ lệch chuẩn: {clean_data.std():.4f} (phải > 0)."
                )
            }

        # Thực hiện kiểm định
        statistic, p_value = stats.shapiro(clean_data)

        # Kết luận
        reject_h0 = p_value < alpha
        conclusion = "reject_h0" if reject_h0 else "fail_to_reject_h0"

        # Tạo văn bản tiếng Việt
        if reject_h0:
            nl_conclusion = (
                f"Với mức ý nghĩa {alpha}, p-value = {p_value:.4f} < {alpha}, "
                f"chúng ta bác bỏ giả thuyết H0. "
                f"Kết luận: Dữ liệu KHÔNG tuân theo phân phối chuẩn. "
                f"Nên sử dụng các kiểm định phi tham số (Mann-Whitney, Kruskal-Wallis)."
            )
        else:
            nl_conclusion = (
                f"Với mức ý nghĩa {alpha}, p-value = {p_value:.4f} >= {alpha}, "
                f"chúng ta không có đủ bằng chứng để bác bỏ H0. "
                f"Kết luận: Dữ liệu CÓ THỂ tuân theo phân phối chuẩn. "
                f"Có thể sử dụng các kiểm định tham số (T-Test, ANOVA)."
            )

        return {
            "method_name": "Shapiro-Wilk Test",
            "null_hypothesis": "Dữ liệu tuân theo phân phối chuẩn",
            "alt_hypothesis": "Dữ liệu không tuân theo phân phối chuẩn",
            "assumptions_met": True,
            "assumption_details": assumptions,
            "sample_size": n,
            "statistic": float(statistic),
            "p_value": float(p_value),
            "confidence_interval": None,
            "effect_size": None,
            "effect_size_interpretation": None,
            "conclusion": conclusion,
            "natural_language_conclusion": nl_conclusion
        }

    @staticmethod
    def independent_ttest(group1: pd.Series, group2: pd.Series,
                         equal_variance: bool = True, alpha: float = 0.05) -> dict:
        """
        Kiểm định T-Test cho 2 nhóm độc lập.
        H0: Trung bình của 2 nhóm bằng nhau (μ1 = μ2).
        H1: Trung bình của 2 nhóm khác nhau (μ1 ≠ μ2).

        Args:
            group1, group2: Dữ liệu 2 nhóm
            equal_variance: Giả định phương sai bằng nhau
            alpha: Mức ý nghĩa

        Returns:
            dict chứa kết quả kiểm định
        """
        g1 = group1.dropna()
        g2 = group2.dropna()
        n1, n2 = len(g1), len(g2)

        # Kiểm tra giả định
        assumptions = {
            "min_sample_size_g1": n1 >= 2,
            "min_sample_size_g2": n2 >= 2,
            "normality_recommended": n1 >= 30 and n2 >= 30  # CLT áp dụng
        }

        if n1 < 2 or n2 < 2:
            return HypothesisTestEngine._insufficient_data_result(
                "Independent T-Test", n1, n2, assumptions
            )

        # Kiểm định Levene để kiểm tra phương sai đồng nhất
        levene_stat, levene_p = stats.levene(g1, g2)
        variances_equal = levene_p > 0.05
        assumptions["equal_variances"] = variances_equal

        # Thực hiện T-Test
        if equal_variance:
            statistic, p_value = stats.ttest_ind(g1, g2, equal_var=True)
        else:
            statistic, p_value = stats.ttest_ind(g1, g2, equal_var=False)  # Welch's T-Test

        # Tính Cohen's d (effect size)
        pooled_std = np.sqrt(((n1 - 1) * g1.std()**2 + (n2 - 1) * g2.std()**2) / (n1 + n2 - 2))
        cohens_d = (g1.mean() - g2.mean()) / pooled_std if pooled_std > 0 else 0

        effect_interp = HypothesisTestEngine._interpret_cohens_d(cohens_d)

        # Tính confidence interval cho sự khác biệt trung bình
        diff_mean = g1.mean() - g2.mean()
        se_diff = pooled_std * np.sqrt(1/n1 + 1/n2)
        t_critical = stats.t.ppf(1 - alpha/2, n1 + n2 - 2)
        ci_lower = diff_mean - t_critical * se_diff
        ci_upper = diff_mean + t_critical * se_diff

        # Kết luận
        reject_h0 = p_value < alpha
        conclusion = "reject_h0" if reject_h0 else "fail_to_reject_h0"

        test_type = "T-Test tiêu chuẩn" if equal_variance else "Welch's T-Test"

        if reject_h0:
            nl_conclusion = (
                f"Với mức ý nghĩa {alpha}, p-value = {p_value:.4f} < {alpha}, "
                f"chúng ta bác bỏ giả thuyết H0. "
                f"Kết luận: Trung bình của 2 nhóm CÓ SỰ KHÁC BIỆT có ý nghĩa thống kê. "
                f"Nhóm 1 (M={g1.mean():.2f}, SD={g1.std():.2f}) khác với "
                f"Nhóm 2 (M={g2.mean():.2f}, SD={g2.std():.2f}). "
                f"Kích thước hiệu ứng (Cohen's d={cohens_d:.3f}): {effect_interp}."
            )
        else:
            nl_conclusion = (
                f"Với mức ý nghĩa {alpha}, p-value = {p_value:.4f} >= {alpha}, "
                f"chúng ta không có đủ bằng chứng để bác bỏ H0. "
                f"Kết luận: KHÔNG CÓ bằng chứng cho thấy trung bình của 2 nhóm khác nhau. "
                f"Nhóm 1 (M={g1.mean():.2f}) và Nhóm 2 (M={g2.mean():.2f}) "
                f"có thể có trung bình tương đương."
            )

        return {
            "method_name": f"Independent T-Test ({test_type})",
            "null_hypothesis": "Trung bình của 2 nhóm bằng nhau (μ1 = μ2)",
            "alt_hypothesis": "Trung bình của 2 nhóm khác nhau (μ1 ≠ μ2)",
            "assumptions_met": all([v for k, v in assumptions.items() if k != "normality_recommended"]),
            "assumption_details": assumptions,
            "sample_size": {"group1": n1, "group2": n2},
            "statistic": float(statistic),
            "p_value": float(p_value),
            "confidence_interval": (float(ci_lower), float(ci_upper)),
            "effect_size": float(cohens_d),
            "effect_size_interpretation": effect_interp,
            "conclusion": conclusion,
            "natural_language_conclusion": nl_conclusion
        }

    @staticmethod
    def paired_ttest(before: pd.Series, after: pd.Series, alpha: float = 0.05) -> dict:
        """
        Kiểm định T-Test cho dữ liệu cặp (trước/sau).
        H0: Không có sự thay đổi trung bình (μ_diff = 0).
        H1: Có sự thay đổi trung bình (μ_diff ≠ 0).

        Args:
            before, after: Dữ liệu trước và sau
            alpha: Mức ý nghĩa

        Returns:
            dict chứa kết quả kiểm định
        """
        # Loại bỏ các cặp có giá trị thiếu
        df_temp = pd.DataFrame({"before": before, "after": after}).dropna()
        b = df_temp["before"]
        a = df_temp["after"]
        n = len(b)

        assumptions = {
            "min_sample_size": n >= 2,
            "paired_data": True
        }

        if n < 2:
            return {
                "method_name": "Paired T-Test",
                "assumptions_met": False,
                "assumption_details": assumptions,
                "sample_size": n,
                "natural_language_conclusion": f"Không đủ dữ liệu cặp hợp lệ (chỉ có {n} cặp)."
            }

        # Thực hiện Paired T-Test
        statistic, p_value = stats.ttest_rel(b, a)

        # Tính Cohen's d cho paired data
        diff = a - b
        cohens_d = diff.mean() / diff.std() if diff.std() > 0 else 0
        effect_interp = HypothesisTestEngine._interpret_cohens_d(cohens_d)

        # Confidence interval cho mean difference
        mean_diff = diff.mean()
        se_diff = diff.std() / np.sqrt(n)
        t_critical = stats.t.ppf(1 - alpha/2, n - 1)
        ci_lower = mean_diff - t_critical * se_diff
        ci_upper = mean_diff + t_critical * se_diff

        # Kết luận
        reject_h0 = p_value < alpha
        conclusion = "reject_h0" if reject_h0 else "fail_to_reject_h0"

        if reject_h0:
            change_dir = "tăng" if mean_diff > 0 else "giảm"
            nl_conclusion = (
                f"Với mức ý nghĩa {alpha}, p-value = {p_value:.4f} < {alpha}, "
                f"chúng ta bác bỏ giả thuyết H0. "
                f"Kết luận: CÓ SỰ THAY ĐỔI có ý nghĩa thống kê. "
                f"Giá trị trung bình {change_dir} từ {b.mean():.2f} lên {a.mean():.2f} "
                f"(chênh lệch = {mean_diff:.2f}). "
                f"Kích thước hiệu ứng (Cohen's d={cohens_d:.3f}): {effect_interp}."
            )
        else:
            nl_conclusion = (
                f"Với mức ý nghĩa {alpha}, p-value = {p_value:.4f} >= {alpha}, "
                f"chúng ta không có đủ bằng chứng để bác bỏ H0. "
                f"Kết luận: KHÔNG CÓ bằng chứng cho thấy có sự thay đổi đáng kể. "
                f"Trước (M={b.mean():.2f}) và Sau (M={a.mean():.2f}) "
                f"có thể không khác nhau."
            )

        return {
            "method_name": "Paired T-Test",
            "null_hypothesis": "Không có sự thay đổi trung bình (μ_diff = 0)",
            "alt_hypothesis": "Có sự thay đổi trung bình (μ_diff ≠ 0)",
            "assumptions_met": True,
            "assumption_details": assumptions,
            "sample_size": n,
            "statistic": float(statistic),
            "p_value": float(p_value),
            "confidence_interval": (float(ci_lower), float(ci_upper)),
            "effect_size": float(cohens_d),
            "effect_size_interpretation": effect_interp,
            "conclusion": conclusion,
            "natural_language_conclusion": nl_conclusion
        }

    @staticmethod
    def anova_oneway(groups: list[pd.Series], group_names: list[str], alpha: float = 0.05) -> dict:
        """
        Kiểm định ANOVA một chiều (3+ nhóm).
        H0: Tất cả các nhóm có trung bình bằng nhau.
        H1: Ít nhất một nhóm có trung bình khác biệt.

        Args:
            groups: Danh sách dữ liệu các nhóm
            group_names: Tên các nhóm
            alpha: Mức ý nghĩa

        Returns:
            dict chứa kết quả kiểm định
        """
        # Làm sạch dữ liệu
        clean_groups = [g.dropna() for g in groups]
        group_sizes = [len(g) for g in clean_groups]

        assumptions = {
            "min_groups": len(groups) >= 3,
            "all_groups_have_data": all(n >= 2 for n in group_sizes)
        }

        if not all(assumptions.values()):
            return {
                "method_name": "One-way ANOVA",
                "assumptions_met": False,
                "assumption_details": assumptions,
                "sample_size": {name: size for name, size in zip(group_names, group_sizes)},
                "natural_language_conclusion": "Không đủ điều kiện để thực hiện ANOVA (cần ít nhất 3 nhóm, mỗi nhóm >= 2 mẫu)."
            }

        # Thực hiện ANOVA
        statistic, p_value = stats.f_oneway(*clean_groups)

        # Tính Eta-squared (effect size cho ANOVA)
        all_data = pd.concat(clean_groups, ignore_index=True)
        grand_mean = all_data.mean()
        ss_between = sum(len(g) * (g.mean() - grand_mean)**2 for g in clean_groups)
        ss_total = sum((all_data - grand_mean)**2)
        eta_squared = ss_between / ss_total if ss_total > 0 else 0

        effect_interp = HypothesisTestEngine._interpret_eta_squared(eta_squared)

        # Kết luận
        reject_h0 = p_value < alpha
        conclusion = "reject_h0" if reject_h0 else "fail_to_reject_h0"

        # Tóm tắt các nhóm
        group_summary = ", ".join([
            f"{name} (M={g.mean():.2f}, n={len(g)})"
            for name, g in zip(group_names, clean_groups)
        ])

        if reject_h0:
            nl_conclusion = (
                f"Với mức ý nghĩa {alpha}, p-value = {p_value:.4f} < {alpha}, "
                f"chúng ta bác bỏ giả thuyết H0. "
                f"Kết luận: CÓ SỰ KHÁC BIỆT có ý nghĩa thống kê giữa các nhóm. "
                f"Ít nhất một nhóm có trung bình khác với các nhóm còn lại. "
                f"Các nhóm: {group_summary}. "
                f"Kích thước hiệu ứng (η²={eta_squared:.3f}): {effect_interp}. "
                f"Nên thực hiện Post-hoc test để xác định nhóm nào khác biệt."
            )
        else:
            nl_conclusion = (
                f"Với mức ý nghĩa {alpha}, p-value = {p_value:.4f} >= {alpha}, "
                f"chúng ta không có đủ bằng chứng để bác bỏ H0. "
                f"Kết luận: KHÔNG CÓ bằng chứng cho thấy sự khác biệt giữa các nhóm. "
                f"Các nhóm: {group_summary}."
            )

        return {
            "method_name": "One-way ANOVA",
            "null_hypothesis": "Tất cả các nhóm có trung bình bằng nhau",
            "alt_hypothesis": "Ít nhất một nhóm có trung bình khác biệt",
            "assumptions_met": True,
            "assumption_details": assumptions,
            "sample_size": {name: size for name, size in zip(group_names, group_sizes)},
            "statistic": float(statistic),
            "p_value": float(p_value),
            "confidence_interval": None,
            "effect_size": float(eta_squared),
            "effect_size_interpretation": effect_interp,
            "conclusion": conclusion,
            "natural_language_conclusion": nl_conclusion
        }

    @staticmethod
    def chi_square_test(contingency_table: pd.DataFrame, alpha: float = 0.05) -> dict:
        """
        Kiểm định Chi-Square cho biến phân loại.
        H0: Hai biến độc lập với nhau (không có mối liên hệ).
        H1: Hai biến có mối liên hệ với nhau.

        Args:
            contingency_table: Bảng chéo 2 biến phân loại
            alpha: Mức ý nghĩa

        Returns:
            dict chứa kết quả kiểm định
        """
        # Thực hiện Chi-Square test
        chi2, p_value, dof, expected = stats.chi2_contingency(contingency_table)

        # Kiểm tra giả định: Expected frequency >= 5
        min_expected = expected.min()
        assumptions = {
            "min_expected_freq_5": min_expected >= 5,
            "no_zero_cells": (contingency_table.values == 0).sum() == 0
        }

        # Tính Cramér's V (effect size)
        n = contingency_table.sum().sum()
        min_dim = min(contingency_table.shape[0], contingency_table.shape[1]) - 1
        cramers_v = np.sqrt(chi2 / (n * min_dim)) if min_dim > 0 else 0

        effect_interp = HypothesisTestEngine._interpret_cramers_v(cramers_v)

        # Kết luận
        reject_h0 = p_value < alpha
        conclusion = "reject_h0" if reject_h0 else "fail_to_reject_h0"

        if reject_h0:
            nl_conclusion = (
                f"Với mức ý nghĩa {alpha}, p-value = {p_value:.4f} < {alpha}, "
                f"chúng ta bác bỏ giả thuyết H0. "
                f"Kết luận: CÓ MỐI LIÊN HỆ có ý nghĩa thống kê giữa hai biến. "
                f"Kích thước hiệu ứng (Cramér's V={cramers_v:.3f}): {effect_interp}."
            )
        else:
            nl_conclusion = (
                f"Với mức ý nghĩa {alpha}, p-value = {p_value:.4f} >= {alpha}, "
                f"chúng ta không có đủ bằng chứng để bác bỏ H0. "
                f"Kết luận: KHÔNG CÓ bằng chứng cho thấy mối liên hệ giữa hai biến. "
                f"Hai biến có thể độc lập với nhau."
            )

        assumption_warning = ""
        if min_expected < 5:
            assumption_warning = " Cảnh báo: Một số ô có tần số kỳ vọng < 5, kết quả có thể không chính xác."

        return {
            "method_name": "Chi-Square Test of Independence",
            "null_hypothesis": "Hai biến độc lập với nhau (không có mối liên hệ)",
            "alt_hypothesis": "Hai biến có mối liên hệ với nhau",
            "assumptions_met": assumptions["min_expected_freq_5"],
            "assumption_details": assumptions,
            "sample_size": int(n),
            "statistic": float(chi2),
            "p_value": float(p_value),
            "degrees_of_freedom": int(dof),
            "confidence_interval": None,
            "effect_size": float(cramers_v),
            "effect_size_interpretation": effect_interp,
            "conclusion": conclusion,
            "natural_language_conclusion": nl_conclusion + assumption_warning
        }

    @staticmethod
    def mann_whitney_test(group1: pd.Series, group2: pd.Series, alpha: float = 0.05) -> dict:
        """
        Kiểm định Mann-Whitney U (phi tham số, 2 nhóm).
        H0: Hai nhóm có phân phối giống nhau.
        H1: Hai nhóm có phân phối khác nhau.

        Args:
            group1, group2: Dữ liệu 2 nhóm
            alpha: Mức ý nghĩa

        Returns:
            dict chứa kết quả kiểm định
        """
        g1 = group1.dropna()
        g2 = group2.dropna()
        n1, n2 = len(g1), len(g2)

        assumptions = {
            "min_sample_size": n1 >= 2 and n2 >= 2,
            "non_parametric": True
        }

        if n1 < 2 or n2 < 2:
            return HypothesisTestEngine._insufficient_data_result(
                "Mann-Whitney U Test", n1, n2, assumptions
            )

        # Thực hiện Mann-Whitney U Test
        statistic, p_value = stats.mannwhitneyu(g1, g2, alternative='two-sided')

        # Tính rank-biserial correlation (effect size)
        rank_biserial = 1 - (2 * statistic) / (n1 * n2)
        effect_interp = HypothesisTestEngine._interpret_rank_biserial(rank_biserial)

        # Kết luận
        reject_h0 = p_value < alpha
        conclusion = "reject_h0" if reject_h0 else "fail_to_reject_h0"

        if reject_h0:
            nl_conclusion = (
                f"Với mức ý nghĩa {alpha}, p-value = {p_value:.4f} < {alpha}, "
                f"chúng ta bác bỏ giả thuyết H0. "
                f"Kết luận: CÓ SỰ KHÁC BIỆT có ý nghĩa thống kê giữa 2 nhóm. "
                f"Nhóm 1 (Median={g1.median():.2f}, n={n1}) khác với "
                f"Nhóm 2 (Median={g2.median():.2f}, n={n2}). "
                f"Kích thước hiệu ứng (r={rank_biserial:.3f}): {effect_interp}."
            )
        else:
            nl_conclusion = (
                f"Với mức ý nghĩa {alpha}, p-value = {p_value:.4f} >= {alpha}, "
                f"chúng ta không có đủ bằng chứng để bác bỏ H0. "
                f"Kết luận: KHÔNG CÓ bằng chứng cho thấy sự khác biệt giữa 2 nhóm. "
                f"Nhóm 1 (Median={g1.median():.2f}) và Nhóm 2 (Median={g2.median():.2f})."
            )

        return {
            "method_name": "Mann-Whitney U Test",
            "null_hypothesis": "Hai nhóm có phân phối giống nhau",
            "alt_hypothesis": "Hai nhóm có phân phối khác nhau",
            "assumptions_met": True,
            "assumption_details": assumptions,
            "sample_size": {"group1": n1, "group2": n2},
            "statistic": float(statistic),
            "p_value": float(p_value),
            "confidence_interval": None,
            "effect_size": float(rank_biserial),
            "effect_size_interpretation": effect_interp,
            "conclusion": conclusion,
            "natural_language_conclusion": nl_conclusion
        }

    @staticmethod
    def kruskal_wallis_test(groups: list[pd.Series], group_names: list[str], alpha: float = 0.05) -> dict:
        """
        Kiểm định Kruskal-Wallis (phi tham số, 3+ nhóm).
        H0: Tất cả các nhóm có phân phối giống nhau.
        H1: Ít nhất một nhóm có phân phối khác biệt.

        Args:
            groups: Danh sách dữ liệu các nhóm
            group_names: Tên các nhóm
            alpha: Mức ý nghĩa

        Returns:
            dict chứa kết quả kiểm định
        """
        clean_groups = [g.dropna() for g in groups]
        group_sizes = [len(g) for g in clean_groups]

        assumptions = {
            "min_groups": len(groups) >= 3,
            "all_groups_have_data": all(n >= 2 for n in group_sizes),
            "non_parametric": True
        }

        if not all([assumptions["min_groups"], assumptions["all_groups_have_data"]]):
            return {
                "method_name": "Kruskal-Wallis Test",
                "assumptions_met": False,
                "assumption_details": assumptions,
                "sample_size": {name: size for name, size in zip(group_names, group_sizes)},
                "natural_language_conclusion": "Không đủ điều kiện để thực hiện Kruskal-Wallis (cần ít nhất 3 nhóm, mỗi nhóm >= 2 mẫu)."
            }

        # Thực hiện Kruskal-Wallis test
        statistic, p_value = stats.kruskal(*clean_groups)

        # Tính Epsilon-squared (effect size)
        n_total = sum(group_sizes)
        k = len(groups)
        epsilon_squared = (statistic - k + 1) / (n_total - k) if (n_total - k) > 0 else 0
        epsilon_squared = max(0, min(1, epsilon_squared))  # Clamp to [0, 1]

        effect_interp = HypothesisTestEngine._interpret_eta_squared(epsilon_squared)

        # Kết luận
        reject_h0 = p_value < alpha
        conclusion = "reject_h0" if reject_h0 else "fail_to_reject_h0"

        group_summary = ", ".join([
            f"{name} (Median={g.median():.2f}, n={len(g)})"
            for name, g in zip(group_names, clean_groups)
        ])

        if reject_h0:
            nl_conclusion = (
                f"Với mức ý nghĩa {alpha}, p-value = {p_value:.4f} < {alpha}, "
                f"chúng ta bác bỏ giả thuyết H0. "
                f"Kết luận: CÓ SỰ KHÁC BIỆT có ý nghĩa thống kê giữa các nhóm. "
                f"Ít nhất một nhóm có phân phối khác với các nhóm còn lại. "
                f"Các nhóm: {group_summary}. "
                f"Kích thước hiệu ứng (ε²={epsilon_squared:.3f}): {effect_interp}."
            )
        else:
            nl_conclusion = (
                f"Với mức ý nghĩa {alpha}, p-value = {p_value:.4f} >= {alpha}, "
                f"chúng ta không có đủ bằng chứng để bác bỏ H0. "
                f"Kết luận: KHÔNG CÓ bằng chứng cho thấy sự khác biệt giữa các nhóm. "
                f"Các nhóm: {group_summary}."
            )

        return {
            "method_name": "Kruskal-Wallis Test",
            "null_hypothesis": "Tất cả các nhóm có phân phối giống nhau",
            "alt_hypothesis": "Ít nhất một nhóm có phân phối khác biệt",
            "assumptions_met": True,
            "assumption_details": assumptions,
            "sample_size": {name: size for name, size in zip(group_names, group_sizes)},
            "statistic": float(statistic),
            "p_value": float(p_value),
            "confidence_interval": None,
            "effect_size": float(epsilon_squared),
            "effect_size_interpretation": effect_interp,
            "conclusion": conclusion,
            "natural_language_conclusion": nl_conclusion
        }

    # ========== Helper methods ==========

    @staticmethod
    def _insufficient_data_result(method: str, n1: int, n2: int, assumptions: dict) -> dict:
        """Trả về kết quả khi không đủ dữ liệu"""
        return {
            "method_name": method,
            "assumptions_met": False,
            "assumption_details": assumptions,
            "sample_size": {"group1": n1, "group2": n2},
            "statistic": None,
            "p_value": None,
            "conclusion": "cannot_test",
            "natural_language_conclusion": f"Không đủ dữ liệu để thực hiện {method}. Nhóm 1: {n1} mẫu, Nhóm 2: {n2} mẫu (yêu cầu mỗi nhóm >= 2)."
        }

    @staticmethod
    def _interpret_cohens_d(d: float) -> str:
        """Diễn giải Cohen's d"""
        abs_d = abs(d)
        if abs_d < 0.2:
            return "không đáng kể"
        elif abs_d < 0.5:
            return "nhỏ"
        elif abs_d < 0.8:
            return "trung bình"
        else:
            return "lớn"

    @staticmethod
    def _interpret_eta_squared(eta_sq: float) -> str:
        """Diễn giải Eta-squared hoặc Epsilon-squared"""
        if eta_sq < 0.01:
            return "không đáng kể"
        elif eta_sq < 0.06:
            return "nhỏ"
        elif eta_sq < 0.14:
            return "trung bình"
        else:
            return "lớn"

    @staticmethod
    def _interpret_cramers_v(v: float) -> str:
        """Diễn giải Cramér's V"""
        if v < 0.1:
            return "không đáng kể"
        elif v < 0.3:
            return "nhỏ"
        elif v < 0.5:
            return "trung bình"
        else:
            return "lớn"

    @staticmethod
    def _interpret_rank_biserial(r: float) -> str:
        """Diễn giải rank-biserial correlation"""
        abs_r = abs(r)
        if abs_r < 0.1:
            return "không đáng kể"
        elif abs_r < 0.3:
            return "nhỏ"
        elif abs_r < 0.5:
            return "trung bình"
        else:
            return "lớn"
