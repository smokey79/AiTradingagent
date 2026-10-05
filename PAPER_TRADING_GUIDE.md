# Paper Trading Guide – JEDAI Trading Agent
## Ready to deploy and test live signals

---

## Quick Start

### Windows
```powershell
# Navigate to project root
cd F:\aitradingagent

# Launch paper trading
.\paper-trading-launch.bat
```

### Linux/macOS
```bash
cd /path/to/aitradingagent
bash paper-trading-launch.sh
```

---

## What Happens Next

1. **Docker services start:**
   - `trading-api` (port 3003) — Live signal generation + paper trading engine
   - `postgres` (port 5432) — Trade history & ledger
   - `redis` (port 6379) — JEDAI match cache, session storage
   - `ollama` (port 11434) — Local LLM support (optional)
   - `open-webui` (port 3000) — Web interface for model queries

2. **Agent begins monitoring BTC/USDT, ETH/USDT, SOL/USDT** on 1h timeframe (configurable)

3. **Signals flow through consensus:**
   - EMA trend (20/50 crossover)
   - RSI confirmation (0-30 oversold, 70-100 overbought)
   - Volume check
   - **JEDAI advisor** applies ±0.12 confidence adjustment based on historical similarity
   - Risk gate: only trades ≥ 0.75 final confidence

4. **Each trade is logged with:**
   - Entry/exit price
   - P&L (paper account only—no real money)
   - JEDAI match (if any)
   - Confidence score
   - All metadata in PostgreSQL

---

## Access Points

| Service | URL | Purpose |
|---------|-----|---------|
| **Trading API** | http://localhost:3003/api/status | Check if agent is running |
| **Dashboard** | http://localhost:3001 | View trades, P&L, confidence distribution |
| **Web UI** | http://localhost:3000 | Query models, chat with agent |
| **Database** | `psql -h localhost -U trader trading_db` | Direct SQL access |

---

## Monitoring

### Real-time logs (all services)
```bash
docker compose logs -f
```

### Trading API only
```bash
docker compose logs -f trading-api
```

### Check active containers
```bash
docker compose ps
```

### Get current balance & trade count
```bash
curl http://localhost:3003/api/status
```

---

## Expected Behavior (Paper Trading)

### Example Signal Flow

**14:00 UTC: BTC RSI crosses above 30 (from oversold)**
- Base confidence: 0.70 (EMA crossover reliable)
- JEDAI check: "Compares current RSI + EMA setup against historical wins/losses"
  - If matches past WIN 85% similar → +0.05 boost
  - If matches past LOSS 90% similar → -0.12 penalty
- Final confidence = 0.70 + adjustment
- Result: 
  - ≥ 0.75 → BUY 0.01% of balance (~$0.10 on $1000)
  - < 0.75 → VETO, no trade

**14:40 UTC: Price hits +4% take-profit**
- P&L recorded: +$0.40 (or ±fees)
- Trade added to `won_trades_memory.json` (future JEDAI boost source)
- Confidence score logged for monthly review

### Why Small Position Sizes?

- **1% per trade** = $10 on $1000
- **2% stop-loss** = max $0.20 loss per trade
- **4% take-profit** = max $0.40 gain per trade
- Expected ~200-300 trades/month → $20-60 P&L (if 55% win rate) → 2-6% monthly return
- **Zero risk of ruin** if win rate drops to 50% (break-even at 33% WR with 2:1 RR)

---

## First 24 Hours: What to Look For

### Ideal Signals
✓ 3-8 trades executed (not too many, not too few)
✓ Win rate 40-60% (30%+ is profitable with 2:1 RR)
✓ JEDAI match rate 20-40% (not everyone has historical data yet)
✓ Confidence score distribution centered 0.75-0.85
✓ Max drawdown <5%

### Red Flags
✗ Zero trades → signal generation broken or thresholds too high
✗ >20 trades/day → over-trading, lower confidence floor
✗ Win rate <25% → strategy needs tuning
✗ Drawdown >10% → risk management issue

### If Something's Wrong
```bash
# View full error logs
docker compose logs trading-api | tail -100

# Restart a single service
docker compose restart trading-api

# Full reset (clears data)
docker compose down -v
docker compose up --pull always -d
```

---

## Data Generated (Paper Trading)

All trades, metrics, and JEDAI matches stored in PostgreSQL:

