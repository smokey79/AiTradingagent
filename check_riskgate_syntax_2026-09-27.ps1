Set-Location F:\aitradingagent
node --check src\risk\riskGate.js
if ($LASTEXITCODE -eq 0) {
    Write-Output "SYNTAX_OK"
} else {
    Write-Output "SYNTAX_FAIL"
}
