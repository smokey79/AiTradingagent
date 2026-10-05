Set-Location F:\aitradingagent
node --check src\risk\riskGate.js
if ($LASTEXITCODE -eq 0) { Write-Output 'riskGate.js OK' } else { Write-Output 'riskGate.js SYNTAX ERROR' }
node --check src\notifications\telegramNotifier.js
if ($LASTEXITCODE -eq 0) { Write-Output 'telegramNotifier.js OK' } else { Write-Output 'telegramNotifier.js SYNTAX ERROR' }
