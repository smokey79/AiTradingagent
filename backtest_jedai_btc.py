#!/usr/bin/env python3
"""
backtest_jedai_btc.py
=====================
3-month BTC/USDT 15m backtest with JEDAI similarity matching.
Tests the optimized "consistent small wins" strategy.

Strategy:
  - VWAP + RSI (15m timeframe)
  - Stop Loss: 2% hard stop
  - Take Profit: 4% profit target
  - Position Size: 1% of balance per trade
  - JEDAI Advisor: ±0.12 confidence adjustment
  - Min Confidence Floor: 0.75 (before JEDAI adjustment)

Output: Performance metrics, trade log, drawdown analysis.
"""
import json
import os
from datetime import datetime, timedelta
import sys

import numpy as np
import pandas as pd

# ---- Configuration ----
INITIAL_BALANCE = 1000.0
POSITION_SIZE_PCT = 0.01  # 1% per trade
STOP_LOSS_PCT = 0.02      # 2%
TAKE_PROFIT_PCT = 0.04    # 4%
ROUND_TRIP_COST_PCT = 0.002  # 0.2% per trade (entry + exit)

# JEDAI thresholds
JEDAI_SIMILARITY_THRESHOLD = 0.70
JEDAI_MAX_PENALTY = 0.12
JEDAI_MAX_BOOST = 0.05
MIN_CONFIDENCE = 0.75

# Data file
DATA_FILE = "data/ohlcv/pyb_bybit_BTC_15m.csv"
TRADES_MEMORY_FILE = "data/won_trades_memory.json"
LOSS_MEMORY_FILE = "data/lost_trades_memory.json"

# ---- Indicators ----
def ema(values, length):
    """Exponential Moving Average"""
    k = 2.0 / (length + 1)
    result = np.empty_like(values, dtype=float)
    result[0] = values[0]
    for i in range(1, len(values)):
        result[i] = values[i] * k + result[i - 1] * (1 - k)
    return result

def sma(values, length):
    """Simple Moving Average"""
    result = np.empty_like(values, dtype=float)
    for i in range(len(values)):
        if i < length:
            result[i] = np.mean(values[:i+1])
        else:
            result[i] = np.mean(values[i-length+1:i+1])
    return result

def rsi(values, length=14):
    """Relative Strength Index"""
    delta = np.diff(values, prepend=values[0])
    gain = np.where(delta > 0, delta, 0)
    loss = np.where(delta < 0, -delta, 0)
    
    avg_gain = ema(gain, length)
    avg_loss = ema(loss, length)
    
    rs = np.divide(avg_gain, avg_loss, where=avg_loss!=0, out=np.zeros_like(avg_loss))
    result = 100.0 - (100.0 / (1.0 + rs))
    return result

def vwap(high, low, close, volume):
    """Volume Weighted Average Price"""
    tp = (high + low + close) / 3.0
    cumvol = np.cumsum(volume)
    cumtp_vol = np.cumsum(tp * volume)
    result = cumtp_vol / cumvol
    return result

def summarize_record(symbol, side, rsi_val, vwap_val, price):
    """JEDAI trigram summary of a trade record"""
    dist_vwap_pct = ((price - vwap_val) / vwap_val * 100) if vwap_val > 0 else 0
    return (f"symbol={symbol} | side={side} | rsi={int(rsi_val)} | "
            f"dist_vwap={dist_vwap_pct:.1f} | vol_ratio=1.0")

def trigrams(text):
    """Extract trigrams for Jaccard similarity"""
    t = str(text).lower().replace(" ", "").strip()
    grams = set()
    for i in range(len(t) - 2):
        grams.add(t[i:i+3])
    return grams

def jaccard(a, b):
    """Jaccard similarity between two sets of trigrams"""
    if len(a) == 0 and len(b) == 0:
        return 0
    intersection = len(a & b)
    union = len(a | b)
    return intersection / union if union > 0 else 0

def load_memory(filepath):
    """Load historical trade memory"""
    if not os.path.exists(filepath):
        return []
    with open(filepath) as f:
        try:
            return json.load(f)
        except:
            return []

