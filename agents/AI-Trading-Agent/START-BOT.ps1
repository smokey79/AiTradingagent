$ProjectPath = "F:\AI-Trading-Agent"
Set-Location -Path $ProjectPath
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " LAUNCHING AI TRADING AGENT ON PORT 8080 " -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
python webhook_engine.py
