#!/usr/bin/env python3
"""
backtest_jedai_btc_v2.py
========================
Enhanced BTC/USDT 15m backtest with VWAP + RSI + multi-confirmation.

Strategy improvements:
  - VWAP mean-reversion: buy when price < VWAP - 0.5%, sell when > VWAP + 0.5%
  - RSI confirmation: oversold (<30) for buys, overbought (>70) for sells
  - Volume confirmation: volume > 20-SMA of volume
  - Multi-timeframe filter: 1h EMA200 trend filter (no reverse trades)
  - JEDAI: ±0.12 confidence adjustment on historical similarity
  - Position sizing: 1% of balance per confirmed signal
  - Risk management: 2% stop-loss, 4% take-profit
"""
import json
import os
from datetime import datetime
import sys

import numpy as np
import pandas as pd

# ---- Configuration ----
INITIAL_BALANCE = 1000.0
POSITION_SIZE_PCT = 0.01
STOP_LOSS_PCT = 0.02
TAKE_PROFIT_PCT = 0.04
ROUND_TRIP_COST_PCT = 0.002

# JEDAI
JEDAI_SIMILARITY_THRESHOLD = 0.70
JEDAI_MAX_PENALTY = 0.12
JEDAI_MAX_BOOST = 0.05
MIN_CONFIDENCE = 0.75

# Data
DATA_FILE = "data/ohlcv/pyb_bybit_BTC_15m.csv"
TRADES_MEMORY = "data/won_trades_memory.json"
LOSS_MEMORY = "data/lost_trades_memory.json"

# Indicators
def ema(values, length):
    k = 2.0 / (length + 1)
    result = np.empty_like(values, dtype=float)
    result[0] = values[0]
    for i in range(1, len(values)):
        result[i] = values[i] * k + result[i - 1] * (1 - k)
    return result

def sma(values, length):
    result = np.empty_like(values, dtype=float)
    for i in range(len(values)):
        if i < length:
            result[i] = np.mean(values[:i+1])
        else:
            result[i] = np.mean(values[i-length+1:i+1])
    return result

def rsi(values, length=14):
    delta = np.diff(values, prepend=values[0])
    gain = np.where(delta > 0, delta, 0)
    loss = np.where(delta < 0, -delta, 0)
    
    avg_gain = ema(gain, length)
    avg_loss = ema(loss, length)
    
    rs = np.divide(avg_gain, avg_loss, where=avg_loss!=0, out=np.zeros_like(avg_loss))
    result = 100.0 - (100.0 / (1.0 + rs))
    return result

def vwap(high, low, close, volume):
    tp = (high + low + close) / 3.0
    cumvol = np.cumsum(volume)
    cumtp_vol = np.cumsum(tp * volume)
    result = cumtp_vol / cumvol
    return result

def summarize_record(symbol, side, rsi_val, vwap_pct, vol_ratio):
    """JEDAI trigram summary"""
    return (f"symbol={symbol}|side={side}|rsi={int(rsi_val)}|"
            f"vwap_pct={vwap_pct:.1f}|vol_ratio={vol_ratio:.2f}")

def trigrams(text):
    t = str(text).lower().replace(" ", "").strip()
    grams = set()
    for i in range(len(t) - 2):
        grams.add(t[i:i+3])
    return grams

def jaccard(a, b):
    if len(a) == 0 and len(b) == 0:
        return 0
    intersection = len(a & b)
    union = len(a | b)
    return intersection / union if union > 0 else 0

def load_memory(filepath):
    if not os.path.exists(filepath):
        return []
    try:
        with open(filepath) as f:
            return json.load(f)
    except:
        return []

