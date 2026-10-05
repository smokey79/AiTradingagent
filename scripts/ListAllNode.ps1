$pm2AppNames = @('risk-gate','trading-data','telegram-listener','dashboard','tradingkit-analyst','trading-orchestrator','python-debate','hermes-analyst','arb-scanner','mt5-feed','freqtrade-bridge')
$trackedPids = @()
foreach ($app in $pm2AppNames) {
    $p = (pm2 pid $app 2>$null | Select-Object -First 1)
    if ($p -match '^\d+$') { $trackedPids += [int]$p }
}
Write-Host "TRACKED PIDS: $($trackedPids -join ',')"
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
    $tracked = $trackedPids -contains $_.ProcessId
    Write-Host "PID=$($_.ProcessId) Created=$($_.CreationDate) Tracked=$tracked ParentPID=$($_.ParentProcessId)"
}
