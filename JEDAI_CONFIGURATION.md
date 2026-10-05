# JEDAI Trading Advisor - Production Configuration Guide

## Overview
JedAI (Java Entity Resolution & AI) integration uses trigram-Jaccard similarity matching to compare live trading signals against historical win/loss records. This advisor provides confidence adjustments without forcing trades—purely advisory within the consensus gate.

---

## JEDAI Configuration (Environment Variables)

### `JEDAI_SIMILARITY_THRESHOLD` (default: 0.65)
- **Range:** 0.0–1.0
- **Meaning:** Minimum trigram-Jaccard similarity to trigger a match lookup
- **Lower (0.5):** More matches, higher false positives, more confidence nudges (risky)
- **Higher (0.75):** Fewer matches, higher confidence in results (conservative)
- **Recommendation for consistent small wins:** **0.70**

### `JEDAI_MAX_PENALTY` (default: 0.15)
- **Range:** 0.0–0.5
- **Meaning:** Maximum confidence reduction applied when a match is found against a **past LOSS**
- **Example:** If match to past loss is 90% similar, penalty = min(0.15, 0.20 × 0.90) = 0.15
- **Conservative (0.10):** Smaller confidence hits, more trades allowed (risky)
- **Aggressive (0.20+):** Hard veto on similar setups that previously lost
- **Recommendation for consistent small wins:** **0.12**

### `JEDAI_MAX_BOOST` (default: 0.05)
- **Range:** 0.0–0.15
- **Meaning:** Maximum confidence boost applied when a match is found against a **past WIN**
- **Example:** If match to past win is 80% similar, boost = min(0.05, 0.07 × 0.80) = 0.056
- **Conservative (0.03):** Minimal confidence reward from past wins
- **Aggressive (0.10+):** Strong confidence boost to replay winning patterns
- **Recommendation for consistent small wins:** **0.05** (keep conservative; rely on consensus, not pattern repetition)

---

## Strategy: Consistent Small Wins (Risk Management)

### Goal
Capture **reliable 2–5% cumulative returns** via frequent small-stake trades with high win rates, rather than large position sizing.

### Configuration for This Strategy

```bash
# .env file
JEDAI_SIMILARITY_THRESHOLD=0.70
JEDAI_MAX_PENALTY=0.12
JEDAI_MAX_BOOST=0.05

# Keep confidence floor high; require strong consensus
MIN_CONFIDENCE=0.75

# Smaller position sizing, higher frequency
POSITION_SIZE=0.01  # 1% per trade
STOP_LOSS_PCT=0.02  # 2% hard stop
TAKE_PROFIT_PCT=0.04  # 4% profit target

# Time frames: multiple small cycles per day
BACKTEST_VWAP_ENABLED=true
BACKTEST_RSI_ENABLED=true
BACKTEST_ORDER_BOOK_ENABLED=true

# Avoid large drawdowns; stop after 3 consecutive losses
MAX_CONSECUTIVE_LOSSES=3
```

### How It Works

1. **Live Signal** (e.g., VWAP + RSI BUY on 15m timeframe)
   - Consensus.js evaluates: price action, volume, BTC correlation, sentiment, etc.
   - If consensus ≥ MIN_CONFIDENCE (0.75), proposal advances.

2. **JEDAI Advisor Steps In**
   - Compares live signal against all historical BUY/SELL records for that symbol.
   - If closest match is 70%+ similar:
     - **Match to past WIN?** → Boost confidence +0.03 to +0.05
     - **Match to past LOSS?** → Reduce confidence by 0.08 to 0.12
   - Adjusted confidence used for position sizing (never forces/vetoes).

3. **Risk Gate (riskGate.js)**
   - Final gate: adjusted confidence must still clear MIN_CONFIDENCE.
   - Position size scales with adjusted confidence.
   - Order placed with 2% stop-loss, 4% take-profit.

4. **Outcome Logged**
   - Win → added to `data/won_trades_memory.json` (future boost source)
   - Loss → added to `data/lost_trades_memory.json` (future penalty source)
   - JEDAI learns: next time a similar setup appears, it's slightly downweighted.

---

## Recommended Docker Environment

