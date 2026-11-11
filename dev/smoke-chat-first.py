import argparse
import concurrent.futures
import json
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description='Opt-in Chat acceptance against real Gemini and synthetic CSV 242.')
parser.add_argument('--live', action='store_true', required=True, help='Explicitly enable provider calls')
parser.add_argument('--base-url', default='http://127.0.0.1:18086/api')
parser.add_argument('--output', type=Path, default=REPO / '.local/chat-first-acceptance')
parser.add_argument('--case', action='append', help='Run a named case; repeat to select several')
parser.add_argument('--conversation', action='store_true', help='Run the multi-turn conversational acceptance scenario')
parser.add_argument('--dashboard-actions', action='store_true', help='Run create, update, filter, and export in the same conversation')
args = parser.parse_args()
ROOT = args.output
ROOT.mkdir(parents=True, exist_ok=True)
BASE = args.base_url


def request(path, body=None, token=None, method=None, content_type='application/json'):
    headers = {'Content-Type': content_type}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    data = body if isinstance(body, bytes) else json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=120) as response:
        return json.load(response)


def setup(token):
    title = 'Chat acceptance CSV 242'
    existing = next((item for item in request('/datasets', token=token) if item['name'] == title + ' · Dữ liệu CSV'), None)
    if existing:
        return existing['id']
    csv_path = REPO / 'demo/exploration_dirty_242.csv'
    boundary = uuid.uuid4().hex
    data = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n{title}\r\n'
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{csv_path.name}"\r\nContent-Type: text/csv\r\n\r\n'
    ).encode() + csv_path.read_bytes() + f'\r\n--{boundary}--\r\n'.encode()
    uploaded = request('/imports', data, token, content_type='multipart/form-data; boundary=' + boundary)
    dataset = uploaded['dataset_id']
    assert uploaded['row_count'] == 242
    request('/charts', {'datasetId':dataset, 'chartType':'kpi', 'name':'PR8 KPI tổng doanh thu', 'dimension':'', 'metric':'c_revenue', 'aggregate':'sum'}, token)
    return dataset


CASES = {
    'overview': 'Dataset này có bao nhiêu dòng và bao nhiêu cột? Hiển thị cấu trúc, số giá trị duy nhất từng cột, và ô thiếu.',
    'missing': 'Cột nào có nhiều giá trị NULL nhất? Hãy cho biết tên cột và số ô NULL.',
    'descriptive': 'Tính mean, median, mode, min, max, độ lệch chuẩn mẫu, phương sai mẫu và các tứ phân vị cho tất cả cột số của dataset.',
    'monthly': 'Hãy thống kê doanh thu c_revenue theo từng tháng của c_date, không lọc.',
    'distribution': 'Hãy phân tích phân phối của c_revenue và hiển thị histogram.',
    'outliers-auto': 'Hãy tìm các giá trị ngoại lệ trong dataset.',
    'iqr': 'Phát hiện ngoại lệ trong c_revenue bằng IQR, threshold 1.5.',
    'zscore': 'Phát hiện ngoại lệ trong c_revenue bằng Z-score.',
    'pearson': 'Tính tương quan Pearson giữa c_revenue và c_cost trên toàn bộ dataset.',
    'spearman': 'Tính tương quan Spearman giữa c_revenue và c_cost trên toàn bộ dataset.',
    'shapiro': 'Chạy kiểm định Shapiro-Wilk cho c_revenue để kiểm tra phân phối chuẩn, alpha 0.05.',
    'welch': 'Kiểm định Welch Independent T-test để so sánh trung bình c_revenue giữa hai nhóm A và B của c_branch. Chỉ chọn A và B, alpha 0.05, không giả định phương sai bằng nhau.',
    'paired': 'Chạy Paired T-test: c_before và c_after là giá trị trước và sau của cùng đối tượng trên mỗi dòng. So sánh sau trừ trước, alpha 0.05.',
    'anova': 'Chạy ANOVA một chiều của c_revenue phân nhóm theo c_branch, dùng mọi nhóm A B C, alpha 0.05.',
    'chi': 'Chạy kiểm định Chi-square độc lập giữa c_branch và c_category, alpha 0.05.',
    'mann': 'Chạy Mann–Whitney U hai phía cho c_revenue, nhóm theo c_branch, chỉ chọn A và B, alpha 0.05.',
    'kruskal': 'Chạy Kruskal–Wallis cho c_revenue theo c_branch trên mọi nhóm, alpha 0.05.',
    'auto-test': 'Kiểm tra xem doanh thu trung bình của chi nhánh A và B có khác biệt đáng kể không. Hãy kiểm tra dữ liệu thiếu, phân phối, giả định và chọn phương pháp phù hợp. Biến doanh thu c_revenue, biến chi nhánh c_branch.',
    'insights': 'Hãy tự động phát hiện xu hướng doanh thu theo tháng, các bất thường, và giải thích nhận định chính từ dataset này.',
    'template': 'Tạo dashboard tổng quan doanh thu bằng mẫu sales-overview trên toàn bộ dataset. Dùng c_date làm ngày, c_revenue làm doanh thu, c_branch làm khu vực và c_category làm danh mục.',
    'period': 'Tạo dashboard tổng quan doanh thu bằng mẫu sales-overview, chỉ dùng dữ liệu tháng 03/2025, không dùng các tháng khác. Dùng c_date làm ngày, c_revenue làm doanh thu, c_branch làm khu vực và c_category làm danh mục.',
    'custom': 'Tạo dashboard tùy chỉnh không dùng template gồm KPI tổng c_revenue và histogram phân phối c_revenue với 10 khoảng.',
}


