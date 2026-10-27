$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$data = Join-Path $root '.local\pgdata'
if (-not (Test-Path (Join-Path $data 'PG_VERSION'))) {
  Write-Host 'No POC PostgreSQL cluster was found.'
  exit 0
}
. (Join-Path $PSScriptRoot 'postgres-bin.ps1')
$bin = Resolve-PostgresBin -Root $root
& (Join-Path $bin 'pg_ctl.exe') -D $data status *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'POC PostgreSQL is already stopped.'
  exit 0
}
& (Join-Path $bin 'pg_ctl.exe') -D $data stop
if ($LASTEXITCODE -ne 0) { throw 'Stopping POC PostgreSQL failed.' }
Write-Host 'POC PostgreSQL stopped. Data is still saved in .local/pgdata.'
