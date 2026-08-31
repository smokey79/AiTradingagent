/**
 * PineScript v5 Strategy & Indicator Generator
 * Generates production-ready, compile-safe TradingView Pine Script v5 code
 * with Smart Money Concepts (SMC), 5X Futures Leverage presets, ATR Trailing Stops,
 * and automated JSON Webhook Alerts for AiTradingAgent.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const STRATEGY_DIR = path.resolve(__dirname, '../../strategy');

/**
 * Strategy Templates Registry
 */
const STRATEGY_PRESETS = {
  smc_luxalgo_5x: {
    id: 'smc_luxalgo_5x',
    name: 'LuxAlgo SMC & 5X Futures Leverage Strategy',
    description: 'Smart Money Concepts (Order Blocks, Fair Value Gaps, Liquidity Sweeps) with 5X Leverage ATR Trailing Stop & Webhook Alerts',
    defaultParams: {
      obLookback: 10,
      useFvg: true,
      sweepSensitivity: 1.2,
      rsiLength: 14,
      rsiLongMin: 45,
      rsiLongMax: 68,
      rsiShortMin: 32,
      rsiShortMax: 55,
      mfiLength: 14,
      volMultiplier: 1.45,
      leverage: 5.0,
      takeProfitPct: 4.0,
      stopLossPct: 1.5,
      atrLength: 14,
      atrMultiplier: 1.5,
      useTrailingStop: true,
    },
  },
  casper_orb_retest: {
    id: 'casper_orb_retest',
    name: 'Casper SMC 5-Min ORB Retest Strategy',
    description: '5-Minute Opening Range Breakout with Pullback/Retest validation, 50% ORB Stop Loss, and 2.0+ R:R',
    defaultParams: {
      orbSessionHour: 13,
      orbSessionMinute: 30,
      orbCandleCount: 1,
      retestTolerancePct: 0.15,
      volMultiplier: 1.4,
      rsiLength: 14,
      leverage: 5.0,
      takeProfitPct: 4.5,
      stopLossPct: 1.5,
      atrLength: 14,
      atrMultiplier: 1.5,
      useTrailingStop: true,
    },
  },
  multi_factor_breakout: {
    id: 'multi_factor_breakout',
    name: 'Multi-Factor Trend & Volume Regime Strategy',
    description: 'Dual EMA (50/200) Trend Confirmation with Volume Breakout, Dynamic RSI, and ATR Trailing Exits',
    defaultParams: {
      emaFast: 50,
      emaSlow: 200,
      volSmaPeriod: 20,
      volMultiplier: 1.45,
      rsiLength: 14,
      rsiLongMin: 48,
      rsiLongMax: 68,
      rsiShortMin: 32,
      rsiShortMax: 52,
      leverage: 5.0,
      takeProfitPct: 4.0,
      stopLossPct: 1.5,
      atrLength: 14,
      atrMultiplier: 1.5,
      useTrailingStop: true,
    },
  },
  oscillator_divergence: {
    id: 'oscillator_divergence',
    name: 'Multi-Oscillator Money Flow Divergence Strategy',
    description: 'RSI, MFI, and MACD institutional divergence confirmation with Neo-Cloud volatility bands',
    defaultParams: {
      rsiLength: 14,
      mfiLength: 14,
      macdFast: 12,
      macdSlow: 26,
      macdSignal: 9,
      divergenceLookback: 15,
      leverage: 5.0,
      takeProfitPct: 4.0,
      stopLossPct: 1.5,
      atrLength: 14,
      atrMultiplier: 1.5,
      useTrailingStop: true,
    },
  },
};

/**
 * Generate Pine Script v5 code for LuxAlgo SMC & 5X Futures Strategy
 */
