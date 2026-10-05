Write-Host "=== data folder ledger-like files ==="
Get-ChildItem "F:\aitradingagent\data" -Filter "*ledger*" | ForEach-Object { Write-Host "$($_.Name)  LastWrite=$($_.LastWriteTime)  Size=$($_.Length)" }
Write-Host ""
Write-Host "=== recent trading-orchestrator log: rejections & executions (last 300 lines) ==="
pm2 logs trading-orchestrator --lines 300 --nostream | Select-String "Risk Gate Rejected|Trade executed|agents agree|Confidence"
