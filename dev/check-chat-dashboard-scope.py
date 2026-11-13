"""Check a Chat-created March dashboard in an isolated CSV-242 test database."""
import argparse
import json
import urllib.request
import urllib.error
from pathlib import Path

p=argparse.ArgumentParser()
p.add_argument('--base-url',default='http://127.0.0.1:18086/api')
p.add_argument('--dashboard',required=True)
p.add_argument('--dataset',required=True)
p.add_argument('--output',type=Path,required=True)
args=p.parse_args()
token=None
def api(path,body=None,method=None):
    headers={'Content-Type':'application/json'}
    if token:headers['Authorization']='Bearer '+token
    req=urllib.request.Request(args.base_url+path,data=json.dumps(body).encode() if body is not None else None,headers=headers,method=method)
    with urllib.request.urlopen(req,timeout=90) as r:return json.load(r)

token=api('/auth/login',{'username':'admin','password':'Demo2026!'})['token']
base='/dashboards/'+args.dashboard;records=[]
def passed(name):records.append({'case':name,'status':'PASS'});print(name+' PASS',flush=True)
detail=api(base)
assert detail['scopeFilters']==[{'column':'c_date','op':'date','value':'2025-03-01','end':'2025-03-31','datasetId':args.dataset}]
for chart in detail['charts']:assert sum(row['value'] for row in chart['rows'])==6900
passed('persisted March scope on GET')
for chart_type in ('line','bar','pie','donut','kpi','histogram','scatter','heatmap','map','stacked-bar','stacked-area'):
    spec={'datasetId':args.dataset,'name':'Scope '+chart_type,'chartType':chart_type,'metric':'c_revenue','aggregate':'sum','dimension':'c_branch'}
    if chart_type in ('line','stacked-area'):spec.update(dimension='c_date',timeGrain='month')
    if chart_type in ('kpi','histogram','heatmap','map'):spec['dimension']=''
    if chart_type=='histogram':spec.update(aggregate='count',binCount=10)
    if chart_type=='scatter':spec['dimension']='c_cost'
    if chart_type=='heatmap':spec.update(aggregate='count',numericColumns=['c_revenue','c_cost'])
    if chart_type=='map':spec.update(latitude='c_latitude',longitude='c_longitude',labelColumn='c_branch')
    if chart_type.startswith('stacked-'):spec['seriesDimension']='c_category'
    chart=api(base+'/preview',{'chart':spec,'filters':[]})
    assert chart['chartType']==chart_type and chart['rows'],chart
    if chart_type in ('line','bar','pie','donut','kpi','map','stacked-bar','stacked-area'):assert sum(r['value'] for r in chart['rows'])==6900,chart
    if chart_type=='histogram':assert sum(r['value'] for r in chart['rows'])==20
    passed('scoped preview '+chart_type)
    if chart_type=='kpi':kpi=api('/charts',spec)['id']
original_ids=[c['id'] for c in detail['charts']]
api(base+'/layout',{'chartIds':original_ids+[kpi]},'PUT')
assert next(c for c in api(base)['charts'] if c['id']==kpi)['rows'][0]['value']==6900
passed('new KPI obeys saved scope')
drill=api(base+'/charts/'+kpi+'/drill',{'filters':[]})
assert len(drill['rows'])==20
assert all(str(row['c_date']).startswith('2025-03') for row in drill['rows'])
assert sum(row['c_revenue'] for row in drill['rows'])==6900
passed('KPI drill stays in March and reconciles')
filtered=api(base+'/query',{'filters':[{'datasetId':args.dataset,'column':'c_branch','op':'eq','value':'B'}]})
assert next(c for c in filtered['charts'] if c['id']==kpi)['rows'][0]['value'] is None
filtered=api(base+'/query',{'filters':[{'datasetId':args.dataset,'column':'c_date','op':'date','value':'2025-02-01','end':'2025-02-28'}]})
assert next(c for c in filtered['charts'] if c['id']==kpi)['rows'][0]['value'] is None
passed('additional filters cannot widen saved scope')
assert next(c for c in api(base+'/query',{'filters':[]})['charts'] if c['id']==kpi)['rows'][0]['value']==6900
passed('refresh and clearing temporary filters keep March')
share=api(base+'/share',{})['token']
public=api('/share/'+share)
assert next(c for c in public['charts'] if c['id']==kpi)['rows'][0]['value']==6900
api(base+'/share',method='DELETE')
passed('public share preserves scope and can be revoked')
api(base+'/layout',{'chartIds':[]},'PUT')
assert api(base+'/query',{'filters':[]})['charts']==[]
api(base+'/layout',{'chartIds':original_ids},'PUT')
api('/charts/'+kpi,method='DELETE')
passed('empty scoped dashboard remains usable and accepts charts again')
for bad in ({'column':'missing','op':'eq','value':'A'}, {'column':'c_date','op':'date','value':'2025-03-31','end':'2025-03-01'}):
    try:
        api(base+'/query',{'filters':[dict(bad,datasetId=args.dataset)]})
        raise AssertionError('Invalid filter accepted')
    except urllib.error.HTTPError as e:assert e.code==400
passed('invalid columns and inverted dates rejected')
users=api('/users')
if not any(u['username']=='viewer' for u in users):api('/users',{'username':'viewer','password':'Demo2026!','role':'VIEWER'})
token=api('/auth/login',{'username':'viewer','password':'Demo2026!'})['token']
assert api('/datasets/'+args.dataset+'/exploration')['overview']['rowCount']==242
assert len(api(base)['charts'])==3
for path,body in (('/chat/conversations',{'datasetId':args.dataset,'title':'Not allowed'}),(base,{'name':'Not allowed'})):
    try:
        api(path,body,'POST' if path.startswith('/chat') else 'PUT');raise AssertionError('Viewer mutation accepted')
    except urllib.error.HTTPError as e:assert e.code==403
passed('Viewer can read profiling and dashboard but cannot mutate or call paid chat')
args.output.write_text(json.dumps(records,indent=2),encoding='utf-8')
