# scripts/Import-OandaKey.ps1 - imports the OANDA token from a saved text file into .env, finds the account ID
# automatically, and detects practice vs live. The token is never printed. 2026-09-24
# Usage: powershell.exe -ExecutionPolicy Bypass -File scripts\Import-OandaKey.ps1 [-KeyFile F:\OANDA_API.env.txt]
param([string]$KeyFile = 'F:\OANDA_API.env.txt')
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$setter = Join-Path $root 'scripts\Set-EnvValue.ps1'
$envPath = Join-Path $root '.env'
if (-not (Test-Path $KeyFile)) { Write-Host "Key file not found: $KeyFile"; exit 1 }
$m = [regex]::Match((Get-Content -Raw -Path $KeyFile), '[0-9a-f]{32}-[0-9a-f]{32}')
if (-not $m.Success) { Write-Host 'No OANDA token (32hex-32hex) found in the file - nothing saved.'; exit 1 }
$token = $m.Value

$found = $null
foreach ($envName in 'practice', 'live') {
  $hostUrl = if ($envName -eq 'live') { 'https://api-fxtrade.oanda.com' } else { 'https://api-fxpractice.oanda.com' }
  try {
    $r = Invoke-RestMethod -Uri "$hostUrl/v3/accounts" -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 20
    $found = @{ env = $envName; accounts = @($r.accounts) }; break
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    Write-Host "  $envName host: not accepted ($code)"
  }
}
if (-not $found) { Write-Host 'The token was rejected by both practice and live - it may be revoked. Generate a new one at hub.oanda.com -> Tools -> API.'; $token = $null; exit 1 }

$ids = $found.accounts | ForEach-Object { $_.id }
Write-Host "Token works on the $($found.env.ToUpper()) host. Accounts on this token: $($ids.Count)"
$ids | ForEach-Object { Write-Host ("  account ...-" + $_.Split('-')[-1]) }
& $setter -Name 'OANDA_API_TOKEN' -Value $token -EnvPath $envPath
& $setter -Name 'OANDA_ENV' -Value $found.env -EnvPath $envPath
& $setter -Name 'OANDA_ALLOW_LIVE' -Value 'false' -EnvPath $envPath
if ($ids.Count -ge 1) {
  & $setter -Name 'OANDA_ACCOUNT_ID' -Value $ids[0] -EnvPath $envPath
  Write-Host "OANDA_ACCOUNT_ID set to the first account (...-$($ids[0].Split('-')[-1]))."
}
$token = $null
if ($found.env -eq 'live') { Write-Host 'NOTE: this is a LIVE-money token. Orders stay blocked (OANDA_ALLOW_LIVE=false + live gate). A practice token is recommended for testing.' }
Write-Host 'Done. Test with: node scripts\oanda_check.js'