def evaluate_jedai_similarity(symbol, side, rsi_val, vwap_val, price):
    """
    Evaluate JEDAI confidence adjustment.
    Returns (adjustment, match_info) where adjustment is in [-0.12, +0.05]
    """
    wins = load_memory(TRADES_MEMORY_FILE)
    losses = load_memory(LOSS_MEMORY_FILE)
    
    live_summary = summarize_record(symbol, side, rsi_val, vwap_val, price)
    live_grams = trigrams(live_summary)
    
    best_match = None
    best_sim = 0
    
    # Check losses
    for loss in losses:
        loss_summary = summarize_record(
            loss.get("symbol", symbol),
            loss.get("side", side),
            loss.get("rsi", rsi_val),
            loss.get("vwap", vwap_val),
            loss.get("entry_price", price)
        )
        loss_grams = trigrams(loss_summary)
        sim = jaccard(live_grams, loss_grams)
        
        if sim >= JEDAI_SIMILARITY_THRESHOLD and sim > best_sim:
            best_sim = sim
            best_match = ("LOSS", sim)
    
    # Check wins
    for win in wins:
        win_summary = summarize_record(
            win.get("symbol", symbol),
            win.get("side", side),
            win.get("rsi", rsi_val),
            win.get("vwap", vwap_val),
            win.get("entry_price", price)
        )
        win_grams = trigrams(win_summary)
        sim = jaccard(live_grams, win_grams)
        
        if sim >= JEDAI_SIMILARITY_THRESHOLD and sim > best_sim:
            best_sim = sim
            best_match = ("WIN", sim)
    
    if not best_match:
        return 0, None
    
    outcome, sim = best_match
    if outcome == "LOSS":
        adjustment = -min(JEDAI_MAX_PENALTY, 0.20 * sim)
    else:
        adjustment = min(JEDAI_MAX_BOOST, 0.07 * sim)
    
    return round(adjustment, 3), best_match

