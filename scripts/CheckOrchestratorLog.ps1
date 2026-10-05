pm2 logs trading-orchestrator --lines 60 --nostream | Select-String "Allocation settings changed|Could not watch"
