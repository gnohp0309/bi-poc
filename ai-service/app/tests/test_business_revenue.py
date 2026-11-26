import csv
from pathlib import Path
import unittest

from app.routers.integration import ExecutionRequest, execute
from app.routers.legacy_analyze import AnalyzeRequest, analyze


CSV = Path(__file__).resolve().parents[3] / "demo" / "exploration_dirty_242.csv"
COLUMNS = ["date", "branch", "revenue"]


class BusinessRevenueTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with CSV.open(encoding="utf-8", newline="") as source:
            cls.rows = [[row[c] for c in COLUMNS] for row in csv.DictReader(source)]
        cls.columns = [
            {"name": name, "friendly_name": name, "type": kind, "kind": kind, "aggregates": [], "timeGrains": []}
            for name, kind in zip(COLUMNS, ["date", "text", "number"])
        ]

    def plan(self, question, history=None):
        return analyze(AnalyzeRequest(request_id="test", dataset_name="CSV 242", question=question,
                                      columns=self.columns, conversation_history=history or []))

    def run_plan(self, plan, rows=None):
        config = plan.statistics_config.model_dump(exclude_none=True)
        return execute(ExecutionRequest(dataset_id="test", operation=config.pop("operation"), parameters=config,
                                        columns=COLUMNS, data=self.rows if rows is None else rows))

    def test_ambiguous_period_requests_anchor_and_understands_reply(self):
        question = "So sánh doanh thu cùng kỳ"
        clarify = self.plan(question)
        self.assertEqual(clarify.intent, "clarify")
        self.assertIn("kỳ nào làm mốc", clarify.clarification)
        resolved = self.plan("Tháng 3/2025", [{"role": "user", "content": question},
                                             {"role": "assistant", "content": clarify.clarification}])
        report = self.run_plan(resolved)
        self.assertEqual(report["status"], "insufficient_data")
        self.assertEqual([r["Doanh thu"] for r in report["data"]["rows"]], [6900, None])
        self.assertEqual(report["charts"][0]["rows"], [{"label": "2025-03", "value": 6900}])

    def test_explicit_periods_and_percent(self):
        plan = self.plan("So sánh doanh thu tháng 3/2025 với tháng 1/2025 và vẽ biểu đồ.")
        report = self.run_plan(plan)
        self.assertEqual([r["Doanh thu"] for r in report["data"]["rows"]], [6900, 7110])
        self.assertIn("giảm 210", report["summary"])
        self.assertIn("-2,95%", report["summary"])
        self.assertEqual(report["charts"][0]["chartType"], "bar")

    def test_branch_ranks_and_explains_observable_difference(self):
        report = self.run_plan(self.plan("Chi nhánh nào có doanh thu thấp hơn và tại sao?"))
        rows = report["data"]["rows"]
        self.assertEqual([r["Chi nhánh"] for r in rows], ["B", "A", "C"])
        self.assertEqual([r["Tổng doanh thu"] for r in rows], [26580, 26880, 1026309])
        self.assertEqual([r["Dòng có doanh thu"] for r in rows], [79, 79, 80])
        self.assertEqual(report["rankChangingOutlier"], 999999)
        self.assertIn("300", report["summary"])
        self.assertIn("nguyên nhân kinh doanh", report["summary"])
        self.assertEqual(self.plan("Chi nhánh nào có doanh thu thấp hơn và tại sao? Xét toàn bộ dữ liệu.").statistics_config,
                         self.plan("Chi nhánh nào có doanh thu thấp hơn và tại sao?").statistics_config)

    def test_zero_base_is_not_missing_and_has_no_percent(self):
        plan = self.plan("So sánh doanh thu chi nhánh A tháng 3/2025 với tháng 1/2025")
        report = self.run_plan(plan, [["2025-03-01", "A", 100], ["2025-01-01", "A", 0], ["2025-01-01", "B", 70]])
        self.assertEqual(report["status"], "success")
        self.assertIn("Kỳ gốc bằng 0", report["summary"])
        self.assertEqual([r["Doanh thu"] for r in report["data"]["rows"]], [100, 0])

    def test_localized_integer_exclusion_changes_rank(self):
        question = ("Chi nhánh nào có tổng doanh thu thấp nhất nếu chỉ bỏ đúng dòng doanh thu 999.999? "
                    "Giữ nguyên các dòng còn lại, kể cả dòng trùng và ngày lỗi.")
        plan = self.plan(question)
        self.assertEqual(plan.statistics_config.excluded_integer, 999999)
        report = self.run_plan(plan)
        self.assertEqual([r["Chi nhánh"] for r in report["data"]["rows"]], ["C", "B", "A"])
        self.assertEqual([r["Tổng doanh thu"] for r in report["data"]["rows"]], [26310, 26580, 26880])
        self.assertNotIn("rankChangingOutlier", report)

    def test_duplicate_outlier_is_not_offered_as_single_row_exclusion(self):
        plan = self.plan("Chi nhánh nào có doanh thu thấp hơn?")
        report = self.run_plan(plan, self.rows + [["2025-03-01", "C", 999999]])
        self.assertNotIn("rankChangingOutlier", report)

    def test_exact_exclusion_refuses_missing_or_duplicate_matches(self):
        plan = self.plan("Chi nhánh nào có doanh thu thấp nhất sau khi loại một dòng doanh thu 10.000?")
        base = [["2025-03-01", "A", "10000.000000000001"], ["2025-01-01", "B", 50]]
        report = self.run_plan(plan, base)
        self.assertIn("Tìm thấy 0 dòng", report["reason"])
        report = self.run_plan(plan, base + [["2025-01-01", "B", 10000]]*2)
        self.assertIn("Tìm thấy 2 dòng", report["reason"])
        self.assertEqual(report["status"], "insufficient_data")

    def test_blank_count_groups_the_source_without_filtering_away_zero_groups(self):
        plan = self.plan("Trong toàn bộ file, có bao nhiêu dòng bị trống doanh thu và những dòng đó thuộc chi nhánh nào? Tính theo từng chi nhánh.")
        self.assertEqual(plan.query_config.metrics[0].aggregate, "count_blank")
        self.assertEqual(plan.query_config.groupBy[0].column, "branch")
        self.assertFalse(plan.query_config.filters)

    def change_report(self, question, rows):
        labels = [{"name": "category", "friendly_name": "Danh mục", "type": "text", "kind": "text",
                   "aggregates": [], "timeGrains": []}]
        response = analyze(AnalyzeRequest(request_id="test", dataset_name="CSV 242", question=question,
                                          columns=self.columns + labels))
        config = response.statistics_config.model_dump(exclude_none=True)
        return execute(ExecutionRequest(dataset_id="test", operation=config.pop("operation"), parameters=config,
                                        columns=COLUMNS + ["category"], data=rows))

    def test_explains_change_on_exact_months_with_category_contributions(self):
        with CSV.open(encoding="utf-8", newline="") as source:
            rows = [[row[c] for c in COLUMNS + ["category"]] for row in csv.DictReader(source)]
        rows += [["2025-04-17", "A", "123456", "Store"], ["2025-06-09", "B", "4444", "Online"]]
        report = self.change_report(
            "Vì sao doanh thu chi nhánh A giảm trong tháng 6/2025 so với tháng 3/2025? "
            "Hãy phân tích mức đóng góp theo danh mục nếu dữ liệu cho phép, và nêu giới hạn của kết luận.", rows)
        comparison = report["periodComparison"]
        self.assertEqual(comparison["delta"], -720)
        self.assertEqual(comparison["periods"]["2025-06"],
                         {"total": 6180, "rows": 20, "validRows": 19, "invalidRows": 1})
        self.assertEqual({r["Danh mục"]: r["Chênh lệch"] for r in report["data"]["rows"]},
                         {"Store": -6900, "Online": 6180})
        self.assertIn("1 dòng sai kiểu", report["summary"])
        self.assertIn("Chưa đủ dữ liệu để kết luận nguyên nhân", report["summary"])

    def test_change_uses_range_direction_and_distinguishes_missing_and_zero(self):
        report = self.change_report("Tại sao doanh thu từ tháng 3 năm 2025 đến tháng 6 năm 2025 lại giảm?",
                                    [["2025-03-01", "A", 0, "Store"], ["2025-06-01", "A", "2.01", None],
                                     ["2025-06-02", "A", None, "Store"]])
        self.assertEqual(report["periodComparison"]["delta"], 2.01)
        self.assertIsNone(report["periodComparison"]["percentChange"])
        self.assertIn("tăng 2,01", report["summary"])
        self.assertNotIn("Xác định được", report["summary"])
        by_category = {row["Danh mục"]: row["Chênh lệch"] for row in report["data"]["rows"]}
        self.assertEqual(by_category, {"(Thiếu danh mục)": 2.01, "Store": None})

    def test_change_requires_periods_and_does_not_guess_at_extra_filters(self):
        for question in ("Vì sao doanh thu giảm?", "Vì sao doanh thu giảm tháng 6/2025 so với tháng 6/2025?",
                         "Vì sao doanh thu giảm tháng 6/2025 so với tháng 3/2025, chỉ lấy Completed?"):
            self.assertEqual(self.plan(question).intent, "clarify")
        report = self.change_report("Vì sao doanh thu tháng 6/2025 giảm so với tháng 3/2025?",
                                    [["2025-06-01", "A", 15, "Store"]])
        self.assertEqual(report["status"], "insufficient_data")
        self.assertIsNone(report["periodComparison"]["delta"])

    def test_revenue_change_paraphrases_preserve_explicit_months_and_branch(self):
        for question in (
            "Vì sao doanh thu chi nhánh A giảm mạnh trong tháng 6/2025 so với tháng 3/2025?",
            "Giải thích giúp tôi tại sao doanh thu của chi nhánh A tháng 6/2025 thấp hơn tháng 3/2025.",
            "Tại sao doanh thu chi nhánh A sụt giảm đáng kể từ tháng 3 năm 2025 sang tháng 6 năm 2025?",
        ):
            with self.subTest(question=question):
                config = self.plan(question).statistics_config
                self.assertEqual(config.operation, "period_revenue")
                self.assertEqual(config.months, ["2025-06", "2025-03"])
                self.assertEqual(config.group_values, ["A"])
                self.assertTrue(config.explain_change)

    def test_short_branch_explanation_preserves_focus_and_existing_exclusion(self):
        history = [{"role": "assistant", "content": "Xếp hạng sau khi loại một ngoại lệ.",
                    "intent": "statistical", "branch_focus": "C", "statistics_config": {
                        "operation": "branch_revenue", "group_column": "branch", "value_column": "revenue",
                        "excluded_integer": 999999}},
                   {"role": "user", "content": "vì sao lại thấp"},
                   {"role": "assistant", "content": "Bạn muốn hỏi chi nhánh nào?", "intent": "clarify"}]
        plan = self.plan("nguyên nhân", history)
        self.assertEqual(plan.statistics_config.focus_branch, "C")
        self.assertEqual(plan.statistics_config.excluded_integer, 999999)
        report = self.run_plan(plan)
        self.assertEqual(report["branchComparison"], {"branch": "C", "referenceBranch": "B", "delta": -270})
        self.assertNotIn("rankChangingOutlier", report)

    def test_explains_named_branch_against_other_branches_with_actual_coverage(self):
        status = {"name": "status", "friendly_name": "Trạng thái", "type": "text", "kind": "text",
                  "aggregates": [], "timeGrains": []}
        plan = analyze(AnalyzeRequest(request_id="test", dataset_name="CSV 242", columns=self.columns + [status],
            question="chi nhánh B vì sao doanh thu lại thấp hơn các chi nhánh khác"))
        config = plan.statistics_config.model_dump(exclude_none=True)
        with CSV.open(encoding="utf-8", newline="") as source:
            rows = [[row[c] for c in COLUMNS + ["status"]] for row in csv.DictReader(source)]
        report = execute(ExecutionRequest(dataset_id="test", operation=config.pop("operation"), parameters=config,
                                          columns=COLUMNS + ["status"], data=rows))
        self.assertEqual(report["branchComparison"], {"branch": "B", "referenceBranch": "A", "delta": -300})
        for detail in ("26.580", "79", "336,46", "340,25", "các tháng khác nhau", "Pending", "Completed",
                       "999.999", "Chưa đủ bằng chứng"):
            self.assertIn(detail, report["summary"])

    def test_branch_followup_does_not_resume_across_a_new_topic_or_guess_a_branch(self):
        from app.engine.business_revenue import business_plan
        request = AnalyzeRequest(request_id="test", dataset_name="CSV 242", columns=self.columns, question="nguyên nhân",
            conversation_history=[
                {"role": "assistant", "content": "B thấp nhất", "branch_focus": "B", "statistics_config": {
                    "operation": "branch_revenue", "group_column": "branch", "value_column": "revenue"}},
                {"role": "user", "content": "Xem trung bình doanh thu tháng 3"},
                {"role": "assistant", "content": "Trung bình là 345", "intent": "query"},
            ])
        self.assertIsNone(business_plan(request.question, request.columns, request.conversation_history))
        report = self.run_plan(self.plan("Vì sao doanh thu chi nhánh Z thấp hơn các chi nhánh khác?"))
        self.assertEqual(report["status"], "insufficient_data")
        self.assertIn("chi nhánh Z", report["reason"])

    def test_ranking_accepts_paraphrases_and_punctuation_as_the_same_intent(self):
        prompts = [
            "Chi nhánh nào có tổng doanh thu thấp nhất ? Vì sao ?",
            "Cho tui biết chi nhánh nào đang có mức doanh thu thấp nhất, lý do là gì?",
            "Bạn hãy cho mình biết chi nhánh nào có doanh thu ít nhất trong dữ liệu này?",
            "Tổng doanh thu nhỏ nhất thuộc về chi nhánh nào? Tại sao?",
            "Xác định chi nhánh có doanh thu ít nhất trên toàn bộ file.",
            "xep hang doanh thu theo chi nhanh tu thap den cao",
        ]
        for prompt in prompts:
            with self.subTest(prompt=prompt):
                plan = self.plan(prompt)
                self.assertEqual(plan.intent, "statistical")
                self.assertEqual(plan.statistics_config.operation, "branch_revenue")
                report = self.run_plan(plan)
                self.assertEqual(report["data"]["rows"][0]["Chi nhánh"], "B")
                self.assertEqual(report["data"]["rows"][0]["Tổng doanh thu"], 26580)
        plan = self.plan("Doanh thu thấp nhất thuộc về chi nhánh nào? Sau khi chỉ bỏ đúng dòng doanh thu 999.999?")
        self.assertEqual(plan.statistics_config.excluded_integer, 999999)
        self.assertEqual(self.run_plan(plan)["data"]["rows"][0]["Chi nhánh"], "C")

    def test_ranking_does_not_discard_constraints_or_change_the_task(self):
        from app.engine.business_revenue import business_plan
        for prompt in [
            "Chi nhánh nào có tổng doanh thu thấp nhất trong tháng 3/2025? Vì sao?",
            "Chi nhánh nào có doanh thu thấp nhất, chỉ tính đơn Completed?",
            "Xếp hạng doanh thu theo chi nhánh từ cao đến thấp",
            "Tạo dashboard thể hiện chi nhánh nào có doanh thu thấp nhất",
        ]:
            with self.subTest(prompt=prompt):
                request = AnalyzeRequest(request_id="test", dataset_name="CSV 242", columns=self.columns, question=prompt)
                self.assertIsNone(business_plan(prompt, request.columns))

    def test_paraphrased_explanation_keeps_the_branch_from_the_last_result(self):
        history = [{"role": "assistant", "content": "B thấp nhất", "branch_focus": "B", "statistics_config": {
            "operation": "branch_revenue", "group_column": "branch", "value_column": "revenue"}}]
        for question in ("Vì sao doanh thu của chi nhánh đó lại thấp thế?", "Vì sao doanh thu của chi nhánh đó lại thấp?"):
            report = self.run_plan(self.plan(question, history))
            self.assertEqual(report["branchComparison"]["branch"], "B")
