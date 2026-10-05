// "Sweep and Engulf" strategy (standard definition — adjust once the LuxAlgo rules are confirmed).
// LONG:  candle A sweeps liquidity: its low breaks below the lowest low of the previous `lookback` candles,
//        but it closes back above that level (stop-hunt that failed).
//        candle B (next candle) is a bullish ENGULFING candle: body fully covers candle A's body.
//        Entry at candle B close, stop below the sweep low, target = rr x risk (default 3:1).
// SHORT: mirror image (sweep above recent highs, bearish engulf).
// Optional filters (used by variants): EMA14/50 trend, session VWAP side, RSI(14).
const { ema, rsi, vwap } = require('./threeCandleRsiVwapEma');

const DEFAULTS = { lookback: 20, rr: 3, minRiskPct: 0.004, maxRiskPct: 0.06, trend: false, vwapSide: false, rsiFilter: false };

function indicators(candles) {
  const closes = candles.map(c => c.c);
  return { emaF: ema(closes, 14), emaS: ema(closes, 50), rsi: rsi(closes, 14), vwap: vwap(candles) };
}

function signalAt(candles, ind, i, p = DEFAULTS) {
  if (i < Math.max(p.lookback, 50) + 2) return null;
  const A = candles[i - 1], B = candles[i];
  let lo = Infinity, hi = -Infinity;
  for (let j = i - 1 - p.lookback; j < i - 1; j++) { lo = Math.min(lo, candles[j].l); hi = Math.max(hi, candles[j].h); }
  const bodyTop = c => Math.max(c.o, c.c), bodyBot = c => Math.min(c.o, c.c);
  const eF = ind.emaF[i], eS = ind.emaS[i], r = ind.rsi[i - 1], vw = ind.vwap[i];

  const sweptLow = A.l < lo && A.c > lo;
  const bullEngulf = B.c > B.o && B.c > bodyTop(A) && B.o <= bodyBot(A);
  if (sweptLow && bullEngulf
      && (!p.trend || eF > eS) && (!p.vwapSide || B.c > vw) && (!p.rsiFilter || r < 45)) {
    const entry = B.c, stop = Math.min(A.l, B.l), risk = entry - stop;
    if (risk > 0 && risk / entry >= p.minRiskPct && risk / entry <= p.maxRiskPct)
      return { side: 'long', entry, stop, target: entry + p.rr * risk, reason: 'sweep of lows + bullish engulf' };
  }
  const sweptHigh = A.h > hi && A.c < hi;
  const bearEngulf = B.c < B.o && B.c < bodyBot(A) && B.o >= bodyTop(A);
  if (sweptHigh && bearEngulf
      && (!p.trend || eF < eS) && (!p.vwapSide || B.c < vw) && (!p.rsiFilter || r > 55)) {
    const entry = B.c, stop = Math.max(A.h, B.h), risk = stop - entry;
    if (risk > 0 && risk / entry >= p.minRiskPct && risk / entry <= p.maxRiskPct)
      return { side: 'short', entry, stop, target: entry - p.rr * risk, reason: 'sweep of highs + bearish engulf' };
  }
  return null;
}

const VARIANTS = {
  'SE1 pure sweep+engulf 3R': { ...DEFAULTS },
  'SE2 + EMA14/50 trend 3R': { ...DEFAULTS, trend: true },
  'SE3 + RSI filter 3R': { ...DEFAULTS, rsiFilter: true },
  'SE4 + trend + VWAP + RSI 3R': { ...DEFAULTS, trend: true, vwapSide: true, rsiFilter: true },
};

module.exports = { DEFAULTS, VARIANTS, indicators, signalAt };
