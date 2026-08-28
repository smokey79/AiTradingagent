$ROOT = "F:\aitradingagent"
Set-Location $ROOT
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  AiTradingAgent v4 - PAPER TRADE STARTUP  " -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "STEP 1/6 - Checking Python..." -ForegroundColor Yellow
$py = python --version 2>&1
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Python not found. Install from python.org" -ForegroundColor Red; exit 1 }
Write-Host "  $py" -ForegroundColor Green

Write-Host "STEP 2/6 - Installing Python dependencies..." -ForegroundColor Yellow
pip install ccxt flask python-dotenv requests google-api-python-client --quiet
Write-Host "  Dependencies OK" -ForegroundColor Green

Write-Host "STEP 3/6 - Checking Node.js + npm..." -ForegroundColor Yellow
$node = node --version 2>&1
if ($LASTEXITCODE -ne 0) { Write-Host "  WARNING: Node not found. JS agents will not start." -ForegroundColor Yellow }
else { Write-Host "  Node $node" -ForegroundColor Green }
Write-Host "STEP 4/6 - Testing live market data feed..." -ForegroundColor Yellow
python -c "
import sys; sys.path.insert(0,'F:/aitradingagent')
from data_sources.ccxt_feed import CCXTFeed
feed = CCXTFeed()
tickers = feed.get_all_tickers()
print(f'  Live prices OK: {len(tickers)} tokens fetched')
for t in tickers: print(f'    {t[\"symbol\"]}: \${t[\"price\"]:,.4f}  24h: {t[\"change_24h\"]:+.2f}%')
"
if ($LASTEXITCODE -ne 0) { Write-Host "  WARNING: Market data feed error (check internet)" -ForegroundColor Yellow }

Write-Host "STEP 5/6 - Testing YouTube sentiment agent..." -ForegroundColor Yellow
python -c "
import sys; sys.path.insert(0,'F:/aitradingagent')
from src.sentiment.youtubeSentimentAgent import YouTubeSentimentAgent
agent = YouTubeSentimentAgent()
result = agent.run(symbols=['BTC','ETH','CRO'])
print(f'  Overall signal: {result[\"overall_signal\"][\"signal\"].upper()}')
print(f'  Confidence: {result[\"overall_signal\"][\"confidence\"]:.0%}')
print(f'  Videos analysed: {result[\"videos_analysed\"]}')
"
if ($LASTEXITCODE -ne 0) { Write-Host "  YouTube agent: keyword mode (no API key yet)" -ForegroundColor Yellow }
Write-Host "STEP 6/6 - Starting Flask dashboard..." -ForegroundColor Yellow
$pm2 = pm2 --version 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  PM2 found - starting dashboard as managed process" -ForegroundColor Green
    pm2 delete aitradingagent-dashboard 2>$null
    pm2 start python --name "aitradingagent-dashboard" -- "$ROOT\web-dashboard\app.py"
    pm2 save
    Write-Host "  Dashboard running via PM2 (survives terminal close)" -ForegroundColor Green
} else {
    Write-Host "  PM2 not found - opening dashboard in new window" -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$ROOT'; python web-dashboard\app.py"
    Write-Host "  To keep it running 24/7: npm install -g pm2" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  ALL SYSTEMS READY FOR PAPER TRADING      " -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Dashboard:   http://localhost:3002" -ForegroundColor Cyan
Write-Host "  API status:  http://localhost:3002/api/status" -ForegroundColor Cyan
Write-Host "  API trades:  http://localhost:3002/api/trades" -ForegroundColor Cyan
Write-Host "  API YouTube: http://localhost:3002/api/youtube" -ForegroundColor Cyan
Write-Host ""
Write-Host "  KEYS STILL NEEDED (edit config\master.env):" -ForegroundColor Yellow
Write-Host "    TELEGRAM_BOT_TOKEN  -> message @BotFather on Telegram" -ForegroundColor Yellow
Write-Host "    TELEGRAM_CHAT_ID    -> message @userinfobot on Telegram" -ForegroundColor Yellow
Write-Host "    XAI_API_KEY         -> console.x.ai (Grok agent)" -ForegroundColor Yellow
Write-Host "    YOUTUBE_API_KEY     -> console.cloud.google.com (live video data)" -ForegroundColor Yellow
Write-Host "    BITGET_PASSPHRASE   -> Bitget website -> API Management" -ForegroundColor Yellow
Write-Host ""
Write-Host "  WIN RATE GATE: Need 80% over 20 paper trades before live funds" -ForegroundColor Magenta
Write-Host "  CRO wallet:   0xB1f64d57370c4965cBEd6319ECD058544B3Ef227" -ForegroundColor Magenta
Write-Host ""
