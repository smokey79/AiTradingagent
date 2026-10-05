node --check F:\aitradingagent\src\risk\riskGate.js
if ($LASTEXITCODE -eq 0) {
    Write-Host "SYNTAX OK"
} else {
    Write-Host "SYNTAX FAIL"
}
