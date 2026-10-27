$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8081/api'
$login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body '{"username":"admin","password":"Demo2026!"}'
$headers = @{ Authorization = "Bearer $($login.token)" }
$suffix = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
function Call($method, $path, $body) {
  $args = @{ Method = $method; Uri = "$base$path"; Headers = $headers }
  if ($null -ne $body) { $args.ContentType = 'application/json'; $args.Body = ($body | ConvertTo-Json -Depth 20 -Compress) }
  return Invoke-RestMethod @args
}
$health = Invoke-RestMethod "$base/health"
if ($health.status -ne 'ok') { throw 'Health check failed' }
$conn = Call 'POST' '/connections' @{ name = "Smoke $suffix"; host = '127.0.0.1'; port = 5433; database = 'bi_poc_source'; username = 'bi_reader'; password = 'Reader2026!' }
$tables = Call 'GET' "/connections/$($conn.id)/tables" $null
if (-not ($tables | Where-Object { $_.table -eq 'orders' })) { throw 'Orders table missing' }
$query = Call 'POST' '/sql/execute' @{ connectionId = $conn.id; sql = 'SELECT region, sum(amount) AS total FROM public.orders GROUP BY region' }
if ($query.rows.Count -ne 3) { throw 'SQL result incorrect' }
try { Call 'POST' '/sql/execute' @{ connectionId = $conn.id; sql = 'DELETE FROM public.orders' } | Out-Null; throw 'Unsafe SQL was accepted' }
catch { if ($_.Exception.Response.StatusCode.value__ -ne 400) { throw } }
$dataset = Call 'POST' '/datasets' @{ connectionId = $conn.id; name = "Sales $suffix"; kind = 'PHYSICAL'; sourceName = 'public.orders' }
$preview = Call 'GET' "/datasets/$($dataset.id)/preview" $null
if ($preview.rows.Count -ne 20) { throw 'Dataset preview incorrect' }
$virtual = Call 'POST' '/datasets' @{ connectionId = $conn.id; name = "Virtual $suffix"; kind = 'VIRTUAL'; sql = 'SELECT region, amount FROM public.orders' }
$virtualPreview = Call 'GET' "/datasets/$($virtual.id)/preview" $null
if ($virtualPreview.rows.Count -ne 20) { throw 'Virtual dataset preview incorrect' }
$spec = @{ datasetId = $dataset.id; name = "Revenue $suffix"; chartType = 'bar'; dimension = 'region'; metric = 'amount'; aggregate = 'sum' }
$chartPreview = Call 'POST' '/charts/preview' $spec
if ($chartPreview.rows.Count -ne 3) { throw 'Chart preview incorrect' }
$chart = Call 'POST' '/charts' $spec
$dashboard = Call 'POST' '/dashboards' @{ name = "Demo $suffix" }
Call 'PUT' "/dashboards/$($dashboard.id)/layout" @{ chartIds = @($chart.id) } | Out-Null
$detail = Call 'GET' "/dashboards/$($dashboard.id)" $null
if ($detail.charts.Count -ne 1) { throw 'Dashboard layout incorrect' }
$filtered = Call 'GET' "/dashboards/$($dashboard.id)?filter=Mi%E1%BB%81n%20B%E1%BA%AFc&filterDimension=region" $null
if ($filtered.charts[0].rows.Count -ne 1) { throw 'Dashboard filter incorrect' }
$unrelated = Call 'GET' "/dashboards/$($dashboard.id)?filter=Mi%E1%BB%81n%20B%E1%BA%AFc&filterDimension=category" $null
if ($unrelated.charts[0].rows.Count -ne 3) { throw 'Unrelated chart should not be filtered' }
$share = Call 'POST' "/dashboards/$($dashboard.id)/share" @{}
$public = Invoke-RestMethod "$base/share/$($share.token)"
if ($public.charts.Count -ne 1) { throw 'Public share incorrect' }
$users = Call 'GET' '/users' $null
$audit = Call 'GET' '/audit' $null
if ($users.Count -lt 1 -or $audit.Count -lt 1) { throw 'Security module incorrect' }
$viewerLogin = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body '{"username":"viewer","password":"Demo2026!"}'
$viewerHeaders = @{ Authorization = "Bearer $($viewerLogin.token)" }
$viewerDashboards = Invoke-RestMethod -Uri "$base/dashboards" -Headers $viewerHeaders
if ($viewerDashboards.Count -lt 1) { throw 'Viewer could not read dashboards' }
try { Invoke-RestMethod -Method Post -Uri "$base/sql/execute" -Headers $viewerHeaders -ContentType 'application/json' -Body (@{ connectionId = $conn.id; sql = 'SELECT 1' } | ConvertTo-Json) | Out-Null; throw 'Viewer could execute SQL' }
catch { if ($_.Exception.Response.StatusCode.value__ -ne 403) { throw } }
Call 'DELETE' "/dashboards/$($dashboard.id)" $null | Out-Null
Call 'DELETE' "/connections/$($conn.id)" $null | Out-Null
Write-Host 'SMOKE PASS: connection, SQL, physical+virtual dataset, chart, dashboard filter/share, viewer role, audit. Temporary data removed.'
