# scripts/Add-TradingPairs.ps1  (2026-09-24)
# Appends pairs to TRADING_PAIRS in .env (keeps existing ones, skips duplicates).
# Reads only the TRADING_PAIRS line; writes through Set-EnvValue.ps1 (which backs up .env).
# Usage: powershell.exe -ExecutionPolicy Bypass -File scripts\Add-TradingPairs.ps1 -Pairs "LTC/USDT,TRX/USDT"
param([Parameter(Mandatory = $true)][string]$Pairs)
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envPath = Join-Path $root '.env'
$line = Select-String -Path $envPath -Pattern '^TRADING_PAIRS=' | Select-Object -First 1
$current = @()
if ($line) { $current = $line.Line.Substring('TRADING_PAIRS='.Length).Trim().Trim('"').Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ } }
$added = @()
foreach ($p in $Pairs.Split(',')) {
    $p = $p.Trim().ToUpper()
    if ($p -and ($current -notcontains $p)) { $current += $p; $added += $p }
}
if ($added.Count -eq 0) { Write-Host 'Nothing to add.'; exit 0 }
& (Join-Path $root 'scripts\Set-EnvValue.ps1') -Name 'TRADING_PAIRS' -Value ($current -join ',') -EnvPath $envPath
Write-Host "Added: $($added -join ', ')"
Write-Host "TRADING_PAIRS now has $($current.Count) pairs: $($current -join ', ')"