def run_case(label, question, dataset, token):
    started = time.monotonic()
    out = {'case': label}
    try:
        cid = request('/chat/conversations', {'datasetId':dataset,'title':'Acceptance ' + label}, token)['id']
        out['conversation'] = cid
        r = request('/chat/message', {'conversationId':cid,'message':question}, token)
        out['response'] = r
        out.update(intent=r['intent'], answer=r.get('answer'))
        a = r.get('analysis_result') or {}
        rows = a.get('data',{}).get('rows',[]) or r.get('data',{}).get('rows',[])
        out.update(kind=a.get('kind'), title=a.get('title'), status=a.get('status'), sample=a.get('sample'),
                   statistic=a.get('statistic'), p=a.get('pValue'), ci=a.get('confidenceInterval'), effect=a.get('effectSize'),
                   assumptions=a.get('assumptions'), rows=rows[:12], charts=[c.get('chartType') for c in a.get('charts',[])])
        if 'dashboard_id' in r:
            out['dashboard'] = r['dashboard_id']
            dash = request('/dashboards/' + r['dashboard_id'], token=token)
            out['scopeFilters'] = dash.get('scopeFilters', [])
            out['dashboardCharts'] = [dict(name=c['name'], type=c.get('chartType'), rows=c['rows'][:14]) for c in dash['charts']]
    except urllib.error.HTTPError as e:
        out.update(http=e.code, error=e.read().decode()[:400])
    except Exception as e:
        out.update(error=type(e).__name__)
    if 'error' not in out:
        try:
            validate_case(label,out)
            out['statusCheck']='PASS'
        except (AssertionError, KeyError, TypeError, IndexError) as error:
            out['statusCheck']='FAIL';out['error']='Acceptance: '+str(error)
    else: out['statusCheck']='FAIL'
    out['seconds'] = round(time.monotonic()-started,2)
    return out

