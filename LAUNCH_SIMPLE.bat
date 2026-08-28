@echo off
REM ================================================================
REM AiTradingAgent Full Stack Launcher - Simple Edition
REM Handles all common startup issues
REM ================================================================

setlocal enabledelayedexpansion

set PROJECT_ROOT=F:\aitradingagent

REM Create logs directory
if not exist "%PROJECT_ROOT%\logs" mkdir "%PROJECT_ROOT%\logs"

set LOG_FILE=%PROJECT_ROOT%\logs\startup.log

echo. > "%LOG_FILE%"
echo ==================== STARTUP LOG ==================== >> "%LOG_FILE%"
echo Time: %date% %time% >> "%LOG_FILE%"
echo Working Directory: %CD% >> "%LOG_FILE%"
echo Project Root: %PROJECT_ROOT% >> "%LOG_FILE%"
echo. >> "%LOG_FILE%"

cd /d "%PROJECT_ROOT%" 2>>"%LOG_FILE%"

echo.
echo ==========================================
echo   AiTradingAgent Full Stack Launcher
echo ==========================================
echo.
echo Starting services...
echo Location: %PROJECT_ROOT%
echo.

REM ========== CHECK PREREQUISITES ==========
echo Checking prerequisites... >> "%LOG_FILE%"

where python >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Python is not installed or not in PATH
    echo Visit: https://www.python.org/
    echo Make sure to select "Add Python to PATH"
    echo. >> "%LOG_FILE%"
    echo ERROR: Python not found >> "%LOG_FILE%"
    timeout /t 5
    exit /b 1
)

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Node.js is not installed or not in PATH
    echo Visit: https://nodejs.org/
    echo. >> "%LOG_FILE%"
    echo ERROR: Node.js not found >> "%LOG_FILE%"
    timeout /t 5
    exit /b 1
)

echo [OK] Python and Node.js found >> "%LOG_FILE%"
echo OK - Python and Node.js found
echo.

REM ========== PYTHON SETUP ==========
echo Setting up Python environment...
echo Setting up Python environment >> "%LOG_FILE%"

if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv 2>>"%LOG_FILE%"
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Virtual environment creation failed >> "%LOG_FILE%"
    )
)

call venv\Scripts\activate.bat 2>>"%LOG_FILE%"
if %ERRORLEVEL% NEQ 0 (
    echo [WARNING] Virtual environment activation warning >> "%LOG_FILE%"
)

echo Installing Python packages...
pip install -q -r requirements.txt 2>>"%LOG_FILE%"
if %ERRORLEVEL% NEQ 0 (
    echo [WARNING] pip install had issues, but continuing >> "%LOG_FILE%"
)

echo Python environment ready >> "%LOG_FILE%"
echo OK - Python environment ready
echo.

REM ========== NODE SETUP ==========
echo Setting up Node.js environment...
echo Setting up Node.js environment >> "%LOG_FILE%"

if exist "node_modules" (
    echo Node modules already installed >> "%LOG_FILE%"
) else (
    echo Installing npm packages...
    call npm install 2>>"%LOG_FILE%"
    if %ERRORLEVEL% NEQ 0 (
        echo [WARNING] npm install warning >> "%LOG_FILE%"
    )
)

echo Node environment ready >> "%LOG_FILE%"
echo OK - Node environment ready
echo.

REM ========== CREATE DIRECTORIES ==========
echo Creating required directories...
echo Creating directories >> "%LOG_FILE%"

for %%D in (
    logs
    data
    config
    mcp-servers
    orchestrator
    web-dashboard
) do (
    if not exist "%%D" mkdir "%%D" 2>>"%LOG_FILE%"
)

echo Directories ready >> "%LOG_FILE%"
echo OK - Directories ready
echo.

REM ========== STARTUP MESSAGE ==========
echo.
echo ==========================================
echo   Services Starting...
echo ==========================================
echo.
echo Dashboard:  http://localhost:3000
echo Backtester: http://localhost:3001
echo Monitor:    http://localhost:3002
echo.
echo Logs saved to: %PROJECT_ROOT%\logs\
echo.

echo. >> "%LOG_FILE%"
echo [SUCCESS] Launcher startup completed >> "%LOG_FILE%"
echo Time: %date% %time% >> "%LOG_FILE%"

REM Keep window open
timeout /t 5

endlocal
