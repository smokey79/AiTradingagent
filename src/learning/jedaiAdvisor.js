/**
 * JedAI Advisor -- automatic similarity match against past win/loss trades.
 * Added 2026-09-27 at Alan's request ("add jedai as an advisor to my trading
 * agent, nothing should be manual apart from settings").
 *
 * HONESTY NOTE (carried over from tools/jedai-match's TradeMatcher.java):
 * real JedAI (org.scify.jedai) is a Java entity-resolution / record-linkage
 * library -- there is no such thing as "JedAI trading signals". What IS
 * real and already validated in this project is JedAI's matching TECHNIQUE:
 * a character-trigram Jaccard similarity comparison, used because JedAI's
 * own ProfileMatcher throws a NullPointerException in every version that
 * resolves from Maven Central (a confirmed library bug, not a usage
 * mistake -- see TradeMatcher.java's own note). That technique previously
 * only ran manually, offline, via a JVM subprocess + CSV export
 * (scripts/RunTradeDedupeCheck.ps1), comparing trade-ledger ROWS for
 * duplicates.
 *
 * This module ports the exact same trigram-Jaccard technique to run
 * in-process, automatically, on every consensus cycle -- comparing the
 * LIVE candidate setup's indicator snapshot against every historical
 * win/loss record in data/lost_trades_memory.json and
 * data/won_trades_memory.json (the same memory banks lossLearner.js /
 * tradeLearner.js already maintain). No JVM, no CSV, no manual trigger.
 *
 * Purely advisory: evaluateSimilarity() only returns a match + similarity
 * score. It is wired into consensus.js as a confidence NUDGE, exactly like
 * the existing Self-Learning Negative Pattern penalty right above it --
 * it can never bypass MIN_CONFIDENCE or the majority-agreement gate in
 * riskGate.js, and it cannot force a trade or a veto by itself.
 */
'use strict';

const { loadLossMemory } = require('./lossLearner');
const { loadWinMemory } = require('./tradeLearner');

// Same default as the existing manual dedupe tool (RunTradeDedupeCheck.ps1
// -Threshold 0.65) for consistency across both uses of this technique.
const SIMILARITY_THRESHOLD = parseFloat(process.env.JEDAI_SIMILARITY_THRESHOLD || '0.65');
// Asymmetric on purpose: a similarity match to a past LOSS can cost more
// confidence than a match to a past WIN can add -- consistent with Alan's
// standing instruction "do not recommend trades with low odds".
const MAX_LOSS_PENALTY = parseFloat(process.env.JEDAI_MAX_PENALTY || '0.15');
const MAX_WIN_BOOST = parseFloat(process.env.JEDAI_MAX_BOOST || '0.05');

// ---- JedAI's validated technique (ported verbatim from TradeMatcher.java) ----
function trigramsOf(text) {
  const t = String(text).toLowerCase().replace(/\s+/g, ' ').trim();
  const grams = new Set();
  for (let i = 0; i + 3 <= t.length; i++) grams.add(t.substring(i, i + 3));
  return grams;
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const g of a) if (b.has(g)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
// ---- end ported technique ----

function summarizeRecord(record) {
  const snap = record.marketSnapshot || {};
  return `symbol=${record.symbol} | side=${record.side} | rsi=${(snap.rsi ?? 50).toFixed(0)} | `
    + `distema50=${(snap.distEma50Pct ?? 0).toFixed(1)} | golden=${!!snap.emaGolden} | `
    + `vol=${(snap.volRatio ?? 1).toFixed(2)} | btc=${(snap.btcChange24h ?? 0).toFixed(1)}`;
}

function summarizeLive(symbol, signal, marketData, btcBenchmark) {
  const ind = marketData?.indicators || {};
  const price = marketData?.price?.price || 0;
  const ema50 = ind.ema50 || price;
  const ema20 = ind.ema20 || price;
  const distEma50Pct = ema50 > 0 ? ((price - ema50) / ema50) * 100 : 0;
  const cleanSymbol = String(symbol).split('/')[0].toUpperCase();
  return `symbol=${cleanSymbol} | side=${signal} | rsi=${(ind.rsi14 ?? 50).toFixed(0)} | `
    + `distema50=${distEma50Pct.toFixed(1)} | golden=${ema20 >= ema50} | `
    + `vol=${(ind.volumeRatio ?? 1).toFixed(2)} | btc=${(btcBenchmark?.change24h ?? 0).toFixed(1)}`;
}

/**
 * Compares the live candidate setup against every historical win/loss
 * record for this symbol, using trigram-Jaccard similarity. Returns the
 * single closest match at or above SIMILARITY_THRESHOLD, or null.
 *
 * @param {string} symbol
 * @param {string} signal - 'BUY' or 'SELL' (the direction consensus.js has settled on)
 * @param {object} marketData
 * @param {object} btcBenchmark
 * @returns {{outcome:'WIN'|'LOSS', similarity:number, diagnostic:string, trapType:string}|null}
 */
function findClosestMatch(symbol, signal, marketData, btcBenchmark) {
  const cleanSymbol = String(symbol).split('/')[0].toUpperCase();
  const liveGrams = trigramsOf(summarizeLive(symbol, signal, marketData, btcBenchmark));

  const losses = loadLossMemory()
    .filter(r => r.symbol === cleanSymbol)
    .map(r => ({ ...r, outcome: 'LOSS' }));
  const wins = loadWinMemory()
    .filter(r => r.symbol === cleanSymbol)
    .map(r => ({ ...r, outcome: r.outcome || 'WIN' }));

  let best = null;
  for (const record of [...losses, ...wins]) {
    const sim = jaccard(liveGrams, trigramsOf(summarizeRecord(record)));
    if (sim >= SIMILARITY_THRESHOLD && (!best || sim > best.similarity)) {
      best = { outcome: record.outcome, similarity: sim, diagnostic: record.diagnostic, trapType: record.trapType };
    }
  }
  return best;
}

/**
 * Confidence adjustment to apply for the closest match found, if any.
 * Positive for a WIN match (small boost), negative for a LOSS match
 * (larger penalty). Returns 0 / null match when nothing crosses threshold.
 */
function evaluateSimilarity(symbol, signal, marketData, btcBenchmark) {
  if (!signal || signal === 'HOLD') {
    return { match: null, confidenceDelta: 0 };
  }
  const match = findClosestMatch(symbol, signal, marketData, btcBenchmark);
  if (!match) {
    return { match: null, confidenceDelta: 0 };
  }
  if (match.outcome === 'LOSS') {
    const penalty = Math.min(MAX_LOSS_PENALTY, 0.20 * match.similarity);
    return { match, confidenceDelta: -parseFloat(penalty.toFixed(3)) };
  }
  const boost = Math.min(MAX_WIN_BOOST, 0.07 * match.similarity);
  return { match, confidenceDelta: parseFloat(boost.toFixed(3)) };
}

module.exports = {
  evaluateSimilarity,
  findClosestMatch,
  SIMILARITY_THRESHOLD,
  MAX_LOSS_PENALTY,
  MAX_WIN_BOOST,
};
