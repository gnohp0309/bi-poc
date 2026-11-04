param(
  [string]$BaseUrl = 'http://127.0.0.1:8081/api',
  [string]$SourceHost = '127.0.0.1',
  [int]$SourcePort = 5433,
  [string]$SourceDatabase = 'bi_poc_source'
)
$ErrorActionPreference = 'Stop'
$base = $BaseUrl.TrimEnd('/')
function Assert($condition, $message) { if (-not $condition) { throw $message } }
function Login($username) {
  return Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json; charset=utf-8' -Body (@{username=$username;password='Demo2026!'} | ConvertTo-Json -Compress)
}
$admin = Login 'admin'
$headers = @{Authorization="Bearer $($admin.token)"}
function Call($method, $path, $body) {
  $arguments = @{Method=$method;Uri="$base$path";Headers=$headers}
  if ($null -ne $body) { $arguments.ContentType='application/json; charset=utf-8';$arguments.Body=($body | ConvertTo-Json -Depth 20 -Compress) }
  return Invoke-RestMethod @arguments
}
function ExpectStatus($method, $path, $body, $status, $requestHeaders) {
  $arguments = @{Method=$method;Uri="$base$path";Headers=$requestHeaders}
  if ($null -ne $body) { $arguments.ContentType='application/json; charset=utf-8';$arguments.Body=($body | ConvertTo-Json -Depth 20 -Compress) }
  try { Invoke-RestMethod @arguments | Out-Null; throw "Expected HTTP $status for $path" }
  catch { if ($null -eq $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne $status) { throw } }
}
$connection = $null
$import = $null
$responseFile = $null
$watch = [System.Diagnostics.Stopwatch]::StartNew()
try {
  $connection = Call 'POST' '/connections' @{name="Analysis smoke $([guid]::NewGuid())";host=$SourceHost;port=$SourcePort;database=$SourceDatabase;username='bi_reader';password='Reader2026!'}
  $physical = Call 'POST' '/datasets' @{connectionId=$connection.id;name='Analysis physical';kind='PHYSICAL';sourceName='public.orders'}
  Call 'PUT' "/datasets/$($physical.id)/aliases" @{aliases=@{amount='Revenue'}} | Out-Null
  $metadata = Call 'GET' "/datasets/$($physical.id)/metadata" $null
  Assert ($metadata.datasetId -eq $physical.id -and $metadata.kind -eq 'PHYSICAL') 'Physical metadata identity differs'
  $amount = $metadata.columns | Where-Object { $_.name -eq 'amount' }
  Assert ($amount.kind -eq 'number' -and $amount.label -eq 'Revenue') 'Physical metadata type/alias differs'
  Assert ($null -eq $metadata.password -and $null -eq $metadata.connectionId -and $null -eq $metadata.sql_definition) 'Metadata contains private connection or SQL fields'
  $reference = Call 'POST' '/sql/execute' @{connectionId=$connection.id;sql='SELECT SUM(amount) AS revenue, COUNT(*) AS orders FROM public.orders'}
  $physicalResult = Call 'POST' "/datasets/$($physical.id)/analyze" @{metrics=@(@{column='amount';aggregate='sum';alias='revenue'},@{column='*';aggregate='count';alias='orders'})}
  Assert ($physicalResult.rows[0].revenue -eq $reference.rows[0].revenue -and $physicalResult.rows[0].orders -eq $reference.rows[0].orders) 'Physical analysis differs from independent SQL'

  $root = Split-Path -Parent $PSScriptRoot
  $local = Join-Path $root '.local'
  New-Item -ItemType Directory -Path $local -Force | Out-Null
  $responseFile = Join-Path $local 'analysis-import-response.json'
  $curl = Get-Command curl.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $curl) { $curl = Get-Command curl -CommandType Application -ErrorAction Stop | Select-Object -First 1 }
  $fixtureFile = Join-Path $PSScriptRoot 'import-fixture.csv'
  $status = & $curl.Source -sS -o $responseFile -w '%{http_code}' -X POST "$base/imports" -H "Authorization: Bearer $($admin.token)" -F "file=@$fixtureFile" -F 'title=Analysis CSV check'
  if ($LASTEXITCODE -ne 0 -or [int]$status -ne 200) { throw 'CSV analysis fixture upload failed.' }
  $import = Get-Content -LiteralPath $responseFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $csvMeta = Call 'GET' "/datasets/$($import.dataset_id)/metadata" $null
  $csvAmount = $csvMeta.columns | Where-Object { $_.name -eq 'c_amount' }
  Assert ($csvAmount.kind -eq 'number') 'CSV metadata type differs'
  $csvResult = Call 'POST' "/datasets/$($import.dataset_id)/analyze" @{metrics=@(@{column='c_amount';aggregate='sum';alias='total'},@{column='*';aggregate='count';alias='rows'})}
  Assert ($csvResult.rows[0].total -eq 1050 -and $csvResult.rows[0].rows -eq 8) 'CSV analysis total/count differs'

  $fixtureSql = @'
