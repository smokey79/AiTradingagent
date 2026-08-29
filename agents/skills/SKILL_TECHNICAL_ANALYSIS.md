---
name: technical-analysis
description: Technical Analysis & Smart Money Concepts (SMC) Trading Engine for AiTradingAgent. Combines LuxAlgo Order Blocks, Casper SMC 5-min ORB Retest, 5X Futures Leverage presets, multi-timeframe indicators, and YouTube alpha alignment.
---

# Technical Analysis & Smart Money Concepts (SMC) Skill

## 1. Overview & Core Philosophy
This skill defines the technical analysis framework for **AiTradingAgent**, specializing in high-probability cryptocurrency trading across spot, DEX, and 5X isolated margin perpetual futures.

All technical trade signals MUST clear the **68% Probability Gate** (`TARGET_WIN_RATE_GATE = 0.68`) and adhere to the **£250 / $1000 Capital & Risk Rules**.

---

## 2. Core SMC Patterns & Setups

### A. LuxAlgo Smart Money Concepts (SMC)
1. **Order Blocks (OB)**:
   - Identify institutional accumulation / distribution zones based on the last opposing candle before an aggressive expansion break.
   - Entry triggered only upon price retesting the Order Block with bullish/bearish candle confirmation.
2. **Liquidity Sweeps**:
   - Detect false breakouts below key swing lows or above key swing highs that trap breakout traders before reversing.
   - Confirmed when `low < lowest_low[1]` and `close > lowest_low[1]` on volume $> 1.45\times$ 20-SMA.
3. **Fair Value Gaps (FVG)**:
   - Identify 3-candle price imbalances where candle 1 high does not overlap candle 3 low.
   - Use FVG retests as high-probability confluence zones.
4. **Break of Structure (BoS) & Change of Character (CHoCH)**:
   - Validate trend continuation (BoS) and structural reversal (CHoCH) on 15m and 1h timeframes.

### B. Casper SMC 5-Minute Opening Range Breakout (ORB) Retest
- **Range Definition**: Mark the High and Low of the initial 5-minute candle.
- **Trigger**: Wait for a breakout beyond the range $\rightarrow$ wait for a pullback/retest of the broken boundary $\rightarrow$ enter on re-break in breakout direction.
- **Risk Management**: Stop loss placed at 50% of the 5-minute ORB range; Take profit targeted at $2.0\text{ R}$ minimum.

---

## 3. Indicator Matrix & Technical Filters

| Indicator | Bullish Long Requirement | Bearish Short Requirement | Purpose |
| :--- | :--- | :--- | :--- |
| **Baseline EMA** | Price $> 20\text{-EMA}$ & bullish crossover | Price $< 20\text{-EMA}$ & bearish crossunder | Trend direction filter |
| **Dynamic RSI** | $45 \le \text{RSI} \le 68$ (expansion zone) | $32 \le \text{RSI} \le 55$ (compression zone) | Momentum verification |
| **Money Flow Index (MFI)** | $\text{MFI} > 50$ (institutional inflow) | $\text{MFI} < 50$ (institutional outflow) | Volume-weighted money flow |
| **Volume Multiplier** | Volume $> 1.45\times \text{SMA}_{20}(\text{Volume})$ | Volume $> 1.45\times \text{SMA}_{20}(\text{Volume})$ | Institutional commitment |
| **ATR Trailing Stop** | $1.5\times \text{ATR}_{14}$ trailing below price | $1.5\times \text{ATR}_{14}$ trailing above price | Dynamic volatility exit |

---

## 4. 5.0X Isolated Leverage Futures Presets
- **Leverage Multiplier**: $5.0\text{X}$ Isolated Margin.
- **Liquidation Safety Buffer**: $\ge 17.5\%$ distance from entry price to liquidation threshold.
- **Take-Profit Target**: $+4.0\%$ underlying price move $= +20.0\%$ ROI on margin collateral.
- **Stop-Loss Limit**: $-1.5\%$ underlying price move $= -7.5\%$ max risk on margin collateral.
- **Risk / Reward Ratio**: $1:2.67$ ($+20.0\% / 7.5\%$).

---

## 5. YouTube Alpha & Multi-Channel Alignment
- Cross-reference technical signals with live YouTube transcript sentiment scores from subscribed channels:
  - **LuxAlgo** (`@LuxAlgo`): Confirms SMC order blocks & PineScript presets.
  - **Crypto Banter** (`@CryptoBanterOfficial`): Confirms daily momentum & altcoin inflows.
  - **Coin Bureau** (`@CoinBureau`): Confirms macro cycle alignment.
  - **TradingView Mastery** (`@TradingViewMastery`): Confirms backtest odds.
  - **Glassnode** (`@Glassnode`): Confirms on-chain whale accumulation.
- Signals gain $+0.08$ confidence boost when YouTube sentiment polarity is $\ge +0.50$ (`BULLISH_EXPANSION`).

---

## 6. Output Schema
All technical evaluations MUST return valid JSON:
```json
{
  "agent": "technical_analyst",
  "symbol": "BTC/USDT",
  "signal": "BUY",
  "confidence": 0.85,
  "setup_type": "LuxAlgo SMC Order Block Retest + Casper ORB Retest",
  "timeframe": "15m",
  "indicators": {
    "ema_20_status": "BULLISH_ABOVE",
    "rsi_14": 58.4,
    "mfi_14": 62.1,
    "volume_ratio": 1.68,
    "liquidity_sweep_detected": true
  },
  "futures_5x": {
    "entry_price": 77700.0,
    "take_profit": 80808.0,
    "stop_loss": 76534.5,
    "roi_target_pct": 20.0,
    "liquidation_buffer_pct": 17.5,
    "risk_reward_ratio": 2.67
  },
  "gate_68_met": true,
  "reason": "Bullish liquidity sweep confirmed above 20-EMA with MFI institutional inflow and 76.5% backtested odds."
}
```
