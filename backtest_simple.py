#!/usr/bin/env python3
"""
backtest_simple.py
===================
Simple, robust BTC 1h backtest: just trend-following with ATR stops.
No edge cases, no complex filters—focus on consistent results.
"""
import json
from datetime import datetime
import sys
import numpy as np
import pandas as pd

INITIAL = 1000.0
RISK_PCT = 0.01
TP_MULTIPLIER = 2.0  # 2:1 reward:risk

DATA_FILE = "data/ohlcv/pyb_bybit_BTC_1h.csv"

def atr(high, low, close, period=14):
    """Average True Range"""
    tr = np.maximum(
        high - low,
        np.maximum(
            np.abs(high - np.roll(close, 1)),
            np.abs(low - np.roll(close, 1))
        )
    )
    atr_vals = np.zeros_like(tr)
    atr_vals[period] = np.mean(tr[1:period+1])
    for i in range(period+1, len(tr)):
        atr_vals[i] = (atr_vals[i-1] * (period - 1) + tr[i]) / period
    return atr_vals

def ema(vals, period):
    k = 2.0 / (period + 1)
    result = np.zeros_like(vals)
    result[0] = vals[0]
    for i in range(1, len(vals)):
        result[i] = vals[i] * k + result[i-1] * (1 - k)
    return result

df = pd.read_csv(DATA_FILE)
df['ts'] = pd.to_datetime(df['timestamp'], unit='ms', utc=True)
df = df.sort_values('ts').reset_index(drop=True)

# Use recent 3 months
df = df.tail(2160).reset_index(drop=True)

print(f"Backtesting {df['ts'].min()} to {df['ts'].max()}")

c = df['close'].values
h = df['high'].values
l = df['low'].values

# Indicators
atr_vals = atr(h, l, c, 14)
ema20 = ema(c, 20)
ema50 = ema(c, 50)

balance = INITIAL
position = None
trades = []

for i in range(50, len(c)):
    price = c[i]
    atr_val = atr_vals[i]
    e20 = ema20[i]
    e50 = ema50[i]
    
    # Entry: price above EMA50, EMA20 > EMA50 (uptrend)
    if position is None and price > e50 and e20 > e50 and i > 0 and c[i-1] <= e50:
        stop_loss = price - (atr_val * 1.5)
        take_profit = price + (atr_val * 1.5 * TP_MULTIPLIER)
        risk = price - stop_loss
        qty = (balance * RISK_PCT) / risk if risk > 0 else 0
        
        if qty > 0:
            position = {
                'entry': price,
                'qty': qty,
                'stop': stop_loss,
                'tp': take_profit,
                'risk': risk,
                'idx': i
            }
    
    # Exit
    elif position:
        pnl = 0
        reason = ""
        
        if price >= position['tp']:
            pnl = position['qty'] * (position['tp'] - position['entry'])
            reason = "TP"
        elif price <= position['stop']:
            pnl = position['qty'] * (position['stop'] - position['entry'])
            reason = "SL"
        
        if pnl != 0:
            # Apply 0.2% round-trip cost
            pnl -= position['qty'] * price * 0.002
            balance += pnl
            
            trades.append({
                'entry': round(position['entry'], 2),
                'exit': round(price, 2),
                'pnl': round(pnl, 2),
                'pnl_pct': round((pnl / (position['qty'] * position['entry'])) * 100, 2),
                'reason': reason
            })
            position = None

# Stats
if trades:
    wins = sum(1 for t in trades if t['pnl'] > 0)
    total_pnl = sum(t['pnl'] for t in trades)
else:
    wins = 0
    total_pnl = 0

print("\n" + "="*60)
print("BACKTEST RESULTS")
print("="*60)
print(f"Initial:       ${INITIAL:.2f}")
print(f"Final:         ${balance:.2f}")
print(f"Return:        {((balance-INITIAL)/INITIAL)*100:.2f}%")
print(f"Trades:        {len(trades)}")
print(f"Wins:          {wins}/{len(trades)}" if trades else "Wins:          0")
print(f"Win Rate:      {(wins/len(trades)*100):.1f}%" if trades else "Win Rate:      0%")
print(f"Total P&L:     ${total_pnl:.2f}")

summary = {
    'date': datetime.now().isoformat(),
    'initial': INITIAL,
    'final': float(balance),
    'return_pct': float(((balance-INITIAL)/INITIAL)*100),
    'trades': len(trades),
    'wins': wins,
    'win_rate': float(wins/len(trades)*100) if trades else 0,
    'status': 'PROFITABLE' if balance > INITIAL else 'LOSS'
}

with open("backtest_simple_result.json", "w") as f:
    json.dump({'summary': summary, 'trades': trades}, f, indent=2)

print(f"\nResults saved to backtest_simple_result.json")
print("\nNext: docker compose up --pull always")
