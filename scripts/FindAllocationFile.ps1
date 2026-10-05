$f = 'F:\aitradingagent\src\risk\riskGate.js'
Select-String -Path $f -Pattern "ALLOCATION_FILE|^const fs|require\('fs'\)" | ForEach-Object {
    Write-Host "$($_.LineNumber): $($_.Line.Trim())"
}
