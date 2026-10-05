/**
 * Technical Indicators Engine
 * Provides pure, robust mathematical implementations with technicalindicators library support.
 */

function calculateRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return 50.0;
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100.0;
  const rs = avgGain / avgLoss;
  return parseFloat((100 - 100 / (1 + rs)).toFixed(2));
}

function calculateEMA(closes, period = 20) {
  if (!closes || closes.length < period) return closes ? closes[closes.length - 1] : 0;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return parseFloat(ema.toFixed(2));
}

/** Full-series EMA (needed to build a real MACD signal line). calculateEMA()
 *  below only ever returns the latest scalar value, which every existing
 *  caller (smcAgent, calculateAllIndicators, etc.) relies on — left untouched. */
function emaSeries(values, period) {
  if (!values || values.length === 0) return [];
  const k = 2 / (period + 1);
  const out = new Array(values.length);
  out[0] = values[0];
  for (let i = 1; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

function calculateMACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (!closes || closes.length < slowPeriod + signalPeriod) {
    return { macd: 0, signal: 0, histogram: 0 };
  }

  // FIXED 2026-10-05: the signal line used to be `macdLine * 0.85` -- a
  // placeholder that scales the current MACD value rather than tracking its
  // own momentum, so it could never produce a genuine crossover. Real MACD
  // signal = a 9-period EMA of the MACD line's own history. Confirmed
  // 2026-10-05 that nothing in src/ reads calculateMACD's output for a
  // trading decision, so this only changes what's reported/displayed.
  const fastSeries = emaSeries(closes, fastPeriod);
  const slowSeries = emaSeries(closes, slowPeriod);
  const macdSeries = closes.map((_, i) => fastSeries[i] - slowSeries[i]);
  const signalSeries = emaSeries(macdSeries, signalPeriod);

  const macdLine = parseFloat(macdSeries[macdSeries.length - 1].toFixed(4));
  const signalLine = parseFloat(signalSeries[signalSeries.length - 1].toFixed(4));
  const histogram = parseFloat((macdLine - signalLine).toFixed(4));

  return {
    macd: macdLine,
    signal: signalLine,
    histogram,
  };
}

/**
 * Money Flow Index (MFI) -- the volume-weighted RSI. Documented in
 * agents/skills/SKILL_TECHNICAL_ANALYSIS.md as a required indicator
 * (MFI > 50 = institutional inflow, < 50 = outflow) but never actually
 * implemented anywhere in the codebase until now (added 2026-10-05).
 */
function calculateMFI(highs, lows, closes, volumes, period = 14) {
  if (!highs || !lows || !closes || !volumes || closes.length < period + 1) return 50.0;

  const typicalPrices = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  const rawMoneyFlow = typicalPrices.map((tp, i) => tp * (volumes[i] || 0));

  let positiveFlow = 0;
  let negativeFlow = 0;
  const start = Math.max(1, typicalPrices.length - period);
  for (let i = start; i < typicalPrices.length; i++) {
    if (typicalPrices[i] > typicalPrices[i - 1]) positiveFlow += rawMoneyFlow[i];
    else if (typicalPrices[i] < typicalPrices[i - 1]) negativeFlow += rawMoneyFlow[i];
    // unchanged typical price contributes to neither side, per the standard MFI definition
  }

  if (negativeFlow === 0) return 100.0;
  const moneyRatio = positiveFlow / negativeFlow;
  return parseFloat((100 - 100 / (1 + moneyRatio)).toFixed(2));
}

function calculateBollingerBands(closes, period = 20, multiplier = 2) {
  if (!closes || closes.length < period) {
    const price = closes ? closes[closes.length - 1] : 0;
    return { middle: price, upper: price * 1.02, lower: price * 0.98, bandwidth: 4.0 };
  }

  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);

  const upper = parseFloat((middle + multiplier * stdDev).toFixed(2));
  const lower = parseFloat((middle - multiplier * stdDev).toFixed(2));
  const bandwidth = middle > 0 ? parseFloat((((upper - lower) / middle) * 100).toFixed(2)) : 0;

  return {
    middle: parseFloat(middle.toFixed(2)),
    upper,
    lower,
    bandwidth,
  };
}

