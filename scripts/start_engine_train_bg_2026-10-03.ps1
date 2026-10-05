# start_engine_train_bg_2026-10-03.ps1 -- starts engine_train_run in a hidden background process and returns immediately.
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'F:\aitradingagent\scripts\engine_train_run_2026-10-03.ps1'
"started"
