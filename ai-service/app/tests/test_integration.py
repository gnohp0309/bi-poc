import json
import unittest
from unittest.mock import patch
import numpy as np
import pandas as pd
from scipy import stats
from fastapi.testclient import TestClient
from app.routers.integration import ExecutionRequest, execute
from app.utils.data_loader import DataLoader

def run(operation, frame_columns, data, **parameters):
    return execute(ExecutionRequest(dataset_id='real-dataset',operation=operation,parameters=parameters,columns=frame_columns,data=data))

class IntegrationTests(unittest.TestCase):
    def test_missing_dataset_never_falls_back_to_fake_data(self):
        for name in ('unknown', 'sample_sales', '../../private'):
            with self.assertRaises(ValueError):DataLoader.load_dataset(name)

    def test_context_scope_is_reset_and_dataset_identity_checked(self):
        with DataLoader.bind('a',pd.DataFrame({'x':[123]})):
            self.assertEqual(123,DataLoader.load_dataset('a')['x'][0])
            with self.assertRaises(ValueError):DataLoader.load_dataset('b')
        with self.assertRaises(ValueError):DataLoader.load_dataset('a')

    def test_singleton_and_empty_statistics_are_json_safe(self):
        for data in ([[7],[None]],[[None]],[]):
            result=run('descriptive',['x'],data,columns=['x'])
            json.dumps(result,allow_nan=False)
            self.assertIsNone(result['data']['rows'][0]['std'])

    def test_all_rows_not_preview_are_calculated(self):
        result=run('descriptive',['x'],[[i] for i in range(1,1002)],columns=['x'])
        self.assertEqual(1001,result['data']['rows'][0]['count'])
        self.assertEqual(501,result['data']['rows'][0]['mean'])
        self.assertFalse(result['provenance']['sampled'])

    def test_welch_confidence_interval_uses_unequal_variances(self):
        a=[1,2,3,5,6];b=[3,9,15,24,36,50]
        data=[[x,'A'] for x in a]+[[x,'B'] for x in b]
        result=run('independent_ttest',['x','g'],data,value_column='x',group_column='g')
        expected=stats.ttest_ind(a,b,equal_var=False)
        self.assertAlmostEqual(expected.pvalue,result['pValue']['value'])
        self.assertAlmostEqual(expected.confidence_interval().low,result['confidenceInterval']['lower'])
        self.assertTrue(any(a['status']=='not_checked' for a in result['assumptions']))

    def test_paired_test_statistic_ci_and_effect_have_same_direction(self):
        data=[[1,3],[2,5],[3,7],[4,8],[5,11],[None,100]]
        result=run('paired_ttest',['before','after'],data,column_before='before',column_after='after')
        expected=stats.ttest_rel([3,5,7,8,11],[1,2,3,4,5])
        self.assertAlmostEqual(expected.statistic,result['statistic']['value'])
        self.assertGreater(result['confidenceInterval']['lower'],0)
        self.assertEqual(1,result['sample']['missing'])

    def test_shapiro_large_and_insufficient_return_no_fabricated_pvalue(self):
        for data in ([[1],[2]],[[1]]*5001,[[5]]*10):
            result=run('shapiro_wilk',['x'],data,column='x')
            self.assertEqual('insufficient_data',result['status'])
            self.assertIsNone(result['pValue']['value'])
            json.dumps(result,allow_nan=False)

    def test_correlation_constant_is_null_not_zero(self):
        result=run('correlation',['x','constant'],[[1,5],[2,5],[3,5]],columns=['x','constant'],method='pearson')
        self.assertIsNone(result['data']['rows'][0]['correlation'])
        json.dumps(result,allow_nan=False)

    def test_outlier_count_and_display_limit_are_distinct(self):
        result=run('outlier',['x'],[[1]]*900+[[1000]]*101,column='x',method='iqr')
        self.assertEqual(101,result['statistics']['outlier_count'])
        self.assertEqual(100,len(result['data']['rows']))
        self.assertTrue(result['data']['truncated'])

    def test_selected_groups_do_not_become_missing_data(self):
        result=run('independent_ttest',['x','g'],[[1,'A'],[2,'A'],[3,'B'],[5,'B'],[100,'C']],value_column='x',group_column='g',group_values=['A','B'])
        self.assertEqual(5,result['sample']['total']);self.assertEqual(4,result['sample']['used'])
        self.assertEqual(0,result['sample']['missing']);self.assertEqual(1,result['sample']['excluded'])

    def test_internal_route_rejects_missing_or_wrong_key(self):
        import main
        client=TestClient(main.app)
        body={'dataset_id':'real','operation':'descriptive','parameters':{'columns':['x']},'columns':['x'],'data':[[1],[2]]}
        for key in ('','wrong'):
            self.assertEqual(403,client.post('/internal/statistics',json=body,headers={'X-POC-Internal-Key':key}).status_code)
        with patch.dict('os.environ',{'POC_SECRET_KEY':'test-only'}):
            response=client.post('/internal/statistics',json=body,headers={'X-POC-Internal-Key':'test-only'})
            self.assertEqual(200,response.status_code)
            self.assertEqual('real',response.json()['datasetId'])

if __name__=='__main__':unittest.main()
