$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8081/api'
$root = Split-Path -Parent $PSScriptRoot
$fixture = Join-Path $PSScriptRoot 'import-fixture.csv'
$local = Join-Path $root '.local'
$responseFile = Join-Path $local 'import-smoke-response.json'
$badRows = Join-Path $local 'import-smoke-bad-rows.csv'
$badUtf8 = Join-Path $local 'import-smoke-bad-utf8.csv'
$empty = Join-Path $local 'import-smoke-empty.csv'
New-Item -ItemType Directory -Path $local -Force | Out-Null

function Assert($condition, $message) { if (-not $condition) { throw $message } }
function Login($username) {
  return Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body (@{username=$username;password='Demo2026!'} | ConvertTo-Json -Compress)
}
function Upload($path, $filename, $token) {
  $status = & curl.exe -sS -o $responseFile -w '%{http_code}' -X POST "$base/imports" -H "Authorization: Bearer $token" -F "file=@$path;filename=$filename" -F 'title=Kiểm thử nhập CSV'
  if ($LASTEXITCODE -ne 0) { throw "curl upload failed: $LASTEXITCODE" }
  $body = Get-Content -LiteralPath $responseFile -Raw -Encoding UTF8 | ConvertFrom-Json
  return @{ status=[int]$status; body=$body }
}

$admin = Login 'admin'
$headers = @{Authorization="Bearer $($admin.token)"}
$created = $null
try {
  $result = Upload $fixture 'import-fixture.csv' $admin.token
  Assert ($result.status -eq 200) "Valid upload failed: $($result.body.error)"
  $created = $result.body
  Assert ($created.row_count -eq 8) 'Expected 8 rows'
  Assert ($created.missing_count -eq 2 -and $created.invalid_count -eq 2) 'Missing/invalid counts differ'
  $amount = $created.columns | Where-Object { $_.original -eq 'amount' }
  Assert ($amount.type -eq 'NUMERIC' -and $amount.sum -eq 1050 -and $amount.validCount -eq 6) 'Amount statistics differ'
  Assert ($created.analysis.chartCount -eq 3) 'Expected 3 generated charts'
  $dashboard = Invoke-RestMethod -Uri "$base/dashboards/$($created.dashboard_id)" -Headers $headers
  Assert ($dashboard.charts.Count -eq 3) 'Dashboard has wrong number of charts'
  $north = $dashboard.charts[0].rows | Where-Object { $_.label -eq 'Miền Bắc' }
  Assert ($north.value -eq 300) 'Region aggregation differs'
  $january = $dashboard.charts[2].rows | Where-Object { $_.label -eq '2025-01' }
  Assert ($january.value -eq 300) 'Monthly aggregation differs'

  $wrongExtension = Upload $fixture 'data.txt' $admin.token
  Assert ($wrongExtension.status -eq 400) 'Non-CSV extension was accepted'
  [System.IO.File]::WriteAllText($empty, 'x,y' + "`n", (New-Object System.Text.UTF8Encoding($false)))
  $emptyResult = Upload $empty 'empty.csv' $admin.token
  Assert ($emptyResult.status -eq 400) 'Header-only CSV was accepted'
  $lines = New-Object 'System.Collections.Generic.List[string]'
  $lines.Add('x,y')
  for ($i=0; $i -lt 200; $i++) { $lines.Add("a,$i") }
  $lines.Add('bad,extra,column')
  [System.IO.File]::WriteAllLines($badRows, $lines, (New-Object System.Text.UTF8Encoding($false)))
  $badRowsResult = Upload $badRows 'bad-rows.csv' $admin.token
  Assert ($badRowsResult.status -eq 400) 'Malformed row after sample was accepted'
  [System.IO.File]::WriteAllBytes($badUtf8, [byte[]](0x78,0x2c,0x79,0x0a,0x61,0x2c,0x81,0x0a))
  $utf8Result = Upload $badUtf8 'bad-utf8.csv' $admin.token
  Assert ($utf8Result.status -eq 400) 'Invalid UTF-8 was accepted'

  $viewer = Login 'viewer'
  $viewerResult = Upload $fixture 'import-fixture.csv' $viewer.token
  Assert ($viewerResult.status -eq 403) 'Viewer could upload CSV'

  try { Invoke-RestMethod -Method Delete -Uri "$base/dashboards/$($created.dashboard_id)" -Headers $headers | Out-Null; throw 'Direct deletion of generated dashboard was allowed' }
  catch { if ($_.Exception.Response.StatusCode.value__ -ne 400) { throw } }
  Write-Host 'SMOKE IMPORT PASS: row counts, cleaning, sums, generated dashboard, malformed CSV, UTF-8, viewer role.'
} finally {
  if ($created) {
    Invoke-RestMethod -Method Delete -Uri "$base/imports/$($created.id)" -Headers $headers | Out-Null
    try { Invoke-RestMethod -Uri "$base/dashboards/$($created.dashboard_id)" -Headers $headers | Out-Null; throw 'Dashboard still exists after import deletion' }
    catch { if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw } }
    Write-Host 'CLEANUP PASS: import and generated dashboard removed.'
  }
  foreach ($path in @($responseFile,$badRows,$badUtf8,$empty)) { Remove-Item -LiteralPath $path -ErrorAction SilentlyContinue }
}
