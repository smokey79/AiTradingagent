'use strict';

// Geometry is measured from closed OHLCV candles. Shape strength is not a win probability.
function detectChartPatterns(candles = []) {
  const rows = candles.filter(c => Array.isArray(c) && c.length >= 6 && c.slice(0, 6).every(Number.isFinite));
  if (rows.length < 22) return { patternBias: 'NEUTRAL', detectedPatterns: [], status: 'insufficient_data' };
  const last = rows.at(-1), prev = rows.at(-2), earlier = rows.slice(-21, -1);
  const [ts, o, h, l, c, v] = last, body = Math.abs(c - o), range = h - l;
  const avgVolume = earlier.reduce((sum, r) => sum + r[5], 0) / earlier.length;
  const patterns = [];
  const add = (name, direction, description) => patterns.push({ name, direction, description, candleMs: ts });
  if (prev[4] < prev[1] && c > o && o <= prev[4] && c >= prev[1]) add('Bullish engulfing', 1, 'Current bullish body engulfs the previous bearish body.');
  if (prev[4] > prev[1] && c < o && o >= prev[4] && c <= prev[1]) add('Bearish engulfing', -1, 'Current bearish body engulfs the previous bullish body.');
  if (range > 0 && body / range <= 0.1) add('Doji', 0, 'Small body relative to the candle range indicates indecision.');
  if (range > 0 && body > 0 && Math.min(o, c) - l >= 2 * body && h - Math.max(o, c) <= body) add('Lower wick rejection', 1, 'Lower wick is at least twice the body with a small upper wick.');
  if (range > 0 && body > 0 && h - Math.max(o, c) >= 2 * body && Math.min(o, c) - l <= body) add('Upper wick rejection', -1, 'Upper wick is at least twice the body with a small lower wick.');
  if (avgVolume > 0 && v >= avgVolume * 1.25) {
    if (c > Math.max(...earlier.map(r => r[2]))) add('Volume confirmed range breakout', 1, 'Close breaks the preceding 20-bar high with expanded volume.');
    if (c < Math.min(...earlier.map(r => r[3]))) add('Volume confirmed range breakdown', -1, 'Close breaks the preceding 20-bar low with expanded volume.');
  }
  const bias = Math.sign(patterns.reduce((s, p) => s + p.direction, 0));
  return { patternBias: bias > 0 ? 'BULLISH' : bias < 0 ? 'BEARISH' : 'NEUTRAL', detectedPatterns: patterns,
    status: 'advisory', note: 'Shapes are observations; predictive reliability requires scored outcomes.' };
}
module.exports = { detectChartPatterns };
