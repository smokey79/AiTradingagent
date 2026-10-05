Write-Host "=== ConsensusBridgeStrategy: what file does it read, how stale check works ==="
Get-ChildItem "F:\aitradingagent\freqtrade-stable" -Recurse -Filter "ConsensusBridgeStrategy*" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host $_.FullName
    Select-String -Path $_.FullName -Pattern "signals_file|SIGNALS_FILE|\.json" | Select-Object -First 10
}

Write-Host ""
Write-Host "=== does Node orchestrator write a signals file for freqtrade? ==="
Select-String -Path "F:\aitradingagent\src\orchestrator\index.js" -Pattern "freqtrade|signals_file|bridge_signals" -CaseSensitive:$false

Write-Host ""
Write-Host "=== search whole src for who writes a freqtrade signals json ==="
Get-ChildItem "F:\aitradingagent\src" -Recurse -Include *.js | Select-String -Pattern "freqtrade.*signal|bridge_signals|signals.*freqtrade" -CaseSensitive:$false | Select-Object -First 10
