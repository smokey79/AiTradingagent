/**
 * src/agents/technicalMtfAgent.js
 * Adapter that plugs the 2026-09-23 multi-timeframe (15m/1h/4h) research
 * into the main consensus as `technical_mtf`.
 *
 * WHAT THIS IS: a third, independent technical vote alongside the
 * existing `technical_lab` (2h, EMA50/100+VWAP, walk-forward validated,
 * ETH-only) and `technical_daily` (daily bars, 3-cycle-robust,
 * BTC/ETH/SOL/AVAX/ARB). This one covers 15m/1h/4h bars across a much
 * wider top-50-derived token universe (25 tokens, 3 timeframes, 3
 * strategy families, ~9,000 backtests run via backtest_mtf.py).
 *
 * WHY THE WEIGHT IS LOWER THAN technical_lab/technical_daily: this was a
 * broad grid search (40 param combos x 3 strategies x 25 tokens x 3
 * timeframes). Even after requiring a combo to hold up in EVERY one of
 * 3 sequential cycles AND capping worst-cycle drawdown at 20%, a search
 * this wide has a real chance of surfacing a few lucky-by-chance
 * survivors (multiple-comparisons risk) that a narrower, more targeted
 * search wouldn't. Treat this as a real but slightly less trustworthy
 * signal than the other two technical agents until it's been watched
 * live for a while -- hence the lighter weight and why several
 * "technically passing" combos (BNB 15m, LINK 15m, TAO 1h, SHIB 15m --
 * PF too close to 1.0, or worst-cycle drawdown right at the 20% cap)
 * were deliberately left OUT of live trading despite clearing the bar.
 * See claude/session-2026-09-23-mtf-top50-research.md for full findings.
 *
 * Only ever votes BUY (no shorts, matching the rest of this project's
 * spot-only agents) and never hard-vetoes. Fails safe to HOLD on any
 * error (unmapped token, Binance hiccup, insufficient candle history).
 */
'use strict';
const { getCandles } = require('./technicalMtf/priceFeed');
const { checkEmaTrendSignal, checkBbMeanrevSignal } = require('./technicalMtf/strategies');

// One or more (timeframe, strategy, params) configs per token -- every
// entry here cleared: 3/3 cycles profitable, min 8 trades/cycle, worst
// single-cycle drawdown <= 20%, on backtest_mtf.py's re-run with the
// tightened (require-all-cycles) bar. Source numbers included inline so
// the weighting/confidence logic below and any future review can see
// exactly what was found without re-running the backtest.
const MTF_CONFIG = {
  BTC: [
    { timeframe: '4h', strategy: 'ema_trend', params: { ema_fast_len: 20, ema_slow_len: 50, atr_mult: 2.0, rr: 2.0 },
      avgProfitFactor: 1.98, avgReturnPct: 14.3, worstDrawdownPct: -14.1, totalTrades: 41 },
  ],
  ETH: [
    { timeframe: '15m', strategy: 'bb_meanrev', params: { bb_len: 20, bb_std: 2.0, rsi_oversold: 25, atr_mult: 1.5 },
      avgProfitFactor: 1.40, avgReturnPct: 1.9, worstDrawdownPct: -4.5, totalTrades: 36 },
  ],
  ZEC: [
    { timeframe: '15m', strategy: 'ema_trend', params: { ema_fast_len: 20, ema_slow_len: 50, atr_mult: 2.0, rr: 2.0 },
      avgProfitFactor: 1.46, avgReturnPct: 8.9, worstDrawdownPct: -8.6, totalTrades: 63 },
    { timeframe: '1h', strategy: 'ema_trend', params: { ema_fast_len: 50, ema_slow_len: 100, atr_mult: 1.5, rr: 1.5 },
      avgProfitFactor: 2.47, avgReturnPct: 14.9, worstDrawdownPct: -11.4, totalTrades: 33 },
    // 4h combo's worst-cycle drawdown (-19.0%) sits close to the 20% cap --
    // included, but flagged as the highest-risk config in this table.
    { timeframe: '4h', strategy: 'ema_trend', params: { ema_fast_len: 20, ema_slow_len: 50, atr_mult: 1.5, rr: 1.5 },
      avgProfitFactor: 1.71, avgReturnPct: 20.3, worstDrawdownPct: -19.0, totalTrades: 39, caution: 'worst-cycle DD near the 20% cap' },
  ],
  ADA: [
    { timeframe: '15m', strategy: 'bb_meanrev', params: { bb_len: 30, bb_std: 2.5, rsi_oversold: 30, atr_mult: 1.5 },
      avgProfitFactor: 1.34, avgReturnPct: 4.0, worstDrawdownPct: -5.4, totalTrades: 53 },
  ],
  NEAR: [
    { timeframe: '1h', strategy: 'ema_trend', params: { ema_fast_len: 50, ema_slow_len: 100, atr_mult: 2.0, rr: 2.0 },
      avgProfitFactor: 2.26, avgReturnPct: 14.1, worstDrawdownPct: -12.0, totalTrades: 41 },
  ],
  AVAX: [
    { timeframe: '15m', strategy: 'bb_meanrev', params: { bb_len: 30, bb_std: 2.5, rsi_oversold: 25, atr_mult: 2.0 },
      avgProfitFactor: 1.47, avgReturnPct: 5.3, worstDrawdownPct: -5.7, totalTrades: 47 },
  ],
  SUI: [
    { timeframe: '15m', strategy: 'bb_meanrev', params: { bb_len: 30, bb_std: 2.0, rsi_oversold: 25, atr_mult: 1.5 },
      avgProfitFactor: 1.66, avgReturnPct: 4.6, worstDrawdownPct: -3.8, totalTrades: 42 },
  ],
  HBAR: [
    { timeframe: '15m', strategy: 'bb_meanrev', params: { bb_len: 30, bb_std: 2.0, rsi_oversold: 25, atr_mult: 2.0 },
      avgProfitFactor: 1.47, avgReturnPct: 2.6, worstDrawdownPct: -4.7, totalTrades: 29 },
  ],
  TAO: [
    { timeframe: '15m', strategy: 'bb_meanrev', params: { bb_len: 30, bb_std: 2.0, rsi_oversold: 25, atr_mult: 1.5 },
      avgProfitFactor: 1.63, avgReturnPct: 3.7, worstDrawdownPct: -3.8, totalTrades: 27 },
    // TAO 1h ALSO cleared the bar (PF 1.28, +7.2%, 40 trades) but its
    // worst-cycle drawdown was exactly -20.0% -- right at the cap with
    // zero margin. Deliberately left out of live trading.
  ],
  ENA: [
    { timeframe: '15m', strategy: 'bb_meanrev', params: { bb_len: 20, bb_std: 2.5, rsi_oversold: 30, atr_mult: 2.0 },
      avgProfitFactor: 1.49, avgReturnPct: 3.3, worstDrawdownPct: -8.7, totalTrades: 34 },
    { timeframe: '1h', strategy: 'ema_trend', params: { ema_fast_len: 50, ema_slow_len: 100, atr_mult: 2.0, rr: 2.0 },
      avgProfitFactor: 1.81, avgReturnPct: 17.0, worstDrawdownPct: -13.6, totalTrades: 33 },
  ],
  // Deliberately NOT configured despite technically clearing the robustness
  // bar -- edge too thin or drawdown too close to the cap to trust with
  // real weight yet: BNB 15m (PF 1.11, +0.6%), LINK 15m (PF 1.26, +1.4%),
  // TAO 1h (worst DD exactly -20.0%), SHIB 15m (PF 1.16 vs -12.3% DD).
};

