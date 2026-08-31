@echo off
title AiTradingAgent — Dashboard & AI Trading Agents
setlocal enabledelayedexpansion

REM ================================================================
REM  AiTradingAgent v4 — Master Desktop Launcher
REM  Starts Live Web Dashboard + Multi-Agent Consensus Trading Engine
REM ================================================================

set PROJECT_ROOT=F:\aitradingagent
set LOG_DIR=%PROJECT_ROOT%\logs

color 0B
cls

echo =======================================================================
echo          ⚡ AITRADINGAGENT — DASHBOARD & AUTONOMOUS AGENTS ⚡
echo =======================================================================
echo  Multi-LLM Consensus  : GPT-4o, Claude 3.5, DeepSeek, Gemini, Hermes
echo  Market Feeds         : CCXT, CoinMarketCap, DexScreener, On-Chain
echo  Risk Sentinels       : $30 Floor, Kelly Criterion, 72%% Gate
echo =======================================================================
echo.

cd /d "%PROJECT_ROOT%"

REM Ensure logs directory exists
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

REM 1. Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js not found in PATH. Please install Node.js from https://nodejs.org
    pause
    exit /b 1
)

REM 2. Check Python
where python >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python not found in PATH. Please install Python from https://python.org
    pause
    exit /b 1
)

echo [*] Activating Python Virtual Environment...
if exist "%PROJECT_ROOT%\venv\Scripts\activate.bat" (
    call "%PROJECT_ROOT%\venv\Scripts\activate.bat"
    set PYTHON_BIN="%PROJECT_ROOT%\venv\Scripts\python.exe"
) else (
    set PYTHON_BIN=python
)

echo [OK] Environments verified.
echo.

REM 3. Start Live Dashboard (Express + WebSockets + Real-Time Engine) on port 3001
echo [*] Starting Live Trading Dashboard & WebSocket Server on port 3001...
set PORT=3001
set DASHBOARD_PORT=3001
start "AiTradingAgent - Live Dashboard (Port 3001)" /MIN cmd /c "title Dashboard-3001 && node src/dashboard/server.js >> logs\dashboard_node.log 2>&1"

REM 4. Start WSGI Developments Studio (Waitress Flask Server) on port 3002
echo [*] Starting Developments Studio & Charting WSGI on port 3002...
set DASHBOARD_PORT=3002
start "AiTradingAgent - WSGI Studio (Port 3002)" /MIN cmd /c "title Studio-3002 && %PYTHON_BIN% wsgi.py >> logs\wsgi_studio.log 2>&1"

REM 5. Start Multi-Agent Consensus Trading Orchestrator
echo [*] Starting Multi-Agent Consensus Trading Engine...
start "AiTradingAgent - Multi-Agent Engine" cmd /k "title Trading-Agents && cd /d %PROJECT_ROOT% && node src/orchestrator/index.js"

REM Wait 3 seconds for servers to bind ports
timeout /t 3 /nobreak >nul

REM 6. Open Web Dashboard in default browser
echo [*] Opening Live Trading Dashboard in browser...
start http://localhost:3001
start http://localhost:3002

echo.
echo =======================================================================
echo  ✅ ALL SERVICES SUCCESSFULLY STARTED & RUNNING!
echo =======================================================================
echo   • Live Trading Dashboard  : http://localhost:3001
echo   • Developments Studio     : http://localhost:3002
echo   • Multi-Agent Engine      : Running in active agent terminal
echo   • Activity Logs           : %LOG_DIR%
echo =======================================================================
echo.
echo  [TIP] To stop all services at any time, use the "Stop AiTradingAgent"
echo        shortcut on your desktop, or run STOP_DASHBOARD_AND_AGENTS.bat
echo.
echo Press any key to minimize this status window...
pause >nul