SELECT * FROM (VALUES
(DATE '2025-01-01','North',100::numeric,true),
(DATE '2025-01-10','North',200::numeric,false),
(DATE '2025-02-01','South',300::numeric,true),
(NULL::date,'South',400::numeric,true),
(DATE '2025-02-10',NULL::text,NULL::numeric,false)
) AS sample(event_date,region,amount,active)
'@
  $fixture = Call 'POST' '/datasets' @{connectionId=$connection.id;name='Analysis edge cases';kind='VIRTUAL';sql=$fixtureSql}
  $meta = Call 'GET' "/datasets/$($fixture.id)/metadata" $null
  Assert ($meta.kind -eq 'VIRTUAL' -and $meta.columns.Count -eq 4) 'Virtual metadata differs'
  $all = Call 'POST' "/datasets/$($fixture.id)/analyze" @{metrics=@(
    @{column='amount';aggregate='sum';alias='total'},@{column='*';aggregate='count';alias='rows'},
    @{column='amount';aggregate='count';alias='valid_amounts'},@{column='region';aggregate='count_distinct';alias='regions'},
    @{column='amount';aggregate='avg';alias='average'})}
  Assert ($all.rows[0].total -eq 1000 -and $all.rows[0].rows -eq 5 -and $all.rows[0].valid_amounts -eq 4 -and $all.rows[0].regions -eq 2 -and $all.rows[0].average -eq 250) 'NULL/aggregate behavior differs'
  $monthly = Call 'POST' "/datasets/$($fixture.id)/analyze" @{groupBy=@(@{column='event_date';timeGrain='month';alias='month'});metrics=@(@{column='amount';aggregate='sum';alias='revenue'})}
  Assert ($monthly.rows.Count -eq 2 -and $monthly.rows[0].revenue -eq 300 -and $monthly.rows[1].revenue -eq 300) 'Monthly totals or NULL date handling differ'
  $filtered = Call 'POST' "/datasets/$($fixture.id)/analyze" @{metrics=@(@{column='amount';aggregate='sum';alias='total'});filters=@(@{column='region';operator='in';value=@('North')})}
  Assert ($filtered.rows[0].total -eq 300) 'IN filter differs'
  $dateRange = Call 'POST' "/datasets/$($fixture.id)/analyze" @{metrics=@(@{column='amount';aggregate='sum';alias='total'});filters=@(@{column='event_date';operator='gte';value='2025-02-01'})}
  Assert ($dateRange.rows[0].total -eq 300) 'Date filter differs'
  $boolean = Call 'POST' "/datasets/$($fixture.id)/analyze" @{metrics=@(@{column='amount';aggregate='sum';alias='total'});filters=@(@{column='active';operator='eq';value=$true})}
  Assert ($boolean.rows[0].total -eq 800) 'Boolean filter differs'
  $nulls = Call 'POST' "/datasets/$($fixture.id)/analyze" @{metrics=@(@{column='*';aggregate='count';alias='rows'});filters=@(@{column='amount';operator='is_null'})}
  Assert ($nulls.rows[0].rows -eq 1) 'NULL filter differs'
  $hostile = Call 'POST' "/datasets/$($fixture.id)/analyze" @{metrics=@(@{column='*';aggregate='count';alias='rows'});filters=@(@{column='region';operator='eq';value="North' OR TRUE --"})}
  Assert ($hostile.rows[0].rows -eq 0) 'Filter value changed query meaning'
  $empty = Call 'POST' '/datasets' @{connectionId=$connection.id;name='Analysis empty';kind='VIRTUAL';sql='SELECT 1::integer AS n WHERE false'}
  $emptyMeta = Call 'GET' "/datasets/$($empty.id)/metadata" $null
  Assert ($emptyMeta.columns[0].name -eq 'n' -and $emptyMeta.columns[0].kind -eq 'number') 'Empty dataset metadata differs'
  $emptyResult = Call 'POST' "/datasets/$($empty.id)/analyze" @{metrics=@(@{column='n';aggregate='sum';alias='total'},@{column='*';aggregate='count';alias='rows'})}
  Assert ($null -eq $emptyResult.rows[0].total -and $emptyResult.rows[0].rows -eq 0) 'Empty aggregate should preserve SQL NULL/count semantics'
  $zoned = Call 'POST' '/datasets' @{connectionId=$connection.id;name='Analysis UTC';kind='VIRTUAL';sql="SELECT * FROM (VALUES (TIMESTAMPTZ '2025-01-31 23:30:00-02',100::numeric),(TIMESTAMPTZ '2025-01-31 23:30:00+02',200::numeric)) AS sample(event_time,amount)"}
  $utc = Call 'POST' "/datasets/$($zoned.id)/analyze" @{groupBy=@(@{column='event_time';timeGrain='month';alias='month'});metrics=@(@{column='amount';aggregate='sum';alias='total'})}
  Assert ($utc.rows.Count -eq 2 -and $utc.rows[0].total -eq 200 -and $utc.rows[1].total -eq 100) 'Timestamp grouping is not UTC'

  foreach ($bad in @(
    @{sql='SELECT * FROM app_users';metrics=@()},
    @{metrics=@(@{column='password_cipher';aggregate='count';alias='n'})},
    @{metrics=@(@{column='region';aggregate='sum';alias='n'})},
    @{metrics=@(@{column='amount';aggregate='sum';alias='x;DROP'})},
    @{metrics=@(@{column='*';aggregate='count';alias='n'});limit=501},
    @{metrics=@(@{column='*';aggregate='count';alias='n'});limit=1.5},
    @{metrics=@(@{column='*';aggregate='count';alias='n'});filters=@(@{column='event_date';operator='gte';value='2025-02-30'})}
  )) { ExpectStatus 'POST' "/datasets/$($fixture.id)/analyze" $bad 400 $headers }
  ExpectStatus 'GET' "/datasets/$([guid]::NewGuid())/metadata" $null 404 $headers
  ExpectStatus 'GET' "/datasets/$($fixture.id)/metadata" $null 401 @{}
  $viewer = Login 'viewer'
  $viewerHeaders = @{Authorization="Bearer $($viewer.token)"}
  ExpectStatus 'POST' "/datasets/$($fixture.id)/analyze" @{metrics=@(@{column='*';aggregate='count';alias='n'})} 403 $viewerHeaders
  $viewerMeta = Invoke-RestMethod -Uri "$base/datasets/$($fixture.id)/metadata" -Headers $viewerHeaders
  Assert ($viewerMeta.datasetId -eq $fixture.id) 'Viewer could not inspect metadata'
  $analyst = Login 'analyst'
  $analystResult = Invoke-RestMethod -Method Post -Uri "$base/datasets/$($fixture.id)/analyze" -Headers @{Authorization="Bearer $($analyst.token)"} -ContentType 'application/json; charset=utf-8' -Body '{"metrics":[{"column":"*","aggregate":"count","alias":"n"}]}'
  Assert ($analystResult.rows[0].n -eq 5) 'Analyst could not analyze'

  $large = Call 'POST' '/datasets' @{connectionId=$connection.id;name='Analysis 500000 rows';kind='VIRTUAL';sql='SELECT n::integer AS id, ((n-1)%100+1)::numeric AS amount FROM generate_series(1,500000) AS n'}
  $largeWatch = [System.Diagnostics.Stopwatch]::StartNew()
  $largeResult = Call 'POST' "/datasets/$($large.id)/analyze" @{metrics=@(@{column='amount';aggregate='sum';alias='total'},@{column='*';aggregate='count';alias='rows'})}
  $largeWatch.Stop()
  Assert ($largeResult.rows[0].total -eq 25250000 -and $largeResult.rows[0].rows -eq 500000) 'Analysis did not aggregate all 500000 source rows'
  $limited = Call 'POST' "/datasets/$($large.id)/analyze" @{groupBy=@(@{column='id'});metrics=@(@{column='amount';aggregate='sum';alias='total'});limit=2}
  Assert ($limited.rows.Count -eq 2 -and $limited.rows[0].id -eq 1 -and $limited.rows[1].id -eq 2 -and $limited.truncated) 'Small result limit/truncation differs'
  $max = Call 'POST' "/datasets/$($large.id)/analyze" @{groupBy=@(@{column='id'});metrics=@(@{column='*';aggregate='count';alias='n'});limit=500}
  Assert ($max.rows.Count -eq 500 -and $max.truncated) 'Maximum result limit/truncation differs'
  Write-Host "LARGE ANALYSIS PASS: 500000 generated PostgreSQL rows, sum=25250000, count=500000; request $($largeWatch.Elapsed.TotalSeconds.ToString('F2')) seconds."
  Write-Host 'SMOKE ANALYSIS PASS: physical/CSV/virtual/empty metadata, aliases, aggregates, filters, UTC, input rejection, roles, result limits.'
} finally {
  try { if ($import) { Call 'DELETE' "/imports/$($import.id)" $null | Out-Null } }
  finally {
    try { if ($connection) { Call 'DELETE' "/connections/$($connection.id)" $null | Out-Null } }
    finally { if ($responseFile) { Remove-Item -LiteralPath $responseFile -ErrorAction SilentlyContinue } }
  }
  $watch.Stop()
  Write-Host "Analysis smoke finished in $($watch.Elapsed.TotalSeconds.ToString('F2')) seconds; temporary source connection, datasets and import removed. Shared CSV connection and audit/session history remain."
}
