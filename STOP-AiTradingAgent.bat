@echo off
title AiTradingAgent — STOPPING
color 0C

echo.
echo  ██████████████████████████████████████████
echo  ██     STOPPING AiTradingAgent...       ██
echo  ██████████████████████████████████████████
echo.

echo  Engaging kill switch via API...
curl -s -X POST http://localhost:3001/api/kill-switch/engage ^
  -H "Content-Type: application/json" ^
  -d "{\"reason\":\"Manual stop via STOP button\"}" >nul 2>&1

echo  Stopping Node.js processes...
taskkill /FI "WINDOWTITLE eq AiTradingAgent-Dashboard" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq AiTradingAgent-Telegram"  /F >nul 2>&1

timeout /t 2 /nobreak >nul

REM Final sweep — kill any remaining node processes started from this project
for /f "tokens=2" %%i in ('tasklist /fi "imagename eq node.exe" /fo list ^| find "PID:"') do (
  wmic process where "ProcessId=%%i and CommandLine like '%%aitradingagent%%'" delete >nul 2>&1
)

echo.
echo  ██████████████████████████████████████████
echo  ██           BOT STOPPED ✓              ██
echo  ██                                      ██
echo  ██  All trading halted                  ██
echo  ██  Open positions still tracked        ██
echo  ██  To restart: START-AiTradingAgent    ██
echo  ██████████████████████████████████████████
echo.
pause