function confidenceFor(cfg) {
  // Deterministic, no LLM -- confidence scales with the backtested profit
  // factor (capped), same spirit as technicalDailyAgent's fixed-formula
  // confidence. 1.0 PF -> ~0.55, 2.5+ PF -> capped at 0.85.
  const pf = Math.min(cfg.avgProfitFactor, 3.0);
  return Math.max(0.50, Math.min(0.85, 0.55 + (pf - 1) * 0.15));
}

async function checkOneConfig(symbol, cfg) {
  const candles = await getCandles(symbol, cfg.timeframe, { limit: 300 });
  const result = cfg.strategy === 'ema_trend'
    ? checkEmaTrendSignal(candles, cfg.params)
    : checkBbMeanrevSignal(candles, cfg.params);
  return { cfg, result };
}

async function getSignal(symbol, _marketData) {
  const configs = MTF_CONFIG[symbol];
  if (!configs || configs.length === 0) {
    return {
      signal: 'HOLD',
      confidence: 0,
      reason: `technical_mtf: no cross-cycle-robust 15m/1h/4h combo for ${symbol}`,
      model_used: 'technical-mtf-v1 (deterministic, no LLM)',
      provider: 'technical_mtf',
      veto_flag: false,
    };
  }

  try {
    const checks = await Promise.all(configs.map((cfg) => checkOneConfig(symbol, cfg)));
    const fired = checks.filter((c) => c.result.fired);

    if (fired.length === 0) {
      return {
        signal: 'HOLD',
        confidence: 0,
        reason: `technical_mtf: no entry condition fired on ${configs.map((c) => c.timeframe).join('/')} for ${symbol}`,
        model_used: 'technical-mtf-v1 (deterministic, no LLM)',
        provider: 'technical_mtf',
        veto_flag: false,
      };
    }

    // If more than one timeframe fires at once, take the highest-quality
    // (best avgProfitFactor) one for the headline confidence/reason, but
    // note every timeframe that agreed.
    const best = fired.reduce((a, b) => (b.cfg.avgProfitFactor > a.cfg.avgProfitFactor ? b : a));
    const firedList = fired.map((f) => `${f.cfg.timeframe}:${f.cfg.strategy}`).join(', ');

    return {
      signal: 'BUY',
      confidence: confidenceFor(best.cfg),
      reason: `technical_mtf: ${firedList} entry fired for ${symbol} ` +
        `(best: ${best.cfg.timeframe} ${best.cfg.strategy}, backtest avg PF ${best.cfg.avgProfitFactor}, ` +
        `avg return/cycle +${best.cfg.avgReturnPct}%, worst-cycle DD ${best.cfg.worstDrawdownPct}%)`,
      model_used: 'technical-mtf-v1 (deterministic, no LLM)',
      provider: 'technical_mtf',
      veto_flag: false,
      details: { fired: fired.map((f) => ({ timeframe: f.cfg.timeframe, strategy: f.cfg.strategy, ...f.result })) },
    };
  } catch (err) {
    // Binance hiccup, unmapped symbol, or thin candle history -- fail to
    // a harmless HOLD, same pattern as technicalDailyAgent/technicalLabAgent.
    return {
      signal: 'HOLD',
      confidence: 0,
      reason: `technical_mtf unavailable for ${symbol}: ${err.message}`,
      model_used: 'technical-mtf-v1 (deterministic, no LLM)',
      provider: 'technical_mtf',
      veto_flag: false,
      error: true,
    };
  }
}

module.exports = { getSignal, MTF_CONFIG };
