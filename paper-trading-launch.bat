@echo off
REM paper-trading-launch.bat
REM Launch JEDAI trading agent in paper mode on Windows

setlocal enabledelayedexpansion

echo ==================================================
echo JEDAI Trading Agent - Paper Trading Mode
echo ==================================================
echo.
echo Starting Docker environment for paper trading...
echo This will run simulated trades using historical data.
echo.

if not exist .env.paper (
    echo ERROR: .env.paper not found. Run from F:\aitradingagent
    exit /b 1
)

echo Configuring environment...
copy .env.paper .env >nul
echo. Configuration loaded

echo.
echo Starting services with docker compose...
docker compose up --pull always -d

echo.
echo Waiting 30 seconds for services to initialize...
timeout /t 30

echo.
echo ==================================================
echo Service Status
echo ==================================================
docker compose ps

echo.
echo ==================================================
echo Paper Trading Started
echo ==================================================
echo.
echo Access points:
echo   - Trading API:      http://localhost:3003
echo   - Dashboard:        http://localhost:3001
echo   - Open WebUI:       http://localhost:3000
echo   - Database:         postgres://trader@localhost:5432/trading_db
echo.
echo Logs:
echo   - docker compose logs -f
echo.
echo To stop:
echo   docker compose down
echo.
echo Backtest results:
type backtest_simple_result.json | find "summary" -A 10
echo.
