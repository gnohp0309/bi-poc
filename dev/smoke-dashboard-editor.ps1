param([string]$BaseUrl='http://127.0.0.1:8081/api', [int]$SourcePort=5433)
$ErrorActionPreference='Stop';$base=$BaseUrl.TrimEnd('/')
function Assert($condition,$message){if(-not $condition){throw $message}}
function Login($name){Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body (@{username=$name;password='Demo2026!'}|ConvertTo-Json -Compress)}
$admin=Login 'admin';$headers=@{Authorization="Bearer $($admin.token)"}
function Call($method,$path,$body){$args=@{Method=$method;Uri="$base$path";Headers=$headers};if($null -ne $body){$args.ContentType='application/json; charset=utf-8';$args.Body=($body|ConvertTo-Json -Depth 20 -Compress)};Invoke-RestMethod @args}
function Reject($method,$path,$body,$status=400){try{Call $method $path $body|Out-Null}catch{if($null -ne $_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq $status){return};throw};throw "Expected rejection for $path"}
$conn=$null;$dashboards=@()
try{
  $conn=Call 'POST' '/connections' @{name='Dashboard editor smoke';host='127.0.0.1';port=$SourcePort;database='bi_poc_source';username='bi_reader';password='Reader2026!'}
  $dataset=Call 'POST' '/datasets' @{connectionId=$conn.id;name='Editor fixture';kind='VIRTUAL';sql="SELECT * FROM (VALUES ('A',10::numeric,2,DATE '2025-01-01'),('B',20::numeric,3,DATE '2025-02-01')) t(region,amount,quantity,event_date)"}
  $first=Call 'POST' '/charts' @{datasetId=$dataset.id;name='Original shared';chartType='bar';dimension='region';metric='amount';aggregate='sum'}
  $second=Call 'POST' '/charts' @{datasetId=$dataset.id;name='Second';chartType='line';dimension='event_date';metric='amount';aggregate='sum';timeGrain='month'}
  $a=Call 'POST' '/dashboards' @{name='Editor A'};$dashboards+=$a.id
  $b=Call 'POST' '/dashboards' @{name='Editor B'};$dashboards+=$b.id
  Call 'PUT' "/dashboards/$($a.id)/layout" @{chartIds=@($first.id,$second.id)}|Out-Null
  Call 'PUT' "/dashboards/$($b.id)/layout" @{chartIds=@($first.id)}|Out-Null
  $legacy=Call 'GET' "/dashboards/$($a.id)" $null
  Assert ($legacy.charts[0].x -eq 0 -and $legacy.charts[1].x -eq 6 -and $legacy.charts[0].h -eq 9) 'Legacy default grid differs'
  Call 'PUT' "/dashboards/$($a.id)" @{name=' Updated dashboard '}|Out-Null
  Assert ((Call 'GET' "/dashboards/$($a.id)" $null).name -eq 'Updated dashboard') 'Rename differs'
  Reject 'PUT' "/dashboards/$($a.id)" @{name=' '}
  Reject 'PUT' "/dashboards/$($a.id)" @{name=('x'*201)}
  $items=@(@{chartId=$first.id;x=0;y=0;w=12;h=10},@{chartId=$second.id;x=0;y=10;w=6;h=8})
  Call 'PUT' "/dashboards/$($a.id)/layout" @{items=$items}|Out-Null
  foreach($attempt in 1..2){$detail=Call 'GET' "/dashboards/$($a.id)" $null;Assert ($detail.charts[0].w -eq 12 -and $detail.charts[0].h -eq 10 -and $detail.charts[1].y -eq 10) 'Saved geometry differs'}
  Reject 'PUT' "/dashboards/$($a.id)/layout" @{items=@(@{chartId=$first.id;x=0;y=0;w=12;h=10},@{chartId=$second.id;x=6;y=0;w=6;h=8})}
  Reject 'PUT' "/dashboards/$($a.id)/layout" @{items=@(@{chartId=$first.id;x=0.5;y=0;w=6;h=9})}
  Reject 'PUT' "/dashboards/$($a.id)/layout" @{items=@(@{chartId=$first.id;x=7;y=0;w=6;h=9})}
  Reject 'PUT' "/dashboards/$($a.id)/layout" @{items=@(@{chartId=([guid]::NewGuid().ToString());x=0;y=0;w=6;h=9})} 404
  Assert ((Call 'GET' "/dashboards/$($a.id)" $null).charts[0].w -eq 12) 'Rejected layout changed saved geometry'
  $edit=@{datasetId=$dataset.id;name='Edited only in A';chartType='pie';dimension='region';metric='amount';aggregate='sum'}
  $saved=Call 'PUT' "/dashboards/$($a.id)/charts/$($first.id)" $edit
  Assert ($saved.copied -and $saved.chartId -ne $first.id) 'Shared edit should create private chart'
  $edited=Call 'GET' "/dashboards/$($a.id)" $null;$other=Call 'GET' "/dashboards/$($b.id)" $null
  Assert ($edited.charts[0].name -eq 'Edited only in A' -and $edited.charts[0].chartType -eq 'pie' -and $edited.charts[0].w -eq 12) 'Chart edit lost title/type/layout'
  Assert ($other.charts[0].name -eq 'Original shared' -and $other.charts[0].chartType -eq 'bar') 'Other dashboard was changed'
  $bad=$edit.Clone();$bad.chartType='scatter'
  Reject 'PUT' "/dashboards/$($a.id)/charts/$($saved.chartId)" $bad
  Assert ((Call 'GET' "/charts/$($saved.chartId)" $null).chartType -eq 'pie') 'Invalid type change was saved'
  $edit=@{datasetId=$dataset.id;name='Histogram edited';chartType='histogram';metric='amount';aggregate='count';binCount=4}
  $same=Call 'PUT' "/dashboards/$($a.id)/charts/$($saved.chartId)" $edit
  Assert (-not $same.copied -and $same.chartId -eq $saved.chartId) 'Unshared edit should preserve ID'
  Assert ((Call 'GET' "/charts/$($saved.chartId)" $null).binCount -eq 4) 'Extended config lost on edit'
  $edit.datasetId=[guid]::NewGuid().ToString();Reject 'PUT' "/dashboards/$($a.id)/charts/$($saved.chartId)" $edit
  $share=Call 'POST' "/dashboards/$($a.id)/share" $null
  $public=Invoke-RestMethod -Uri "$base/share/$($share.token)"
  Assert ($public.charts[0].w -eq 12 -and $public.charts[0].chartType -eq 'histogram') 'Public layout/edit differs'
  Call 'PUT' "/dashboards/$($a.id)/layout" @{items=@(@{chartId=$saved.chartId;x=3;y=4;w=9;h=10})}|Out-Null
  Assert ((Call 'GET' "/dashboards/$($a.id)" $null).charts.Count -eq 1) 'Remove membership failed'
  Call 'PUT' "/dashboards/$($a.id)/layout" @{chartIds=@($second.id,$saved.chartId)}|Out-Null
  $ordered=Call 'GET' "/dashboards/$($a.id)" $null
  Assert ($ordered.charts[0].id -eq $second.id -and $ordered.charts[0].x -eq 0 -and $ordered.charts[1].x -eq 6) 'Legacy reorder semantics broke'
  $viewer=Login 'viewer';$adminHeaders=$headers;$headers=@{Authorization="Bearer $($viewer.token)"}
  try{
    Reject 'PUT' "/dashboards/$($a.id)" @{name='No'} 403
    Reject 'PUT' "/dashboards/$($a.id)/layout" @{items=@()} 403
    Reject 'PUT' "/dashboards/$($a.id)/charts/$($saved.chartId)" @{name='No'} 403
  }finally{Call 'POST' '/auth/logout' $null|Out-Null;$headers=$adminHeaders}
  Write-Host 'DASHBOARD EDITOR PASS: rename, grid persistence, invalid geometry rollback, shared-chart isolation, title/type/config edit, validation, public layout, add/remove, legacy order, Viewer.'
}finally{
  foreach($id in $dashboards){Call 'DELETE' "/dashboards/$id" $null|Out-Null}
  if($conn){Call 'DELETE' "/connections/$($conn.id)" $null|Out-Null}
  Call 'POST' '/auth/logout' $null|Out-Null
}
