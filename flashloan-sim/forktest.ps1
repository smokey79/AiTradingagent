# forktest.ps1 - run the Arbitrum fork simulation (local copy; nothing broadcast, no keys) and save output
$here = 'F:\aitradingagent\flashloan-sim'
Set-Location $here
$env:HARDHAT_DISABLE_TELEMETRY_PROMPT = 'true'
New-Item -ItemType Directory -Force "$here\results" | Out-Null
npx hardhat run scripts/forkTest.js *> "$here\results\forktest_console.log"
"exit $LASTEXITCODE"
