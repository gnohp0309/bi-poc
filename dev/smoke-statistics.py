"""Real Spring Boot -> real SciPy on imported data, with independent numerical oracles."""
import argparse
import csv
import json
import math
import time
import uuid
import urllib.request
import urllib.error
from pathlib import Path
import numpy as np
import pandas as pd
from scipy import stats

def run():
    parser=argparse.ArgumentParser()
    parser.add_argument('--base-url',default='http://127.0.0.1:8081/api')
    parser.add_argument('--keep',action='store_true')
    parser.add_argument('--large-file',type=Path)
    parser.add_argument('--output',type=Path)
    args=parser.parse_args();root=Path(__file__).resolve().parents[1];results=[];fixtures={}
    def call(path,method='GET',body=None,token=None,expect=200,content_type='application/json'):
        data=body if isinstance(body,bytes) else json.dumps(body).encode() if body is not None else None
        headers={'Content-Type':content_type}
        if token:headers['Authorization']='Bearer '+token
        req=urllib.request.Request(args.base_url.rstrip('/')+path,data=data,headers=headers,method=method)
        try:
            with urllib.request.urlopen(req,timeout=180) as r:status,payload=r.status,json.load(r)
        except urllib.error.HTTPError as r:status,payload=r.code,json.loads(r.read())
        assert status==expect,(path,status,expect,payload)
        return payload
    def login(name):return call('/auth/login','POST',{'username':name,'password':'Demo2026!'})['token']
    admin=login('admin');viewer=login('viewer');imports=[]
    def upload(path,title):
        b=uuid.uuid4().hex
        data=(f'--{b}\r\nContent-Disposition: form-data; name="title"\r\n\r\n{title}\r\n--{b}\r\nContent-Disposition: form-data; name="file"; filename="{path.name}"\r\nContent-Type: text/csv\r\n\r\n').encode()+path.read_bytes()+f'\r\n--{b}--\r\n'.encode()
        r=call('/imports','POST',data,admin,content_type='multipart/form-data; boundary='+b);imports.append(r['id']);return r
    def check(name,fn):
        start=time.monotonic()
        try:
            observed=fn();results.append({'name':name,'status':'PASS','seconds':round(time.monotonic()-start,3),'observed':observed})
        except Exception as e:
            results.append({'name':name,'status':'FAIL','error':str(e)[:2000]});raise
        finally:
            print(json.dumps(results[-1],ensure_ascii=True),flush=True)
            if args.output:
                args.output.parent.mkdir(exist_ok=True,parents=True)
                args.output.write_text(json.dumps({'results':results,'fixtures':fixtures},ensure_ascii=False,indent=2),encoding='utf-8')
    def close(a,b):assert math.isclose(a,b,rel_tol=1e-9,abs_tol=1e-10),(a,b)
    try:
        imported=upload(root/'demo/exploration_dirty_242.csv','Demo khám phá dữ liệu bẩn')
        dataset=imported['dataset_id'];fixtures.update(dataset=dataset,importId=imported['id'],dashboardId=imported['dashboard_id'])
        expected=json.loads((root/'demo/exploration_dirty_242.expected.json').read_text(encoding='utf-8'))
        frame=pd.read_csv(root/'demo/exploration_dirty_242.csv')
        for c in ['revenue','cost','before','after']:frame[c]=pd.to_numeric(frame[c],errors='coerce')
        def profile():
            r=call(f'/datasets/{dataset}/exploration',token=admin)
            assert r['overview']['rowCount']==242 and r['overview']['columnCount']==10
            assert r['quality']['duplicateRows']==2 and r['quality']['missingCells']==6
            assert r['quality']['importSnapshot']['missing_count']==3 and r['quality']['importSnapshot']['invalid_count']==3
            revenue=next(c for c in r['columns'] if c['name']=='c_revenue')
            assert revenue['validCount']==238 and revenue['importInvalidCount']==2 and revenue['importMissingCount']==2;close(revenue['mean'],expected['revenueMean'])
            close(revenue['median'],frame['revenue'].median());close(revenue['variance'],frame['revenue'].var())
            assert not r['sampled']
            return {'rows':242,'columns':10,'currentMissing':6,'originalMissing':3,'originalInvalid':3,'duplicates':2}
        check('Real CSV profiling, original errors vs current NULL, duplicates',profile)
        def execute(operation,**kw):return call(f'/datasets/{dataset}/statistics','POST',{'operation':operation,**kw},admin)
        def descriptive():
            r=execute('descriptive',columns=['c_revenue','c_cost']);a=r['data']['rows'][0]
            assert a['count']==238 and a['missing']==4
            for key,expected_value in [('mean',frame.revenue.mean()),('median',frame.revenue.median()),('std',frame.revenue.std()),('variance',frame.revenue.var()),('q1',frame.revenue.quantile(.25)),('q3',frame.revenue.quantile(.75))]:close(a[key],expected_value)
            return {'count':a['count'],'mean':a['mean'],'median':a['median']}
        check('Descriptive engine values against independent dataframe',descriptive)
        for method in ['pearson','spearman']:
            def correlation(method=method):
                r=execute('correlation',columns=['c_revenue','c_cost'],method=method)
                pairs=frame[['revenue','cost']].dropna();ref=stats.pearsonr(pairs.revenue,pairs.cost) if method=='pearson' else stats.spearmanr(pairs.revenue,pairs.cost)
                row=r['data']['rows'][0];close(row['correlation'],ref.statistic);close(row['p_value'],ref.pvalue)
                return {'n':row['n'],'coefficient':row['correlation']}
            check('Correlation '+method,correlation)
        for method in ['iqr','zscore']:
            def outlier(method=method):
                r=execute('outlier',column='c_revenue',method=method)
                assert r['statistics']['outlier_count']==1 and r['data']['rows'][0]['value']==999999
                return {'outliers':1,'value':999999}
            check('Outlier '+method,outlier)
        def hypothesis(op,reference,**kw):
            r=execute(op,**kw)
            assert r['kind']=='statistical_test' and r['status']=='success'
            close(r['statistic']['value'],reference.statistic);close(r['pValue']['value'],reference.pvalue)
            assert any(a['status']=='not_checked' for a in r['assumptions'])
            return {'statistic':r['statistic']['value'],'pValue':r['pValue']['value'],'sample':r['sample']}
        check('Shapiro real data',lambda:hypothesis('shapiro_wilk',stats.shapiro(frame.revenue.dropna()),column='c_revenue'))
        a=frame.loc[frame.branch=='A','revenue'].dropna();b=frame.loc[frame.branch=='B','revenue'].dropna()
        check('Welch independent t-test real groups',lambda:hypothesis('independent_ttest',stats.ttest_ind(a,b,equal_var=False),value_column='c_revenue',group_column='c_branch',group_values=['A','B'],equal_variance=False))
        check('Paired t-test real row alignment',lambda:hypothesis('paired_ttest',stats.ttest_rel(frame.after,frame.before),column_before='c_before',column_after='c_after'))
        groups=[g.revenue.dropna() for _,g in frame.groupby('branch')]
        check('ANOVA real groups',lambda:hypothesis('anova',stats.f_oneway(*groups),value_column='c_revenue',group_column='c_branch'))
        contingency=pd.crosstab(frame.branch,frame.category)
        chi=stats.chi2_contingency(contingency)
        check('Chi-square real categories',lambda:hypothesis('chi_square',chi,column1='c_branch',column2='c_category'))
        check('Mann Whitney real groups',lambda:hypothesis('mann_whitney',stats.mannwhitneyu(a,b,alternative='two-sided'),value_column='c_revenue',group_column='c_branch',group_values=['A','B']))
        check('Kruskal Wallis real groups',lambda:hypothesis('kruskal_wallis',stats.kruskal(*groups),value_column='c_revenue',group_column='c_branch'))
        def rejections():
            call(f'/datasets/{dataset}/statistics','POST',{'operation':'descriptive','columns':['c_revenue']},viewer,expect=403)
            call(f'/datasets/{dataset}/statistics','POST',{'operation':'descriptive','columns':['c_revenue']},expect=401)
            for body in [{'operation':'descriptive','columns':['secret']},{'operation':'descriptive','columns':['c_branch']},{'operation':'descriptive','columns':['c_revenue'],'sql':'SELECT * FROM app_users'},{'operation':'outlier','column':'c_revenue','threshold':-1}]:
                call(f'/datasets/{dataset}/statistics','POST',body,admin,expect=400)
            call(f'/datasets/{uuid.uuid4()}/statistics','POST',{'operation':'descriptive','columns':['x']},admin,expect=404)
            return '401/403/404 and invalid columns, types, raw SQL, thresholds correctly rejected'
        check('Auth dataset boundaries and invalid configurations',rejections)
        if args.large_file:
            start=time.monotonic();large=upload(args.large_file,'QA large statistics 500000');fixtures['largeDataset']=large['dataset_id']
            def large_stats():
                r=call(f"/datasets/{large['dataset_id']}/statistics",'POST',{'operation':'descriptive','columns':['c_amount']},admin)
                value=r['data']['rows'][0];assert value['count']==500000;close(value['mean'],50.5)
                return {'count':500000,'mean':value['mean'],'sum':value['mean']*value['count'],'importAndAnalysisSeconds':round(time.monotonic()-start,2)}
            check('Actual imported 500000 rows to real Python engine',large_stats)
        print('STATISTICS INTEGRATION PASS',flush=True)
    finally:
        if not args.keep:
            for id in imports:call('/imports/'+id,'DELETE',token=admin)
        call('/auth/logout','POST',{},admin);call('/auth/logout','POST',{},viewer)

if __name__=='__main__':run()
