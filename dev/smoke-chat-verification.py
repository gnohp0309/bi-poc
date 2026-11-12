"""Exercise Chat verification on the 242-row CSV with the local Chat provider stub.

Run only against the disposable bi_chat_verification DB. The wrong-value
case changes a saved test answer so the API can verify a real discrepancy.
"""
import argparse
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
    parser.add_argument("--psql", required=True)
    args = parser.parse_args()

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

    def change_saved_value(message_id, conversation_id):
        env = dict(os.environ, PGPASSWORD=os.environ.get("POC_DB_PASSWORD", "Demo2026!"), PGCLIENTENCODING="UTF8")
        result = subprocess.run([args.psql, "-h", "127.0.0.1", "-p", str(args.db_port), "-U", "postgres",
                                 "-d", "bi_chat_verification", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
                                input=f"""
          UPDATE chat_messages SET content='answer: 7200',
            metadata_json=jsonb_set(jsonb_set(metadata_json::jsonb,
              '{{data,rows,0,answer}}','7200'), '{{analysis_result,data,rows,0,answer}}','7200')::text
            WHERE id='{uuid.UUID(message_id)}' AND conversation_id='{uuid.UUID(conversation_id)}'
              AND metadata_json::jsonb #>> '{{data,rows,0,answer}}' = '6900'
            RETURNING id;
          """, env=env, text=True, encoding="utf-8", capture_output=True, check=True)
        assert result.stdout.strip() == message_id, result.stdout

    token = login("admin")
    title = "Verification CSV " + uuid.uuid4().hex[:8]
    boundary = uuid.uuid4().hex
    csv = Path(__file__).resolve().parents[1] / "demo/exploration_dirty_242.csv"
    body = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n{title}\r\n'
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{csv.name}"\r\n'
        'Content-Type: text/csv\r\n\r\n'
    ).encode() + csv.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    imported = call("/imports", "POST", body, token, content_type="multipart/form-data; boundary=" + boundary)
    assert imported["row_count"] == 242, imported
    dataset = imported["dataset_id"]
    conversation = call("/chat/conversations", "POST", {"datasetId": dataset, "title": title}, token)["id"]

    def ask(question):
        return call("/chat/message", "POST", {"conversationId": conversation, "message": question}, token)

    def verification_path(answer):
        return f"/chat/conversations/{conversation}/messages/{answer['message_id']}/verification"

    def verify(answer, status, given, computed):
        result = call(verification_path(answer), "POST", token=token)
        assert (result["status"], result["answerValue"], result["computedValue"]) == (status, given, computed), result
        if computed is not None:
            assert result["matchingRows"] == 20, result
        print(status, given, computed, result["reason"], flush=True)
        return result

    question = "Tổng doanh thu chi nhánh A tháng 3/2025 là bao nhiêu?"
    correct = ask(question)
    verify(correct, "match", "6900", "6900")
    wrong = ask(question)
    change_saved_value(wrong["message_id"], conversation)
    verify(wrong, "value_mismatch", "7200", "6900")
    scope = verify(ask("Hãy tính " + question), "scope_mismatch", "6900", "6900")
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
    call("/auth/logout", "POST", token=other)
    call("/auth/logout", "POST", token=token)
    print("CHAT VERIFICATION PASS", title, flush=True)


if __name__ == "__main__":
    run()
