@echo off
echo.
echo Stopping AiTradingAgent...
echo.
taskkill /F /FI "WINDOWTITLE eq AiTradingAgent Dashboard" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq Telegram Listener" >nul 2>&1
:: Kill any node processes running our scripts
for /f "tokens=1" %%i in ('wmic process where "commandline like '%%dashboard%%server%%' or commandline like '%%telegramListener%%'" get processid 2^>nul ^| findstr /r "[0-9]"') do (
  taskkill /F /PID %%i >nul 2>&1
)
echo Done - AiTradingAgent stopped.
timeout /t 2 /nobreak >nul
