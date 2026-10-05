Set-Location F:\aitradingagent
node --check src\agents\deepseekAgent.js
node --check src\agents\bearDebateAgent.js
node -e "require('./src/agents/deepseekAgent.js'); require('./src/agents/bearDebateAgent.js'); console.log('REQUIRE_OK')"
if ($LASTEXITCODE -eq 0) {
    Write-Output "ALL_CHECKS_PASSED"
} else {
    Write-Output "CHECKS_FAILED"
}
