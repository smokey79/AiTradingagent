@echo off
title AiTradingAgent — Dashboard & AI Trading Agents
setlocal enabledelayedexpansion

REM ================================================================
REM  AiTradingAgent v4 — Master Desktop Launcher
REM  Starts Live Web Dashboard + Multi-Agent Consensus Trading Engine
REM ================================================================

cd /d "%~dp0"
set PROJECT_ROOT=%~dp0
if "%PROJECT_ROOT:~-1%"=="\" set PROJECT_ROOT=%PROJECT_ROOT:~0,-1%
set LOG_DIR=%PROJECT_ROOT%\logs

color 0B
cls

echo =======================================================================
echo          ⚡ AITRADINGAGENT — DASHBOARD & AUTONOMOUS AGENTS ⚡
echo =======================================================================
echo  Multi-LLM Consensus  : DeepSeek R1, GPT-4o, Claude 3.7, Gemini, Grok
echo  Multi-Platform Engine: 5X Futures (Bitget), Flash Loans, DEX Breakouts
echo  Risk Sentinels       : $30 Floor, Kelly Criterion, 72%% Win Rate Gate
echo =======================================================================
echo.

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

echo [OK] Runtime environments verified.
echo.

echo [*] Cleaning previous instances to prevent port conflicts...
taskkill /FI "WINDOWTITLE eq Dashboard-3001*" /F /T >nul 2>&1
taskkill /FI "WINDOWTITLE eq Studio-3002*" /F /T >nul 2>&1
taskkill /FI "WINDOWTITLE eq Trading-Agents*" /F /T >nul 2>&1
taskkill /FI "WINDOWTITLE eq Telegram-Listener*" /F /T >nul 2>&1

REM 3. Start Live Dashboard (Express + WebSockets + Real-Time Engine) on port 3001
echo [*] Starting Live Trading Dashboard & WebSocket Server on port 3001...
set PORT=3001
set DASHBOARD_PORT=3001
start "AiTradingAgent - Live Dashboard (Port 3001)" /MIN cmd /c "title Dashboard-3001 && cd /d %PROJECT_ROOT% && node src\dashboard\server.js >> logs\dashboard_node.log 2>&1"

REM 4. Start WSGI Developments Studio (Waitress Flask Server) on port 3002
echo [*] Starting Developments Studio & Charting WSGI on port 3002...
set DASHBOARD_PORT=3002
start "AiTradingAgent - WSGI Studio (Port 3002)" /MIN cmd /c "title Studio-3002 && cd /d %PROJECT_ROOT% && python wsgi.py >> logs\wsgi_studio.log 2>&1"

REM 5. Start Multi-Agent Consensus Trading Orchestrator
echo [*] Starting Multi-Agent Consensus Trading Engine...
start "AiTradingAgent - Multi-Agent Engine" cmd /k "title Trading-Agents && cd /d %PROJECT_ROOT% && node src\orchestrator\index.js"

REM 5.5 Start Telegram Signals Listener (Background)
echo [*] Starting Telegram Signals Listener...
start "AiTradingAgent - Telegram Listener" /MIN cmd /c "title Telegram-Listener && cd /d %PROJECT_ROOT% && node src\notifications\telegramListener.js >> logs\telegram_listener.log 2>&1"

REM Wait 2 seconds for servers to bind ports
timeout /t 2 /nobreak >nul

REM 6. Open Web Dashboard in default browser
echo [*] Opening Live Trading Dashboard in browser...
start "" "http://localhost:3001"
explorer "http://localhost:3001"
powershell -Command "Start-Process 'http://localhost:3001'" >nul 2>&1
powershell -Command "Start-Process 'chrome.exe' 'http://localhost:3001'" >nul 2>&1
powershell -Command "Start-Process 'msedge.exe' 'http://localhost:3001'" >nul 2>&1

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
echo Press any key to close this status window (services keep running)...
pause >nul
