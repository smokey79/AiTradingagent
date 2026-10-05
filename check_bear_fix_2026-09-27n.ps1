$ErrorActionPreference = 'Stop'
& node --check "F:\aitradingagent\src\agents\bearDebateAgent.js"
if ($LASTEXITCODE -eq 0) { Write-Output "SYNTAX_OK" } else { Write-Output "SYNTAX_FAIL" }

Set-Location "F:\aitradingagent"
node -e "require('./src/agents/bearDebateAgent.js'); require('./src/agents/openrouterFreeAgent.js'); console.log('REQUIRE_OK')"
