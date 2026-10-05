# Quick Start: Paper Trading Checklist

## Pre-Launch (5 minutes)

- [ ] Read **OPTIMIZATION_SUMMARY.md** (2 min)
- [ ] Read **JEDAI_CONFIGURATION.md** (3 min)

## Deploy (1 minute)

**Windows:**
```powershell
cd F:\aitradingagent
.\paper-trading-launch.bat
```

**Linux/macOS:**
```bash
cd /path/to/aitradingagent
bash paper-trading-launch.sh
```

## Verify (2 minutes)

```bash
# Check services are running
docker compose ps

# You should see:
# - trading-api (Up)
# - postgres (Up)
# - redis (Up)
# - ollama (Up)
# - open-webui (Up)

# View API status
curl http://localhost:3003/api/status

# View logs
docker compose logs -f trading-api
```

## Day 1: Monitor (5 minutes)

- [ ] Check dashboard: http://localhost:3001
- [ ] Verify trades appear in logs: `docker compose logs -f | grep -i "trade\|signal"`
- [ ] Note win rate after first 5-10 trades

## Day 7: Review (15 minutes)

```bash
# Export trade data
docker compose exec postgres psql -U trader trading_db -c \
  "SELECT side, COUNT(*) as count, ROUND(100.0*SUM(CASE WHEN pnl>0 THEN 1 ELSE 0 END)/COUNT(*),1) as win_rate, ROUND(AVG(pnl),2) as avg_pnl FROM trades GROUP BY side;" > week1_stats.txt

# View results
cat week1_stats.txt
```

Expected:
- 40-70 trades executed
- Win rate 35-50%
- JEDAI match rate 5-15%

## Day 14: Decision (30 minutes)

Read **PAPER_TRADING_GUIDE.md** section "Next Steps After Paper Trading (1-2 weeks)"

Choose one:
1. **Continue Paper Trading** — Need more data
2. **Tune Parameters** — Adjust MIN_CONFIDENCE, JEDAI_MAX_PENALTY, etc.
3. **Go Live Small** — Start with 0.1% position size on $100-1000 account

## Go Live (if choosing option 3)

1. Open broker account (Binance, Bybit, Oanda, etc.)
2. Generate API keys (read-only + trading perms, no withdrawal)
3. Edit `.env`:
   ```
   PAPER_TRADING=false
   TRADING_MODE=live
   BINANCE_API_KEY=your_key
   BINANCE_SECRET=your_secret
   ```
4. Restart service: `docker compose restart trading-api`
5. **Start with 0.1% position size** (1 micro-unit on $10,000)
6. Monitor for errors: `docker compose logs -f`

## Troubleshooting

| Problem | Solution |
|---------|----------|
| No trades after 24h | Lower `MIN_CONFIDENCE=0.70` in `.env` |
| Too many trades | Raise `MIN_CONFIDENCE=0.80` |
| Losing money | Check market is trending; small losses (-6%) normal in ranging markets |
| API connection error | Restart: `docker compose restart trading-api` |
| Database error | Full reset: `docker compose down -v && docker compose up --pull always -d` |
| Memory warning | Reduce Redis: edit docker-compose.yml, change `--maxmemory 512mb` to `256mb` |

## Logs to Monitor

```bash
# Real-time all logs
docker compose logs -f

# Just trading-api
docker compose logs -f trading-api

# Last 100 lines of trading-api
docker compose logs --tail 100 trading-api

# Search for JEDAI matches
docker compose logs trading-api | grep -i "jedai"

# Search for errors
docker compose logs trading-api | grep -i "error\|failed"
```

## Stop / Restart

```bash
# Graceful stop (data preserved)
docker compose down

# Restart
docker compose up -d

# Restart single service
docker compose restart trading-api

# Full reset (clears DB, volumes)
docker compose down -v
docker compose up --pull always -d
```

## Success Metrics (2-week paper trading)

✓ **5+ trades executed** (shows signals generating)  
✓ **Win rate ≥ 30%** (profitable with 2:1 RR)  
✓ **Drawdown < 10%** (reasonable risk control)  
✓ **JEDAI match rate > 0%** (advisor working)  
✓ **No API errors in logs** (stable operation)  

If all ✓, ready to go live with 0.1% position size.

---

## Support

- **API endpoint issues?** `docker compose logs trading-api | grep -i "error"`
- **Database issues?** `docker compose exec postgres psql -U trader trading_db -c "SELECT 1;"`
- **Redis issues?** `docker compose exec redis redis-cli ping` → should return "PONG"
- **Ollama issues?** `curl http://localhost:11434/api/tags` → should list models

---

**You're ready. Deploy now:**

```bash
./paper-trading-launch.bat    # Windows
bash paper-trading-launch.sh  # Linux/macOS
```

**Monitor for 2 weeks, then decide. Good luck!** 🚀
