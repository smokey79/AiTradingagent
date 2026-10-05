$f = 'F:\aitradingagent\src\risk\riskGate.js'
Select-String -Path $f -Pattern "AllocationSettings|allocationSettings" | ForEach-Object {
    Write-Host "$($_.LineNumber): $($_.Line.Trim())"
}
