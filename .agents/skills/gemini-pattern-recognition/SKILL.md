---
name: gemini-pattern-recognition
description: Gemini AI Pattern Recognition & 50-EMA Quantitative Trading Engine for Cryptocurrency. Detects candlestick patterns, chart formations, dynamic 50-EMA support/resistance, trendline breakouts, and automated risk sizing for 5X futures and spot trading.
---

# Gemini Pattern Recognition & 50-EMA Skill

## 1. Overview & Core Mission
This skill empowers **Gemini** as the primary **Pattern Recognition & Trend Verification Engine** for cryptocurrency trading. It specializes in real-time technical pattern scanning, 50-period Exponential Moving Average (50-EMA) trend verification, dynamic support/resistance bounces, and automated position calculation for BTC, ETH, SOL, high-momentum altcoins, and 5X perpetual futures.

All recognized patterns must clear the **68% Confluence Gate** (`MIN_PATTERN_CONFIDENCE = 0.68`) before execution.

---

## 2. The 50-EMA (Exponential Moving Average) Core Rules

The 50-EMA serves as the institutional trend baseline and dynamic value anchor across 5m, 15m, 1h, and 4h timeframes.

| 50-EMA Condition | Market Bias | Tactical Action | Required Confirmation |
| :--- | :--- | :--- | :--- |
| **Price > 50-EMA (Upward Slope)** | Bullish Trend | Look exclusively for Long / Buy setups on pullbacks | 20-EMA > 50-EMA (Golden Alignment) |
| **50-EMA Dynamic Bounce** | Trend Continuation | Buy when candle wick touches 50-EMA and closes above | Bullish pinbar / hammer / engulfing |
| **Price < 50-EMA (Downward Slope)** | Bearish Trend | Look exclusively for Short / Sell setups on relief rallies | 20-EMA < 50-EMA (Death Alignment) |
| **50-EMA Dynamic Rejection** | Trend Continuation | Sell when candle wick tests 50-EMA from below and rejects | Bearish shooting star / engulfing |
| **Price Compressing Inside 50-EMA** | Range Consolidation | No directional trades; hold capital or scalp range extremes | Volume < 20-SMA volume |

### 50-EMA Golden / Death Cross Protocol
1. **Golden Cross (20-EMA crossing above 50-EMA)**:
   - Signals institutional trend acceleration.
   - Confidence boost: $+0.12$.
   - Entry triggered on the first subsequent retest of the 50-EMA.
2. **Death Cross (20-EMA crossing below 50-EMA)**:
   - Signals institutional distribution.
   - Triggers hard long exit / liquidation protection.

---

## 3. High-Probability Chart & Candlestick Patterns

Gemini scans and categorizes patterns into three distinct setups:

### A. Trend Continuation Patterns
1. **High-Tight Bull Flag**:
   - Aggressive impulse pole ($+3.5\%$ to $+8\%$ price surge).
   - Flag consolidation holding strictly above the 50-EMA with declining volume.
   - Trigger: Candle break and close above the upper flag trendline with volume $> 1.4\times$ 20-SMA.
2. **Fair Value Gap (FVG) 50-EMA Confluence**:
   - 3-candle imbalance zone where the midpoint aligns within $\pm 0.5\%$ of the 50-EMA.
   - Trigger: Price retests the FVG-50EMA sweet spot and prints an aggressive rejection candle.

### B. Structural Reversal Patterns
1. **Double Bottom (W-Formation) + Liquidity Sweep**:
   - Second low dips slightly below the first low to sweep stop-loss orders, then reclaims the 50-EMA.
   - RSI displays bullish divergence (higher low on RSI while price makes lower low).
   - Trigger: Close above the neckline with expanding volume.
2. **Inverse Head & Shoulders**:
   - Left shoulder and head form below 50-EMA; right shoulder retests 50-EMA as new support.
   - Trigger: Breakout above the neckline.

### C. Candlestick Anatomy Confirmation
* **Bullish Pinbar / Hammer at 50-EMA**: Lower shadow $\ge 2\times$ candle body, closing in the top 30% of range.
* **Bullish Engulfing at 50-EMA**: Current candle body completely engulfs prior candle body on $>1.3\times$ volume.

---

## 4. Automated Figures & Sizing ("Automate Figure")

The skill automatically calculates position metrics according to account equity:
* **Distance to 50-EMA**:
  $$\text{distPct} = \frac{\text{Price} - \text{EMA}_{50}}{\text{EMA}_{50}} \times 100$$
* If $|\text{distPct}| > 4.5\%$, the asset is overextended; reduce position sizing by $30\%$ to prevent chasing.
* **Stop Loss**: Set 0.4% below the 50-EMA or $1.5\times \text{ATR}_{14}$ (whichever is closer).
* **Take Profit**: Targeted at $2.2\times$ the stop-loss distance (minimum 1:2.2 Risk/Reward).
* **5X Isolated Leverage Preset**:
  - Max leverage: $5.0\text{X}$.
  - Collateral allocation: $10\%$ of account balance per position.

---

## 5. Output Schema
Gemini pattern recognition must output strictly valid JSON:
```json
{
  "agent": "gemini_pattern_engine",
  "symbol": "BTC/USDT",
  "signal": "BUY",
  "confidence": 0.86,
  "pattern": {
    "name": "Bull Flag 50-EMA Retest",
    "type": "CONTINUATION",
    "timeframe": "15m",
    "quality_score": 92
  },
  "ema_50": {
    "value": 76850.0,
    "price_vs_ema50": "ABOVE",
    "distance_pct": 0.45,
    "slope": "UPWARD",
    "ema20_cross_status": "GOLDEN_ALIGNED"
  },
  "automated_figures": {
    "entry_price": 77200.0,
    "stop_loss": 76465.0,
    "take_profit": 78817.0,
    "risk_reward_ratio": 2.2,
    "recommended_leverage": 5.0,
    "allocation_pct": 10.0
  },
  "validation_result": "PASS",
  "reason": "High-tight bull flag retest bouncing directly off 50-EMA ($76,850) with bullish pinbar confirmation and golden EMA alignment."
}
```
