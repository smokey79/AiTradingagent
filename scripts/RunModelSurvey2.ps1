node --check F:\aitradingagent\scripts\survey-free-models-2.js
if ($LASTEXITCODE -ne 0) {
    Write-Host "SYNTAX FAIL"
    exit 1
}
node F:\aitradingagent\scripts\survey-free-models-2.js
