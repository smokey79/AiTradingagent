'use strict';
const patterns = require('../agents/patternRecognitionAgent');
const memory = require('./expertMemory');

function sourcesOf(md) {
  const result = [];
  const add = (name, value, freshnessMs = 86400000) => {
    if (value == null) { result.push({ name, status: 'unavailable', direction: 0 }); return; }
    const rawDate = value.timestamp || value.savedAt || value.updatedAt;
    const time = rawDate ? Date.parse(rawDate) : NaN;
    const stale = Number.isFinite(time) && Date.now() - time > freshnessMs;
    const sig = String(value.signal || value.action || '').toUpperCase();
    const direction = ['BUY', 'LONG', 'BULLISH'].includes(sig) ? 1 : ['SELL', 'SHORT', 'BEARISH'].includes(sig) ? -1 : 0;
    result.push({ name, status: stale ? 'stale' : direction && Number.isFinite(time) ? 'available' : 'context_only', direction: stale ? 0 : direction,
      observationTime: Number.isFinite(time) ? new Date(time).toISOString() : null });
  };
  add('telegram', md.telegramSignal, 1800000);
  add('tradingview', md.tradingViewSignal, 1800000);
  add('strategy_advisor', md.strategyAdvisorSignal, 1800000);
  add('news_macro', md.bigdata || md.bigdataSignal);
  add('youtube', md.youtubeSentiment || md.sentiment);
  add('fear_greed', md.fearGreed);
  add('onchain', md.onchain);
  add('dex', md.dex);
  add('coinmarketcap', md.cmc);
  const ob = md.rawOrderBook;
  if (ob?.bids?.length && ob?.asks?.length) {
    const sum = rows => rows.reduce((s, r) => s + r[0] * r[1], 0);
    const bids = sum(ob.bids), asks = sum(ob.asks), skew = (bids - asks) / (bids + asks);
    result.push({ name: 'orderbook', status: Number.isFinite(skew) ? 'available' : 'unavailable', direction: skew > 0.1 ? 1 : skew < -0.1 ? -1 : 0 });
  }
  for (const [kind, provider] of Object.entries(md.sources || {})) result.push({ name: `${kind}:${String(provider).slice(0, 40)}`, status: 'context_only', direction: 0 });
  return result;
}

function enrich(pair, md) {
  const sourceEvidence = sourcesOf(md), patternAdvice = {};
  for (const [timeframe, candles] of Object.entries(md.horizonCandles || { '1h': md.candles || [] })) {
    if (!candles.length) continue;
    memory.score(pair, timeframe, candles);
    const detected = patterns.detectChartPatterns(candles);
    patternAdvice[timeframe] = detected;
    memory.observe({ pair, timeframe, candleMs: candles.at(-1)[0], patterns: detected.detectedPatterns, sources: sourceEvidence });
  }
  return { ...md, sourceEvidence, patternAdvice, learningContext: memory.lessons(pair) };
}

function recordPeerOutcome(pair, consensus) {
  memory.remember(pair, 'consensus', { signal: consensus.signal, confidence: consensus.confidence,
    peers: (consensus.breakdown || []).map(p => ({ agent: p.agent, signal: p.signal, confidence: p.confidence })),
    riskReview: consensus.engine?.review || null, reason: String(consensus.reasoning || '').slice(0, 300) });
}
module.exports = { sourcesOf, enrich, recordPeerOutcome };
