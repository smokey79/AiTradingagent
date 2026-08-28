@echo off
REM ================================================================
REM AiTradingAgent Full Stack Launcher
REM ================================================================
REM This script launches the complete AI trading agent system with
REM all components: MCP servers, dashboard, backtester, visualizers
REM ================================================================

setlocal enabledelayedexpansion

set PROJECT_ROOT=F:\aitradingagent
set LOG_DIR=%PROJECT_ROOT%\logs
set TIMESTAMP=%date:~10,4%%date:~4,2%%date:~7,2%_%time:~0,2%%time:~3,2%%time:~6,2%
set LOG_FILE=%LOG_DIR%\launcher_%TIMESTAMP%.log

REM Create logs directory if it doesn't exist
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo. >> "%LOG_FILE%"
echo ========================================== >> "%LOG_FILE%"
echo AiTradingAgent Full Stack Launch >> "%LOG_FILE%"
echo Timestamp: %date% %time% >> "%LOG_FILE%"
echo ========================================== >> "%LOG_FILE%"

REM Change to project root
cd /d "%PROJECT_ROOT%"

echo [%time%] Starting AiTradingAgent Full Stack... >> "%LOG_FILE%"
echo Starting AiTradingAgent Full Stack...

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js not found. Please install Node.js >> "%LOG_FILE%"
    echo [ERROR] Node.js not found. Please install Node.js
    timeout /t 5
    exit /b 1
)

REM Check if Python is installed
where python >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python not found. Please install Python >> "%LOG_FILE%"
    echo [ERROR] Python not found. Please install Python
    timeout /t 5
    exit /b 1
)

echo [OK] Node.js and Python found >> "%LOG_FILE%"
echo [OK] Node.js and Python found

REM ========== PYTHON ENVIRONMENT SETUP ==========
echo. >> "%LOG_FILE%"
echo [%time%] Setting up Python environment... >> "%LOG_FILE%"
echo Setting up Python environment...

python -m venv venv --upgrade-deps >nul 2>&1
call venv\Scripts\activate.bat

if %ERRORLEVEL% NEQ 0 (
    echo [WARNING] Virtual environment activation failed >> "%LOG_FILE%"
) else (
    echo [OK] Virtual environment activated >> "%LOG_FILE%"
)

REM Install/update Python dependencies
echo [%time%] Installing Python dependencies... >> "%LOG_FILE%"
echo Installing Python dependencies...
pip install -q -r requirements.txt 2>>"%LOG_FILE%"

if %ERRORLEVEL% NEQ 0 (
    echo [WARNING] Some Python packages failed to install >> "%LOG_FILE%"
) else (
    echo [OK] Python dependencies ready >> "%LOG_FILE%"
)

REM ========== NODE ENVIRONMENT SETUP ==========
echo. >> "%LOG_FILE%"
echo [%time%] Installing Node.js dependencies... >> "%LOG_FILE%"
echo Installing Node.js dependencies...

if not exist "node_modules" (
    call npm install 2>>"%LOG_FILE%"
) else (
    echo [OK] node_modules already exists >> "%LOG_FILE%"
)

REM ========== PREFLIGHT CHECKS ==========
echo. >> "%LOG_FILE%"
echo [%time%] Running preflight checks... >> "%LOG_FILE%"
echo Running preflight checks...

set MISSING_COUNT=0

setlocal enabledelayedexpansion
for %%D in (
    "mcp-servers\trading-data-mcp"
    "mcp-servers\signal-engine-mcp"
    "mcp-servers\risk-gate-mcp"
    "mcp-servers\portfolio-mcp"
    "orchestrator"
    "web-dashboard"
    "risk"
    "backtester"
    "logs"
) do (
    if not exist "%%D" (
        mkdir "%%D"
        echo [CREATED] %%D >> "%LOG_FILE%"
    ) else (
        echo [OK] %%D >> "%LOG_FILE%"
    )
)

REM ========== START CORE SERVICES IN BACKGROUND ==========
echo. >> "%LOG_FILE%"
echo [%time%] Starting core MCP servers... >> "%LOG_FILE%"
echo Starting core MCP servers...