```yaml
# docker-compose.yml trading-api service
trading-api:
  environment:
    - JEDAI_SIMILARITY_THRESHOLD=0.70
    - JEDAI_MAX_PENALTY=0.12
    - JEDAI_MAX_BOOST=0.05
    - MIN_CONFIDENCE=0.75
    - REDIS_URL=redis://redis:6379/0
  deploy:
    resources:
      limits:
        memory: 2G
```

**Why Docker?**
- **Consistent Environment:** No local Python version conflicts.
- **Redis Caching:** JEDAI similarity matches cached for 1-hour TTL, reducing re-computation.
- **Data Persistence:** Volumes preserve trade memory across restarts.
- **Scaling:** Easy to run multiple strategy variants in parallel containers.

---

## Monitoring & Tuning

### Metrics to Track (Daily)
- **Win Rate:** % of trades closed at take-profit vs. stop-loss
- **Avg Win Size:** Average $ per winning trade
- **Avg Loss Size:** Average $ per losing trade  
- **JEDAI Match Rate:** % of signals that had a historical match
  - Too high (>50%) → Threshold is too low; increase to 0.75+
  - Too low (<10%) → Few historical patterns; rebuild memory
- **Confidence Distribution:** Histogram of final confidence scores
  - Skewed left → Too many penalties; reduce MAX_PENALTY to 0.08
  - Skewed right → Not enough challenge; increase MIN_CONFIDENCE to 0.80

### Backtest Before Production
```bash
# backtester/backtest_mtf.py
python backtest_mtf.py \
  --symbol BTC/USDT \
  --timeframe 15m \
  --start 2026-01-01 \
  --end 2026-09-26 \
  --initial_balance 1000 \
  --position_size 0.01 \
  --enable_vwap \
  --enable_rsi \
  --enable_order_book
```

**Expected backtest results for small-wins strategy:**
- Win rate: 55–65%
- Max drawdown: <10%
- Profit factor: 1.5–2.0

---

## Multi-Timeframe Integration

JEDAI advisor runs on the **consensus cycle's primary timeframe** (default: 15m). For multi-timeframe setups:

```
Timeframes:  5m (fast), 15m (primary), 1h (trend filter)
Advisors:    All feed into 15m consensus
JEDAI:       Compares 15m signal only (not aggregated 5m+1h)
Trades:      Executed only if 15m + 1h agree
```

**Reason:** JEDAI's memory database is indexed by symbol + side, not timeframe. A BUY on 15m VWAP is more predictive of another 15m BUY than a 1h BUY. Filtering by higher-timeframe trend separately is safer.

---

## Oanda / MT5 / Spread Betting Integration

JedAI scores are **broker-agnostic**. To route JEDAI-scored signals to Oanda (or MT5, spread betting):

1. **Adapter in consensus.js:**
   ```javascript
   const jedaiScore = evaluateSimilarity(symbol, signal, marketData, btcBenchmark);
   if (shouldRoute === 'OANDA') {
     const order = formatForOanda({
       symbol, signal, confidence: jedaiScore.adjustedConfidence,
       stopLoss, takeProfit
     });
     await oandaClient.order(order);
   }
   ```

2. **No retry on network fail; fail open:** If Oanda API is down, veto the trade. Do not chain trades.

---

## Summary

| Setting | Value | Reason |
|---------|-------|--------|
| JEDAI_SIMILARITY_THRESHOLD | 0.70 | Mid-conservative: avoid noise, not too few matches |
| JEDAI_MAX_PENALTY | 0.12 | Moderate penalty on past losses; don't over-penalize |
| JEDAI_MAX_BOOST | 0.05 | Small boost on past wins; avoid overconfidence |
| MIN_CONFIDENCE | 0.75 | High floor; strong consensus required |
| POSITION_SIZE | 1% | Small stakes, frequent wins > big wins rarely |
| STOP_LOSS | 2% | Hard stop; limit damage on bad setups |
| TAKE_PROFIT | 4% | Close winners quickly; compound small gains |
| Backtest | ✓ | Always backtest before going live |

---

**Next Steps:**
1. Set environment variables in `.env`
2. Run backtest on 1–3 months of historical data
3. Deploy to Docker
4. Trade with paper (simulated) mode first
5. Monitor daily: win rate, match rate, confidence distribution
6. Adjust thresholds monthly based on observed outcomes

