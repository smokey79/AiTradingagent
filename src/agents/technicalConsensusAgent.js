/**
 * src/agents/technicalConsensusAgent.js
 * ─────────────────────────────────────────────────────────────────────────
 * Free, zero-API-cost daily-bar "systematic" agent for the AiTradingAgent
 * consensus layer. Implements the exact same EMA-trend + RSI/MACD-momentum
 * + ATR-risk logic that is backtested in Python (backtest_own_ohlcv.py /
 * analyze_cross_cycle.py) and mirrored in the companion Pine Script
 * (claude/consensus-proxy-strategy.pine) so all three places agree.
 *
 * REVISED 2026-09-14 — replaces the original Sep-11 defaults, which were
 * based on Alpha Vantage's 25-req/day free tier (only let us test 3 of 7
 * tokens over one ~3-year window). This version is based on Alan's own
 * OHLCV pull via ccxt (Binance primary, Bitget fallback — no quota, full
 * available history per token) split into 3 SEQUENTIAL, non-overlapping
 * market-regime cycles per token, with every parameter combo tested
 * independently on each cycle. The settings below are not "best on one
 * lucky window" — they are the ones that produced real trades and held up
 * across EVERY valid cycle tested for that token (see
 * F:\aitradingagent\analyze_cross_cycle.py and
 * F:\aitradingagent\data\ohlcv\cross_cycle_robust_findings.json for the
 * full methodology and raw numbers).
 *
 * Cross-cycle-robust results (daily bars, 1% risk/trade, fees included,
 * numbers are the AVERAGE across all 3 cycles the combo appeared in):
 *   BTC  — EMA(20/50)  RSI-min 50 ATRx1.5  RR2.0 -> 3/3 cycles, 103 trades, avg PF 1.69, avg return +12.7%, worst-cycle DD -7.0%
 *   ETH  — EMA(20/100) RSI-min 50 ATRx1.75 RR1.5 -> 3/3 cycles, 97 trades,  avg PF 1.67, avg return +8.6%,  worst-cycle DD -6.0%
 *   SOL  — EMA(50/200) RSI-min 50 ATRx1.5  RR1.5 -> 3/3 cycles, 63 trades,  avg PF 2.03, avg return +9.7%,  worst-cycle DD -3.0%
 *   AVAX — EMA(20/100) RSI-min 45 ATRx1.75 RR2.5 -> 3/3 cycles, 35 trades,  avg PF 1.88, avg return +5.7%,  worst-cycle DD -4.0%
 *   ARB  — EMA(20/50)  RSI-min 50 ATRx2.0  RR1.5 -> 3/3 cycles, 28 trades (thinnest reliable sample), avg PF 1.62, avg return +2.8%, worst-cycle DD -3.0%
 *   OP   — DISABLED: even its best cross-cycle combo nets avg PF 1.02 / avg return -1.5% (net losing) with a -9.7% worst-cycle drawdown. 2 of its 3 cycles lost money outright — no combo found a real edge.
 *   CRO  — DISABLED: Bitget only lists ~300 days of CRO/USDT history (since Nov 2025). One cycle had zero trades in ANY combo; the other two had only 3 trades each at 0% win rate. Far too thin to trust — per principles.md, no trading on insufficient sample size.
 *
 * NOTE on how this relates to `technical_lab` (added 2026-09-14, see
 * claude/session-2026-09-14-merge-report.md): technical_lab is a DIFFERENT,
 * independently-validated strategy — 2-hour bars, EMA50/100+VWAP cross,
 * genuine out-of-sample walk-forward tested, ETH-only live. This agent
 * (technical_daily) trades DAILY bars with a different rule set, validated
 * by 3-cycle robustness rather than a held-out walk-forward split — a real
 * but slightly weaker form of validation. The two are complementary, not
 * duplicates: technical_lab only ever votes on ETH; this agent covers
 * BTC/ETH/SOL/AVAX/ARB. Both are additive, non-veto votes — see
 * consensus.js's technical_daily weight (set below its technical_lab peer
 * to reflect the difference in validation rigor).
 *
 * Drop this file in: F:\aitradingagent\src\agents\technicalConsensusAgent.js
 * Wired into src/orchestrator/consensus.js as `technical_daily` via
 * src/agents/technicalDailyAgent.js (its own self-contained daily-candle
 * fetch, same reasoning as technicalLabAgent.js: don't reuse marketData's
 * 1h candles for a strategy validated on daily bars).
 * ─────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ── Config (cross-cycle-robust defaults — see header for the backtest) ─────
const DEFAULT_CONFIG = {
  emaFastLen: 20,
  emaSlowLen: 50,
  rsiLen: 14,
  rsiBullMin: 50,
  rsiOverbought: 70,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  atrLen: 14,
  extEmaLen: 20,
  extAtrMult: 3.0,
  atrStopMult: 1.5,
  rewardRiskRatio: 2.0,
  riskPctPerTrade: 1.0,
};

// Per-token overrides — the ONE combo per token that produced real trades
// in every valid cycle it was tested on (not just the single best window).
const TOKEN_OVERRIDES = {
  BTC: {
    emaFastLen: 20, emaSlowLen: 50, rsiBullMin: 50, atrStopMult: 1.5, rewardRiskRatio: 2.0,
    note: '3/3 cycles, 103 trades total, avg PF 1.69, avg return +12.7%, worst-cycle DD -7.0%',
  },
  ETH: {
    emaFastLen: 20, emaSlowLen: 100, rsiBullMin: 50, atrStopMult: 1.75, rewardRiskRatio: 1.5,
    note: '3/3 cycles, 97 trades total, avg PF 1.67, avg return +8.6%, worst-cycle DD -6.0%',
  },
  SOL: {
    emaFastLen: 50, emaSlowLen: 200, rsiBullMin: 50, atrStopMult: 1.5, rewardRiskRatio: 1.5,
    note: '3/3 cycles, 63 trades total, avg PF 2.03, avg return +9.7%, worst-cycle DD -3.0%',
  },
  AVAX: {
    emaFastLen: 20, emaSlowLen: 100, rsiBullMin: 45, atrStopMult: 1.75, rewardRiskRatio: 2.5,
    note: '3/3 cycles, 35 trades total, avg PF 1.88, avg return +5.7%, worst-cycle DD -4.0%',
  },
  ARB: {
    emaFastLen: 20, emaSlowLen: 50, rsiBullMin: 50, atrStopMult: 2.0, rewardRiskRatio: 1.5,
    note: '3/3 cycles, 28 trades total (thinnest reliable sample), avg PF 1.62, avg return +2.8%, worst-cycle DD -3.0%',
  },
  OP: {
    disabled: true,
    note: 'DISABLED: best cross-cycle combo still nets avg PF 1.02 / avg return -1.5% (net losing), -9.7% worst-cycle DD. No edge found.',
  },
  CRO: {
    disabled: true,
    note: 'DISABLED: only ~300 days of Bitget history; one cycle had zero trades in any combo, the other two only 3 trades each at 0% win rate. Sample too thin to trust.',
  },
};

// ── Indicator helpers (no external dependencies) ────────────────────────────
function ema(values, length) {
  const k = 2 / (length + 1);
  const out = new Array(values.length).fill(null);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function rsi(closes, length) {
  const out = new Array(closes.length).fill(50);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (i <= length) {
      avgGain = (avgGain * (i - 1) + gain) / i;
      avgLoss = (avgLoss * (i - 1) + loss) / i;
    } else {
      avgGain = (avgGain * (length - 1) + gain) / length;
      avgLoss = (avgLoss * (length - 1) + loss) / length;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
  }
  return out;
}

function atr(candles, length) {
  const trs = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
  return ema(trs, length);
}

function macd(closes, fastLen, slowLen, signalLen) {
  const fast = ema(closes, fastLen);
  const slow = ema(closes, slowLen);
  const macdLine = closes.map((_, i) => fast[i] - slow[i]);
  const signalLine = ema(macdLine, signalLen);
  return { macdLine, signalLine };
}

// ── Main entry point ─────────────────────────────────────────────────────
/**
 * @param {string} token - e.g. "BTC"
 * @param {Array<{open:number, high:number, low:number, close:number, volume:number, timestamp:number}>} candles
 *        Daily candles, oldest first. Needs at least emaSlowLen+5 bars of history.
 * @param {object} [overrides] - optional config overrides for this call
 * @returns {{ signal: 'BUY'|'HOLD', confidence: number, reason: string, constraints: object }}
 */
