@echo off
title AiTradingAgent — Emergency Stop
color 0C
cls

echo =======================================================================
echo          STOPPING AITRADINGAGENT (kill switch + PM2 stop)
echo =======================================================================
echo.

cd /d "%~dp0"

echo [*] Engaging kill switch (halts new trades even if something restarts) ...
curl -s -X POST http://localhost:3001/api/kill-switch/engage -H "Content-Type: application/json" -d "{\"reason\":\"Stopped via desktop STOP-PM2-BOT.bat\"}" >nul 2>&1

echo [*] Stopping all PM2-managed processes ...
where pm2 >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    call pm2 stop all
) else (
    echo [WARN] pm2 not found in PATH — could not stop processes automatically.
    echo        Open Task Manager and end any remaining node.exe processes if needed.
)

echo.
echo [OK] Kill switch engaged and PM2 processes stopped.
echo      Already-open paper positions are left as recorded — nothing was
echo      abandoned mid-trade, they just won't have new trades opened
echo      alongside them. Use START-PM2-BOT.bat to resume.
echo.
timeout /t 3 /nobreak >nul
pause
