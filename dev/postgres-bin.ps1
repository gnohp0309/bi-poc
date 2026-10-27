function Resolve-PostgresBin {
  param([string]$Root)

  $candidates = @()
  if ($env:POC_POSTGRES_BIN) { $candidates += $env:POC_POSTGRES_BIN }

  $versionFile = Join-Path $Root '.local\pgdata\PG_VERSION'
  if (Test-Path $versionFile) {
    $major = (Get-Content -LiteralPath $versionFile -Raw).Trim()
    if ($major -match '^\d+$') {
      $candidates += Join-Path $env:ProgramFiles "PostgreSQL\$major\bin"
    }
  }

  $onPath = Get-Command pg_ctl.exe -ErrorAction SilentlyContinue
  if ($onPath) { $candidates += Split-Path -Parent $onPath.Source }

  $installRoot = Join-Path $env:ProgramFiles 'PostgreSQL'
  if (Test-Path $installRoot) {
    $versions = Get-ChildItem -LiteralPath $installRoot -Directory |
      Where-Object { $_.Name -match '^\d+$' } |
      Sort-Object -Property @{ Expression = { [int]$_.Name }; Descending = $true }
    foreach ($version in $versions) { $candidates += Join-Path $version.FullName 'bin' }
  }

  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    if (Test-Path (Join-Path $candidate 'initdb.exe') -PathType Leaf) { return $candidate }
  }
  throw 'PostgreSQL bin not found. Install PostgreSQL or set POC_POSTGRES_BIN to its bin folder.'
}
