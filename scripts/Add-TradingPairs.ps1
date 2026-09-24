# scripts/Add-TradingPairs.ps1  (2026-09-24)
# Adds and/or removes pairs in TRADING_PAIRS in .env (keeps the rest, skips duplicates).
# Reads only the TRADING_PAIRS line; writes through Set-EnvValue.ps1 (which backs up .env).
# Usage:
#   powershell.exe -ExecutionPolicy Bypass -File scripts\Add-TradingPairs.ps1 -Pairs "LTC/USDT,TRX/USDT"
#   powershell.exe -ExecutionPolicy Bypass -File scripts\Add-TradingPairs.ps1 -Remove "MATIC/USDT"
# Then: pm2 restart all --update-env
param([string]$Pairs = '', [string]$Remove = '')
if (-not $Pairs -and -not $Remove) { Write-Host 'Give -Pairs and/or -Remove.'; exit 1 }
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envPath = Join-Path $root '.env'
$line = Select-String -Path $envPath -Pattern '^TRADING_PAIRS=' | Select-Object -First 1
$current = @()
if ($line) { $current = @($line.Line.Substring('TRADING_PAIRS='.Length).Trim().Trim('"').Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
$added = @(); $removed = @()
foreach ($p in $Pairs.Split(',')) {
    $p = $p.Trim().ToUpper()
    if ($p -and ($current -notcontains $p)) { $current += $p; $added += $p }
}
foreach ($p in $Remove.Split(',')) {
    $p = $p.Trim().ToUpper()
    if ($p -and ($current -contains $p)) { $current = @($current | Where-Object { $_ -ne $p }); $removed += $p }
}
if ($added.Count -eq 0 -and $removed.Count -eq 0) { Write-Host 'Nothing to change.'; exit 0 }
if ($current.Count -eq 0) { Write-Host 'Refusing to leave TRADING_PAIRS empty.'; exit 1 }
& (Join-Path $root 'scripts\Set-EnvValue.ps1') -Name 'TRADING_PAIRS' -Value ($current -join ',') -EnvPath $envPath
if ($added) { Write-Host "Added: $($added -join ', ')" }
if ($removed) { Write-Host "Removed: $($removed -join ', ')" }
Write-Host "TRADING_PAIRS now has $($current.Count) pairs: $($current -join ', ')"
