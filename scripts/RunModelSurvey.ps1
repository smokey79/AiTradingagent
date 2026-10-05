node --check F:\aitradingagent\scripts\survey-free-models.js
if ($LASTEXITCODE -ne 0) {
    Write-Host "SYNTAX FAIL"
    exit 1
}
Write-Host "SYNTAX OK -- running survey..."
node F:\aitradingagent\scripts\survey-free-models.js
