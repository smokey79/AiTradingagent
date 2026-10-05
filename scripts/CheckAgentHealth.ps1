pm2 logs trading-orchestrator --lines 400 --nostream | Select-String "401|unavailable|HOLD @ 50%|No Telegram|invalid key|fallback"