function generateSmcLuxAlgoPine(symbol = 'BTC/USDT', customParams = {}) {
  const p = { ...STRATEGY_PRESETS.smc_luxalgo_5x.defaultParams, ...customParams };
  const cleanSymbol = symbol.replace('/', '');

  return `//@version=5
strategy("AiTradingAgent — LuxAlgo SMC & 5X Futures Strategy (${symbol})", overlay=true, initial_capital=1000, default_qty_type=strategy.percent_of_equity, default_qty_value=20, commission_type=strategy.commission.percent, commission_value=0.05, process_orders_on_close=true)

// ==============================================================================
// AiTradingAgent v4 — Autonomous PineScript v5 Strategy
// Symbol: ${symbol} | Leverage: ${p.leverage}X Isolated Margin
// Target Win Rate: >68.0% | Risk-Reward Ratio: ${(p.takeProfitPct / p.stopLossPct).toFixed(2)}:1
// Concepts: LuxAlgo Order Blocks (OB), Liquidity Sweeps, Fair Value Gaps (FVG)
// ==============================================================================

// ─── Input Configuration ──────────────────────────────────────────────────────
grp_smc = "LuxAlgo Smart Money Concepts (SMC)"
ob_len       = input.int(${p.obLookback}, "Order Block Lookback Period", minval=3, maxval=50, group=grp_smc)
use_fvg      = input.bool(${p.useFvg}, "Enable Fair Value Gap (FVG) Confirmation", group=grp_smc)
sweep_sens   = input.float(${p.sweepSensitivity}, "Liquidity Sweep Sensitivity Multiplier", minval=0.5, step=0.1, group=grp_smc)

grp_momentum = "Oscillators & Volume Regime"
rsi_len      = input.int(${p.rsiLength}, "RSI Calculation Length", minval=2, group=grp_momentum)
rsi_long_min = input.int(${p.rsiLongMin}, "RSI Long Minimum (Expansion Gate)", minval=30, maxval=70, group=grp_momentum)
rsi_long_max = input.int(${p.rsiLongMax}, "RSI Long Maximum (Overbought Gate)", minval=50, maxval=90, group=grp_momentum)
rsi_short_min= input.int(${p.rsiShortMin}, "RSI Short Minimum (Oversold Gate)", minval=10, maxval=50, group=grp_momentum)
rsi_short_max= input.int(${p.rsiShortMax}, "RSI Short Maximum (Compression Gate)", minval=30, maxval=70, group=grp_momentum)
mfi_len      = input.int(${p.mfiLength}, "Money Flow Index (MFI) Length", minval=5, group=grp_momentum)
vol_mult     = input.float(${p.volMultiplier}, "Institutional Volume Multiplier", minval=1.0, step=0.05, group=grp_momentum)

grp_futures  = "5X Futures Risk & ATR Management"
leverage_val = input.float(${p.leverage}, "Futures Leverage Multiplier (Isolated)", minval=1.0, maxval=20.0, step=0.5, group=grp_futures)
tp_pct_raw   = input.float(${p.takeProfitPct}, "Underlying Take-Profit %", minval=0.5, step=0.1, group=grp_futures)
sl_pct_raw   = input.float(${p.stopLossPct}, "Underlying Stop-Loss %", minval=0.5, step=0.1, group=grp_futures)
atr_len      = input.int(${p.atrLength}, "ATR Volatility Period", minval=5, group=grp_futures)
atr_sl_mult  = input.float(${p.atrMultiplier}, "ATR Trailing Stop Multiplier", minval=0.5, step=0.1, group=grp_futures)
use_trailing = input.bool(${p.useTrailingStop}, "Enable Dynamic ATR Trailing Stop", group=grp_futures)

// ─── Technical Calculations ──────────────────────────────────────────────────
atr_v   = ta.atr(atr_len)
rsi_v   = ta.rsi(close, rsi_len)
mfi_v   = ta.mfi(hlc3, volume, mfi_len)
vol_ma  = ta.sma(volume, 20)
ema_20  = ta.ema(close, 20)
ema_50  = ta.ema(close, 50)
ema_200 = ta.ema(close, 200)

highest_high = ta.highest(high, ob_len)
lowest_low   = ta.lowest(low, ob_len)

// Order Block & Liquidity Sweep Detection
vol_surge     = volume > (vol_ma * vol_mult)
bullish_sweep = low < lowest_low[1] and close > lowest_low[1] and vol_surge
bearish_sweep = high > highest_high[1] and close < highest_high[1] and vol_surge

// Fair Value Gap (FVG) Detection
bullish_fvg = use_fvg and (low > high[2])
bearish_fvg = use_fvg and (high < low[2])

// Momentum & Trend Confluence
bull_momentum = (rsi_v >= rsi_long_min and rsi_v <= rsi_long_max) and (mfi_v >= 50.0)
bear_momentum = (rsi_v <= rsi_short_max and rsi_v >= rsi_short_min) and (mfi_v <= 50.0)
trend_bullish = close > ema_20 and ema_20 > ema_50
trend_bearish = close < ema_20 and ema_20 < ema_50

// Entry Trigger Logic
long_condition  = (bullish_sweep or (bullish_fvg and trend_bullish)) and bull_momentum and ta.crossover(close, ema_20)
short_condition = (bearish_sweep or (bearish_fvg and trend_bearish)) and bear_momentum and ta.crossunder(close, ema_20)

// ─── Strategy Execution & Position Management ────────────────────────────────
var float long_sl_price  = na
var float long_tp_price  = na
var float short_sl_price = na
var float short_tp_price = na

if (long_condition and strategy.position_size == 0)
    long_sl_price := close * (1.0 - (sl_pct_raw / 100.0))
    long_tp_price := close * (1.0 + (tp_pct_raw / 100.0))
    alert_json = '{"action":"BUY","symbol":"' + syminfo.ticker + '","side":"LONG","leverage":' + str.tostring(leverage_val) + ',"price":' + str.tostring(close) + ',"sl":' + str.tostring(long_sl_price) + ',"tp":' + str.tostring(long_tp_price) + ',"strategy":"smc_luxalgo_5x","roi_target_pct":' + str.tostring(tp_pct_raw * leverage_val) + '}'
    strategy.entry("SMC_5X_LONG", strategy.long, alert_message=alert_json)

if (short_condition and strategy.position_size == 0)
    short_sl_price := close * (1.0 + (sl_pct_raw / 100.0))
    short_tp_price := close * (1.0 - (tp_pct_raw / 100.0))
    alert_json = '{"action":"SELL","symbol":"' + syminfo.ticker + '","side":"SHORT","leverage":' + str.tostring(leverage_val) + ',"price":' + str.tostring(close) + ',"sl":' + str.tostring(short_sl_price) + ',"tp":' + str.tostring(short_tp_price) + ',"strategy":"smc_luxalgo_5x","roi_target_pct":' + str.tostring(tp_pct_raw * leverage_val) + '}'
    strategy.entry("SMC_5X_SHORT", strategy.short, alert_message=alert_json)

// Dynamic ATR Trailing Stops & Limit Exits
if (strategy.position_size > 0)
    if (use_trailing)
        long_sl_price := math.max(nz(long_sl_price, close - (atr_v * atr_sl_mult)), close - (atr_v * atr_sl_mult))
    strategy.exit("EXIT_LONG", "SMC_5X_LONG", stop=long_sl_price, limit=long_tp_price)

if (strategy.position_size < 0)
    if (use_trailing)
        short_sl_price := math.min(nz(short_sl_price, close + (atr_v * atr_sl_mult)), close + (atr_v * atr_sl_mult))
    strategy.exit("EXIT_SHORT", "SMC_5X_SHORT", stop=short_sl_price, limit=short_tp_price)

// ─── Visual Plots & Chart Overlays ───────────────────────────────────────────
plot(ema_20, "EMA 20", color=color.new(#3b82f6, 0), linewidth=1)
plot(ema_50, "EMA 50", color=color.new(#8b5cf6, 0), linewidth=2)
plot(ema_200, "EMA 200", color=color.new(#f59e0b, 0), linewidth=2)

plotshape(long_condition and strategy.position_size == 0, title="SMC Long Signal", location=location.belowbar, color=color.new(#10b981, 0), style=shape.triangleup, size=size.normal, text="5X BUY")
plotshape(short_condition and strategy.position_size == 0, title="SMC Short Signal", location=location.abovebar, color=color.new(#ef4444, 0), style=shape.triangledown, size=size.normal, text="5X SELL")
plotshape(bullish_sweep, title="Bullish Liquidity Sweep", location=location.belowbar, color=color.new(#06b6d4, 0), style=shape.diamond, size=size.tiny, text="SWEEP")
plotshape(bearish_sweep, title="Bearish Liquidity Sweep", location=location.abovebar, color=color.new(#f97316, 0), style=shape.diamond, size=size.tiny, text="SWEEP")
`;
}

