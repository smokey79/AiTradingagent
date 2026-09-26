@echo off
:: ============================================================
:: AiTradingAgent — Telegram Setup Launcher
:: Double-click this file from Windows Explorer
:: Located at: F:\aitradingagent\SETUP-TELEGRAM.bat
:: ============================================================

cd /d F:\aitradingagent

echo.
echo ============================================================
echo   AiTradingAgent — Telegram Session Setup
echo ============================================================
echo.
echo API_ID / API_HASH are read from .env — see TELEGRAM_API_ID / TELEGRAM_API_HASH
echo.
echo This will ask for your Telegram phone number,
echo send you a code, and save your session to .env
echo.
echo Press any key to start...
pause >nul

node src/notifications/setupTelegram.js

echo.
echo ============================================================
echo   Done! Now run START-BOT.bat to launch everything.
echo ============================================================
pause
