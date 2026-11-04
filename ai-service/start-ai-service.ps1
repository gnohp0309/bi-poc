# Script khởi động AI Service
# Chạy: powershell -ExecutionPolicy Bypass -File .\start-ai-service.ps1

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "==> Khởi động AI Service..." -ForegroundColor Cyan

# Check Python
try {
    $pythonVersion = python --version 2>&1
    Write-Host "Python: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Python không tìm thấy. Cài Python 3.8+ và thêm vào PATH." -ForegroundColor Red
    exit 1
}

# Check .env file
if (-not (Test-Path ".env")) {
    Write-Host "ERROR: File .env không tồn tại." -ForegroundColor Red
    Write-Host "Tạo file .env từ .env.example và điền GEMINI_API_KEY" -ForegroundColor Yellow
    exit 1
}

# Check virtual environment
if (-not (Test-Path "venv")) {
    Write-Host "Tạo virtual environment..." -ForegroundColor Yellow
    python -m venv venv
}

# Activate venv and install dependencies
Write-Host "Cài đặt dependencies..." -ForegroundColor Yellow
& "venv\Scripts\Activate.ps1"
pip install -q -r requirements.txt

# Start service
Write-Host "==> AI Service đang chạy tại http://127.0.0.1:8082" -ForegroundColor Green
Write-Host "Nhấn Ctrl+C để dừng" -ForegroundColor Yellow
python main.py