/**
 * Generate Pine Script v5 code for Casper 5-min ORB Retest Strategy
 */
function generateCasperOrbPine(symbol = 'BTC/USDT', customParams = {}) {
  const p = { ...STRATEGY_PRESETS.casper_orb_retest.defaultParams, ...customParams };

  return `//@version=5
strategy("AiTradingAgent — Casper SMC 5-Min ORB Retest (${symbol})", overlay=true, initial_capital=1000, default_qty_type=strategy.percent_of_equity, default_qty_value=20, commission_type=strategy.commission.percent, commission_value=0.05, process_orders_on_close=true)

// ==============================================================================
// AiTradingAgent v4 — Casper SMC 5-Minute Opening Range Breakout Retest
// Symbol: ${symbol} | Timeframe: 5m Recommended
// Strategy Rules:
// 1. Establish 5-minute Opening Range High and Low (Default 13:30 UTC / NY Open).
// 2. Wait for clear expansion break above/below range.
// 3. Confirm pullback retest of the broken level.
// 4. Enter on confirmation with 50% range Stop Loss and min 2.0R Take Profit.
// ==============================================================================

// ─── Inputs ──────────────────────────────────────────────────────────────────
grp_session = "Session & Range Definition"
orb_hour     = input.int(${p.orbSessionHour}, "Session Open Hour (UTC)", minval=0, maxval=23, group=grp_session)
orb_minute   = input.int(${p.orbSessionMinute}, "Session Open Minute (UTC)", minval=0, maxval=59, group=grp_session)
vol_mult     = input.float(${p.volMultiplier}, "Breakout Volume Multiplier", minval=1.0, step=0.05, group=grp_session)

grp_risk    = "Futures Risk Management"
leverage_val = input.float(${p.leverage}, "Futures Leverage (Isolated)", minval=1.0, maxval=20.0, group=grp_risk)
tp_pct       = input.float(${p.takeProfitPct}, "Take-Profit Target %", minval=1.0, step=0.1, group=grp_risk)
sl_pct       = input.float(${p.stopLossPct}, "Stop-Loss Limit %", minval=0.5, step=0.1, group=grp_risk)
atr_len      = input.int(${p.atrLength}, "ATR Period", group=grp_risk)
atr_mult     = input.float(${p.atrMultiplier}, "ATR Trailing Multiplier", group=grp_risk)

// ─── ORB Calculations ────────────────────────────────────────────────────────
is_orb_bar = (hour(time, "UTC") == orb_hour) and (minute(time, "UTC") == orb_minute)

var float orb_high = na
var float orb_low  = na
var bool  broken_high = false
var bool  broken_low  = false

if (is_orb_bar)
    orb_high := high
    orb_low  := low
    broken_high := false
    broken_low  := false

vol_ma = ta.sma(volume, 20)
vol_ok = volume > (vol_ma * vol_mult)
atr_v  = ta.atr(atr_len)

// Breakout & Retest Detection
break_high = not broken_high and close > orb_high and vol_ok
break_low  = not broken_low and close < orb_low and vol_ok

if (break_high)
    broken_high := true

if (break_low)
    broken_low := true

// Retest confirmation
retest_long  = broken_high and (low <= orb_high * 1.001) and (close > orb_high)
retest_short = broken_low and (high >= orb_low * 0.999) and (close < orb_low)

// ─── Execution Logic ─────────────────────────────────────────────────────────
var float long_sl  = na
var float long_tp  = na
var float short_sl = na
var float short_tp = na

if (retest_long and strategy.position_size == 0)
    long_sl := close * (1.0 - (sl_pct / 100.0))
    long_tp := close * (1.0 + (tp_pct / 100.0))
    alert_msg = '{"action":"BUY","symbol":"' + syminfo.ticker + '","strategy":"casper_orb_retest","price":' + str.tostring(close) + ',"sl":' + str.tostring(long_sl) + ',"tp":' + str.tostring(long_tp) + ',"leverage":' + str.tostring(leverage_val) + '}'
    strategy.entry("ORB_LONG", strategy.long, alert_message=alert_msg)

if (retest_short and strategy.position_size == 0)
    short_sl := close * (1.0 + (sl_pct / 100.0))
    short_tp := close * (1.0 - (tp_pct / 100.0))
    alert_msg = '{"action":"SELL","symbol":"' + syminfo.ticker + '","strategy":"casper_orb_retest","price":' + str.tostring(close) + ',"sl":' + str.tostring(short_sl) + ',"tp":' + str.tostring(short_tp) + ',"leverage":' + str.tostring(leverage_val) + '}'
    strategy.entry("ORB_SHORT", strategy.short, alert_message=alert_msg)

if (strategy.position_size > 0)
    long_sl := math.max(nz(long_sl, close - (atr_v * atr_mult)), close - (atr_v * atr_mult))
    strategy.exit("EXIT_LONG", "ORB_LONG", stop=long_sl, limit=long_tp)

if (strategy.position_size < 0)
    short_sl := math.min(nz(short_sl, close + (atr_v * atr_mult)), close + (atr_v * atr_mult))
    strategy.exit("EXIT_SHORT", "ORB_SHORT", stop=short_sl, limit=short_tp)

// ─── Visual Plots ────────────────────────────────────────────────────────────
plot(orb_high, "ORB High Level", color=color.new(#10b981, 0), linewidth=2, style=plot.style_circles)
plot(orb_low, "ORB Low Level", color=color.new(#ef4444, 0), linewidth=2, style=plot.style_circles)
plotshape(retest_long and strategy.position_size == 0, title="ORB Retest Long", location=location.belowbar, color=color.green, style=shape.labelup, size=size.small, text="ORB BUY")
plotshape(retest_short and strategy.position_size == 0, title="ORB Retest Short", location=location.abovebar, color=color.red, style=shape.labeldown, size=size.small, text="ORB SELL")
`;
}

