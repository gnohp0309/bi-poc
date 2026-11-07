param([string]$BaseUrl='http://127.0.0.1:8081/api')
$ErrorActionPreference='Stop';$base=$BaseUrl.TrimEnd('/')
function Assert($condition,$message){if(-not $condition){throw $message}}
function Login($name){Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body (@{username=$name;password='Demo2026!'}|ConvertTo-Json -Compress)}
$admin=Login 'admin';$headers=@{Authorization="Bearer $($admin.token)"}
function Call($method,$path,$body){$args=@{Method=$method;Uri="$base$path";Headers=$headers};if($null -ne $body){$args.ContentType='application/json; charset=utf-8';$args.Body=($body|ConvertTo-Json -Depth 25 -Compress)};Invoke-RestMethod @args}
function Reject($path,$body,$status=400){try{Call 'POST' $path $body|Out-Null}catch{if($null -ne $_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq $status){return};throw};throw "Expected rejection for $path"}
$conn=$null;$dash=$null
try{
  $conn=Call 'POST' '/connections' @{name='Dashboard interaction smoke';host='127.0.0.1';port=5433;database='bi_poc_source';username='bi_reader';password='Reader2026!'}
  $dataset=Call 'POST' '/datasets' @{connectionId=$conn.id;name='Interaction fixture';kind='VIRTUAL';sql="SELECT *,event_date::timestamp event_ts FROM (VALUES ('North','A',10::numeric,2::numeric,DATE '2025-01-01'),('North','B',20::numeric,3::numeric,DATE '2025-01-31'),('South','A',30::numeric,4::numeric,DATE '2025-02-01'),(NULL,'A',40::numeric,5::numeric,DATE '2025-02-15')) t(region,category,amount,quantity,event_date)"}
  $other=Call 'POST' '/datasets' @{connectionId=$conn.id;name='Other source';kind='VIRTUAL';sql="SELECT 'X'::text region,99::numeric amount,extract(epoch FROM clock_timestamp()) tick"}
  $dash=Call 'POST' '/dashboards' @{name='Interaction smoke'}
  $specs=@(
    @{chartType='bar';dimension='region';metric='amount';aggregate='sum'},
    @{chartType='line';dimension='event_date';metric='amount';aggregate='sum';timeGrain='month'},
    @{chartType='kpi';metric='amount';aggregate='sum'},
    @{chartType='histogram';metric='amount';aggregate='count';binCount=2},
    @{chartType='scatter';dimension='amount';metric='quantity';aggregate='count'},
    @{chartType='heatmap';numericColumns=@('amount','quantity');aggregate='count'},
    @{chartType='stacked-bar';dimension='category';seriesDimension='region';metric='amount';aggregate='sum'},
    @{chartType='map';latitude='quantity';longitude='amount';metric='amount';aggregate='sum'},
    @{chartType='line';dimension='event_ts';metric='amount';aggregate='sum'}
  )
  $ids=@();foreach($spec in $specs){$spec.datasetId=$dataset.id;$spec.name=$spec.chartType;$ids+=(Call 'POST' '/charts' $spec).id}
  $ids+=(Call 'POST' '/charts' @{datasetId=$other.id;name='Other KPI';chartType='kpi';metric='amount';aggregate='sum'}).id
  $ids+=(Call 'POST' '/charts' @{datasetId=$other.id;name='Live clock';chartType='kpi';metric='tick';aggregate='sum'}).id
  Call 'PUT' "/dashboards/$($dash.id)/layout" @{chartIds=$ids}|Out-Null
  $root="/dashboards/$($dash.id)"
  $meta=Call 'GET' "$root/filters" $null;Assert ($meta.datasets.Count -eq 2) 'Dataset scopes missing'
  $full=Call 'POST' "$root/query" @{filters=@()};Assert ($full.charts[2].rows[0].value -eq 100) 'Unfiltered KPI wrong'
  foreach($c in $full.charts){
    if($c.chartType -eq 'kpi'){$drill=Call 'POST' "$root/charts/$($c.id)/drill" @{filters=@()}}
    else{$drill=Call 'POST' "$root/charts/$($c.id)/drill" @{filters=@();rowIndex=0;rowKey=$c.rowKeys[0]}}
    Assert ($drill.rows.Count -gt 0) "Empty drill for $($c.chartType)"
  }
  $region=@{datasetId=$dataset.id;column='region';op='eq';value='North'}
  $date=@{datasetId=$dataset.id;column='event_date';op='date';value='2025-01-01';end='2025-01-31'}
  $filtered=Call 'POST' "$root/query" @{filters=@($region,$date)}
  Assert ($filtered.charts[2].rows[0].value -eq 30) 'Filter should apply to KPI before aggregation'
  Assert ($filtered.charts[-2].rows[0].value -eq 99) 'Filter crossed dataset boundary'
  Assert ($filtered.charts[1].rows.Count -eq 1 -and $filtered.charts[1].rows[0].value -eq 30) 'Month/date filter wrong'
  $detail=Call 'POST' "$root/charts/$($ids[0])/drill" @{filters=@($region,$date);rowIndex=0;rowKey=$filtered.charts[0].rowKeys[0]}
  Assert ($detail.rows.Count -eq 2 -and ($detail.rows|Measure-Object amount -Sum).Sum -eq 30) 'Drill does not reconcile bar total'
  $hist=$full.charts[3];$histCount=0
  for($i=0;$i -lt $hist.rows.Count;$i++){$r=Call 'POST' "$root/charts/$($hist.id)/drill" @{filters=@();rowIndex=$i;rowKey=$hist.rowKeys[$i]};Assert ($r.rows.Count -eq $hist.rows[$i].value) 'Histogram bounds mismatch';$histCount+=$r.rows.Count}
  Assert ($histCount -eq 4) 'Histogram duplicated or omitted a bound'
  $nullResult=Call 'POST' "$root/query" @{filters=@(@{datasetId=$dataset.id;column='region';op='null'})};Assert ($nullResult.charts[2].rows[0].value -eq 40) 'NULL filter wrong'
  $injection=Call 'POST' "$root/query" @{filters=@(@{datasetId=$dataset.id;column='region';op='eq';value="North' OR '1'='1"})};Assert ($injection.charts[0].rows.Count -eq 0) 'Filter injection changed query'
  Reject "$root/query" @{filters=@(@{datasetId=$dataset.id;column='missing';op='eq';value='a'})}
  Reject "$root/query" @{filters=@(@{datasetId=$dataset.id;column='region';op='date';value='2025-01-01';end='2025-01-31'})}
  Reject "$root/query" @{filters=@(@{datasetId=$dataset.id;column='event_date';op='date';value='2025-02-01';end='2025-01-01'})}
  Reject "$root/query" @{filters=@(@{datasetId=([guid]::NewGuid().ToString());column='region';op='eq';value='x'})}
  Reject "$root/charts/$($ids[0])/drill" @{filters=@();rowIndex=0;rowKey='stale-key'}
  Reject "$root/charts/$([guid]::NewGuid())/drill" @{filters=@();rowIndex=0} 404
  $again=Call 'POST' "$root/query" @{filters=@($region,$date)};Assert ($again.charts[2].rows[0].value -eq 30 -and $again.refreshedAt) 'Refresh lost applied filters'
  Assert ($again.charts[-1].rows[0].value -gt $full.charts[-1].rows[0].value) 'Refresh reused cached data instead of querying current source'
  Assert ($again.charts[0].x -eq $full.charts[0].x -and $again.charts[0].w -eq $full.charts[0].w) 'Query changed layout'
  $viewer=Login 'viewer';$oldHeaders=$headers;$headers=@{Authorization="Bearer $($viewer.token)"}
  try{$r=Call 'POST' "$root/query" @{filters=@($region)};Assert ($r.charts[2].rows[0].value -eq 30) 'Viewer cannot filter';Call 'POST' '/auth/logout' $null|Out-Null}finally{$headers=$oldHeaders}
  Write-Host 'DASHBOARD INTERACTION PASS: scoped AND filters, inclusive dates, NULL, injection, all chart drill paths, histogram edges, reconciliation, stale selection, refresh/layout, Viewer.'
}finally{
  if($dash){Call 'DELETE' "/dashboards/$($dash.id)" $null|Out-Null}
  if($conn){Call 'DELETE' "/connections/$($conn.id)" $null|Out-Null}
  Call 'POST' '/auth/logout' $null|Out-Null
}

