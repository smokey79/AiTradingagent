#!/usr/bin/env python3
"""
backtest_jedai_btc_1h.py
========================
BTC/USDT 1h backtest with EMA trend-following + JEDAI advisor.
Focus: consistent small wins via trend following, not mean reversion.

Strategy:
  - EMA20/EMA50 crossover (uptrend confirmation)
  - RSI filter (avoid extreme overbought/oversold)
  - Volume confirmation
  - JEDAI advisor: ±confidence adjustment
  - Position size: 1% risk per trade
  - Stop loss: 2%, Take profit: 4%
"""
import json
import os
from datetime import datetime
import sys

import numpy as np
import pandas as pd

INITIAL_BALANCE = 1000.0
POSITION_SIZE_PCT = 0.01
STOP_LOSS_PCT = 0.02
TAKE_PROFIT_PCT = 0.04
ROUND_TRIP_COST_PCT = 0.002

JEDAI_SIMILARITY_THRESHOLD = 0.70
JEDAI_MAX_PENALTY = 0.12
JEDAI_MAX_BOOST = 0.05
MIN_CONFIDENCE = 0.75

DATA_FILE = "data/ohlcv/pyb_bybit_BTC_1h.csv"
TRADES_MEMORY = "data/won_trades_memory.json"
LOSS_MEMORY = "data/lost_trades_memory.json"

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

def summarize_record(symbol, side, rsi_val, ema_cross_pct, vol_ratio):
    """JEDAI trigram summary"""
    return f"sym={symbol}|s={side}|rsi={int(rsi_val)}|emacross={ema_cross_pct:.1f}|vol={vol_ratio:.2f}"

def evaluate_jedai(symbol, side, rsi_val, ema_cross_pct, vol_ratio):
    """Evaluate JEDAI confidence delta"""
    wins = load_memory(TRADES_MEMORY)
    losses = load_memory(LOSS_MEMORY)
    
    live_summary = summarize_record(symbol, side, rsi_val, ema_cross_pct, vol_ratio)
    live_grams = trigrams(live_summary)
    
    best_match = None
    best_sim = 0
    
    for loss in losses:
        loss_summary = summarize_record(
            loss.get('symbol', symbol), loss.get('side', side),
            loss.get('rsi', rsi_val), loss.get('ema_cross_pct', ema_cross_pct),
            loss.get('vol_ratio', vol_ratio)
        )
        sim = jaccard(live_grams, trigrams(loss_summary))
        if sim >= JEDAI_SIMILARITY_THRESHOLD and sim > best_sim:
            best_sim = sim
            best_match = ('LOSS', sim)
    
    for win in wins:
        win_summary = summarize_record(
            win.get('symbol', symbol), win.get('side', side),
            win.get('rsi', rsi_val), win.get('ema_cross_pct', ema_cross_pct),
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
    ema20 = ema(c, 20)
    ema50 = ema(c, 50)
    rsi_vals = rsi(c, 14)
    vol_sma20 = sma(v, 20)
    
    print("Running backtest...")
    balance = INITIAL_BALANCE
    position = None
    trades = []
    wins = losses = 0
    max_balance = balance
    max_drawdown = 0
    
    for i in range(50, len(df)):
        price = c[i]
        ema20_val = ema20[i]
        ema50_val = ema50[i]
        rsi_val = rsi_vals[i]
        vol = v[i]
        vol_sma = vol_sma20[i]
        
        ema_cross_pct = ((ema20_val - ema50_val) / ema50_val * 100) if ema50_val > 0 else 0
        vol_ratio = vol / vol_sma if vol_sma > 0 else 1.0
        
        signal = None
        reason = ""
        
        # EMA crossover + RSI confirmation
        if i > 0:
            prev_cross = (ema20[i-1] - ema50[i-1]) / (ema50[i-1] + 1e-9)
            curr_cross = (ema20_val - ema50_val) / (ema50_val + 1e-9)
            
            # Golden cross (EMA20 crosses above EMA50) + RSI not overbought + volume
            if prev_cross <= 0 and curr_cross > 0 and rsi_val < 70 and vol > vol_sma:
                signal = "BUY"
                reason = "GOLDEN-CROSS"
            # Death cross (EMA20 crosses below EMA50) + RSI not oversold + volume
            elif prev_cross >= 0 and curr_cross < 0 and rsi_val > 30 and vol > vol_sma:
                signal = "SELL"
                reason = "DEATH-CROSS"
        
        # Entry
        if position is None and signal:
            base_conf = 0.7  # EMA crossover is reliable
            if signal == "BUY" and rsi_val < 50:
                base_conf += 0.15
            elif signal == "SELL" and rsi_val > 50:
                base_conf += 0.15
            base_conf = np.clip(base_conf, 0.5, 1.0)
            
            jedai_adj, match = evaluate_jedai("BTC/USDT", signal, rsi_val, ema_cross_pct, vol_ratio)
            final_conf = base_conf + jedai_adj
            
            if final_conf >= MIN_CONFIDENCE:
                qty = (balance * POSITION_SIZE_PCT) / price
                position = {
                    'entry_price': price,
                    'entry_idx': i,
                    'side': signal,
                    'qty': qty,
                    'entry_rsi': rsi_val,
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
    print("BACKTEST RESULTS: BTC/USDT 1h (EMA Crossover + JEDAI)")
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
        
        if wins > 0 and losses > 0:
            profit_factor = sum(t['pnl'] for t in trades if t['pnl'] > 0) / abs(sum(t['pnl'] for t in trades if t['pnl'] < 0))
            print(f"Profit Factor:          {profit_factor:.2f}")
        
        confs = [t['final_conf'] for t in trades]
        print(f"\nAvg Final Confidence:   {np.mean(confs):.3f}")
        print(f"Confidence Range:       {np.min(confs):.3f} - {np.max(confs):.3f}")
    
    # Save
    with open("backtest_trades_1h.json", "w") as f:
        json.dump(trades, f, indent=2)
    
    summary = {
        'backtest_date': datetime.now().isoformat(),
        'symbol': 'BTC/USDT',
        'timeframe': '1h',
        'strategy': 'EMA Crossover + JEDAI Advisor',
        'initial_balance': INITIAL_BALANCE,
        'final_balance': float(balance),
        'return_pct': float(((balance - INITIAL_BALANCE) / INITIAL_BALANCE) * 100),
        'total_trades': len(trades),
        'win_rate': float(wins / len(trades) * 100) if trades else 0,
        'max_drawdown_pct': float(max_drawdown * 100),
        'recommendation': 'PAPER_TRADE' if (balance > INITIAL_BALANCE * 0.98) else 'ADJUST_PARAMETERS'
    }
    with open("backtest_summary_1h.json", "w") as f:
        json.dump(summary, f, indent=2)
    
    print(f"\nTrade log saved: backtest_trades_1h.json")
    print(f"Summary saved:   backtest_summary_1h.json")
    
    return summary

if __name__ == "__main__":
    run_backtest()
