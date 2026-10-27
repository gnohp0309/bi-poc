param([switch]$WithSampleData)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$bin = 'C:\Program Files\PostgreSQL\18\bin'
$data = Join-Path $root '.local\pgdata'
$log = Join-Path $root '.local\postgres.log'
$passFile = Join-Path $root '.local\pg-password.txt'
$env:PGCLIENTENCODING = 'UTF8'
if (-not (Test-Path (Join-Path $bin 'initdb.exe'))) { throw 'PostgreSQL 18 was not found at C:\Program Files\PostgreSQL\18\bin' }
New-Item -ItemType Directory -Path (Join-Path $root '.local') -Force | Out-Null
if (-not (Test-Path (Join-Path $data 'PG_VERSION'))) {
  [System.IO.File]::WriteAllText($passFile, "Demo2026!`n", [System.Text.Encoding]::ASCII)
  try {
    & (Join-Path $bin 'initdb.exe') -D $data -U postgres --encoding=UTF8 --auth-host=scram-sha-256 --auth-local=scram-sha-256 --pwfile=$passFile
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL cluster initialization failed' }
  } finally { Remove-Item -LiteralPath $passFile -ErrorAction SilentlyContinue }
}
& (Join-Path $bin 'pg_ctl.exe') -D $data status *> $null
if ($LASTEXITCODE -ne 0) {
  & (Join-Path $bin 'pg_ctl.exe') -D $data -o '-h 127.0.0.1 -p 5433' -l $log start
  if ($LASTEXITCODE -ne 0) { throw 'Local PostgreSQL failed to start' }
}
$env:PGPASSWORD = 'Demo2026!'
try {
  $roleExists = & (Join-Path $bin 'psql.exe') -h 127.0.0.1 -p 5433 -U postgres -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='bi_reader'"
  if (-not $roleExists) { & (Join-Path $bin 'psql.exe') -h 127.0.0.1 -p 5433 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE bi_reader LOGIN PASSWORD 'Reader2026!'" }
  $appExists = & (Join-Path $bin 'psql.exe') -h 127.0.0.1 -p 5433 -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='bi_poc_app'"
  if (-not $appExists) { & (Join-Path $bin 'createdb.exe') -h 127.0.0.1 -p 5433 -U postgres bi_poc_app }
  $sourceExists = & (Join-Path $bin 'psql.exe') -h 127.0.0.1 -p 5433 -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='bi_poc_source'"
  if (-not $sourceExists) { & (Join-Path $bin 'createdb.exe') -h 127.0.0.1 -p 5433 -U postgres bi_poc_source }
  & (Join-Path $bin 'psql.exe') -h 127.0.0.1 -p 5433 -U postgres -d bi_poc_app -v ON_ERROR_STOP=1 -c 'CREATE SCHEMA IF NOT EXISTS uploads; GRANT USAGE ON SCHEMA uploads TO bi_reader; GRANT CONNECT ON DATABASE bi_poc_app TO bi_reader;'
  if ($LASTEXITCODE -ne 0) { throw 'Configuring upload database failed' }
  if ($WithSampleData) {
    & (Join-Path $bin 'psql.exe') -h 127.0.0.1 -p 5433 -U postgres -d bi_poc_source -v ON_ERROR_STOP=1 -f (Join-Path $PSScriptRoot 'source.sql')
    if ($LASTEXITCODE -ne 0) { throw 'Loading sample data failed' }
  }
} finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
Write-Host 'POC PostgreSQL is ready at 127.0.0.1:5433.'