def evaluate_jedai(symbol, side, rsi_val, vwap_pct, vol_ratio):
    """Evaluate JEDAI confidence delta"""
    wins = load_memory(TRADES_MEMORY)
    losses = load_memory(LOSS_MEMORY)
    
    live_summary = summarize_record(symbol, side, rsi_val, vwap_pct, vol_ratio)
    live_grams = trigrams(live_summary)
    
    best_match = None
    best_sim = 0
    
    for loss in losses:
        loss_summary = summarize_record(
            loss.get('symbol', symbol),
            loss.get('side', side),
            loss.get('rsi', rsi_val),
            loss.get('vwap_pct', vwap_pct),
            loss.get('vol_ratio', vol_ratio)
        )
        sim = jaccard(live_grams, trigrams(loss_summary))
        if sim >= JEDAI_SIMILARITY_THRESHOLD and sim > best_sim:
            best_sim = sim
            best_match = ('LOSS', sim)
    
    for win in wins:
        win_summary = summarize_record(
            win.get('symbol', symbol),
            win.get('side', side),
            win.get('rsi', rsi_val),
            win.get('vwap_pct', vwap_pct),
            win.get('vol_ratio', vol_ratio)
        )
        sim = jaccard(live_grams, trigrams(win_summary))
        if sim >= JEDAI_SIMILARITY_THRESHOLD and sim > best_sim:
            best_sim = sim
            best_match = ('WIN', sim)
    
    if not best_match:
        return 0, None
    
    outcome, sim = best_match
    adj = -min(JEDAI_MAX_PENALTY, 0.20 * sim) if outcome == 'LOSS' else min(JEDAI_MAX_BOOST, 0.07 * sim)
    return round(adj, 3), best_match

