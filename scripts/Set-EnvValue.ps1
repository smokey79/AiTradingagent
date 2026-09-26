<#
  Set-EnvValue.ps1 - safely set one KEY=value line in F:\aitradingagent\.env
  - Backs up .env to .env.bak-<timestamp> first
  - Replaces the line if the key exists, otherwise appends it
  - Never prints the value
  - Optionally removes another key (e.g. a stale URL override) with -RemoveKey
  Usage:
    powershell.exe -ExecutionPolicy Bypass -File scripts\Set-EnvValue.ps1 -Name TRADINGKIT_API_KEY -Value <value> [-RemoveKey TRADINGKIT_MCP_URL]
#>
param(
  [Parameter(Mandatory=$true)][string]$Name,
  [Parameter(Mandatory=$true)][string]$Value,
  [string]$RemoveKey = '',
  [string]$EnvPath = ''
)
$ErrorActionPreference = 'Stop'
if (-not $EnvPath) {
  $here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
  $EnvPath = Join-Path (Split-Path -Parent $here) '.env'
}
if ($Name -notmatch '^[A-Z0-9_]+$') { throw "Invalid key name: $Name" }
$lines = @()
if (Test-Path $EnvPath) {
  Copy-Item $EnvPath "$EnvPath.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
  $lines = Get-Content $EnvPath
}
$found = $false
$out = foreach ($l in $lines) {
  if ($RemoveKey -and $l -match "^\s*$RemoveKey\s*=") { Write-Host "Removed $RemoveKey"; continue }
  if ($l -match "^\s*$Name\s*=") { $found = $true; "$Name=$Value" } else { $l }
}
if (-not $found) { $out = @($out) + "$Name=$Value" }
Set-Content -Path $EnvPath -Value $out -Encoding UTF8
Write-Host "$Name $(if ($found) {'updated'} else {'added'}) in $EnvPath (value hidden). Backup saved."