function getTechnicalSignal(token, candles, overrides = {}) {
  const tokenOverride = TOKEN_OVERRIDES[token] || {};

  if (tokenOverride.disabled && !overrides.forceEnable) {
    return {
      signal: 'HOLD',
      confidence: 0,
      reason: `${token} disabled for technical_daily: ${tokenOverride.note}`,
      constraints: {},
      signalSuppressed: true,
    };
  }

  const cfg = { ...DEFAULT_CONFIG, ...tokenOverride, ...overrides };

  if (!candles || candles.length < cfg.emaSlowLen + 5) {
    return {
      signal: 'HOLD',
      confidence: 0,
      reason: `Not enough history for ${token} (need ${cfg.emaSlowLen + 5}+ daily candles).`,
      constraints: {},
    };
  }

  const closes = candles.map((c) => c.close);
  const emaFast = ema(closes, cfg.emaFastLen);
  const emaSlow = ema(closes, cfg.emaSlowLen);
  const extEma = ema(closes, cfg.extEmaLen);
  const rsiVals = rsi(closes, cfg.rsiLen);
  const { macdLine, signalLine } = macd(closes, cfg.macdFast, cfg.macdSlow, cfg.macdSignal);
  const atrVals = atr(candles, cfg.atrLen);

  const i = candles.length - 1; // most recent completed candle
  const price = closes[i];

  const trendUp = emaFast[i] > emaSlow[i] && price > emaFast[i];
  const momentumUp = rsiVals[i] > cfg.rsiBullMin && macdLine[i] > signalLine[i];
  const bullVotes = (trendUp ? 1 : 0) + (momentumUp ? 1 : 0);

  const overExtended = price > extEma[i] + cfg.extAtrMult * atrVals[i];
  const overbought = rsiVals[i] > cfg.rsiOverbought;
  const veto = overExtended || overbought;

  const longSignal = bullVotes >= 2 && !veto;

  let confidence = 0;
  if (longSignal) {
    const rsiHeadroom = Math.max(0, (cfg.rsiOverbought - rsiVals[i]) / cfg.rsiOverbought);
    confidence = Math.min(0.9, 0.5 + 0.4 * rsiHeadroom);
    if (cfg.confidenceCap) confidence = Math.min(confidence, cfg.confidenceCap);
  }

  const stopDistance = cfg.atrStopMult * atrVals[i];
  const stopPrice = price - stopDistance;
  const targetPrice = price + stopDistance * cfg.rewardRiskRatio;

  const reason = longSignal
    ? `Trend up (EMA${cfg.emaFastLen}>EMA${cfg.emaSlowLen}), momentum confirmed (RSI ${rsiVals[i].toFixed(1)}, MACD>signal), not overbought/overextended. [${tokenOverride.note || 'default config'}]`
    : veto
      ? `Veto: ${overbought ? 'RSI overbought' : 'price overextended vs ATR'} — sitting out despite ${bullVotes}/2 bull votes.`
      : `Only ${bullVotes}/2 bull votes (need 2) — trend/momentum not aligned.`;

  return {
    signal: longSignal ? 'BUY' : 'HOLD',
    confidence: Number(confidence.toFixed(2)),
    reason,
    constraints: {
      stopPrice: Number(stopPrice.toFixed(6)),
      targetPrice: Number(targetPrice.toFixed(6)),
      riskPctPerTrade: cfg.riskPctPerTrade,
      atr: Number(atrVals[i].toFixed(6)),
    },
  };
}

module.exports = { getTechnicalSignal, DEFAULT_CONFIG, TOKEN_OVERRIDES };
