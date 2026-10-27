$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root '.local\app.pid'
if (-not (Test-Path $pidFile)) { Write-Host 'No POC process ID was saved.'; exit 0 }
$appPid = [int](Get-Content $pidFile -Raw)
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$appPid"
if ($process -and $process.CommandLine -like '*bi-poc-0.1.0.jar*') {
  Stop-Process -Id $appPid
  Write-Host "Stopped POC app process $appPid."
} else { Write-Host 'Saved PID does not belong to the POC app; no process stopped.' }
Remove-Item -LiteralPath $pidFile
Write-Host 'PostgreSQL sample cluster remains running; see README for its stop command.'
