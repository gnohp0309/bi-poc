"""Exercise scope-aware Chat and verification on the 242-row CSV and a variant.

Run only against the disposable bi_chat_verification DB. The wrong-value
case changes a saved test answer so the API can verify a real discrepancy.
"""
import argparse
import csv
from decimal import Decimal, InvalidOperation
import io
import json
import os
from pathlib import Path
import subprocess
import urllib.error
import urllib.request
import uuid


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:18086/api")
    parser.add_argument("--db-port", default=55435, type=int)
    parser.add_argument("--database", default="bi_chat_verification")
    parser.add_argument("--psql", required=True)
    args = parser.parse_args()
    if not (args.database == "bi_chat_verification" or args.database.startswith("bi_chat_verification_")):
        parser.error("The verification smoke test requires a disposable verification database.")

    def call(path, method="GET", body=None, token=None, status=200, content_type="application/json"):
        headers = {"Content-Type": content_type}
        if token:
            headers["Authorization"] = "Bearer " + token
        payload = body if isinstance(body, bytes) else json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(args.base_url + path, data=payload, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=75) as response:
                code, result = response.status, json.load(response)
        except urllib.error.HTTPError as response:
            code, result = response.code, json.load(response)
        assert code == status, (path, code, status, result)
        return result

    def login(username):
        return call("/auth/login", "POST", {"username": username, "password": "Demo2026!"})["token"]

    def mutate_test_message(message_id, conversation_id, expression, expected_value):
        env = dict(os.environ, PGPASSWORD=os.environ.get("POC_DB_PASSWORD", "Demo2026!"), PGCLIENTENCODING="UTF8")
        result = subprocess.run([args.psql, "-h", "127.0.0.1", "-p", str(args.db_port), "-U", "postgres",
                                 "-d", args.database, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
                                input=f"""
          UPDATE chat_messages SET metadata_json=({expression})::text
            WHERE id='{uuid.UUID(message_id)}' AND conversation_id='{uuid.UUID(conversation_id)}'
              AND metadata_json::jsonb #>> '{{data,rows,0,answer}}' = '{expected_value}'
            RETURNING id;
          """, env=env, text=True, encoding="utf-8", capture_output=True, check=True)
        assert result.stdout.strip() == message_id, result.stdout

    token = login("admin")
    title = "Verification CSV " + uuid.uuid4().hex[:8]
    source = Path(__file__).resolve().parents[1] / "demo/exploration_dirty_242.csv"

    def import_dataset(name, csv_bytes, count):
        boundary = uuid.uuid4().hex
        body = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n{name}\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{source.name}"\r\n'
            'Content-Type: text/csv\r\n\r\n'
        ).encode() + csv_bytes + f"\r\n--{boundary}--\r\n".encode()
        imported = call("/imports", "POST", body, token, content_type="multipart/form-data; boundary=" + boundary)
        assert imported["row_count"] == count, imported
        return call("/chat/conversations", "POST", {"datasetId": imported["dataset_id"], "title": name}, token)["id"]

    conversation = import_dataset(title, source.read_bytes(), 242)

    def ask(question):
        return call("/chat/message", "POST", {"conversationId": conversation, "message": question}, token)

    def verification_path(answer):
        return f"/chat/conversations/{conversation}/messages/{answer['message_id']}/verification"

    def verify(answer, status, given, computed, matching_rows=20):
        result = call(verification_path(answer), "POST", token=token)
        assert (result["status"], result["answerValue"], result["computedValue"]) == (status, given, computed), result
        if computed is not None:
            assert result["matchingRows"] == matching_rows, result
        print(status, given, computed, result["reason"], flush=True)
        return result

    question = "Tổng doanh thu chi nhánh A tháng 3/2025 là bao nhiêu?"
    correct = ask(question)
    verify(correct, "match", "6900", "6900")
    wrong = ask(question)
    mutate_test_message(wrong["message_id"], conversation,
                        "jsonb_set(metadata_json::jsonb,'{data,rows,0,answer}','7200')", "6900")
    verify(wrong, "value_mismatch", "7200", "6900")
    def remove_branch(answer, wrong_total):
        # The source prompt and its independent expected scope stay intact.
        mutate_test_message(answer["message_id"], conversation, f"""jsonb_set(
            jsonb_set(metadata_json::jsonb, '{{query_config,filters}}', (
                SELECT jsonb_agg(f) FROM jsonb_array_elements(metadata_json::jsonb #> '{{query_config,filters}}') f
                WHERE f->>'column' <> 'c_branch')),
            '{{data,rows,0,answer}}','{wrong_total}')""", "6900")

    wrong_scope = ask("Hãy tính " + question)
    remove_branch(wrong_scope, 6900)
    scope = verify(wrong_scope, "scope_mismatch", "6900", "6900")
    assert "c_branch = A" in scope["reason"], scope
    verify(ask("Đếm số dòng chi nhánh A tháng 3/2025."), "match", "20", "20")
    verify(ask("Trung bình doanh thu tháng 3 năm 2025 của chi nhánh A."), "match", "345", "345")
    verify(ask("Số đó tính thế nào?"), "insufficient", None, None)

    dashboard = ask("Tạo dashboard doanh thu tháng 3 năm 2025.")
    kpi = ask("Thêm KPI tổng doanh thu vào dashboard vừa tạo và lọc chi nhánh A.")
    assert kpi["dashboard_id"] == dashboard["dashboard_id"], kpi
    verify(kpi, "match", "6900", "6900")

    username = "verify_" + uuid.uuid4().hex[:8]
    call("/users", "POST", {"username": username, "password": "Demo2026!", "role": "ANALYST"}, token)
    other = login(username)
    call(verification_path(correct), "POST", token=other, status=404)
    call(f"/chat/conversations/{conversation}/messages/{correct['message_id']}/suggestions/all-branches",
         "POST", token=other, status=404)
    call("/auth/logout", "POST", token=other)

    with source.open(encoding="utf-8", newline="") as file:
        rows = list(csv.DictReader(file))
    variant = rows + [dict(rows[0], date="2025-03-15", branch="B", revenue="4321", status="Completed")]
    new_csv = io.StringIO(newline="")
    writer = csv.DictWriter(new_csv, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(variant)

    def reference(month, branch=None, state=None):
        amounts = []
        for row in variant:
            if not row["date"].startswith(month) or (branch is not None and row["branch"] != branch):
                continue
            if state is not None and row["status"] != state:
                continue
            try:
                value = Decimal(row["revenue"])
                if value.is_finite():
                    amounts.append(value)
            except InvalidOperation:
                continue
        return (str(sum(amounts)) if amounts else None, len(amounts))

    def suggest(answer, action, **kwargs):
        return call(f"/chat/conversations/{conversation}/messages/{answer['message_id']}/suggestions/{action}",
                    "POST", token=token, **kwargs)

    conversation = import_dataset(title + " · March B", new_csv.getvalue().encode(), 243)
    assert ask("Còn tháng trước thì sao?")["intent"] == "clarify"
    scoped = ask(question)
    march_total, march_count = reference("2025-03")
    assert march_total == "11221"
    remove_branch(scoped, march_total)
    verify(scoped, "scope_mismatch", march_total, "6900")

    initial = ask(question)
    assert ask("Còn cùng kỳ?")["intent"] == "clarify"
    verify(ask("Còn tháng 3/2025?"), "match", "6900", "6900")
    branch_b = ask("Con chi nhanh B thi sao?")
    verify(branch_b, "match", "4321", "4321", matching_rows=1)
    feb_branch_b, _ = reference("2025-02", "B")
    earlier = ask("Còn tháng trước thì sao?")
    assert earlier["data"]["rows"][0]["answer"] == (int(feb_branch_b) if feb_branch_b else None)
    january_b, january_count = reference("2025-01", "B")
    verify(ask("Còn tháng 1/2025?"), "match", january_b, january_b, matching_rows=january_count)
    all_branches = suggest(initial, "all-branches")
    verify(all_branches, "match", march_total, march_total, matching_rows=march_count)
    months_back = suggest(initial, "previous-month")
    feb_total, feb_count = reference("2025-02", "A")
    if feb_total is not None:
        verify(months_back, "match", feb_total, feb_total, matching_rows=feb_count)
    else:
        verify(months_back, "insufficient", None, None)
    verify(suggest(initial, "previous-year"), "insufficient", None, None)
    suggest(initial, "export-dashboard", status=404)
    verify(ask("Tổng doanh thu chi nhánh B tháng 3/2025 trạng thái Completed."), "match", "4321", "4321", matching_rows=1)

    rank = ask("Chi nhánh nào có doanh thu thấp hơn và tại sao?")
    comparison = suggest(rank, "exclude-outlier")
    assert rank["analysis_result"]["rankChangingOutlier"] == 999999
    assert rank["analysis_result"]["data"]["rows"][0]["Chi nhánh"] == "A"
    assert comparison["analysis_result"]["data"]["rows"][0]["Chi nhánh"] == "C"
    print("FOLLOW-UP & SUGGESTIONS PASS", conversation, flush=True)

    # Independent dataset with renamed columns, overlapping statuses and both sides of a year boundary.
    second_csv = b"""sold_on,office,order_state,net_amount
2024-12-15,EAST,Posted,10
2024-12-16,EAST,Open,90
2024-12-20,WEST,Posted,45
2025-01-09,EAST,Posted,30
2025-01-10,EAST,Voided,100
2025-01-07,WEST,Posted,20
2025-01-10,WEST,Voided,200
2024-01-10,EAST,Posted,5
"""
    conversation = import_dataset(title + " · Renamed dataset", second_csv, 8)
    second_dataset = call(f"/chat/conversations/{conversation}", token=token)["dataset_id"]
    call(f"/datasets/{second_dataset}/aliases", "PUT", {"aliases": {
        "c_sold_on": "Ngày bán", "c_office": "Chi nhánh",
        "c_order_state": "Trạng thái", "c_net_amount": "Doanh thu",
    }}, token)
    first = ask("Tổng doanh thu chi nhánh EAST trạng thái Posted tháng 1/2025?")
    verify(first, "match", "30", "30", matching_rows=1)
    verify(ask("Còn tháng trước thì sao?"), "match", "10", "10", matching_rows=1)
    verify(ask("Còn chi nhánh WEST?"), "match", "45", "45", matching_rows=1)
    verify(suggest(first, "previous-year"), "match", "5", "5", matching_rows=1)
    verify(suggest(first, "all-branches"), "match", "50", "50", matching_rows=2)
    verify(ask("Tổng doanh thu tháng 1/2025?"), "match", "350", "350", matching_rows=4)
    print("RENAMED DATASET PASS", conversation, flush=True)
    call("/auth/logout", "POST", token=token)
    print("CHAT VERIFICATION PASS", title, flush=True)


if __name__ == "__main__":
    run()
