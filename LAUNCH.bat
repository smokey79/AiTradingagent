@echo off
title AiTradingAgent v4
color 0A
echo.
echo  ============================================
echo   AiTradingAgent v4  -  PAPER TRADE MODE
echo  ============================================
echo.
cd /d F:\aitradingagent

:: Init DB if not exists
if not exist data\trading.db (
    echo  [1/4] Creating database...
    python data\init_db.py
) else (
    echo  [1/4] Database exists - OK
)

:: Install deps silently
echo  [2/4] Checking Python dependencies...
pip install ccxt flask python-dotenv requests --quiet --exists-action i

:: Start dashboard in new window
echo  [3/4] Starting dashboard...
start "AiTradingAgent Dashboard" cmd /k "cd /d F:\aitradingagent && python web-dashboard\app.py"

:: Wait 3 seconds then open browser
echo  [4/4] Opening browser...
timeout /t 3 /nobreak >nul
start http://localhost:3002

echo.
echo  Dashboard running at http://localhost:3002
echo  Close this window to stop watching logs.
echo.
pause
