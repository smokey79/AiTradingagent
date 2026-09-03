@echo off
title AiTradingAgent — PM2 Launcher
color 0B
cls

echo =======================================================================
echo          AITRADINGAGENT — PM2-Managed Launch (paper mode)
echo =======================================================================
echo  This starts the SAME processes the dashboard/orchestrator use under
echo  PM2 supervision (auto-restart on crash). It does NOT start the legacy
echo  raw-node launcher scripts — running both at once risks two trading
echo  loops writing to the same ledger. Use STOP-PM2-BOT.bat to stop.
echo =======================================================================
echo.

cd /d "%~dp0"

where pm2 >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] pm2 not found in PATH. Install it with: npm install -g pm2
    pause
    exit /b 1
)

echo [*] Starting PM2 process list from ecosystem.config.cjs ...
call pm2 start ecosystem.config.cjs
call pm2 save

echo.
echo [OK] Started. Opening dashboard in your browser...
timeout /t 3 /nobreak >nul
start "" "http://localhost:3001"

echo.
echo Current PM2 status:
call pm2 list

echo.
echo Press any key to close this window (the bot keeps running in the background).
pause >nul
