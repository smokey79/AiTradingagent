@echo off
REM ================================================================
REM AiTradingAgent Full Stack Launcher v2 (Enhanced Debug)
REM ================================================================

setlocal enabledelayedexpansion

set PROJECT_ROOT=F:\aitradingagent
set LOG_DIR=%PROJECT_ROOT%\logs
set TIMESTAMP=%date:~10,4%%date:~4,2%%date:~7,2%_%time:~0,2%%time:~3,2%%time:~6,2%
set LOG_FILE=%LOG_DIR%\launcher_%TIMESTAMP%.log

REM Ensure logs directory exists
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

REM Enable error reporting
echo. > "%LOG_FILE%"
echo ========================================== >> "%LOG_FILE%"
echo AiTradingAgent Full Stack Launch >> "%LOG_FILE%"
echo Timestamp: %date% %time% >> "%LOG_FILE%"
echo ROOT: %PROJECT_ROOT% >> "%LOG_FILE%"
echo ========================================== >> "%LOG_FILE%"

echo.
echo ==========================================
echo AiTradingAgent Full Stack Launcher v2
echo ==========================================
echo.
echo Project Root: %PROJECT_ROOT%
echo Logs: %LOG_DIR%
echo.

REM Change to project root
cd /d "%PROJECT_ROOT%" 2>>"%LOG_FILE%"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Cannot change to project directory %PROJECT_ROOT%
    echo. >> "%LOG_FILE%"
    echo [ERROR] Cannot change to directory: %cd% >> "%LOG_FILE%"
    pause
    exit /b 1
)

REM ========== VERIFY PREREQUISITES ==========
echo [%time%] Verifying prerequisites... >> "%LOG_FILE%"
echo Checking prerequisites...

REM Check Python
where python >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Python not found in PATH
    echo. >> "%LOG_FILE%"
    echo [%time%] ERROR: Python not found >> "%LOG_FILE%"
    echo Install from: https://www.python.org/
    echo Make sure to check "Add Python to PATH" during installation
    pause
    exit /b 1
)
echo [OK] Python found >> "%LOG_FILE%"

REM Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Node.js not found in PATH
    echo. >> "%LOG_FILE%"
    echo [%time%] ERROR: Node.js not found >> "%LOG_FILE%"
    echo Install from: https://nodejs.org/
    echo Make sure to check "Add to PATH" during installation
    pause
    exit /b 1
)
echo [OK] Node.js found >> "%LOG_FILE%"

REM Check launcher script exists
if not exist "launch-full-stack.bat" (
    echo.
    echo ERROR: launch-full-stack.bat not found
    echo Expected: %PROJECT_ROOT%\launch-full-stack.bat
    echo. >> "%LOG_FILE%"
    echo [ERROR] launch-full-stack.bat not found >> "%LOG_FILE%"
    pause
    exit /b 1
)
echo [OK] Launcher script found >> "%LOG_FILE%"

echo.
echo ==========================================
echo Launching Full Stack...
echo ==========================================
echo.

REM ========== CALL MAIN LAUNCHER ==========
echo [%time%] Calling main launcher... >> "%LOG_FILE%"
call launch-full-stack.bat

echo. >> "%LOG_FILE%"
echo [%time%] Launcher completed >> "%LOG_FILE%"
