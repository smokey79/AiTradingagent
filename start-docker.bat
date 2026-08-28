@echo off
REM start-docker.bat - Quick start script for AiTradingAgent Docker (Windows)

setlocal enabledelayedexpansion

set PROJECT_DIR=%~dp0
set DOCKER_DIR=%PROJECT_DIR%docker

echo =========================================
echo 🚀 AiTradingAgent Docker Startup
echo =========================================
echo.

REM Check if .env exists
if not exist "%PROJECT_DIR%.env" (
    echo ⚠️  .env not found. Creating from .env.example...
    copy "%PROJECT_DIR%.env.example" "%PROJECT_DIR%.env"
    echo 📝 Edit .env with your API keys before running!
    echo.
    pause
    exit /b 1
)

REM Check Docker
docker --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker not found. Install Docker Desktop and try again.
    pause
    exit /b 1
)

echo ✅ Pulling latest images...
cd /d "%DOCKER_DIR%"
docker compose --pull always pull

echo.
echo 📦 Building multi-LLM trading agent image...
docker compose build --no-cache

echo.
echo 🔥 Starting services...
docker compose up --detach

echo.
echo =========================================
echo ✨ AiTradingAgent Running!
echo =========================================
echo.
echo 📊 Dashboard:      http://localhost:3002
echo 🛡️  Risk Gate:      http://localhost:3001
echo 📡 Signal Engine:   http://localhost:3003
echo 💼 Portfolio:       http://localhost:3004
echo.
echo View logs:
echo   docker compose logs -f dashboard
echo.
echo Stop all services:
echo   docker compose down
echo.
pause
