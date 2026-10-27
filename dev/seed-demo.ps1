$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'setup-postgres.ps1') -WithSampleData
$base = 'http://127.0.0.1:8081/api'
$login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body '{"username":"admin","password":"Demo2026!"}'
$headers = @{ Authorization = "Bearer $($login.token)" }
function Call($method, $path, $body) {
  $args = @{ Method = $method; Uri = "$base$path"; Headers = $headers }
  if ($null -ne $body) { $args.ContentType = 'application/json'; $args.Body = ($body | ConvertTo-Json -Depth 20 -Compress) }
  return Invoke-RestMethod @args
}
$users = Call 'GET' '/users' $null
if (-not ($users | Where-Object { $_.username -eq 'analyst' })) { Call 'POST' '/users' @{ username = 'analyst'; password = 'Demo2026!'; role = 'ANALYST' } | Out-Null }
if (-not ($users | Where-Object { $_.username -eq 'viewer' })) { Call 'POST' '/users' @{ username = 'viewer'; password = 'Demo2026!'; role = 'VIEWER' } | Out-Null }
$existing = Call 'GET' '/dashboards' $null | Where-Object { $_.name -eq 'Tổng quan bán hàng 2025' }
if ($existing) { Write-Host 'Demo dashboard already exists.'; exit 0 }
$connection = Call 'POST' '/connections' @{ name = 'PostgreSQL · Bán hàng mẫu'; host = '127.0.0.1'; port = 5433; database = 'bi_poc_source'; username = 'bi_reader'; password = 'Reader2026!' }
$orders = Call 'POST' '/datasets' @{ connectionId = $connection.id; name = 'Đơn hàng 2025'; kind = 'PHYSICAL'; sourceName = 'public.orders' }
Call 'PUT' "/datasets/$($orders.id)/aliases" @{ aliases = @{ region = 'Vùng'; category = 'Danh mục'; amount = 'Doanh thu'; order_date = 'Ngày đặt' } } | Out-Null
$months = Call 'POST' '/datasets' @{ connectionId = $connection.id; name = 'Doanh thu theo tháng'; kind = 'VIRTUAL'; sql = "SELECT to_char(order_date, 'YYYY-MM') AS month, amount FROM public.orders" }
$region = Call 'POST' '/charts' @{ datasetId = $orders.id; name = 'Doanh thu theo vùng'; chartType = 'bar'; dimension = 'region'; metric = 'amount'; aggregate = 'sum' }
$category = Call 'POST' '/charts' @{ datasetId = $orders.id; name = 'Tỷ trọng theo danh mục'; chartType = 'pie'; dimension = 'category'; metric = 'amount'; aggregate = 'sum' }
$month = Call 'POST' '/charts' @{ datasetId = $months.id; name = 'Xu hướng doanh thu tháng'; chartType = 'line'; dimension = 'month'; metric = 'amount'; aggregate = 'sum' }
Call 'POST' '/sql/saved' @{ connectionId = $connection.id; name = 'Doanh thu theo vùng'; sql = 'SELECT region, sum(amount) AS revenue FROM public.orders GROUP BY region ORDER BY revenue DESC' } | Out-Null
$dashboard = Call 'POST' '/dashboards' @{ name = 'Tổng quan bán hàng 2025' }
Call 'PUT' "/dashboards/$($dashboard.id)/layout" @{ chartIds = @($region.id, $category.id, $month.id) } | Out-Null
Write-Host "Demo dashboard is ready. ID: $($dashboard.id)"
