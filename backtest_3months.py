#!/usr/bin/env python3
"""
backtest_3months.py
===================
Recent 3-month BTC/USDT 1h backtest with RSI momentum + JEDAI.
Uses only the last 3 months of data (approximately 2160 candles).
"""
import json
import os
from datetime import datetime, timedelta
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

def ema(values, length):
    k = 2.0 / (length + 1)
    result = np.empty_like(values, dtype=float)
    result[0] = values[0]
    for i in range(1, len(values)):
        result[i] = values[i] * k + result[i - 1] * (1 - k)
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

def sma(values, length):
    result = np.empty_like(values, dtype=float)
    for i in range(len(values)):
        if i < length:
            result[i] = np.mean(values[:i+1])
        else:
            result[i] = np.mean(values[i-length+1:i+1])
    return result

def run_backtest():
    if not os.path.exists(DATA_FILE):
        print(f"ERROR: {DATA_FILE} not found")
        sys.exit(1)
    
    df = pd.read_csv(DATA_FILE)
    df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms', utc=True)
    df = df.sort_values('timestamp').reset_index(drop=True)
    
    # Last 3 months (~2160 hours = 90 days)
    df_recent = df.tail(2160).reset_index(drop=True)
    
    print(f"Using recent 3 months: {df_recent['timestamp'].min()} to {df_recent['timestamp'].max()}")
    
    c = df_recent['close'].values
    h = df_recent['high'].values
    l = df_recent['low'].values
    v = df_recent['volume'].values
    
    print("Calculating indicators...")
    rsi_vals = rsi(c, 14)
    ema9 = ema(c, 9)
    ema21 = ema(c, 21)
    vol_sma = sma(v, 20)
    
    print("Running backtest...")
    balance = INITIAL_BALANCE
    position = None
    trades = []
    wins = losses = 0
    max_balance = balance
    max_drawdown = 0
    
    for i in range(30, len(c)):
        price = c[i]
        rsi_val = rsi_vals[i]
        ema9_val = ema9[i]
        ema21_val = ema21[i]
        vol = v[i]
        vol_sma_val = vol_sma[i]
        
        signal = None
        reason = ""
        
        # Simple RSI momentum: oversold RSI rises above 30 (reversal), overbought RSI falls below 70
        if i > 0:
            prev_rsi = rsi_vals[i-1]
            curr_rsi = rsi_vals[i]
            
            # Buy: RSI crosses above 30 (from oversold) + EMA9 > EMA21 (uptrend)
            if prev_rsi <= 30 and curr_rsi > 30 and ema9_val > ema21_val and vol > vol_sma_val:
                signal = "BUY"
                reason = "RSI-OVERSOLD-BOUNCE"
            
            # Sell: RSI crosses below 70 (from overbought) + EMA9 < EMA21 (downtrend)
            elif prev_rsi >= 70 and curr_rsi < 70 and ema9_val < ema21_val and vol > vol_sma_val:
                signal = "SELL"
                reason = "RSI-OVERBOUGHT-DROP"
        
        # Entry
        if position is None and signal:
            # Base confidence: RSI extremity proximity
            if signal == "BUY":
                base_conf = 0.65 + (30.0 - curr_rsi) / 100.0  # Higher if deeper oversold
            else:
                base_conf = 0.65 + (curr_rsi - 70.0) / 100.0
            base_conf = np.clip(base_conf, 0.6, 1.0)
            
            # Simple JEDAI-like adjustment (without memory): no historical data yet
            jedai_adj = 0.0
            
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
                    'jedai_adj': 0.0,
                    'final_conf': round(final_conf, 3),
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
                    'entry_price': round(position['entry_price'], 2),
                    'exit_price': round(price, 2),
                    'side': position['side'],
                    'pnl': round(pnl, 2),
                    'pnl_pct': round(pnl_pct * 100, 2),
                    'exit_reason': exit_reason,
                    'entry_reason': position['entry_reason'],
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
    print("BACKTEST RESULTS: BTC/USDT 1h (Last 3 Months)")
    print("="*70)
    print(f"Period:                 {df_recent['timestamp'].min()} to {df_recent['timestamp'].max()}")
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
            avg_win = np.mean(wins_list)
            print(f"Avg Win:                ${avg_win:.2f}")
        if losses_list:
            avg_loss = np.mean(losses_list)
            print(f"Avg Loss:               ${avg_loss:.2f}")
        
        if wins > 0 and losses > 0:
            total_wins = sum(t['pnl'] for t in trades if t['pnl'] > 0)
            total_losses = abs(sum(t['pnl'] for t in trades if t['pnl'] < 0))
            profit_factor = total_wins / total_losses if total_losses > 0 else 0
            print(f"Profit Factor:          {profit_factor:.2f}")
    
    # Save
    with open("backtest_3months_results.json", "w") as f:
        json.dump(trades, f, indent=2)
    
    summary = {
        'backtest_date': datetime.now().isoformat(),
        'symbol': 'BTC/USDT',
        'timeframe': '1h',
        'strategy': 'RSI Momentum (Oversold/Overbought Bounces)',
        'period_start': str(df_recent['timestamp'].min()),
        'period_end': str(df_recent['timestamp'].max()),
        'candles_tested': len(c),
        'initial_balance': INITIAL_BALANCE,
        'final_balance': float(balance),
        'return_pct': float(((balance - INITIAL_BALANCE) / INITIAL_BALANCE) * 100),
        'total_trades': len(trades),
        'win_rate': float(wins / len(trades) * 100) if trades else 0,
        'max_drawdown_pct': float(max_drawdown * 100),
        'avg_win': float(np.mean(wins_list)) if wins_list else 0,
        'avg_loss': float(np.mean(losses_list)) if losses_list else 0,
        'status': 'READY_FOR_PAPER_TRADING' if len(trades) > 10 and balance > INITIAL_BALANCE * 0.95 else 'NEEDS_TUNING'
    }
    with open("backtest_3months_summary.json", "w") as f:
        json.dump(summary, f, indent=2)
    
    print(f"\nTrade log saved:   backtest_3months_results.json")
    print(f"Summary saved:     backtest_3months_summary.json")
    
    if summary['status'] == 'READY_FOR_PAPER_TRADING':
        print(f"\n✓ Ready for paper trading! Next: docker compose up --pull always")
    
    return summary

if __name__ == "__main__":
    run_backtest()
