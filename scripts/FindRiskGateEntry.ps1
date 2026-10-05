Get-ChildItem -Path F:\aitradingagent -Filter "ecosystem.config.*" | ForEach-Object {
    Write-Host "=== $($_.FullName) ==="
    Get-Content $_.FullName | Select-String "risk-gate" -Context 0,4
}
