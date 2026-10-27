$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8081/api'
$login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body '{"username":"admin","password":"Demo2026!"}'
$headers = @{ Authorization = "Bearer $($login.token)" }
$dashboards = Invoke-RestMethod -Uri "$base/dashboards" -Headers $headers
$connections = Invoke-RestMethod -Uri "$base/connections" -Headers $headers
$oldDashboards = @($dashboards | Where-Object { $_.name -match '^Demo \d{10}$' })
$oldConnections = @($connections | Where-Object { $_.name -match '^Smoke \d{10}$' })
Write-Host "Found $($oldDashboards.Count) generated smoke dashboards and $($oldConnections.Count) generated smoke connections."
foreach ($item in $oldDashboards) { Invoke-RestMethod -Method Delete -Uri "$base/dashboards/$($item.id)" -Headers $headers | Out-Null }
foreach ($item in $oldConnections) { Invoke-RestMethod -Method Delete -Uri "$base/connections/$($item.id)" -Headers $headers | Out-Null }
Write-Host 'Generated smoke records removed; audit history remains.'
