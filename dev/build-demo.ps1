$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$npm = Get-Command npm.cmd -ErrorAction Stop
$maven = Get-Command mvn.cmd -ErrorAction Stop

Push-Location (Join-Path $root 'frontend')
try {
  & $npm.Source ci
  if ($LASTEXITCODE -ne 0) { throw 'Installing frontend dependencies failed.' }
  & $npm.Source run build
  if ($LASTEXITCODE -ne 0) { throw 'Building frontend failed.' }
} finally { Pop-Location }

Push-Location (Join-Path $root 'backend')
try {
  & $maven.Source -q -DskipTests package
  if ($LASTEXITCODE -ne 0) { throw 'Building Spring Boot JAR failed.' }
} finally { Pop-Location }

Write-Host 'POC build is ready.'