REM Start MCP servers (if they exist)
if exist "mcp-servers\trading-data-mcp\index.js" (
    start "Trading Data MCP" /B node mcp-servers\trading-data-mcp\index.js >>"%LOG_DIR%\mcp-trading-data.log" 2>&1
    echo [STARTED] Trading Data MCP >> "%LOG_FILE%"
    timeout /t 2 >nul
)

if exist "mcp-servers\signal-engine-mcp\index.js" (
    start "Signal Engine MCP" /B node mcp-servers\signal-engine-mcp\index.js >>"%LOG_DIR%\mcp-signal-engine.log" 2>&1
    echo [STARTED] Signal Engine MCP >> "%LOG_FILE%"
    timeout /t 2 >nul
)

if exist "mcp-servers\risk-gate-mcp\index.js" (
    start "Risk Gate MCP" /B node mcp-servers\risk-gate-mcp\index.js >>"%LOG_DIR%\mcp-risk-gate.log" 2>&1
    echo [STARTED] Risk Gate MCP >> "%LOG_FILE%"
    timeout /t 2 >nul
)

if exist "mcp-servers\portfolio-mcp\index.js" (
    start "Portfolio MCP" /B node mcp-servers\portfolio-mcp\index.js >>"%LOG_DIR%\mcp-portfolio.log" 2>&1
    echo [STARTED] Portfolio MCP >> "%LOG_FILE%"
    timeout /t 2 >nul
)

REM Start Orchestrator
if exist "orchestrator\index.js" (
    start "Orchestrator" /B node orchestrator\index.js >>"%LOG_DIR%\orchestrator.log" 2>&1
    echo [STARTED] Orchestrator >> "%LOG_FILE%"
    timeout /t 2 >nul
)

REM ========== START AUXILIARY SERVICES ==========
echo. >> "%LOG_FILE%"
echo [%time%] Starting auxiliary services... >> "%LOG_FILE%"
echo Starting auxiliary services...

REM Web Dashboard (visible)
if exist "web-dashboard\index.js" (
    start "Web Dashboard" node web-dashboard\index.js >>"%LOG_DIR%\web-dashboard.log" 2>&1
    echo [STARTED] Web Dashboard >> "%LOG_FILE%"
    timeout /t 2 >nul
)

REM Trade Visualizer (if exists)
if exist "trade-visualizer\index.js" (
    start "Trade Visualizer" node trade-visualizer\index.js >>"%LOG_DIR%\visualizer.log" 2>&1
    echo [STARTED] Trade Visualizer >> "%LOG_FILE%"
    timeout /t 2 >nul
)

REM Risk Tuning Panel (if exists)
if exist "risk-tuning\index.js" (
    start "Risk Tuning" node risk-tuning\index.js >>"%LOG_DIR%\risk-tuning.log" 2>&1
    echo [STARTED] Risk Tuning >> "%LOG_FILE%"
    timeout /t 2 >nul
)

REM Backtester
if exist "backtester\index.js" (
    start "Backtester" /B node backtester\index.js >>"%LOG_DIR%\backtester.log" 2>&1
    echo [STARTED] Backtester >> "%LOG_FILE%"
    timeout /t 2 >nul
)

REM Telegram Bot (background)
if exist "telegram-bot\index.js" (
    start "Telegram Bot" /B node telegram-bot\index.js >>"%LOG_DIR%\telegram-bot.log" 2>&1
    echo [STARTED] Telegram Bot >> "%LOG_FILE%"
    timeout /t 2 >nul
)

REM ========== LAUNCH COMPLETE ==========
echo. >> "%LOG_FILE%"
echo [%time%] ========================================== >> "%LOG_FILE%"
echo [%time%] AiTradingAgent Full Stack is now RUNNING >> "%LOG_FILE%"
echo [%time%] ========================================== >> "%LOG_FILE%"
echo. >> "%LOG_FILE%"
echo Logs available at: %LOG_DIR% >> "%LOG_FILE%"
echo. >> "%LOG_FILE%"

echo.
echo ==========================================
echo AiTradingAgent Full Stack is now RUNNING
echo ==========================================
echo.
echo Web Dashboard: http://localhost:3000
echo Backtester: http://localhost:3001
echo Monitor: http://localhost:3002
echo.
echo Logs saved to: %LOG_DIR%
echo.
timeout /t 3

endlocal
