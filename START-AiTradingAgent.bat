@echo off
cd /d F:\aitradingagent
title AiTradingAgent — LIVE
color 0A

echo.
echo  ██████████████████████████████████████████
echo  ██  AiTradingAgent v3  —  STARTING...  ██
echo  ██████████████████████████████████████████
echo.

where node >nul 2>&1
if errorlevel 1 (
  color 0C
  echo  ERROR: Node.js not found.
  echo  Download from: https://nodejs.org
  pause & exit /b 1
)

if not exist node_modules (
  echo  Installing dependencies — please wait...
  npm install --silent
)

echo  [1/3] Starting Dashboard...
start "AiTradingAgent-Dashboard" /min cmd /k "cd /d F:\aitradingagent && node src/dashboard/server.js"
timeout /t 4 /nobreak >nul

echo  [2/3] Starting Telegram Listener...
start "AiTradingAgent-Telegram" /min cmd /k "cd /d F:\aitradingagent && node src/notifications/telegramListener.js"
timeout /t 2 /nobreak >nul

echo  [3/3] Opening Dashboard in browser...
start http://localhost:3001
timeout /t 1 /nobreak >nul

echo.
echo  ██████████████████████████████████████████
echo  ██         ALL SYSTEMS RUNNING          ██
echo  ██                                      ██
echo  ██  Dashboard : http://localhost:3001   ██
echo  ██  Telegram  : Active                  ██
echo  ██  Agents    : 18 online               ██
echo  ██                                      ██
echo  ██  To STOP: double-click              ██
echo  ██  STOP-AiTradingAgent.bat             ██
echo  ██████████████████████████████████████████
echo.
echo  Press any key to minimise this window...
pause >nul
exit
