Set-Location F:\aitradingagent
node -e "require('./src/orchestrator/consensus.js'); require('./src/risk/riskGate.js'); require('./src/agents/edgeAggregator.js'); require('./src/agents/metaEvaluatorAgent.js'); console.log('REQUIRE_OK')"
if ($LASTEXITCODE -eq 0) {
    Write-Output "REQUIRE_CHECK_PASSED"
} else {
    Write-Output "REQUIRE_CHECK_FAILED"
}
