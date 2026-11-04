param(
  [string]$BaseUrl = 'http://127.0.0.1:8081/api',
  [string]$SourceHost = '127.0.0.1',
  [int]$SourcePort = 5433,
  [string]$SourceDatabase = 'bi_poc_source'
)
$ErrorActionPreference = 'Stop'
$base = $BaseUrl.TrimEnd('/')
$login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body '{"username":"admin","password":"Demo2026!"}'
$headers = @{ Authorization = "Bearer $($login.token)" }
function Call($method, $path, $body) {
  $args = @{ Method = $method; Uri = "$base$path"; Headers = $headers }
  if ($null -ne $body) { $args.ContentType = 'application/json; charset=utf-8'; $args.Body = ($body | ConvertTo-Json -Depth 20 -Compress) }
  $result = Invoke-RestMethod @args
  if ($result -is [array]) { foreach ($item in $result) { Write-Output $item } } else { Write-Output $result }
}
function Assert($condition, $message) { if (-not $condition) { throw $message } }
function Rejected($body, $status = 400) {
  try { Call 'POST' '/dashboards/from-template' $body | Out-Null }
  catch { if ([int]$_.Exception.Response.StatusCode -eq $status) { return }; throw }
  throw 'Invalid request unexpectedly succeeded'
}
$conn = $null
$import = $null
$responseFile = $null
$dashboardIds = @()
try {
  $conn = Call 'POST' '/connections' @{ name = 'Template smoke'; host = $SourceHost; port = $SourcePort; database = $SourceDatabase; username = 'bi_reader'; password = 'Reader2026!' }
  $sql = "SELECT * FROM (VALUES (DATE '2025-01-01',100::numeric,'North','A'),(DATE '2025-01-15',200::numeric,'North','B'),(DATE '2025-02-01',400::numeric,'South','A'),(NULL::date,50::numeric,'South','B')) AS t(order_date,amount,region,category)"
  $dataset = Call 'POST' '/datasets' @{ connectionId = $conn.id; name = 'Template fixture'; kind = 'VIRTUAL'; sql = $sql }
  $templates = @(Call 'GET' '/dashboard-templates' $null)
  Assert ($templates[0].id -eq 'sales-overview') 'Template missing'
  Assert (($templates | Where-Object id -eq 'product-analysis').fields.Count -eq 4) 'Product template missing'
  Assert (($templates | Where-Object id -eq 'order-status').fields.Count -eq 3) 'Order status template missing'
  $columns = @(Call 'GET' "/datasets/$($dataset.id)/columns" $null)
  Assert (($columns | Where-Object name -eq 'order_date').kind -eq 'date') 'Date metadata differs'
  $body = @{ datasetId = $dataset.id; templateId = 'sales-overview'; name = 'Template smoke'; mapping = @{ date = 'order_date'; revenue = 'amount'; region = 'region'; category = 'category' } }
  $created = Call 'POST' '/dashboards/from-template' $body
  $dashboardIds += $created.dashboardId
  # Fetch twice to verify persisted configuration, not just creation response.
  foreach ($attempt in 1..2) {
    $detail = Call 'GET' "/dashboards/$($created.dashboardId)" $null
    Assert ($detail.charts.Count -eq 3) 'Expected three charts'
    Assert ($detail.charts[0].rows.Count -eq 2) 'Expected two months'
    Assert ($detail.charts[0].rows[0].label -eq '2025-01' -and $detail.charts[0].rows[0].value -eq 300) 'Monthly sum differs'
    Assert (($detail.charts[1].rows | Where-Object label -eq 'South').value -eq 450) 'Region sum should include NULL date'
    Assert (($detail.charts[2].rows | Where-Object label -eq 'A').value -eq 500) 'Category sum differs'
  }
  $filteredMonth = Call 'GET' "/dashboards/$($created.dashboardId)?filterDimension=order_date&filter=2025-01" $null
  Assert ($filteredMonth.charts[0].rows.Count -eq 1 -and $filteredMonth.charts[0].rows[0].value -eq 300) 'Monthly dashboard filter must match month buckets'
  Assert (($filteredMonth.charts[1].rows | Where-Object label -eq 'South').value -eq 450) 'Monthly filter affected region chart'
  # The AI analysis API and dashboard must use the same UTC month for timestamptz.
  $zonedSql = "SELECT * FROM (VALUES (TIMESTAMPTZ '2025-01-31 23:30:00-02',100::numeric,'North','A'),(TIMESTAMPTZ '2025-01-31 23:30:00+02',200::numeric,'South','B')) AS t(event_time,total_value,area,department)"
  $zonedDataset = Call 'POST' '/datasets' @{connectionId=$conn.id;name='Template timezone fixture';kind='VIRTUAL';sql=$zonedSql}
  $zonedDashboard = Call 'POST' '/dashboards/from-template' @{datasetId=$zonedDataset.id;templateId='sales-overview';name='UTC month check';mapping=@{date='event_time';revenue='total_value';region='area';category='department'}}
  $dashboardIds += $zonedDashboard.dashboardId
  $zonedDetail = Call 'GET' "/dashboards/$($zonedDashboard.dashboardId)" $null
  Assert ($zonedDetail.charts[0].rows.Count -eq 2) 'Timestamp months should use UTC'
  Assert (($zonedDetail.charts[0].rows | Where-Object label -eq '2025-01').value -eq 200) 'UTC January total differs'
  Assert (($zonedDetail.charts[0].rows | Where-Object label -eq '2025-02').value -eq 100) 'UTC February total differs'
  $zonedAnalysis = Call 'POST' "/datasets/$($zonedDataset.id)/analyze" @{groupBy=@(@{column='event_time';timeGrain='month';alias='month'});metrics=@(@{column='total_value';aggregate='sum';alias='revenue'})}
  Assert ($zonedAnalysis.rows[0].revenue -eq $zonedDetail.charts[0].rows[0].value -and $zonedAnalysis.rows[1].revenue -eq $zonedDetail.charts[0].rows[1].value) 'Template and AI analysis month totals differ'
  try {
    Call 'POST' '/charts/preview' @{datasetId=$dataset.id;chartType='bar';dimension='amount';metric='amount';aggregate='sum';timeGrain='month'} | Out-Null
    throw 'Numeric dimension accepted a month time grain'
  } catch { if ($null -eq $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 400) { throw } }
  $root = Split-Path -Parent $PSScriptRoot
  $local = Join-Path $root '.local'
  New-Item -ItemType Directory -Path $local -Force | Out-Null
  $responseFile = Join-Path $local 'template-import-response.json'
  $curl = Get-Command curl.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $curl) { $curl = Get-Command curl -CommandType Application -ErrorAction Stop | Select-Object -First 1 }
  $csv = Join-Path $root 'demo/doanh_thu_poc.csv'
  $status = & $curl.Source -sS -o $responseFile -w '%{http_code}' -X POST "$base/imports" -H "Authorization: Bearer $($login.token)" -F "file=@$csv" -F 'title=Template CSV fixture'
  if ($LASTEXITCODE -ne 0 -or [int]$status -ne 200) { throw 'Template CSV upload failed.' }
  $import = Get-Content -LiteralPath $responseFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $csvDashboard = Call 'POST' '/dashboards/from-template' @{datasetId=$import.dataset_id;templateId='sales-overview';name='CSV template check';mapping=@{date='c_ngay';revenue='c_doanh_thu';region='c_khu_vuc';category='c_danh_muc'}}
  $dashboardIds += $csvDashboard.dashboardId
  $csvDetail = Call 'GET' "/dashboards/$($csvDashboard.dashboardId)" $null
  Assert (($csvDetail.charts[0].rows | Measure-Object value -Sum).Sum -eq 9300000) 'CSV month total differs'
  Assert (($csvDetail.charts[1].rows | Measure-Object value -Sum).Sum -eq 9700000) 'CSV region total differs'
  $before = @(Call 'GET' '/charts' $null).Count
  $body.mapping.revenue = 'region'; Rejected $body
  $body.mapping.revenue = 'missing'; Rejected $body
  $body.mapping.revenue = 'amount'; $body.mapping.Remove('date'); Rejected $body
  $body.mapping.date = 'order_date'; $body.templateId = 'unknown'; Rejected $body
  $body.templateId = 'sales-overview'
  Assert (@(Call 'GET' '/charts' $null).Count -eq $before) 'Invalid request left charts behind'
  # A bad identifier in the second chart makes the first insert roll back.
  $bad = Call 'POST' '/datasets' @{ connectionId = $conn.id; name = 'Rollback fixture'; kind = 'VIRTUAL'; sql = 'SELECT order_date, amount, region AS "bad region", category FROM (' + $sql + ') fixture' }
  $body.datasetId = $bad.id; $body.mapping.region = 'bad region'
  Rejected $body
  Assert (@(Call 'GET' '/charts' $null).Count -eq $before) 'Failed creation did not roll back charts'
  $empty = Call 'POST' '/datasets' @{ connectionId = $conn.id; name = 'Empty fixture'; kind = 'VIRTUAL'; sql = 'SELECT * FROM (' + $sql + ') fixture WHERE false' }
  $body.datasetId = $empty.id; $body.mapping.region = 'region'
  $createdEmpty = Call 'POST' '/dashboards/from-template' $body
  $dashboardIds += $createdEmpty.dashboardId
  $emptyDetail = Call 'GET' "/dashboards/$($createdEmpty.dashboardId)" $null
  Assert ($emptyDetail.charts.Count -eq 3 -and $emptyDetail.charts[0].rows.Count -eq 0) 'Empty dataset handling differs'
  $productSql = "SELECT * FROM (VALUES ('Laptop',100::numeric,2,'A'),('Laptop',200::numeric,3,'A'),('Mouse',50::numeric,4,'B'),('Mouse',NULL::numeric,NULL::integer,'B')) AS t(product,amount,quantity,category)"
  $productDataset = Call 'POST' '/datasets' @{ connectionId = $conn.id; name = 'Product fixture'; kind = 'VIRTUAL'; sql = $productSql }
  $body = @{ datasetId = $productDataset.id; templateId = 'product-analysis'; name = 'Product smoke'; mapping = @{ product = 'product'; revenue = 'amount'; quantity = 'quantity'; category = 'category' } }
  $productDashboard = Call 'POST' '/dashboards/from-template' $body
  $dashboardIds += $productDashboard.dashboardId
  foreach ($attempt in 1..2) {
    $productDetail = Call 'GET' "/dashboards/$($productDashboard.dashboardId)" $null
    Assert ($productDetail.charts.Count -eq 3) 'Expected three product charts'
    Assert ($productDetail.charts[0].chartType -eq 'bar' -and $productDetail.charts[1].chartType -eq 'bar' -and $productDetail.charts[2].chartType -eq 'pie') 'Product chart types differ'
    Assert (($productDetail.charts[0].rows | Where-Object label -eq 'Laptop').value -eq 300) 'Product revenue differs'
    Assert (($productDetail.charts[1].rows | Where-Object label -eq 'Laptop').value -eq 5) 'Product quantity should use quantity metric'
    Assert (($productDetail.charts[1].rows | Where-Object label -eq 'Mouse').value -eq 4) 'NULL quantity handling differs'
    Assert (($productDetail.charts[2].rows | Where-Object label -eq 'A').value -eq 300) 'Product category revenue differs'
  }
  $before = @(Call 'GET' '/charts' $null).Count
  $body.mapping.Remove('quantity'); Rejected $body
  $body.mapping.quantity = 'product'; Rejected $body
  $body.mapping.quantity = 'missing'; Rejected $body
  $body.mapping.quantity = 'quantity'
  Assert (@(Call 'GET' '/charts' $null).Count -eq $before) 'Invalid product mapping left charts behind'
  # Different column names exercise mapping reuse. NULL revenue must still count as an order.
  $statusSql = "SELECT * FROM (VALUES (DATE '2025-01-01',100::numeric,'Done'),(DATE '2025-01-15',NULL::numeric,'Pending'),(DATE '2025-02-01',200::numeric,'Done'),(NULL::date,50::numeric,'Pending'),(DATE '2025-02-02',30::numeric,NULL::text)) AS t(placed_on,total_value,order_state)"
  $statusDataset = Call 'POST' '/datasets' @{ connectionId = $conn.id; name = 'Status fixture'; kind = 'VIRTUAL'; sql = $statusSql }
  $body = @{ datasetId = $statusDataset.id; templateId = 'order-status'; name = 'Status smoke'; mapping = @{ date = 'placed_on'; revenue = 'total_value'; status = 'order_state' } }
  $statusDashboard = Call 'POST' '/dashboards/from-template' $body
  $dashboardIds += $statusDashboard.dashboardId
  foreach ($attempt in 1..2) {
    $statusDetail = Call 'GET' "/dashboards/$($statusDashboard.dashboardId)" $null
    Assert ($statusDetail.charts.Count -eq 3) 'Expected three status charts'
    Assert ($statusDetail.charts[0].chartType -eq 'pie' -and $statusDetail.charts[1].chartType -eq 'bar' -and $statusDetail.charts[2].chartType -eq 'line') 'Status chart types differ'
    Assert ($statusDetail.charts[0].aggregate -eq 'count' -and $statusDetail.charts[0].metric -eq '*') 'Status count must count rows'
    Assert (($statusDetail.charts[0].rows | Where-Object label -eq 'Pending').value -eq 2) 'Order count must include NULL revenue/date'
    Assert (($statusDetail.charts[0].rows | Measure-Object value -Sum).Sum -eq 5) 'NULL status should remain a group'
    Assert (($statusDetail.charts[1].rows | Where-Object label -eq 'Done').value -eq 300) 'Status revenue differs'
    Assert (($statusDetail.charts[2].rows | Where-Object label -eq '2025-01').value -eq 2) 'Monthly count should include NULL revenue'
    Assert (($statusDetail.charts[2].rows | Measure-Object value -Sum).Sum -eq 4) 'Monthly count must exclude NULL date'
  }
  $before = @(Call 'GET' '/charts' $null).Count
  $body.mapping.Remove('status'); Rejected $body
  $body.mapping.status = 'total_value'; Rejected $body
  $body.mapping.status = 'order_state'
  Assert (@(Call 'GET' '/charts' $null).Count -eq $before) 'Invalid status mapping left charts behind'
  $viewer = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body '{"username":"viewer","password":"Demo2026!"}'
  $adminHeaders = $headers
  $headers = @{ Authorization = "Bearer $($viewer.token)" }
  try { Rejected $body 403 } finally { try { Call 'POST' '/auth/logout' $null | Out-Null } finally { $headers = $adminHeaders } }
  Write-Host 'Template smoke PASS: sales/product/status, CSV, monthly filters, UTC analysis consistency, SUM/COUNT, NULL, reload, validation, rollback, empty data, Viewer.'
} finally {
  try { foreach ($id in $dashboardIds) { Call 'DELETE' "/dashboards/$id" $null | Out-Null } }
  finally {
    try { if ($import) { Call 'DELETE' "/imports/$($import.id)" $null | Out-Null } }
    finally {
      try { if ($conn) { Call 'DELETE' "/connections/$($conn.id)" $null | Out-Null } }
      finally {
        if ($responseFile) { Remove-Item -LiteralPath $responseFile -ErrorAction SilentlyContinue }
        Call 'POST' '/auth/logout' $null | Out-Null
      }
    }
  }
}
