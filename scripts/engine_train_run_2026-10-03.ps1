# engine_train_run_2026-10-03.ps1 -- runs scripts\engine_train.js (real history download + train + out-of-sample test) and writes the console output to a file.
param([string]$Out = 'F:\aitradingagent\runs\2026-10-03_calibration\engine_train_output.txt')
Set-Location F:\aitradingagent
Remove-Item $Out -ErrorAction SilentlyContinue
node scripts\engine_train.js *> $Out
"done, exit $LASTEXITCODE" | Add-Content $Out
