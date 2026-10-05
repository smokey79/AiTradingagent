# compile.ps1 - compile the flash-loan contract (inside flashloan-sim only)
$here = 'F:\aitradingagent\flashloan-sim'
Set-Location $here
$env:HARDHAT_DISABLE_TELEMETRY_PROMPT = 'true'
npx hardhat compile 2>&1 | Select-Object -Last 15
"exit $LASTEXITCODE"
