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
        json.dumps(r, allow_nan=False)

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