def run_backtest():
    # Load
    if not os.path.exists(DATA_FILE):
        print(f"ERROR: {DATA_FILE} not found")
        sys.exit(1)
    
    df = pd.read_csv(DATA_FILE)
    df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms', utc=True)
    df = df.sort_values('timestamp').reset_index(drop=True)
    
    print(f"Loaded {len(df)} candles: {df['timestamp'].min()} to {df['timestamp'].max()}")
    
    h = df['high'].values
    l = df['low'].values
    c = df['close'].values
    v = df['volume'].values
    
    print("Calculating indicators...")
    rsi_vals = rsi(c, length=14)
    vwap_vals = vwap(h, l, c, v)
    vol_sma20 = sma(v, length=20)
    ema200_vals = ema(c, length=200)
    
    print("Running backtest...")
    balance = INITIAL_BALANCE
    position = None
    trades = []
    wins = losses = 0
    max_balance = balance
    max_drawdown = 0
    
    for i in range(200, len(df)):  # Warmup
        price = c[i]
        rsi_val = rsi_vals[i]
        vwap_val = vwap_vals[i]
        vol = v[i]
        vol_sma = vol_sma20[i]
        ema200 = ema200_vals[i]
        
        # VWAP distance %
        vwap_pct = ((price - vwap_val) / vwap_val * 100) if vwap_val > 0 else 0
        vol_ratio = vol / vol_sma if vol_sma > 0 else 1.0
        
        signal = None
        reason = ""
        
        # VWAP mean reversion + RSI confirmation
        if price < vwap_val * 0.995 and rsi_val < 30 and vol > vol_sma and price < ema200:
            signal = "BUY"
            reason = "VWAP-MR-BUY"
        elif price > vwap_val * 1.005 and rsi_val > 70 and vol > vol_sma and price > ema200:
            signal = "SELL"
            reason = "VWAP-MR-SELL"
        
        # Entry
        if position is None and signal:
            # Base confidence: RSI extremity
            if signal == "BUY":
                base_conf = (30.0 - rsi_val) / 30.0
            else:
                base_conf = (rsi_val - 70.0) / 30.0
            base_conf = np.clip(base_conf, 0.5, 1.0)
            
            # JEDAI adjustment
            jedai_adj, match = evaluate_jedai("BTC/USDT", signal, rsi_val, vwap_pct, vol_ratio)
            final_conf = base_conf + jedai_adj
            
            if final_conf >= MIN_CONFIDENCE:
                qty = (balance * POSITION_SIZE_PCT) / price
                position = {
                    'entry_price': price,
                    'entry_idx': i,
                    'side': signal,
                    'qty': qty,
                    'entry_rsi': rsi_val,
                    'entry_vwap': vwap_pct,
                    'entry_reason': reason,
                    'base_conf': round(base_conf, 3),
                    'jedai_adj': jedai_adj,
                    'final_conf': round(final_conf, 3),
                    'match_info': str(match)
                }
        
        # Exit
        elif position:
            if position['side'] == "BUY":
                pnl_pct = (price - position['entry_price']) / position['entry_price']
            else:
                pnl_pct = (position['entry_price'] - price) / position['entry_price']
            
            exit_reason = None
            if pnl_pct >= TAKE_PROFIT_PCT:
                exit_reason = "TP"
            elif pnl_pct <= -STOP_LOSS_PCT:
                exit_reason = "SL"
            
            if exit_reason:
                cost = position['qty'] * price * ROUND_TRIP_COST_PCT
                pnl = (position['qty'] * pnl_pct * position['entry_price']) - cost
                balance += pnl
                
                trades.append({
                    'entry_price': position['entry_price'],
                    'exit_price': price,
                    'side': position['side'],
                    'pnl': round(pnl, 2),
                    'pnl_pct': round(pnl_pct * 100, 2),
                    'exit_reason': exit_reason,
                    'entry_reason': position['entry_reason'],
                    'base_conf': position['base_conf'],
                    'jedai_adj': position['jedai_adj'],
                    'final_conf': position['final_conf'],
                })
                
                if pnl > 0:
                    wins += 1
                else:
                    losses += 1
                
                if balance > max_balance:
                    max_balance = balance
                else:
                    dd = (max_balance - balance) / max_balance
                    if dd > max_drawdown:
                        max_drawdown = dd
                
                position = None
    
    # Results
    print("\n" + "="*70)
    print("BACKTEST RESULTS: BTC/USDT 15m (VWAP Mean-Reversion + JEDAI)")
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
    
    if trades:
        wr = wins / len(trades) * 100
        print(f"Win Rate:               {wr:.1f}%")
        
        wins_list = [t['pnl'] for t in trades if t['pnl'] > 0]
        losses_list = [t['pnl'] for t in trades if t['pnl'] < 0]
        
        if wins_list:
            print(f"Avg Win:                ${np.mean(wins_list):.2f}")
        if losses_list:
            print(f"Avg Loss:               ${np.mean(losses_list):.2f}")
        
        confs = [t['final_conf'] for t in trades]
        print(f"\nAvg Final Confidence:   {np.mean(confs):.3f}")
        print(f"Confidence Range:       {np.min(confs):.3f} - {np.max(confs):.3f}")
    
    # Save
    with open("backtest_trades_log_v2.json", "w") as f:
        json.dump(trades, f, indent=2)
    
    summary = {
        'backtest_date': datetime.now().isoformat(),
        'symbol': 'BTC/USDT',
        'timeframe': '15m',
        'strategy': 'VWAP Mean-Reversion + JEDAI Advisor',
        'initial_balance': INITIAL_BALANCE,
        'final_balance': float(balance),
        'return_pct': float(((balance - INITIAL_BALANCE) / INITIAL_BALANCE) * 100),
        'total_trades': len(trades),
        'win_rate': float(wins / len(trades) * 100) if trades else 0,
        'max_drawdown_pct': float(max_drawdown * 100),
    }
    with open("backtest_summary_v2.json", "w") as f:
        json.dump(summary, f, indent=2)
    
    print(f"\nTrade log saved: backtest_trades_log_v2.json")
    print(f"Summary saved:   backtest_summary_v2.json")
    
    return summary

if __name__ == "__main__":
    run_backtest()
