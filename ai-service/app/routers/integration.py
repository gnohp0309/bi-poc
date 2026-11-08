"""Execute real dataset frames supplied by Spring Boot, never numbers from an LLM."""
import hmac
import math
import os
import warnings
from typing import Any, Literal
import numpy as np
import pandas as pd
import scipy
from scipy import stats
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from app.engine.descriptive import DescriptiveEngine, CorrelationEngine, OutlierEngine
from app.engine.hypothesis import HypothesisTestEngine
from app.utils.data_loader import DataLoader

router = APIRouter(tags=['Internal dataset execution'])
OPERATIONS = Literal['descriptive','correlation','outlier','shapiro_wilk','independent_ttest',
    'paired_ttest','anova','chi_square','mann_whitney','kruskal_wallis']

class ExecutionRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    dataset_id: str
    operation: OPERATIONS
    parameters: dict[str, Any]
    columns: list[str] = Field(min_length=1,max_length=10)
    data: list[list[Any]] = Field(max_length=1_000_000)

def finite(value):
    if isinstance(value,dict):return {str(k):finite(v) for k,v in value.items()}
    if isinstance(value,(tuple,list)):return [finite(v) for v in value]
    if isinstance(value,(float,np.floating)):return float(value) if math.isfinite(value) else None
    if isinstance(value,np.integer):return int(value)
    if isinstance(value,np.bool_):return bool(value)
    return value

def table(rows,columns=None):
    return {'columns':columns or (list(rows[0]) if rows else []),'rows':finite(rows),'rowCount':len(rows),'truncated':False}

def chart(kind,rows,name,**extra):
    return {'chartType':kind,'rows':finite(rows),'name':name,'dimension':'','metric':'','aggregate':'count',**extra}

def measure(value,reason='Không áp dụng hoặc không xác định cho dữ liệu này'):
    v=finite(value)
    return {'status':'available','value':v} if v is not None else {'status':'not_applicable','value':None,'reason':reason}

