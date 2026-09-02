@echo off
title AiTradingAgent — Developments Studio (Port 3002)
setlocal enabledelayedexpansion

cd /d "%~dp0"
set PROJECT_ROOT=%~dp0
if "%PROJECT_ROOT:~-1%"=="\" set PROJECT_ROOT=%PROJECT_ROOT:~0,-1%
set LOG_DIR=%PROJECT_ROOT%\logs
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

color 0B
cls

echo =======================================================================
echo          ⚡ AITRADINGAGENT — DEVELOPMENTS STUDIO (PORT 3002) ⚡
echo =======================================================================
echo  Multi-LLM Consensus | Live Charts | PineScript v5 | 5X Futures & LuxAlgo
echo =======================================================================
echo.

REM 1. Activate Python Virtual Environment if available
if exist "%PROJECT_ROOT%\venv\Scripts\activate.bat" (
    call "%PROJECT_ROOT%\venv\Scripts\activate.bat"
    set PYTHON_BIN="%PROJECT_ROOT%\venv\Scripts\python.exe"
) else (
    set PYTHON_BIN=python
)

REM 2. Clean previous Studio instance on port 3002
echo [*] Checking and freeing port 3002...
taskkill /FI "WINDOWTITLE eq Studio-3002*" /F /T >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3002 "') do (
    taskkill /F /PID %%a >nul 2>&1
)

REM 3. Start WSGI Developments Studio
set DASHBOARD_PORT=3002
echo [*] Starting Developments Studio (Waitress WSGI Server) on port 3002...
start "AiTradingAgent - WSGI Studio (Port 3002)" /MIN cmd /c "title Studio-3002 && cd /d %PROJECT_ROOT% && python wsgi.py >> logs\wsgi_studio.log 2>&1"

REM Wait 2 seconds for server to bind port
timeout /t 2 /nobreak >nul

REM 4. Open in browser
echo [*] Opening Developments Studio at http://localhost:3002 ...
start "" "http://localhost:3002"
powershell -Command "Start-Process 'http://localhost:3002'" >nul 2>&1

echo.
echo =======================================================================
echo  ✅ DEVELOPMENTS STUDIO SUCCESSFULLY LAUNCHED!
echo =======================================================================
echo   • URL          : http://localhost:3002
echo   • Log File     : %LOG_DIR%\wsgi_studio.log
echo =======================================================================
echo.
echo  [TIP] To stop, close the terminal window or run STOP_DASHBOARD_AND_AGENTS.bat
echo.
pause
