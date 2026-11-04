# FastAPI cho Chat AI

Dịch câu hỏi thành cấu hình JSON được Spring Boot kiểm tra/thực thi. Không kết nối PostgreSQL và không thực thi SQL.

Yêu cầu Python 3.12. Từ thư mục này:

~~~powershell
Copy-Item .env.example .env
# Điền GEMINI_API_KEY trong .env, không commit file này.
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-ai-service.ps1
~~~

Mặc định 127.0.0.1:8000, tương ứng POC_AI_SERVICE_URL của Spring Boot. Model cấu hình bằng GEMINI_MODEL; thiếu key trả 503 khi gửi câu hỏi. Các màn hình BI khác không cần service này.

Cài/chạy thủ công:

~~~powershell
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt
.\venv\Scripts\python.exe main.py
~~~

Chạy test không gọi Gemini:

~~~powershell
.\venv\Scripts\python.exe -m pip install -r requirements-test.txt
.\venv\Scripts\python.exe -m unittest discover -s . -p test_main.py -v
~~~

Xem [hợp đồng, luồng demo, giới hạn và kiểm thử](../docs/CHAT_AI.md).
