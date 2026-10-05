# arb_smoke_2026-10-03.ps1 -- ONE live arbitrage scan against a SANDBOX database (nothing in data/ is touched).
# Public market data only; no keys used for exchanges; LLM debate off so it is quick.
$env:ARB_DB_PATH = "$env:TEMP\arb_smoke.db"
$env:PREDICTIONS_DB_PATH = "$env:TEMP\pred_smoke.db"
$env:PREDICTOR_LLM = 'false'
$env:ARB_MODE = 'observe'
Remove-Item "$env:ARB_DB_PATH*", "$env:PREDICTIONS_DB_PATH*" -ErrorAction SilentlyContinue
Set-Location F:\aitradingagent
node src/arb/arbAgent.js --once
"--- observations stored in the sandbox DB:"
node -e "const m=require('./src/arb/memory');console.log(JSON.stringify(m.topRoutes(8),null,1));console.log(JSON.stringify(m.summary(),null,0).slice(0,200));m.close()"
Remove-Item "$env:ARB_DB_PATH*", "$env:PREDICTIONS_DB_PATH*" -ErrorAction SilentlyContinue