def run_backtest():
    """Run the backtest"""
    # Load data
    if not os.path.exists(DATA_FILE):
        print(f"ERROR: {DATA_FILE} not found")
        sys.exit(1)
    
    df = pd.read_csv(DATA_FILE)
    df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms', utc=True)
    df = df.sort_values('timestamp').reset_index(drop=True)
    
    print(f"Loaded {len(df)} candles from {df['timestamp'].min()} to {df['timestamp'].max()}")
    
    # Extract OHLCV
    high = df['high'].values
    low = df['low'].values
    close = df['close'].values
    volume = df['volume'].values
    
    # Calculate indicators
    print("Calculating indicators...")
    rsi_vals = rsi(close, length=14)
    vwap_vals = vwap(high, low, close, volume)
    ema20_vals = ema(close, length=20)
    
    # Backtest loop
    print("\nRunning backtest...")
    balance = INITIAL_BALANCE
    position = None  # {entry_price, entry_idx, side, qty, entry_rsi, entry_vwap}
    trades = []
    wins = 0
    losses = 0
    max_balance = balance
    max_drawdown = 0
    
    for i in range(100, len(df)):  # Start after indicator warmup
        price = close[i]
        rsi_val = rsi_vals[i]
        vwap_val = vwap_vals[i]
        ema20_val = ema20_vals[i]
        
        # Generate signal (simple: RSI + price relative to EMA20)
        signal = None
        if rsi_val < 30 and price < ema20_val:
            signal = "BUY"
        elif rsi_val > 70 and price > ema20_val:
            signal = "SELL"
        
        # No position: consider entry
        if position is None and signal:
            # Base confidence (simple: high RSI extremity = high confidence)
            if signal == "BUY":
                base_conf = (30.0 - rsi_val) / 30.0  # Range [0, 1]
            else:
                base_conf = (rsi_val - 70.0) / 30.0
            
            # Apply JEDAI adjustment
            jedai_adj, match_info = evaluate_jedai_similarity(
                "BTC/USDT", signal, rsi_val, vwap_val, price
            )
            final_conf = base_conf + jedai_adj
            
            # Check confidence floor
            if final_conf >= MIN_CONFIDENCE:
                qty = (balance * POSITION_SIZE_PCT) / price
                position = {
                    'entry_price': price,
                    'entry_idx': i,
                    'side': signal,
                    'qty': qty,
                    'entry_rsi': rsi_val,
                    'entry_vwap': vwap_val,
                    'base_conf': round(base_conf, 3),
                    'jedai_adj': jedai_adj,
                    'final_conf': round(final_conf, 3),
                    'match_info': match_info
                }
        
        # Position open: check exit conditions
        elif position:
            if position['side'] == "BUY":
                pnl_pct = (price - position['entry_price']) / position['entry_price']
            else:
                pnl_pct = (position['entry_price'] - price) / position['entry_price']
            
            # Take profit or stop loss
            exit_reason = None
            if pnl_pct >= TAKE_PROFIT_PCT:
                exit_reason = "TP"
            elif pnl_pct <= -STOP_LOSS_PCT:
                exit_reason = "SL"
            
            if exit_reason:
                # Apply costs
                cost = position['qty'] * price * ROUND_TRIP_COST_PCT
                pnl = (position['qty'] * pnl_pct * position['entry_price']) - cost
                new_balance = balance + pnl
                
                trade = {
                    'entry_idx': position['entry_idx'],
                    'entry_price': position['entry_price'],
                    'entry_rsi': position['entry_rsi'],
                    'entry_vwap': position['entry_vwap'],
                    'exit_idx': i,
                    'exit_price': price,
                    'side': position['side'],
                    'qty': position['qty'],
                    'pnl': round(pnl, 2),
                    'pnl_pct': round(pnl_pct * 100, 2),
                    'exit_reason': exit_reason,
                    'base_conf': position['base_conf'],
                    'jedai_adj': position['jedai_adj'],
                    'final_conf': position['final_conf'],
                    'match_info': str(position['match_info'])
                }
                trades.append(trade)
                
                if pnl > 0:
                    wins += 1
                else:
                    losses += 1
                
                balance = new_balance
                if balance > max_balance:
                    max_balance = balance
                else:
                    dd = (max_balance - balance) / max_balance
                    if dd > max_drawdown:
                        max_drawdown = dd
                
                position = None
    
    # Summary
    print("\n" + "="*70)
    print("BACKTEST RESULTS: BTC/USDT 15m (3 months)")
    print("="*70)
    print(f"Initial Balance:        ${INITIAL_BALANCE:.2f}")
    print(f"Final Balance:          ${balance:.2f}")
    print(f"Net Profit/Loss:        ${balance - INITIAL_BALANCE:.2f}")
    print(f"Return:                 {((balance - INITIAL_BALANCE) / INITIAL_BALANCE) * 100:.2f}%")
    print(f"\nMax Balance:            ${max_balance:.2f}")
    print(f"Max Drawdown:           {max_drawdown * 100:.2f}%")
    print(f"\nTotal Trades:           {len(trades)}")
    print(f"Winning Trades:         {wins}")
    print(f"Losing Trades:          {losses}")
    print(f"Win Rate:               {(wins / len(trades) * 100):.1f}%" if trades else "N/A")
    
    if wins > 0:
        avg_win = np.mean([t['pnl'] for t in trades if t['pnl'] > 0])
        print(f"Avg Win:                ${avg_win:.2f}")
    
    if losses > 0:
        avg_loss = np.mean([t['pnl'] for t in trades if t['pnl'] < 0])
        print(f"Avg Loss:               ${avg_loss:.2f}")
    
    # JEDAI match rate
    jedai_matches = sum(1 for t in trades if t['match_info'] != 'None')
    print(f"\nJEDAI Match Rate:       {(jedai_matches / len(trades) * 100):.1f}%" if trades else "N/A")
    
    # Confidence distribution
    confs = [t['final_conf'] for t in trades]
    if confs:
        print(f"Avg Final Confidence:   {np.mean(confs):.3f}")
        print(f"Min/Max Confidence:     {np.min(confs):.3f} / {np.max(confs):.3f}")
    
    # Save trade log
    with open("backtest_trades_log.json", "w") as f:
        json.dump(trades, f, indent=2)
    print(f"\nTrade log saved to: backtest_trades_log.json")
    
    # Save summary
    summary = {
        'backtest_date': datetime.now().isoformat(),
        'symbol': 'BTC/USDT',
        'timeframe': '15m',
        'period': f"{df['timestamp'].min()} to {df['timestamp'].max()}",
        'initial_balance': INITIAL_BALANCE,
        'final_balance': float(balance),
        'return_pct': float(((balance - INITIAL_BALANCE) / INITIAL_BALANCE) * 100),
        'total_trades': len(trades),
        'win_rate': float((wins / len(trades) * 100)) if trades else 0,
        'max_drawdown_pct': float(max_drawdown * 100),
        'jedai_match_rate': float((jedai_matches / len(trades) * 100)) if trades else 0
    }
    with open("backtest_summary.json", "w") as f:
        json.dump(summary, f, indent=2)
    print("Summary saved to: backtest_summary.json")
    
    return summary

if __name__ == "__main__":
    run_backtest()
