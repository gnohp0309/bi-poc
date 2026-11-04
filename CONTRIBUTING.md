# Làm việc chung trên Pythera POC

Nhóm phát triển một sản phẩm chung. Mỗi người có bản clone và PostgreSQL riêng trên máy; Git chia sẻ mã nguồn, không đồng bộ database hoặc dữ liệu đã upload.

## Phân công đề xuất

| Phần việc | Nhánh gợi ý | Khu vực chính |
| --- | --- | --- |
| Phong: hệ thống nền, dữ liệu và tích hợp | `feature/data-platform` | `backend/`, `dev/`, tài liệu API |
| Chat AI hỏi đáp dữ liệu | `feature/ai-chat` | Dịch vụ FastAPI mới, giao diện chat |
| Dashboard theo template | `feature/dashboard-templates` | Dashboard React, API/template Spring Boot |

Xem [ranh giới tích hợp](docs/TEAM_INTEGRATION.md) và [Chat AI/FastAPI](docs/CHAT_AI.md). Mỗi máy tự cấu hình Gemini key trong ai-service/.env; không commit hoặc chia sẻ key qua Git.

## Bắt đầu một phần việc

```powershell
git clone https://github.com/gnohp0309/bi-poc.git
cd bi-poc
git switch main
git pull --ff-only origin main
git switch -c feature/ai-chat
```

Thay tên nhánh theo phần việc. Cài đặt/chạy theo README và [DEVELOPMENT](docs/DEVELOPMENT.md). Không copy nguyên frontend hoặc backend từ repo cá nhân đè lên source chung.

## Lưu và gửi thay đổi

Chạy `git status`, thêm đúng các file đã kiểm tra bằng `git add <đường-dẫn-file>`, rồi:

```powershell
git diff --cached
git commit -m "Them giao dien chat du lieu"
git push -u origin feature/ai-chat
```

Trên GitHub tạo Pull Request từ nhánh của mình vào `main`. Nêu thay đổi, cách chạy/thử, kết quả và phần chưa xong. Người ghép code kiểm tra build và chạy thử luồng liên quan trước khi merge; không tự ghi nhận test PASS nếu chưa chạy.

## Nhận thay đổi của người khác

Khi nhánh không còn thay đổi chưa commit:

```powershell
git fetch origin
git merge origin/main
```

Nếu xung đột, đọc cả hai thay đổi và trao đổi với người sửa file đó; sửa dấu xung đột, chạy thử, rồi commit kết quả. Không dùng force push để xử lý xung đột trên `main`.

## Các file cần phối hợp

- `frontend/src/App.tsx`: menu và gắn màn hình mới.
- `frontend/src/api.ts`: kiểu dữ liệu và lớp gọi API dùng chung.
- `frontend/src/screens.tsx`: hiện chứa nhiều màn hình; trao đổi trước khi cùng sửa, tách component khi cần.
- `backend/src/main/resources/schema.sql`: cấu trúc database. Sửa `CREATE TABLE IF NOT EXISTS` không tự cập nhật bảng đã tồn tại; thay đổi schema phải có câu lệnh nâng cấp phù hợp và hướng dẫn kiểm tra.
- `pom.xml`, `package.json`, `package-lock.json`: báo nhóm khi đổi thư viện. Commit cả lockfile khi thay dependency frontend.

Giữ hợp đồng API ổn định. Nếu đổi tên trường, đường dẫn hoặc cách xác thực, cập nhật frontend, tài liệu API và các script kiểm tra trong cùng Pull Request.

## Cấu hình riêng

Không commit `.local/`, database, dữ liệu nội bộ, token, API key, `.env`, `application-local.properties`, thư viện đã cài hoặc file build. `.gitignore` đã loại các vị trí cấu hình thường dùng; vẫn kiểm tra `git diff --cached` trước khi push.

Khóa Gemini/DeepSeek chỉ đặt ở dịch vụ backend/AI. Không đưa khóa thật vào biến `VITE_*` hoặc source React vì chúng có thể xuất hiện trong trình duyệt.

Repo public cho phép người khác clone; để push trực tiếp lên nhánh của repo, hai thành viên phải nhận và chấp nhận lời mời collaborator. Nhóm dùng Pull Request để review; tài liệu này không tự bật bảo vệ nhánh `main` trên GitHub.
