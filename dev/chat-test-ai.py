"""Local/CI provider stub. Runs the real FastAPI validation; never calls Gemini.
Do not use this entry point for a user demo. Production runs ai-service/main.py.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ai-service"))
import main
from app.routers import interpret, legacy_analyze
from fastapi import HTTPException
import uvicorn


def fixture_plan(request):
    q = request.question
    if request.dataset_name.startswith("Verification CSV "):
        return legacy_analyze.AIPlan.model_validate(verification_plan(q))
    config = {"metrics":[{"column":"amount","aggregate":"sum","alias":"revenue"}]}
    plan = {"intent":"query", "query_config":config}
    if q == "followup":
        assert request.conversation_history[-1].query_config is not None
        config["metrics"][0]["aggregate"] = "avg"
        config["metrics"][0]["alias"] = "average"
    elif q == "decimal":
        config["metrics"][0].update(aggregate="avg", alias="average")
    elif q == "literal":
        config["groupBy"] = [{"column":"region"}]
        config["metrics"] = [{"column":"*","aggregate":"count","alias":"orders"}]
    elif q == "fake-answer":
        plan["explanation"] = "Revenue is 999999999999"
    elif q == "sql-injection":
        plan["sql"] = "SELECT count(*) FROM public.products"
    elif q == "other-column":
        config["metrics"][0]["column"] = "password_cipher"
    elif q == "schema-check":
        kinds = {c.name:c.kind for c in request.columns}
        assert kinds["amount"] == "number" and kinds["order_date"] == "date"
        assert not hasattr(request.columns[0], "sample_values")
    elif q == "provider-failure":
        raise RuntimeError("provider API_KEY=this-must-not-leak")
    elif q == "clarify":
        plan = {"intent":"clarify","clarification":"Bạn muốn phân tích chỉ số nào?"}
    elif q in ("Tạo dashboard template", "dashboard-only-plan-without-user-request"):
        plan = {"intent":"create_dashboard","dashboard_name":"Chat smoke template","useTemplate":True,
                "templateId":"sales-overview","mapping":{"date":"order_date","revenue":"amount","region":"region","category":"category"}}
    elif q in ("Tạo dashboard custom","Tạo dashboard custom-partial","Tạo dashboard rollback-persistence"):
        plan = {"intent":"create_dashboard","dashboard_name":"Chat smoke "+q,"useTemplate":False,"charts":[
            {"name":"Chat smoke Revenue","chartType":"bar","dimension":"region","metric":"amount","aggregate":"sum"},
            {"name":"Chat smoke Orders","chartType":"pie","dimension":"missing_column" if q.endswith("custom-partial") else "category","metric":"*","aggregate":"count"}]}
    return legacy_analyze.AIPlan.model_validate(plan)


def verification_plan(question):
    month = {"column": "c_date", "op": "date", "value": "2025-03-01", "end": "2025-03-31"}
    if question == "Tạo dashboard doanh thu tháng 3 năm 2025.":
        return {"intent": "create_dashboard", "dashboard_name": "Verification dashboard", "useTemplate": True,
                "templateId": "sales-overview", "dashboard_filters": [month],
                "mapping": {"date": "c_date", "revenue": "c_revenue", "region": "c_branch", "category": "c_category"}}
    if question == "Thêm KPI tổng doanh thu vào dashboard vừa tạo và lọc chi nhánh A.":
        return {"intent": "dashboard_action", "dashboard_action": {
            "add_kpi": {"name": "Tổng doanh thu", "metric": "c_revenue", "aggregate": "sum"},
            "filters": [{"column": "c_branch", "op": "eq", "value": "A"}]}}
    filters = [{"column": "c_date", "operator": "gte", "value": "2025-03-01"},
               {"column": "c_date", "operator": "lte", "value": "2025-03-31"}]
    if not question.startswith("Hãy tính"):
        filters.append({"column": "c_branch", "operator": "eq", "value": "A"})
    aggregate, column = ("count", "*") if question.startswith("Đếm") else ("avg", "c_revenue") if question.startswith("Trung bình") else ("sum", "c_revenue")
    return {"intent": "query", "query_config": {
        "metrics": [{"column": column, "aggregate": aggregate, "alias": "answer"}], "filters": filters}}


def fixture_interpretation(_request):
    raise HTTPException(503, 'Provider unavailable in the offline smoke test')


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port",type=int,default=8000)
    args = parser.parse_args()
    legacy_analyze.generate_plan = fixture_plan
    interpret.generate_interpretation = fixture_interpretation
    uvicorn.run(main.app,host="127.0.0.1",port=args.port,log_level="warning")
