$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
  $python = (Get-Command python.exe -ErrorAction Stop).Source
  if (-not (Test-Path '.env') -and -not $env:GEMINI_API_KEY) {
    throw 'Copy .env.example to .env and set GEMINI_API_KEY before starting.'
  }
  if (-not (Test-Path 'venv\Scripts\python.exe')) {
    & $python -m venv venv
    if ($LASTEXITCODE -ne 0) { throw 'Creating Python virtual environment failed.' }
  }
  $venvPython = Join-Path $PSScriptRoot 'venv\Scripts\python.exe'
  & $venvPython -m pip install -r requirements.txt
  if ($LASTEXITCODE -ne 0) { throw 'Installing AI service dependencies failed.' }
  Write-Host 'Starting AI service (default http://127.0.0.1:8000; see SERVICE_PORT in .env).'
  & $venvPython main.py
  if ($LASTEXITCODE -ne 0) { throw 'AI service exited with an error.' }
} finally { Pop-Location }
