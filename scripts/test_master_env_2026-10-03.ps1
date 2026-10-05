# test_master_env_2026-10-03.ps1 -- runs the offline tests for build_master_env.py (fake keys, temp folder, no network).
Set-Location F:\aitradingagent
& 'F:\aitradingagent\.venv\Scripts\python.exe' tests\test_build_master_env.py
