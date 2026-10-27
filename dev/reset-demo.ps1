$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'postgres-bin.ps1')
$bin = Resolve-PostgresBin -Root $root
$backupDir = Join-Path $root '.local\backups'
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

& (Join-Path $PSScriptRoot 'setup-postgres.ps1')
$env:PGPASSWORD = 'Demo2026!'
try {
  $psql = Join-Path $bin 'psql.exe'
  $identity = & $psql -h 127.0.0.1 -p 5433 -U postgres -d bi_poc_app -tAc 'SELECT current_database() || ''|'' || inet_server_port()'
  if ($LASTEXITCODE -ne 0 -or $identity.Trim() -ne 'bi_poc_app|5433') { throw 'Unexpected PostgreSQL target; reset cancelled' }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $appBackup = Join-Path $backupDir "before-reset-app-$stamp.dump"
  $sourceBackup = Join-Path $backupDir "before-reset-source-$stamp.dump"
  & (Join-Path $bin 'pg_dump.exe') -h 127.0.0.1 -p 5433 -U postgres -Fc -f $appBackup bi_poc_app
  if ($LASTEXITCODE -ne 0) { throw 'App database backup failed; reset cancelled' }
  & (Join-Path $bin 'pg_dump.exe') -h 127.0.0.1 -p 5433 -U postgres -Fc -f $sourceBackup bi_poc_source
  if ($LASTEXITCODE -ne 0) { throw 'Source database backup failed; reset cancelled' }
  & (Join-Path $bin 'pg_restore.exe') -l $appBackup *> $null
  if ($LASTEXITCODE -ne 0) { throw 'App backup validation failed; reset cancelled' }
  & (Join-Path $bin 'pg_restore.exe') -l $sourceBackup *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Source backup validation failed; reset cancelled' }
  Write-Host "Backups saved in $backupDir"
} finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }

& (Join-Path $PSScriptRoot 'stop-demo.ps1')
$env:PGPASSWORD = 'Demo2026!'
try {
  $psql = Join-Path $bin 'psql.exe'
  $appSql = @'
BEGIN;
TRUNCATE TABLE file_imports, dashboard_charts, charts, saved_queries, datasets, dashboards,
  db_connections, group_members, app_groups, audit_logs, auth_sessions RESTART IDENTITY CASCADE;
DROP SCHEMA IF EXISTS uploads CASCADE;
CREATE SCHEMA uploads;
GRANT USAGE ON SCHEMA uploads TO bi_reader;
COMMIT;
'@
  & $psql -h 127.0.0.1 -p 5433 -U postgres -d bi_poc_app -v ON_ERROR_STOP=1 -c $appSql
  if ($LASTEXITCODE -ne 0) { throw 'Resetting app data failed; backups are intact' }
  & $psql -h 127.0.0.1 -p 5433 -U postgres -d bi_poc_source -v ON_ERROR_STOP=1 -c 'DROP TABLE IF EXISTS public.orders, public.products;'
  if ($LASTEXITCODE -ne 0) { throw 'Resetting sample source data failed; backups are intact' }
} finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }

& (Join-Path $PSScriptRoot 'start-demo.ps1')
Write-Host 'Clean POC is ready: no imports, connections, datasets, charts or dashboards.'