function calculateATR(highs, lows, closes, period = 14) {
  if (!highs || !lows || !closes || highs.length < period + 1) {
    return closes && closes.length > 0 ? closes[closes.length - 1] * 0.02 : 1.0;
  }

  const trueRanges = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);
  }

  const atrSlice = trueRanges.slice(-period);
  const atr = atrSlice.reduce((a, b) => a + b, 0) / period;
  // 2026-10-03: was toFixed(2), which rounds the ATR of any coin priced under ~$1 (ARB, OP, HBAR, ...) to 0.00 and
  // silently gave their stops/sizing a zero volatility. 8 significant digits keeps every price scale exact enough.
  return parseFloat(atr.toPrecision(8));
}

function analyzeOrderBook(orderBook, depth = 10) {
  if (!orderBook || !orderBook.bids || !orderBook.asks || orderBook.bids.length === 0 || orderBook.asks.length === 0) {
    return {
      bestBid: 0,
      bestAsk: 0,
      spread: 0,
      spreadPct: 0,
      bidVolume: 0,
      askVolume: 0,
      imbalanceRatio: 0.5,
      bias: 'neutral',
    };
  }

  const topBid = orderBook.bids[0][0];
  const topAsk = orderBook.asks[0][0];
  const spread = parseFloat((topAsk - topBid).toFixed(4));
  const spreadPct = topBid > 0 ? parseFloat(((spread / topBid) * 100).toFixed(4)) : 0;

  const bidSlice = orderBook.bids.slice(0, depth);
  const askSlice = orderBook.asks.slice(0, depth);

  const bidVolume = parseFloat(bidSlice.reduce((s, [, v]) => s + v, 0).toFixed(4));
  const askVolume = parseFloat(askSlice.reduce((s, [, v]) => s + v, 0).toFixed(4));
  const totalVolume = bidVolume + askVolume;
  const imbalanceRatio = totalVolume > 0 ? parseFloat((bidVolume / totalVolume).toFixed(3)) : 0.5;

  let bias = 'neutral';
  if (imbalanceRatio >= 0.60) bias = 'bid_heavy_bullish';
  else if (imbalanceRatio <= 0.40) bias = 'ask_heavy_bearish';

  return {
    bestBid: topBid,
    bestAsk: topAsk,
    spread,
    spreadPct,
    bidVolume,
    askVolume,
    imbalanceRatio,
    bias,
  };
}

function calculateAllIndicators(candles, orderBook = null) {
  if (!candles || candles.length === 0) {
    return {
      rsi14: 50,
      ema20: 0,
      ema50: 0,
      ema200: 0,
      macd: { macd: 0, signal: 0, histogram: 0 },
      bollinger: { middle: 0, upper: 0, lower: 0, bandwidth: 0 },
      atr14: 0,
      mfi14: 50,
      volumeRatio: 1.0,
      orderBook: analyzeOrderBook(orderBook),
    };
  }

  const closes = candles.map(c => (Array.isArray(c) ? c[4] : c.close));
  const highs  = candles.map(c => (Array.isArray(c) ? c[2] : c.high));
  const lows   = candles.map(c => (Array.isArray(c) ? c[3] : c.low));
  const vols   = candles.map(c => (Array.isArray(c) ? c[5] : c.volume));

  const currentPrice = closes[closes.length - 1];
  const rsi14 = calculateRSI(closes, 14);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, Math.min(200, closes.length));
  const macd = calculateMACD(closes);
  const bollinger = calculateBollingerBands(closes, 20, 2);
  const atr14 = calculateATR(highs, lows, closes, 14);
  const mfi14 = calculateMFI(highs, lows, closes, vols, 14);

  const volSlice = vols.slice(-20);
  const avgVol20 = volSlice.length > 0 ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length : 1;
  const currentVol = vols[vols.length - 1] || 1;
  const volumeRatio = parseFloat((currentVol / (avgVol20 || 1)).toFixed(2));

  return {
    currentPrice,
    rsi14,
    ema20,
    ema50,
    ema200,
    macd,
    bollinger,
    atr14,
    mfi14,
    moneyFlowSignal: mfi14 > 50 ? 'inflow' : mfi14 < 50 ? 'outflow' : 'neutral',
    volumeRatio,
    volumeSignal: volumeRatio > 1.5 ? 'high_volume' : volumeRatio < 0.6 ? 'low_volume' : 'normal',
    priceVsEma50: currentPrice >= ema50 ? 'above' : 'below',
    priceVsEma200: currentPrice >= ema200 ? 'above' : 'below',
    orderBook: analyzeOrderBook(orderBook),
  };
}

module.exports = {
  calculateRSI,
  calculateEMA,
  calculateMACD,
  calculateMFI,
  calculateBollingerBands,
  calculateATR,
  analyzeOrderBook,
  calculateAllIndicators,
};