def validate_case(label, out):
    r = out['response']; a = r.get('analysis_result', {})
    expected_p = {'welch': .8682721788129366, 'paired': 3.505547734e-142, 'anova': .3743996055,
                  'chi': .9835366372, 'mann': .8701442510849804, 'kruskal': .9789931572, 'shapiro': 7.7951446e-33}
    if label in expected_p:
        assert r['intent'] == 'statistical', r
        value = a['pValue']['value']; expected = expected_p[label]
        assert abs(value-expected) <= max(abs(expected)*1e-6,1e-150), (value, expected)
        assert a['hypotheses']['h0'] and a['hypotheses']['h1'] and a['conclusion']
        assert a['confidenceInterval']['status'] and a['effectSize']['status'] and a['assumptions']
    elif label in ('iqr','zscore'):
        assert a['statistics']['outlier_count'] == 1
        assert a['data']['rows'][0]['value'] == 999999
    elif label in ('pearson','spearman'):
        expected = .03326635 if label=='pearson' else .9964503089038604
        assert abs(a['data']['rows'][0]['correlation']-expected)<1e-7
    elif label in ('overview','missing'):
        assert r['intent']=='explore' and '242' in r['answer'] and 'c_revenue (4' in r['answer']
    elif label in ('descriptive','distribution'):
        row = next(x for x in a['data']['rows'] if x.get('column')=='c_revenue')
        assert row['count']==238 and row['median']==340 and abs(row['std']-64798.647854)<1e-5
        assert 'histogram' in out['charts']
    elif label=='monthly':
        rows = a['data']['rows']; assert len(rows)>=12
        assert any('2025-03' in str(row) and 6900 in row.values() for row in rows)
    elif label in ('insights','outliers-auto'):
        assert a['title']=='Insights từ dữ liệu thực'
        row=next(x for x in a['data']['rows'] if x['column']=='c_revenue')
        assert row['outliers']==1 and row['max']==999999
        if label=='insights':assert any(p['label']=='2025-02' and p['value']==1006419 for p in a['charts'][0]['rows'])
    elif label=='auto-test':
        assert a['status']=='needs_confirmation' and 'pValue' not in a
        assert a['sample']['used']==158 and a['sample']['missing']==3 and a['sample']['excluded']==81
        assert a['selection']['operation']=='mann_whitney'
    elif label in ('template','period','custom'):
        assert r['intent']=='create_dashboard'
        if label=='period':
            assert len(out['scopeFilters'])==1
            for chart in out['dashboardCharts']:assert sum(p['value'] for p in chart['rows'])==6900
            assert out['dashboardCharts'][0]['rows']==[{'label':'2025-03','value':6900}]
        if label=='custom': assert {c['type'] for c in out['dashboardCharts']}=={'kpi','histogram'}


