import json
import unittest
from pathlib import Path
import numpy as np
import pandas as pd
from scipy import stats
from app.routers.integration import execute, ExecutionRequest


def run(op, data, input_columns, **parameters):
    return execute(ExecutionRequest(dataset_id='fixture', operation=op, data=data, columns=input_columns, parameters=parameters))


class ExplorationWorkflows(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frame = pd.read_csv(Path(__file__).resolve().parents[3] / 'demo/exploration_dirty_242.csv')

    def fixture(self, columns):
        data = self.frame[columns].copy()
        for col in columns:
            if col not in ('branch', 'category', 'date'):
                data[col] = pd.to_numeric(data[col], errors='coerce').replace([np.inf, -np.inf], np.nan)
        return data.astype(object).where(data.notna(), None).values.tolist()

    def test_242_insights_report_actual_anomaly_and_month(self):
        r = run('insights', self.fixture(['revenue','date']), ['revenue','date'], columns=['revenue'], date_column='date')
        self.assertEqual(242, r['sample']['total'])
        self.assertEqual(1, r['data']['rows'][0]['outliers'])
        self.assertEqual(999999, r['data']['rows'][0]['max'])
        months = {p['label']: p['value'] for p in r['charts'][0]['rows']}
        self.assertEqual(6900, months['2025-03'])
        self.assertEqual(1006419, months['2025-02'])
        self.assertIn('999999', r['summary'])
        self.assertIn('= 6420', r['summary'])
        self.assertEqual('2025-02', r['insightContext'][0]['peak_month'])
        json.dumps(r, allow_nan=False)

    def test_242_followup_compares_same_months_with_global_iqr_scope(self):
        r = run('insights', self.fixture(['revenue','date']), ['revenue','date'], columns=['revenue'],
                date_column='date', months=['2025-03','2025-02'], exclude_outliers=True)
        self.assertEqual([6420, 6900], [row['without_outliers'] for row in r['data']['rows']])
        self.assertEqual([1006419, 6900], [row['total'] for row in r['data']['rows']])
        self.assertEqual([6420, 6900], [point['value'] for point in r['charts'][0]['rows']])
        self.assertIn('= 480', r['summary'])

    def test_missing_month_is_not_zero(self):
        r = run('insights', [[17, '2025-02-01']], ['x','day'], columns=['x'], date_column='day',
                months=['2025-02','2025-03'])
        self.assertIsNone(r['data']['rows'][1]['total'])
        self.assertIsNone(r['charts'][0]['rows'][1]['value'])

    def test_interpretation_drops_invented_numeric_prose_and_keeps_evidence(self):
        from app.routers.interpret import InterpretationPlan, render_plan

        plan = InterpretationPlan(lead='Tổng là 9999.', evidence_ids=['row2', 'missing', 'row2', 'row1'],
                                  follow_up='Bạn muốn xem chi tiết không?')
        self.assertEqual('[[row2]]\n[[row1]]\nBạn muốn xem chi tiết không?',
                         render_plan(plan, {'row1':'6420', 'row2':'6900'}).answer)

    def test_conversation_keeps_requested_revenue_as_the_only_measure(self):
        from app.routers.legacy_analyze import AIPlan, AnalyzeRequest, keep_insight_focus

        plan = AIPlan(intent='statistical', statistics_config={'operation':'insights', 'columns':['c_revenue','c_cost']})
        request = AnalyzeRequest(request_id='a',dataset_name='CSV',question='Phân tích doanh thu giúp tui',columns=[
            {'name':name,'friendly_name':label,'kind':'number','type':'numeric','aggregates':['sum'],'timeGrains':[]}
            for name,label in [('c_revenue','revenue'),('c_cost','cost')]])
        initial = keep_insight_focus(plan, request).statistics_config
        self.assertEqual(['c_revenue'], initial.columns)
        followup = AnalyzeRequest.model_validate({**request.model_dump(), 'question':'So lại với tháng 3',
            'conversation_history':[{'role':'assistant','content':'Kết quả', 'statistics_config':initial.model_dump()}]})
        plan.statistics_config.months=['2025-02','2025-03']
        self.assertEqual(['c_revenue'], keep_insight_focus(plan, followup).statistics_config.columns)

    def test_auto_compares_missing_normality_variance_then_waits(self):
        r = run('auto_compare', self.fixture(['revenue','branch']), ['revenue','branch'],
                value_column='revenue', group_column='branch', group_values=['A','B'])
        self.assertEqual('needs_confirmation', r['status'])
        self.assertNotIn('pValue', r)
        self.assertEqual(158, r['sample']['used'])
        self.assertEqual(3, r['sample']['missing'])
        self.assertEqual(81, r['sample']['excluded'])
        self.assertEqual(4, len(r['assumptions']))

    def test_confirmed_242_selects_method_and_matches_scipy(self):
        r = run('auto_compare', self.fixture(['revenue','branch']), ['revenue','branch'],
                value_column='revenue', group_column='branch', group_values=['A','B'], independent=True)
        self.assertEqual('mann_whitney', r['selection']['operation'])
        self.assertAlmostEqual(.870144251139, r['pValue']['value'], places=9)
        self.assertTrue(any('không trực tiếp' in w for w in r['warnings']))

    def test_normal_independent_groups_use_welch_not_pooled_test(self):
        values = stats.norm.ppf(np.linspace(.01,.99,80))
        data = [[float(v), 'A'] for v in values] + [[float(v*3+2), 'B'] for v in values]
        r = run('auto_compare', data, ['x','g'], value_column='x', group_column='g', independent=True)
        self.assertEqual('independent_ttest', r['selection']['operation'])
        self.assertAlmostEqual(stats.ttest_ind(values,values*3+2,equal_var=False).pvalue, r['pValue']['value'])
        self.assertTrue(any(a['name'].startswith('Phương sai') and a['status']=='failed' for a in r['assumptions']))

    def test_constant_and_too_small_groups_never_fabricate_p(self):
        for data in ([[1,'A'],[1,'A'],[1,'B'],[1,'B']], [[None,'A'],[2,'B']]):
            try:
                r = run('auto_compare', data, ['x','g'], value_column='x', group_column='g')
                self.assertEqual('needs_confirmation', r['status'])
                self.assertNotIn('pValue', r)
                json.dumps(r, allow_nan=False)
            except ValueError as e:
                self.assertIn('nhóm', str(e))

    def test_empty_insights_no_fake_trend(self):
        r = run('insights', [[None,None]], ['x','day'], columns=['x'], date_column='day')
        self.assertEqual([], r['charts'])
        self.assertEqual(0,r['sample']['used'])

    def test_multi_group_auto_selection(self):
        values = stats.norm.ppf(np.linspace(.01,.99,60))
        data = [[float(v+i),str(i)] for i in range(3) for v in values]
        r = run('auto_compare', data, ['x','g'], value_column='x',group_column='g',independent=True)
        self.assertEqual('anova',r['selection']['operation'])
        data[-1][0] = 100000
        r = run('auto_compare', data, ['x','g'], value_column='x',group_column='g',independent=True)
        self.assertEqual('kruskal_wallis',r['selection']['operation'])