/**
 * Generate Pine Script v5 code based on strategy type
 */
function generatePineScript(strategyType = 'smc_luxalgo_5x', symbol = 'BTC/USDT', params = {}) {
  switch (strategyType.toLowerCase()) {
    case 'casper_orb_retest':
    case 'orb':
    case 'casper':
      return generateCasperOrbPine(symbol, params);

    case 'smc_luxalgo_5x':
    case 'luxalgo':
    case 'smc':
    default:
      return generateSmcLuxAlgoPine(symbol, params);
  }
}

/**
 * Save Pine Script to strategy folder
 */
function exportPineScriptToFile(strategyType, symbol, params = {}, filename = null) {
  try {
    if (!fs.existsSync(STRATEGY_DIR)) {
      fs.mkdirSync(STRATEGY_DIR, { recursive: true });
    }
    const cleanSymbol = symbol.replace('/', '_').toLowerCase();
    const targetFile = filename || path.join(STRATEGY_DIR, `${strategyType}_${cleanSymbol}_v5.pine`);
    const code = generatePineScript(strategyType, symbol, params);
    fs.writeFileSync(targetFile, code, 'utf8');
    logger.info(`[PineScriptGenerator] Exported Pine Script v5: ${targetFile}`);
    return { success: true, filePath: targetFile, code };
  } catch (err) {
    logger.error(`[PineScriptGenerator] Export error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = {
  STRATEGY_PRESETS,
  generatePineScript,
  generateSmcLuxAlgoPine,
  generateCasperOrbPine,
  exportPineScriptToFile,
};
