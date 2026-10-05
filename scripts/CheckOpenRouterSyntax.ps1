node --check F:\aitradingagent\src\agents\openrouterFreeAgent.js
if ($LASTEXITCODE -eq 0) {
    Write-Host "SYNTAX OK"
} else {
    Write-Host "SYNTAX FAIL"
}
