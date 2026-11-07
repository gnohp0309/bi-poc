param([string]$BaseUrl = 'http://127.0.0.1:8081/api')
$ErrorActionPreference = 'Stop'
$base = $BaseUrl.TrimEnd('/')
$curl = Get-Command curl.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $curl) { $curl = Get-Command curl -CommandType Application -ErrorAction Stop | Select-Object -First 1 }
function Assert($condition, $message) { if (-not $condition) { throw $message } }
function Login($user) {
  Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body (@{username=$user;password='Demo2026!'} | ConvertTo-Json -Compress)
}
$admin=Login 'admin'
$headers=@{Authorization="Bearer $($admin.token)"}
function Call($method,$path,$body) {
  $arguments=@{Method=$method;Uri="$base$path";Headers=$headers}
  if($null -ne $body){$arguments.ContentType='application/json; charset=utf-8';$arguments.Body=($body | ConvertTo-Json -Depth 20 -Compress)}
  Invoke-RestMethod @arguments
}
function ExpectStatus($path,$status,$requestHeaders) {
  try { Invoke-RestMethod -Uri "$base$path" -Headers $requestHeaders | Out-Null }
  catch { if($null -ne $_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq $status){return}; throw }
  throw "Expected HTTP $status for $path"
}
$connection=$null; $import=$null; $fixturePath=$null
try {
  $connection=Call 'POST' '/connections' @{name='Exploration smoke';host='127.0.0.1';port=5433;database='bi_poc_source';username='bi_reader';password='Reader2026!'}
  $sql="SELECT * FROM (VALUES (10::numeric,'A',DATE '2025-01-01'),(20::numeric,'B',DATE '2025-01-02'),(20::numeric,'B',DATE '2025-01-02'),(NULL::numeric,' ',NULL::date)) AS t(""revenue value"", label, event_date)"
  $dataset=Call 'POST' '/datasets' @{connectionId=$connection.id;name='Exploration fixture';kind='VIRTUAL';sql=$sql}
  $report=Call 'GET' "/datasets/$($dataset.id)/exploration" $null
  Assert ($report.overview.rowCount -eq 4 -and $report.overview.columnCount -eq 3) 'Overview count differs'
  Assert ($report.overview.sizeBytes -gt 0 -and -not $report.sampled) 'Size/scope differs'
  Assert ($report.quality.duplicateRows -eq 1 -and $report.quality.missingCells -eq 3) 'Duplicates/missing differs'
  $numeric=$report.columns | Where-Object name -eq 'revenue value'
  Assert ($numeric.validCount -eq 3 -and $numeric.distinctCount -eq 2 -and $numeric.missingRate -eq 25) 'Numeric profile differs'
  Assert ($numeric.min -eq 10 -and $numeric.max -eq 20 -and $numeric.median -eq 20 -and $numeric.q1 -eq 15 -and $numeric.q3 -eq 20) 'Quartiles/min/max differ'
  Assert ([math]::Abs($numeric.mean - (50.0/3)) -lt 0.000001 -and [math]::Abs($numeric.variance - (100.0/3)) -lt 0.000001) 'Mean/sample variance differ'
  Assert ([math]::Abs($numeric.standardDeviation - [math]::Sqrt(100.0/3)) -lt 0.000001 -and $numeric.mode -eq '20') 'Stddev/mode differ'
  $text=$report.columns | Where-Object name -eq 'label'
  Assert ($text.blankCount -eq 1 -and $text.nullCount -eq 0 -and $text.missingCount -eq 1) 'Blank vs NULL differs'
  Assert (-not $text.statisticsAvailable -and $null -eq $text.mean) 'Text should not have numeric statistics'
  $empty=Call 'POST' '/datasets' @{connectionId=$connection.id;name='Exploration empty';kind='VIRTUAL';sql="SELECT NULL::numeric AS n WHERE false"}
  $emptyReport=Call 'GET' "/datasets/$($empty.id)/exploration" $null
  Assert ($emptyReport.overview.rowCount -eq 0 -and $null -eq $emptyReport.overview.missingRate -and $null -eq $emptyReport.columns[0].mean -and $null -eq $emptyReport.columns[0].missingRate) 'Empty values must remain NULL'
  $special=Call 'POST' '/datasets' @{connectionId=$connection.id;name='Exploration nonfinite';kind='VIRTUAL';sql="SELECT * FROM (VALUES ('NaN'::numeric),('Infinity'::numeric),('-Infinity'::numeric),(5::numeric)) t(n)"}
  $specialReport=Call 'GET' "/datasets/$($special.id)/exploration" $null
  Assert ($specialReport.quality.invalidCells -eq 3 -and $specialReport.columns[0].validCount -eq 1 -and $specialReport.columns[0].mean -eq 5 -and $null -eq $specialReport.columns[0].standardDeviation) 'Nonfinite or singleton statistics differ'
  $large=Call 'POST' '/datasets' @{connectionId=$connection.id;name='Exploration full population';kind='VIRTUAL';sql='SELECT generate_series(1,1001)::integer AS n'}
  $largeReport=Call 'GET' "/datasets/$($large.id)/exploration" $null
  Assert ($largeReport.overview.rowCount -eq 1001 -and $largeReport.columns[0].distinctCount -eq 1001 -and $largeReport.columns[0].mean -eq 501) 'Report must not profile just preview/500 rows'
  Assert ($largeReport.columns[0].topValues.Count -eq 10 -and $largeReport.columns[0].topValuesTruncated) 'Top values must be bounded and marked'
  $physical=Call 'POST' '/datasets' @{connectionId=$connection.id;name='Exploration physical';kind='PHYSICAL';sourceName='public.orders'}
  $physicalReport=Call 'GET' "/datasets/$($physical.id)/exploration" $null
  $reference=Call 'POST' '/sql/execute' @{connectionId=$connection.id;sql='SELECT count(*) AS n FROM public.orders'}
  Assert ($physicalReport.overview.rowCount -eq $reference.rows[0].n) 'Physical report count differs'
  $fixturePath=Join-Path (Split-Path -Parent $PSScriptRoot) '.local/exploration-fixture.csv'
  New-Item -ItemType Directory -Force -Path (Split-Path $fixturePath) | Out-Null
  [IO.File]::WriteAllText($fixturePath,"amount,region`n10,A`n10,A`nwrong,B`n20,C`n",[Text.UTF8Encoding]::new($false))
  $upload=& $curl.Source -sS -X POST "$base/imports" -H "Authorization: Bearer $($admin.token)" -F "file=@$fixturePath"
  if($LASTEXITCODE -ne 0){throw 'CSV upload failed'}
  $import=$upload | ConvertFrom-Json
  Assert ($null -ne $import.id) 'CSV fixture was not created'
  $csvReport=Call 'GET' "/datasets/$($import.dataset_id)/exploration" $null
  Assert ($csvReport.overview.columnCount -eq 2 -and $csvReport.quality.duplicateRows -eq 1) 'CSV system columns must not mask duplicates'
  Assert ($csvReport.quality.importSnapshot.invalid_count -eq 1 -and $csvReport.quality.missingCells -eq 1) 'CSV historical invalid vs current NULL differs'
  $viewer=Login 'viewer'
  $viewerHeaders=@{Authorization="Bearer $($viewer.token)"}
  try {
    $viewerReport=Invoke-RestMethod -Uri "$base/datasets/$($dataset.id)/exploration" -Headers $viewerHeaders
    Assert ($viewerReport.overview.rowCount -eq 4) 'Viewer cannot read report'
  } finally { Invoke-RestMethod -Method Post -Uri "$base/auth/logout" -Headers $viewerHeaders | Out-Null }
  ExpectStatus "/datasets/$($dataset.id)/exploration" 401 @{}
  ExpectStatus '/datasets/not-a-uuid/exploration' 400 $headers
  ExpectStatus "/datasets/$([guid]::NewGuid())/exploration" 404 $headers
  Write-Host 'EXPLORATION PASS: physical/virtual/CSV/empty, full population, quoted columns, NULL/blank/nonfinite, statistics, duplicates, history, Viewer/auth.'
} finally {
  if($import -and $import.id){Call 'DELETE' "/imports/$($import.id)" $null | Out-Null}
  if($connection){Call 'DELETE' "/connections/$($connection.id)" $null | Out-Null}
  if($fixturePath -and (Test-Path -LiteralPath $fixturePath)){Remove-Item -LiteralPath $fixturePath}
  Call 'POST' '/auth/logout' $null | Out-Null
}
