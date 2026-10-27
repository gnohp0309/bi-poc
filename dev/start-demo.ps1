$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$jar = Join-Path $root 'backend\target\bi-poc-0.1.0.jar'
$local = Join-Path $root '.local'
if (-not (Test-Path $jar)) { throw 'Missing backend JAR. Build frontend, then run Maven package in backend.' }
& (Join-Path $PSScriptRoot 'setup-postgres.ps1')
try {
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8081/api/health' -TimeoutSec 2
  if ($health.status -eq 'ok') { Write-Host 'POC already running at http://127.0.0.1:8081/'; exit 0 }
} catch { }
$java = (Get-Command java.exe -ErrorAction Stop).Source
$app = Start-Process -FilePath $java -ArgumentList @('-jar', "`"$jar`"") -WorkingDirectory (Join-Path $root 'backend') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $local 'app.out.log') -RedirectStandardError (Join-Path $local 'app.err.log') -PassThru
$app.Id | Set-Content -Path (Join-Path $local 'app.pid')
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8081/api/health' -TimeoutSec 1
    if ($health.status -eq 'ok') { Write-Host 'POC ready at http://127.0.0.1:8081/'; exit 0 }
  } catch { }
  if ($app.HasExited) { throw "App exited early. Check $local\app.err.log" }
}
throw "App did not become ready. Check $local\app.err.log"