def check_conversation(dataset, token):
    conversation = request('/chat/conversations', {'datasetId':dataset,'title':'Kiểm thử hội thoại phân tích 242 dòng'}, token)['id']
    previous = {dashboard['id'] for dashboard in request('/dashboards', token=token)}
    results = []

    def ask(question):
        response = request('/chat/message', {'conversationId':conversation,'message':question}, token)
        results.append({'question':question, 'response':response})
        (ROOT/'conversation-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
        print(question, response['intent'], response.get('narrative_source', ''), flush=True)
        return response

    first = ask('Phân tích doanh thu giúp tui, có tháng nào bất thường không?')
    assert first['narrative_source']=='gemini' and 'dashboard_id' not in first, first
    assert '1006419' in first['answer'] and '999999' in first['answer'], first['answer']
    assert '6420' in first['analysis_result']['summary']

    followup = ask('Tạm bỏ ngoại lệ đó ra rồi so lại với tháng 3 đi.')
    # Planning and recomputation are required. Interpretation may fall back to
    # the verified engine answer when the second provider call is unavailable.
    assert followup['narrative_source'] in ('gemini','engine') and 'dashboard_id' not in followup, followup
    data = followup['analysis_result']['data']['rows']
    assert [(row['month'], row['without_outliers']) for row in data]==[('2025-02',6420),('2025-03',6900)], data
    assert '480' in followup['answer'], followup['answer']
    assert followup['analysis_result']['insightContext'][0]['exclude_outliers'] is True

    chart = ask('Cho tui xem biểu đồ doanh thu theo tháng, đừng tạo dashboard.')
    assert chart['analysis_result']['charts'] and 'dashboard_id' not in chart, chart
    assert {d['id'] for d in request('/dashboards', token=token)}==previous

    created = ask('Tạo dashboard doanh thu tháng 3 năm 2025.')
    assert created['dashboard_id'] not in previous, created
    detail = request('/dashboards/'+created['dashboard_id'], token=token)
    assert any(f['value']=='2025-03-01' and f['end']=='2025-03-31' for f in detail['scopeFilters']), detail
    assert detail['charts'][0]['rows']==[{'label':'2025-03','value':6900}], detail
    assert len(request('/chat/conversations/'+conversation, token=token)['messages'])==8
    print('CONVERSATION PASS: Gemini interpretation, grounded comparison, read-only chart, and explicit new dashboard.', flush=True)


def check_dashboard_actions(dataset, token):
    conversation = request('/chat/conversations', {'datasetId': dataset, 'title': 'Dashboard qua Chat'}, token)['id']
    results = []

    def ask(question, conversation_id=conversation):
        response = request('/chat/message', {'conversationId': conversation_id, 'message': question}, token)
        results.append({'question': question, 'response': response})
        (ROOT / 'dashboard-actions.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
        print(question, response['intent'], flush=True)
        return response

    created = ask('Tạo dashboard doanh thu tháng 3 năm 2025.')
    dashboard = created['dashboard_id']
    path = '/dashboards/' + dashboard
    initial = request(path, token=token)
    ids = {d['id'] for d in request('/dashboards', token=token)}
    updated = ask('Thêm KPI tổng doanh thu vào dashboard vừa tạo và lọc chi nhánh A.')
    assert updated['intent'] == 'dashboard_action' and updated['dashboard_id'] == dashboard, updated
    detail = request(path, token=token)
    assert len(detail['charts']) == len(initial['charts']) + 1, detail['charts']
    assert {c['id'] for c in initial['charts']} < {c['id'] for c in detail['charts']}
    kpi = next(c for c in detail['charts'] if c['chartType'] == 'kpi')
    assert kpi['rows'][0]['value'] == 6900, kpi
    assert any(f['column'] == 'c_branch' and f['value'] == 'A' for f in detail['scopeFilters']), detail['scopeFilters']
    assert any(f['column'] == 'c_date' and f['value'] == '2025-03-01' and f['end'] == '2025-03-31'
               for f in detail['scopeFilters']), detail['scopeFilters']
    drill = request(f"{path}/charts/{kpi['id']}/drill", {'filters': []}, token)
    assert len(drill['rows']) == 20 and sum(row['c_revenue'] for row in drill['rows']) == 6900

    exported = ask('Xuất dashboard vừa tạo ra Excel.')
    assert exported['intent'] == 'dashboard_action' and exported['dashboard_id'] == dashboard, exported
    saved = request('/chat/conversations/' + conversation, token=token)
    assert json.loads(saved['messages'][-1]['metadata_json'])['dashboard_export'] == 'xlsx'
    assert {d['id'] for d in request('/dashboards', token=token)} == ids

    other = request('/chat/conversations', {'datasetId': dataset, 'title': 'Không có dashboard'}, token)['id']
    denied = ask('Thêm KPI tổng doanh thu vào dashboard vừa tạo và lọc chi nhánh B.', other)
    assert denied['intent'] == 'clarify' and 'dashboard_id' not in denied, denied
    assert request(path, token=token)['scopeFilters'] == detail['scopeFilters']
    print('DASHBOARD ACTIONS PASS: same dashboard, 6900, 20 rows, Excel action, isolated conversations.', flush=True)


if __name__ == '__main__':
    token=request('/auth/login',{'username':'admin','password':'Demo2026!'})['token']
    dataset=setup(token);results=[]
    (ROOT/'dataset.txt').write_text(dataset)
    if args.conversation:
        try: check_conversation(dataset,token)
        finally: request('/auth/logout',{},token)
        raise SystemExit(0)
    if args.dashboard_actions:
        try: check_dashboard_actions(dataset,token)
        finally: request('/auth/logout',{},token)
        raise SystemExit(0)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        tasks=[pool.submit(run_case,label,question,dataset,token) for label,question in CASES.items() if not args.case or label in args.case]
        for task in concurrent.futures.as_completed(tasks):
            result=task.result();results.append(result)
            (ROOT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
            print(json.dumps({k:result[k] for k in ('case','statusCheck','error','seconds') if k in result}),flush=True)
    request('/auth/logout',{},token)
    if any(r['statusCheck']!='PASS' for r in results):raise SystemExit(1)
