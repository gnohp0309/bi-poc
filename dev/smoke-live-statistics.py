"""Opt-in paid-provider check on the synthetic exploration CSV; never runs in CI."""
import argparse,json,time,urllib.request,urllib.error
from pathlib import Path

def main():
    p=argparse.ArgumentParser();p.add_argument('--base-url',default='http://127.0.0.1:18086/api');p.add_argument('--dataset',required=True);p.add_argument('--output',type=Path,required=True);args=p.parse_args()
    def api(path,body=None,token=None):
        headers={'Content-Type':'application/json'}
        if token:headers['Authorization']='Bearer '+token
        req=urllib.request.Request(args.base_url+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
        try:
            with urllib.request.urlopen(req,timeout=75) as r:return json.load(r)
        except urllib.error.HTTPError as e:raise RuntimeError(f'HTTP {e.code}: '+e.read().decode()[:500]) from None
    token=api('/auth/login',{'username':'admin','password':'Demo2026!'})['token'];results=[]
    cases=[('explore','Hãy thống kê số dòng, số cột, số ô thiếu và số dòng trùng của dataset này.','explore'),
      ('descriptive','Tính median và độ lệch chuẩn mẫu của c_revenue trên toàn bộ dataset, không lọc.','statistical'),
      ('welch','Kiểm định Welch Independent T-test để so sánh trung bình c_revenue giữa hai nhóm A và B của c_branch. Chỉ chọn A và B, alpha 0.05, không giả định phương sai bằng nhau.','statistical'),
      ('correlation','Tính tương quan Spearman giữa c_revenue và c_cost trên toàn bộ dataset.','statistical'),
      ('outlier','Phát hiện ngoại lệ trong c_revenue bằng phương pháp IQR, threshold 1.5.','statistical'),
      ('dashboard','Tạo dashboard tổng quan doanh thu bằng mẫu sales-overview trên toàn bộ dataset. Dùng c_date làm ngày, c_revenue làm doanh thu, c_branch làm khu vực và c_category làm danh mục.','create_dashboard'),
      ('missing','Tính trung vị cột profit. Dataset không có cột profit.','clarify')]
    for label,question,intent in cases:
        start=time.monotonic()
        try:
            cid=api('/chat/conversations',{'datasetId':args.dataset,'title':'QA live '+label},token)['id']
            r=api('/chat/message',{'conversationId':cid,'message':question},token)
            assert r['intent']==intent,(r['intent'],intent)
            if label=='descriptive':assert r['analysis_result']['data']['rows'][0]['median']==340
            if label=='welch':assert abs(r['analysis_result']['pValue']['value']-.8682721788129366)<1e-8
            if label=='outlier':assert r['analysis_result']['statistics']['outlier_count']==1
            if label=='correlation':assert abs(r['analysis_result']['data']['rows'][0]['correlation']-.9964503089038604)<1e-8
            if label=='dashboard':assert len(api('/dashboards/'+r['dashboard_id'],token=token)['charts'])==3
            saved=api('/chat/conversations/'+cid,token=token);assert len(saved['messages'])==2
            results.append({'case':label,'status':'PASS','intent':r['intent'],'conversationId':cid,'seconds':round(time.monotonic()-start,2),'answer':r['answer']})
        except Exception as e:results.append({'case':label,'status':'FAIL','error':str(e)[:1000],'seconds':round(time.monotonic()-start,2)})
        print(json.dumps(results[-1],ensure_ascii=True),flush=True)
        args.output.write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    if any(r['status']!='PASS' for r in results):raise SystemExit(1)
if __name__=='__main__':main()
