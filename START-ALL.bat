@echo off
:: ============================================================
:: AiTradingAgent — Complete Startup
:: F:\aitradingagent\START-ALL.bat
:: ============================================================
cd /d F:\aitradingagent

echo.
echo =====================================================
echo   AiTradingAgent v3 — Full Stack Startup
echo   Telegram: CONFIGURED ^| TradingKit: CONFIGURED
echo =====================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js not found. Download from https://nodejs.org
  pause & exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  npm install
)

echo Starting Dashboard + Orchestrator...
start "AiTradingAgent Dashboard" cmd /k "cd /d F:\aitradingagent && node src/dashboard/server.js"

timeout /t 4 /nobreak >nul

echo Starting Telegram Signal Listener...
start "Telegram Listener" cmd /k "cd /d F:\aitradingagent && node src/notifications/telegramListener.js"

timeout /t 2 /nobreak >nul

echo.
echo =====================================================
echo   Dashboard:  http://localhost:3001
echo   Telegram:   Listening on @intelligent_trading_signals
echo   TradingKit: pk_OUN_iLVFJCGKR5ZEPWH9pQCnUSaUQnHM
echo =====================================================
echo.
echo 18 AI agents now active in consensus pipeline:
echo   Claude, GPT-4, DeepSeek, Gemini, Grok,
echo   SMC, ExpertTrader, StrategyLearner, Hermes,
echo   OpenRouter, Perplexity, DeFi, IntelligentSignals,
echo   Sentiment, ProviderRotator, VolatilityRegime,
echo   TradingKit ^(NEW^), Telegram Channel ^(NEW^)
echo.
start http://localhost:3001
pause