```sql
-- Check trades table
SELECT side, COUNT(*) as count, 
  SUM(pnl) as total_pnl, 
  ROUND(CAST(SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100, 1) as win_rate
FROM trades
WHERE paper_trading = true
GROUP BY side;

-- Check JEDAI matches
SELECT match_type, COUNT(*) as matches, ROUND(AVG(confidence_delta), 3) as avg_delta
FROM trade_jedai_matches
GROUP BY match_type;

-- Check daily P&L
SELECT DATE(entry_time), SUM(pnl) as daily_pnl, COUNT(*) as trade_count
FROM trades
GROUP BY DATE(entry_time)
ORDER BY DATE(entry_time) DESC;
```

---

## Next Steps After Paper Trading (1-2 weeks)

### 1. Review Trade Log
- Export `backtest_simple_result.json` + live trades
- Compare backtest vs. live (live often worse due to slippage, gaps)
- Adjust parameters if needed:
  - `MIN_CONFIDENCE` too high? Lower to 0.70
  - Too many losses? Raise `JEDAI_MAX_PENALTY` to 0.15
  - Too conservative? Lower `STOP_LOSS_PCT` to 1.5% (riskier)

### 2. Add Real Brokers
Once confident, connect real API keys:
```bash
# Edit .env
BINANCE_API_KEY=your_key_here
BINANCE_SECRET=your_secret_here
PAPER_TRADING=false
TRADING_MODE=live
```
Start with **very small position sizes** (0.1% = $1 per trade on $1000).

### 3. Add More Symbols
```
TRADING_SYMBOLS=BTC/USDT,ETH/USDT,SOL/USDT,ADA/USDT,AVAX/USDT
```

### 4. Multi-Broker Integration
Route signals to Oanda, MT5, or spread betting accounts by modifying `consensus.js`:
```javascript
if (finalConfidence >= MIN_CONFIDENCE) {
  await routeToBinance(order);
  await routeToOanda(order);    // Same signal, both brokers
  // Spreads risk, increases capital efficiency
}
```

---

## Common Issues & Fixes

### "Connection refused" on localhost:3003
```bash
docker compose logs trading-api | grep -i error
docker compose ps  # Is trading-api running?
```

### Trades not appearing
- Check PostgreSQL connection: `docker compose logs postgres`
- Check API logs: `docker compose logs trading-api`
- Verify `.env` has `PAPER_TRADING=true`

### High memory usage (>2GB)
- Reduce Redis cache: edit `docker-compose.yml`, change `--maxmemory 256mb` to `128mb`
- Disable Open WebUI if not using it: comment out in compose file

### Signals stopped (no trades for 24h)
- Check market is in tradeable condition (high volatility = more signals)
- Lower `MIN_CONFIDENCE` to 0.70 temporarily
- Restart API: `docker compose restart trading-api`

---

## Exiting Paper Trading

```bash
# Stop all containers (data preserved)
docker compose down

# Stop + delete all volumes (reset to clean state)
docker compose down -v

# View trade history before deleting
docker compose exec postgres psql -U trader trading_db -c "SELECT * FROM trades LIMIT 10;"
```

---

## Performance Targets (Monthly)

| Metric | Target | Reality Check |
|--------|--------|---------------|
| **Win Rate** | 50%+ | 40-60% is realistic |
| **Return** | 2-6% | Depends on volatility |
| **Max Drawdown** | <5% | Can spike to 10-15% in ranging markets |
| **Sharpe Ratio** | >1.0 | Means returns exceed volatility |
| **Trades/Month** | 200-300 | More trades = more data for JEDAI learning |

At end of month, run:
```bash
python analyze_monthly_performance.py --month 2026-10
```

---

## Support & Escalation

- **Agent not starting?** → Check Docker: `docker ps`, `docker logs`
- **Trades losing money?** → Markets are hard; review trade log, adjust stops
- **Want to go live?** → Start with 0.1% position size on one symbol for 2 weeks
- **Need to add exchanges?** → Modify `consensus.js` + adapter layer (Oanda, MT5, etc.)

---

**You're ready to paper trade. Launch with confidence.**

```bash
# Run this now:
./paper-trading-launch.bat    # Windows
bash paper-trading-launch.sh  # Linux/macOS
```

**Monitor for 1-2 weeks, then decide: stay paper, go live small, or tune further.**
