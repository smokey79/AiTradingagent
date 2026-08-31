@echo off
title AiTradingAgent — Stop All Services
color 0C
cls

echo =======================================================================
echo          🛑 STOPPING AITRADINGAGENT DASHBOARD AND AGENTS 🛑
echo =======================================================================
echo.

echo [*] Terminating Trading Agent and Dashboard processes...

REM Kill Node instances running dashboard/orchestrator
taskkill /FI "WINDOWTITLE eq Dashboard-3001*" /F /T >nul 2>&1
taskkill /FI "WINDOWTITLE eq Studio-3002*" /F /T >nul 2>&1
taskkill /FI "WINDOWTITLE eq Trading-Agents*" /F /T >nul 2>&1

REM Kill by port listeners on 3001 and 3002
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3001 "') do (
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3002 "') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo [OK] All AiTradingAgent Dashboard and Agent processes stopped.
echo.
timeout /t 2 /nobreak >nul
exit
