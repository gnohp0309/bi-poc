"""Exercise Spring Boot -> real FastAPI validation -> dataset SQL, without a paid LLM.
Only run against an isolated test DB: the rollback case temporarily installs a trigger.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import urllib.request
import urllib.error
import uuid


def run():
    parser=argparse.ArgumentParser()
    parser.add_argument("--base-url",default="http://127.0.0.1:8081/api")
    parser.add_argument("--db-port",type=int,default=5433)
    parser.add_argument("--db-name",required=True)
    parser.add_argument("--psql",default=shutil.which("psql"))
    args=parser.parse_args()
    if not args.psql:
        raise RuntimeError("Pass --psql path/to/psql for the isolated rollback test")
    base=args.base_url.rstrip("/")
    def sql(statement):
        env=os.environ.copy()
        env["PGPASSWORD"]=env.get("POC_DB_PASSWORD","Demo2026!")
        env["PGCLIENTENCODING"]="UTF8"
        r=subprocess.run([args.psql,"-h","127.0.0.1","-p",str(args.db_port),"-U","postgres","-d",args.db_name,
                          "-X","-q","-A","-t","-v","ON_ERROR_STOP=1","-c",statement],
                         env=env,text=True,encoding="utf-8",capture_output=True,check=True)
        return r.stdout.strip()
    def call(path,method="GET",body=None,token=None,expect=200):
        headers={"Content-Type":"application/json; charset=utf-8"}
        if token: headers["Authorization"]="Bearer "+token
        req=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),headers=headers,method=method)
        try:
            with urllib.request.urlopen(req,timeout=40) as r:
                code,data=r.status,json.load(r)
        except urllib.error.HTTPError as r:
            code,data=r.code,json.loads(r.read())
        assert code==expect,(path,code,expect,data)
        return data
    def login(name):
        return call("/auth/login","POST",{"username":name,"password":"Demo2026!"})["token"]
    admin=login("admin")
    users=call("/users",token=admin)
    for role in ("ANALYST","VIEWER"):
        if not any(x["username"]==role.lower() for x in users):
            call("/users","POST",{"username":role.lower(),"password":"Demo2026!","role":role},admin)
    viewer,analyst=login("viewer"),login("analyst")
    suffix=uuid.uuid4().hex[:10]
    conn=None
    dashboard_ids=[]
    conversations=[]
    group_id=None
    try:
        users=call("/users",token=admin)
        viewer_id=next(user["id"] for user in users if user["username"]=="viewer")
        group_id=call("/groups","POST",{"name":"Chat smoke group "+suffix},admin)["id"]
        for _ in range(2):
            call("/groups/"+group_id+"/members","POST",{"userId":viewer_id},admin)
        group=next(group for group in call("/groups",token=admin) if group["id"]==group_id)
        assert group["members"]==[viewer_id],group
        sql("GRANT USAGE ON SCHEMA uploads TO bi_reader;")
        conn=call("/connections","POST",{"name":"Chat smoke "+suffix,"host":"127.0.0.1","port":args.db_port,
             "database":args.db_name,"username":"bi_reader","password":"Reader2026!"},admin)["id"]
        source="""SELECT * FROM (VALUES
          ('2025-01-01'::date,'$5\\shop{{total}}'::text,'A'::text,12.34::numeric),
          ('2025-02-01'::date,'South'::text,'B'::text,20.36::numeric))
          AS fixture(order_date,region,category,amount)"""
        def dataset(name,query):
            return call("/datasets","POST",{"connectionId":conn,"name":name,"kind":"VIRTUAL","sql":query},admin)["id"]
        ds=dataset("Chat smoke "+suffix,source)
        empty=dataset("Chat smoke empty "+suffix,"SELECT * FROM ("+source+") t WHERE false")
        nulls=dataset("Chat smoke NULL "+suffix,"SELECT NULL::date AS order_date, NULL::numeric AS amount, NULL::text AS region")
        def newconv(dataset_id=ds,token=admin):
            cid=call("/chat/conversations","POST",{"datasetId":dataset_id,"title":"Chat smoke "+suffix},token)["id"]
            conversations.append((cid,token))
            return cid
        def ask(q,dataset_id=ds,token=admin,expect=200,cid=None):
            cid=cid or newconv(dataset_id,token)
            response=call("/chat/message","POST",{"conversationId":cid,"message":q},token,expect)
            if "dashboard_id" in response: dashboard_ids.append(response["dashboard_id"])
            return cid,response
        cid,answer=ask("total")
        assert answer["data"]["rows"][0]["revenue"]==32.7,answer
        assert "32.7" in answer["answer"],answer
        assert answer['narrative_source']=='engine', answer
        presentation = answer["analysis_result"]
        assert presentation["schemaVersion"] == 1 and presentation["kind"] == "query"
        assert presentation["data"]["rows"][0]["revenue"] == 32.7
        assert presentation["charts"][0]["chartType"] == "kpi"
        assert presentation["charts"][0]["rows"][0]["value"] == 32.7
        assert "pValue" not in presentation and "conclusion" not in presentation
        _,followup=ask("followup",cid=cid)
        assert followup["data"]["rows"][0]["average"]==16.35,followup
        saved=call("/chat/conversations/"+cid,token=admin)
        assert [m["role"] for m in saved["messages"]]==["user","assistant","user","assistant"]
        assert json.loads(saved["messages"][-1]["metadata_json"])["data"]["rows"][0]["average"]==16.35
        assert len(call("/chat/conversations",token=admin))>0
        _,answer=ask("decimal")
        assert "16.35" in answer["answer"]
        _,answer=ask("literal")
        assert "$5\\shop{{total}}" in answer["answer"],answer
        _,answer=ask("fake-answer")
        assert "999999999999" not in answer["answer"] and "32.7" in answer["answer"],answer
        ask("total",token=analyst)
        for dataset_id in (empty,nulls): ask("schema-check",dataset_id)
        _,answer=ask("total",empty)
        assert answer["data"]["rows"][0]["revenue"] is None and "NULL" in answer["answer"]
        _,answer=ask("clarify")
        assert answer["intent"]=="clarify"
        before=len(call("/dashboards",token=admin))
        _,blocked=ask("dashboard-only-plan-without-user-request")
        assert blocked["intent"]=="clarify" and "dashboard_id" not in blocked
        assert len(call("/dashboards",token=admin))==before
        for q,count in (("Tạo dashboard template",3),("Tạo dashboard custom",2)):
            _,answer=ask(q)
            dashboard=call("/dashboards/"+answer["dashboard_id"],token=admin)
            assert len(dashboard["charts"])==count
            # Aggregate independently; source sum is 32.70.
            revenue=next(c for c in dashboard["charts"] if c["aggregate"]=="sum")
            assert sum(row["value"] for row in revenue["rows"])==32.7
        for question,expected in (("sql-injection",502),("other-column",400),("provider-failure",502),("Tạo dashboard custom-partial",400)):
            charts_before=len(call("/charts",token=admin))
            dashboards_before=len(call("/dashboards",token=admin))
            failure_cid=newconv()
            _,error=ask(question,expect=expected,cid=failure_cid)
            assert "this-must-not-leak" not in json.dumps(error)
            assert len(call("/charts",token=admin))==charts_before
            assert len(call("/dashboards",token=admin))==dashboards_before
            assert call("/chat/conversations/"+failure_cid,token=admin)["messages"]==[]
        # Fail after charts/dashboard were inserted, to prove real database rollback.
        sql("""CREATE OR REPLACE FUNCTION chat_smoke_fail() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN IF NEW.content LIKE '%rollback-persistence' THEN RAISE EXCEPTION 'test persistence failure'; END IF;
            RETURN NEW; END $$;
            CREATE TRIGGER chat_smoke_fail BEFORE INSERT ON chat_messages FOR EACH ROW EXECUTE FUNCTION chat_smoke_fail();""")
        try:
            before=sql("SELECT (SELECT count(*) FROM charts)||','||(SELECT count(*) FROM dashboards)")
            rollback_cid=newconv()
            ask("Tạo dashboard rollback-persistence",expect=500,cid=rollback_cid)
            assert sql("SELECT (SELECT count(*) FROM charts)||','||(SELECT count(*) FROM dashboards)")==before
            assert call("/chat/conversations/"+rollback_cid,token=admin)["messages"]==[]
        finally:
            sql("DROP TRIGGER IF EXISTS chat_smoke_fail ON chat_messages; DROP FUNCTION IF EXISTS chat_smoke_fail();")
        call("/chat/conversations","POST",{"datasetId":ds},viewer,expect=403)
        call("/chat/message","POST",{"conversationId":cid,"message":"total"},viewer,expect=403)
        call("/chat/conversations/"+cid,"DELETE",token=viewer,expect=403)
        call("/chat/conversations/"+cid,token=viewer,expect=404)
        call("/chat/conversations",expect=401)
        call("/chat/message","POST",{"conversationId":cid,"message":"x"*4001},admin,expect=400)
        print("CHAT SMOKE PASS: query, followup/history, exact decimals, literals, grounded answers, dataset scope, empty/NULL metadata, template/custom/reload, invalid plans, full persistence rollback, ownership, roles and provider failure. No Gemini call.")
    finally:
        if group_id:
            sql("DELETE FROM app_groups WHERE id='"+str(uuid.UUID(group_id))+"'")
        for did in dashboard_ids:
            call("/dashboards/"+did,"DELETE",token=admin)
        if conn: call("/connections/"+conn,"DELETE",token=admin)


if __name__=="__main__":
    run()
