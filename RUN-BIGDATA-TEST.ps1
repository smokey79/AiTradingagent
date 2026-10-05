# RUN-BIGDATA-TEST.ps1 - validates the Bigdata.com data source (safe: read-only, paper mode)
# 1) runs offline unit tests  2) runs a live check (abstains cleanly if BIGDATA_API_KEY is blank)
$ErrorActionPreference = 'Continue'
Set-Location 'F:\aitradingagent'
$py = 'F:\aitradingagent\venv\Scripts\python.exe'
Write-Output "=== 1/2 Offline unit tests ==="
& $py -c "import pytest" 2>$null
if ($LASTEXITCODE -ne 0) { & $py -m pip install --quiet pytest }
& $py -m pytest tests\test_bigdata_feed.py -q -p no:cacheprovider
Write-Output "=== 2/2 Live check ==="
& $py -m data_sources.bigdata_feed
