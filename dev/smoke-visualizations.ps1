param([string]$BaseUrl = 'http://127.0.0.1:8081/api', [int]$SourcePort=5433)
$ErrorActionPreference='Stop'; $base=$BaseUrl.TrimEnd('/')
function Assert($condition,$message){if(-not $condition){throw $message}}
function Login($user){Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body (@{username=$user;password='Demo2026!'}|ConvertTo-Json -Compress)}
$admin=Login 'admin';$headers=@{Authorization="Bearer $($admin.token)"}
function Call($method,$path,$body){
  $args=@{Method=$method;Uri="$base$path";Headers=$headers}
  if($null -ne $body){$args.ContentType='application/json; charset=utf-8';$args.Body=($body|ConvertTo-Json -Depth 20 -Compress)}
  Invoke-RestMethod @args
}
function Reject($spec,$status=400){
  try{Call 'POST' '/charts' $spec|Out-Null}catch{if($null -ne $_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq $status){return};throw}
  throw 'Expected chart rejection'
}
$conn=$null;$dashboard=$null;$ids=@()
try{
  $conn=Call 'POST' '/connections' @{name='Visualization smoke';host='127.0.0.1';port=$SourcePort;database='bi_poc_source';username='bi_reader';password='Reader2026!'}
  $sql="SELECT *,5::numeric AS constant FROM (VALUES (1::numeric,2::numeric,10::numeric,'A',DATE '2025-01-01',10::numeric,106::numeric),(2,4,20,'B',DATE '2025-01-02',11,107),(3,6,30,'A',DATE '2025-02-01',NULL,108),(4,8,NULL,'B',DATE '2025-02-02',999,109),(NULL,10,40,'A',NULL,12,108)) t(x,y,amount,region,event_date,lat,lon)"
  $dataset=Call 'POST' '/datasets' @{connectionId=$conn.id;name='Visualization fixture';kind='VIRTUAL';sql=$sql}
  $specs=@(
    @{chartType='kpi';metric='amount';aggregate='sum'},
    @{chartType='histogram';metric='x';aggregate='count';binCount=2},
    @{chartType='scatter';dimension='x';metric='y';aggregate='sum'},
    @{chartType='heatmap';numericColumns=@('x','y','constant');aggregate='count'},
    @{chartType='map';latitude='lat';longitude='lon';labelColumn='region';metric='amount';aggregate='sum'},
    @{chartType='stacked-bar';dimension='event_date';seriesDimension='region';timeGrain='month';metric='amount';aggregate='sum'},
    @{chartType='stacked-area';dimension='event_date';seriesDimension='region';timeGrain='month';metric='amount';aggregate='sum'},
    @{chartType='donut';dimension='region';metric='amount';aggregate='sum'}
  )
  $results=@{}
  foreach($spec in $specs){
    $spec.datasetId=$dataset.id;$spec.name="Visualization $($spec.chartType)"
    $preview=Call 'POST' '/charts/preview' $spec
    $created=Call 'POST' '/charts' $spec;$ids+=$created.id
    $saved=Call 'GET' "/charts/$($created.id)/data" $null
    Assert ($saved.chartType -eq $spec.chartType -and $saved.rows.Count -eq $preview.rows.Count) "Persisted $($spec.chartType) differs"
    $results[$spec.chartType]=$saved
  }
  Assert ($results.kpi.rows[0].value -eq 100) 'KPI sum differs'
  Assert ($results.histogram.rows.Count -eq 2 -and $results.histogram.rows[0].value -eq 2 -and $results.histogram.rows[1].value -eq 2) 'Histogram counts/boundary differs'
  Assert ($results.scatter.rows.Count -eq 4 -and $results.scatter.rows[0].x -eq 1 -and $results.scatter.rows[0].y -eq 2) 'Scatter paired rows differ'
  $xy=$results.heatmap.rows | Where-Object {$_.x -eq 'x' -and $_.y -eq 'y'}
  Assert ([math]::Abs($xy.value-1) -lt 0.000001 -and $xy.pairedCount -eq 4) 'Pearson correlation differs'
  $cx=$results.heatmap.rows | Where-Object {$_.x -eq 'constant' -and $_.y -eq 'x'}
  Assert ($null -eq $cx.value) 'Constant correlation must remain NULL'
  Assert ($results.map.rows.Count -eq 3 -and ($results.map.rows|Measure-Object value -Sum).Sum -eq 70) 'Map coordinate validation differs'
  Assert (($results['stacked-bar'].rows|Measure-Object value -Sum).Sum -eq 60 -and $results['stacked-area'].seriesDimension -eq 'region') 'Stacked aggregation/config differs'
  $constant=@{datasetId=$dataset.id;chartType='histogram';metric='constant';aggregate='count';binCount=10}
  $constantResult=Call 'POST' '/charts/preview' $constant
  Assert ($constantResult.rows.Count -eq 1 -and $constantResult.rows[0].value -eq 5) 'Constant histogram should have one interval'
  $empty=Call 'POST' '/datasets' @{connectionId=$conn.id;name='Empty chart fixture';kind='VIRTUAL';sql="SELECT * FROM ($sql) fixture WHERE false"}
  $emptyKpi=Call 'POST' '/charts/preview' @{datasetId=$empty.id;chartType='kpi';metric='amount';aggregate='sum'}
  Assert ($null -eq $emptyKpi.rows[0].value) 'Empty SUM must not become zero'
  $emptyCount=Call 'POST' '/charts/preview' @{datasetId=$empty.id;chartType='kpi';metric='*';aggregate='count'}
  Assert ($emptyCount.rows[0].value -eq 0) 'Empty COUNT should be zero'
  foreach($spec in $specs){$copy=$spec.Clone();$copy.datasetId=$empty.id;$value=Call 'POST' '/charts/preview' $copy;Assert ($value.rows.Count -le 9) 'Empty chart response differs'}
  $large=Call 'POST' '/datasets' @{connectionId=$conn.id;name='Large scatter fixture';kind='VIRTUAL';sql='SELECT generate_series(1,1001)::numeric AS n'}
  $largeScatter=Call 'POST' '/charts/preview' @{datasetId=$large.id;chartType='scatter';dimension='n';metric='n';aggregate='sum'}
  Assert ($largeScatter.truncated -and $largeScatter.rows.Count -eq 500) 'Scatter limits must be explicit'
  $largeHistogram=Call 'POST' '/charts/preview' @{datasetId=$large.id;chartType='histogram';metric='n';aggregate='count';binCount=10}
  Assert (($largeHistogram.rows|Measure-Object value -Sum).Sum -eq 1001) 'Histogram must aggregate the full source'
  $dashboard=Call 'POST' '/dashboards' @{name='Visualizations smoke'}
  Call 'PUT' "/dashboards/$($dashboard.id)/layout" @{chartIds=$ids}|Out-Null
  $detail=Call 'GET' "/dashboards/$($dashboard.id)" $null
  Assert ($detail.charts.Count -eq 8) 'Dashboard cannot load all new charts'
  $share=Call 'POST' "/dashboards/$($dashboard.id)/share" $null
  $public=Invoke-RestMethod -Uri "$base/share/$($share.token)"
  Assert ($public.charts.Count -eq 8) 'Shared chart rendering data differs'
  $filtered=Call 'GET' "/charts/$($ids[5])/data?filter=2025-01" $null
  Assert (($filtered.rows|Measure-Object value -Sum).Sum -eq 30) 'Stacked monthly filter differs'
  Reject @{datasetId=$dataset.id;name='Bad';chartType='histogram';metric='region';aggregate='count'}
  Reject @{datasetId=$dataset.id;name='Bad';chartType='histogram';metric='x';aggregate='count';binCount=2.5}
  Reject @{datasetId=$dataset.id;name='Bad';chartType='heatmap';numericColumns=@('x','missing');aggregate='count'}
  Reject @{datasetId=$dataset.id;name='Bad';chartType='map';latitude='region';longitude='lon';metric='amount';aggregate='sum'}
  $viewer=Login 'viewer';$adminHeaders=$headers;$headers=@{Authorization="Bearer $($viewer.token)"}
  try{Reject $specs[0] 403}finally{Call 'POST' '/auth/logout' $null|Out-Null;$headers=$adminHeaders}
  Write-Host 'VISUALIZATIONS PASS: eight new types, persistence, full-source histogram, correlation pairs, NULL/empty, map bounds, truncation, dashboard/share, filters, validation, Viewer.'
}finally{
  if($dashboard){Call 'DELETE' "/dashboards/$($dashboard.id)" $null|Out-Null}
  if($conn){Call 'DELETE' "/connections/$($conn.id)" $null|Out-Null}
  Call 'POST' '/auth/logout' $null|Out-Null
}
