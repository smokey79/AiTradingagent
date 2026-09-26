@echo off
cd /d F:\aitradingagent

:: Check Node
where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js not found - download from https://nodejs.org
  pause & exit /b 1
)

:: Install deps silently if missing
if not exist node_modules (
  echo Installing packages - one moment...
  npm install --silent
)

:: Launch Dashboard
start "AiTradingAgent Dashboard" /min cmd /c "cd /d F:\aitradingagent && node src/dashboard/server.js"
timeout /t 4 /nobreak >nul

:: Launch Telegram Listener
start "Telegram Listener" /min cmd /c "cd /d F:\aitradingagent && node src/notifications/telegramListener.js"
timeout /t 2 /nobreak >nul

:: Open browser
start http://localhost:3001