def execute(request: ExecutionRequest):
    if any(len(row)!=len(request.columns) for row in request.data):raise ValueError('Số cột không khớp cấu trúc')
    frame=pd.DataFrame(request.data,columns=request.columns)
    p=request.parameters;op=request.operation;total=len(frame);used=0;groups_summary=[]
    result={'schemaVersion':1,'kind':'query','status':'success','title':'Kết quả khám phá thống kê',
        'datasetId':request.dataset_id,'warnings':[],'charts':[],
        'provenance':{'engine':'SciPy / pandas','version':scipy.__version__,'sampled':False,'scope':'dataset-definition',
        'missingPolicy':'Bỏ NULL và số không hữu hạn; phân tích nhiều biến dùng dòng đầy đủ cho các biến được chọn'}}
    categorical={p.get('group_column'),p.get('column1'),p.get('column2')}
    for name in frame.columns:
        if name not in categorical:frame[name]=pd.to_numeric(frame[name],errors='coerce').replace([np.inf,-np.inf],np.nan)
        else:frame[name]=frame[name].map(lambda v:None if isinstance(v,str) and not v.strip() else v)
    if p.get('group_values'):
        frame=frame.loc[frame[p['group_column']].isin(p['group_values'])].copy()
        result['warnings'].append('Chỉ phân tích các nhóm được yêu cầu; total vẫn là số dòng dataset.')
    alpha=float(p.get('alpha',.05))
    with DataLoader.bind(request.dataset_id,frame):
        if op=='descriptive':
            rows=finite(DescriptiveEngine.calculate_multi_column_stats(frame,p['columns']))
            result['title']='Thống kê mô tả';result['data']=table(rows)
            result['summary']='Thống kê trên toàn bộ giá trị hợp lệ; độ lệch chuẩn/phương sai mẫu (ddof=1).'
            for name in p['columns'][:3]:
                values=frame[name].dropna().to_numpy(dtype=float)
                if len(values):
                    counts,edges=np.histogram(values,bins=min(12,max(2,int(np.sqrt(len(values))))))
                    points=[{'lower_bound':float(edges[i]),'upper_bound':float(edges[i+1]),'value':int(v)} for i,v in enumerate(counts)]
                    result['charts'].append(chart('histogram',points,'Phân phối '+name,metric=name))
            used=int(frame[p['columns']].notna().any(axis=1).sum())
        elif op=='correlation':
            names=p['columns'];clean=frame[names].dropna();method=p.get('method','pearson')
            if len(clean)<3:raise ValueError('Cần ít nhất 3 dòng đầy đủ để tính tương quan')
            raw=CorrelationEngine.calculate_correlation(frame,names,method);rows=[]
            for i,a in enumerate(names):
                for b in names[i+1:]:
                    pair=stats.pearsonr(clean[a],clean[b]) if method=='pearson' else stats.spearmanr(clean[a],clean[b])
                    rows.append({'column1':a,'column2':b,'correlation':finite(pair.statistic),'p_value':finite(pair.pvalue),'n':len(clean)})
            result['title']='Tương quan '+method;result['data']=table(rows)
            points=[{'x':a,'y':b,'value':finite(raw['correlation_matrix'][a][b])} for a in names for b in names]
            result['charts']=[chart('heatmap',points,'Ma trận tương quan',numericColumns=names)]
            result['summary']=f'Tính trên {len(clean)} dòng đầy đủ. Tương quan không chứng minh nhân quả.'
            result['warnings'].append('Cột hằng có hệ số NULL. P-value từng cặp chưa điều chỉnh kiểm định nhiều lần.')
            used=len(clean)
        elif op=='outlier':
            name=p['column'];method=p.get('method','iqr');threshold=float(p.get('threshold',1.5 if method=='iqr' else 3))
            fn=OutlierEngine.detect_outliers_iqr if method=='iqr' else OutlierEngine.detect_outliers_zscore
            raw=fn(frame[name],threshold);indices=raw['outlier_indices'][:100]
            result['title']='Ngoại lệ '+method.upper()
            result['data']=table([{'position':int(i)+1,'value':float(frame.loc[i,name])} for i in indices],['position','value'])
            result['data']['truncated']=raw['outlier_count']>100
            result['summary']=OutlierEngine.generate_summary_text(name,method,raw) or f"Phát hiện {raw['outlier_count']} ngoại lệ."
            result['statistics']=finite({k:v for k,v in raw.items() if k not in ('outlier_indices','outlier_values')})
            result['warnings'].append('Không tự xóa ngoại lệ. Vị trí trong lượt đọc không phải khóa bản ghi.')
            used=int(frame[name].notna().sum())
        else:
            result['kind']='statistical_test';result['alpha']=alpha
            assumptions=[{'name':'Thiết kế thu thập dữ liệu','status':'not_checked',
                'detail':'Cần xác nhận tính độc lập hoặc ghép cặp đúng; không thể suy ra chỉ từ giá trị.'}]
            if op in ('independent_ttest','anova','mann_whitney','kruskal_wallis'):
                clean=frame.dropna(subset=[p['value_column'],p['group_column']])
                grouped=list(clean.groupby(p['group_column'],sort=True,observed=True))
                if len(grouped)>50:raise ValueError('Tối đa 50 nhóm trong một kiểm định')
                series=[g[p['value_column']] for _,g in grouped];names=[str(n) for n,_ in grouped]
                groups_summary=[{'name':n,'count':len(g)} for n,g in zip(names,series)]
                needed=2 if op in ('independent_ttest','mann_whitney') else 3
                if len(series)<needed or (needed==2 and len(series)!=2):raise ValueError('Số nhóm không phù hợp; chọn group_values cho đúng 2 hoặc ít nhất 3 nhóm')
                used=len(clean)
                if op=='independent_ttest':
                    equal=p.get('equal_variance',False)
                    raw=HypothesisTestEngine.independent_ttest(*series,equal,alpha)
                    if min(map(len,series))>=2:
                        computed=stats.ttest_ind(*series,equal_var=equal);ci=computed.confidence_interval(confidence_level=1-alpha)
                        raw['confidence_interval']=[float(ci.low),float(ci.high)]
                        if not equal:raw.get('assumption_details',{}).pop('equal_variances',None)
                elif op=='mann_whitney':raw=HypothesisTestEngine.mann_whitney_test(*series,alpha)
                elif op=='anova':raw=HypothesisTestEngine.anova_oneway(series,names,alpha)
                else:raw=HypothesisTestEngine.kruskal_wallis_test(series,names,alpha)
                result['data']=table([{'group':n,'n':len(g),'mean':float(g.mean()),'median':float(g.median())} for n,g in zip(names,series)])
                result['charts']=[chart('bar',[{'label':n,'value':float(g.mean())} for n,g in zip(names,series)],'Trung bình từng nhóm')]
                if op in ('anova','independent_ttest'):assumptions.append({'name':'Phân phối và điều kiện suy luận','status':'not_checked','detail':'Cỡ mẫu lớn không tự chứng minh phân phối chuẩn; cần xem phân phối và ngoại lệ.'})
                result['warnings'].append('Không chứng minh các nhóm bằng nhau khi p ≥ alpha. Diễn giải có điều kiện theo giả định.')
            elif op=='paired_ttest':
                clean=frame[[p['column_before'],p['column_after']]].dropna();used=len(clean)
                raw=HypothesisTestEngine.paired_ttest(clean[p['column_before']],clean[p['column_after']],alpha)
                if used>=2:
                    computed=stats.ttest_rel(clean[p['column_after']],clean[p['column_before']]);ci=computed.confidence_interval(confidence_level=1-alpha)
                    raw.update(statistic=float(computed.statistic),p_value=float(computed.pvalue),confidence_interval=[float(ci.low),float(ci.high)])
                result['warnings'].append('Chênh lệch và CI theo Sau − Trước. Mỗi dòng phải là cùng một đối tượng.')
            elif op=='shapiro_wilk':
                used=int(frame[p['column']].notna().sum());raw=HypothesisTestEngine.shapiro_wilk_test(frame[p['column']],alpha)
                result['warnings'].append('Shapiro–Wilk chỉ chạy với 3–5000 quan sát không hằng, không âm thầm lấy mẫu.')
            else:
                clean=frame[[p['column1'],p['column2']]].dropna();used=len(clean)
                contingency=pd.crosstab(clean[p['column1']],clean[p['column2']])
                if contingency.size>10000 or min(contingency.shape,default=0)<2:raise ValueError('Chi-square cần ít nhất 2 mức mỗi biến và tối đa 10.000 ô')
                raw=HypothesisTestEngine.chi_square_test(contingency,alpha)
            raw=finite(raw);has_result=raw.get('statistic') is not None and raw.get('p_value') is not None
            if not has_result:
                raw['effect_size']=None;raw['confidence_interval']=None
            result.update(status='success' if has_result else 'insufficient_data',title=raw.get('method_name',op),method=raw.get('method_name',op),
                hypotheses={'h0':raw.get('null_hypothesis','Giả thuyết không của '+op),'h1':raw.get('alt_hypothesis','Giả thuyết đối của '+op)},
                statistic=measure(raw.get('statistic')),pValue=measure(raw.get('p_value')),effectSize=measure(raw.get('effect_size')),
                summary=f'Đã tính trên {used} quan sát hợp lệ; xem kết quả và giả định bên dưới.' if has_result else raw.get('natural_language_conclusion','Không đủ dữ liệu hoặc kết quả không xác định'),assumptions=assumptions)
            for name,v in raw.get('assumption_details',{}).items():
                if name not in ('normality_recommended','paired_data','non_parametric','no_zero_cells'):assumptions.append({'name':name,'status':'passed' if v is True else 'failed' if v is False else 'not_checked','detail':str(v)})
            result['effectSize']['name']={'independent_ttest':"Cohen's d",'paired_ttest':"Cohen's dz (Sau − Trước)",'anova':'Eta squared','chi_square':"Cramér's V",'mann_whitney':'Rank biserial','kruskal_wallis':'Epsilon squared'}.get(op,'Không áp dụng')
            ci=raw.get('confidence_interval')
            result['confidenceInterval']={'status':'available','lower':ci[0],'upper':ci[1],'level':1-alpha} if ci and all(v is not None for v in ci) else {'status':'not_applicable','reason':'Phương pháp không có CI này hoặc không đủ dữ liệu'}
            result['conclusion']=(('Bác bỏ H0' if raw['p_value']<alpha else 'Chưa đủ bằng chứng bác bỏ H0')+f' tại alpha={alpha}; cần các giả định của phương pháp.') if has_result else 'Không thể kết luận từ dữ liệu này.'
            if not has_result:result['reason']=raw.get('natural_language_conclusion','Dữ liệu không đủ hoặc kết quả không hữu hạn')
    result['sample']={'total':total,'used':used,'missing':int(len(frame)-used),'excluded':total-len(frame),'groups':groups_summary}
    return finite(result)

@router.post('/internal/statistics')
def execute_internal(request: ExecutionRequest,x_poc_internal_key: str=Header(default='')):
    if not hmac.compare_digest(x_poc_internal_key,os.getenv('POC_SECRET_KEY','local-poc-key-change-before-sharing')):raise HTTPException(403,'Chỉ nhận dữ liệu từ Spring Boot')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('ignore',RuntimeWarning)
            return execute(request)
    except (ValueError,KeyError,TypeError) as error:raise HTTPException(400,str(error)[:500]) from None
