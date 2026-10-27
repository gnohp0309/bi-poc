param([int]$Rows = 1000000)
$ErrorActionPreference = 'Stop'
if ($Rows -lt 1 -or $Rows -gt 1000000) { throw 'Rows must be between 1 and 1000000' }
$root = Split-Path -Parent $PSScriptRoot
$local = Join-Path $root '.local'
$path = Join-Path $local "load-$Rows.csv"
$responsePath = Join-Path $local 'load-import-response.json'
New-Item -ItemType Directory -Path $local -Force | Out-Null
$writer = New-Object System.IO.StreamWriter($path,$false,(New-Object System.Text.UTF8Encoding($false)),65536)
try {
  $writer.WriteLine('date,region,category,amount,quantity')
  $regions = @('North','South','Central')
  $categories = @('Electronics','Home','Office')
  for ($i=0; $i -lt $Rows; $i++) {
    $month = 1 + ($i % 12)
    $amount = ($i % 100) + 1
    $writer.WriteLine(('2025-{0:00}-01,{1},{2},{3},1' -f $month,$regions[$i % 3],$categories[([int][math]::Floor($i / 3)) % 3],$amount))
  }
} finally { $writer.Dispose() }
$size = (Get-Item $path).Length
Write-Host "Generated $Rows rows ($size bytes)."
$base = 'http://127.0.0.1:8081/api'
$login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body '{"username":"admin","password":"Demo2026!"}'
$token = $login.token
$watch = [System.Diagnostics.Stopwatch]::StartNew()
$status = & curl.exe -sS -o $responsePath -w '%{http_code}' -X POST "$base/imports" -H "Authorization: Bearer $token" -F "file=@$path" -F "title=Load test $Rows"
$watch.Stop()
if ($LASTEXITCODE -ne 0) { throw "curl failed: $LASTEXITCODE" }
$result = Get-Content -LiteralPath $responsePath -Raw -Encoding UTF8 | ConvertFrom-Json
if ([int]$status -ne 200) { throw "Upload HTTP $status after $($watch.Elapsed.TotalSeconds) seconds: $($result.error)" }
$headers = @{Authorization="Bearer $token"}
try {
  if ($result.row_count -ne $Rows) { throw "Expected $Rows rows, got $($result.row_count)" }
  $dashboard = Invoke-RestMethod -Uri "$base/dashboards/$($result.dashboard_id)" -Headers $headers
  if ($dashboard.charts.Count -ne 3) { throw 'Expected 3 generated charts' }
  $amount = $result.columns | Where-Object { $_.original -eq 'amount' }
  $expectedCycles = [int][math]::Floor($Rows / 100)
  $remainder = $Rows % 100
  $expectedSum = ($expectedCycles * 5050) + ([int]($remainder * ($remainder + 1) / 2))
  if ($amount.sum -ne $expectedSum) { throw "Expected sum $expectedSum, got $($amount.sum)" }
  Write-Host "LOAD PASS: $Rows rows, $($watch.Elapsed.TotalSeconds.ToString('F1')) seconds, sum=$($amount.sum), charts=$($dashboard.charts.Count)."
} finally {
  Invoke-RestMethod -Method Delete -Uri "$base/imports/$($result.id)" -Headers $headers | Out-Null
  Remove-Item -LiteralPath $path,$responsePath -ErrorAction SilentlyContinue
}
