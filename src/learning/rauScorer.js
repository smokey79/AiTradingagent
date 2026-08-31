/**
 * RAU Scorer — Relevance × Accuracy × Utility
 * ============================================
 * Scores every YouTube-sourced learning insight on three independent axes
 * before it is allowed to enter agent memory or influence consensus.
 *
 * Formula:
 *   RAU = (0.40 × R) + (0.35 × A) + (0.25 × U)
 *
 * Gate tiers:
 *   RAU < 0.35          → REJECT   (not stored)
 *   0.35 ≤ RAU < 0.55   → LOW      (stored, confidence capped at 0.45)
 *   0.55 ≤ RAU < 0.75   → NORMAL   (stored, confidence as-scored)
 *   RAU ≥ 0.75          → HIGH     (stored, +0.08 confidence boost to consensus)
 */

'use strict';

// ── Trading universe — symbols the agent actively trades ─────────────────────
const TRADING_SYMBOLS = [
  'BTC', 'BITCOIN', 'ETH', 'ETHEREUM', 'SOL', 'SOLANA',
  'CRO', 'AVAX', 'AVALANCHE', 'ARB', 'ARBITRUM', 'OP', 'OPTIMISM',
  'LINK', 'CHAINLINK', 'AAVE', 'UNI', 'UNISWAP', 'BNB', 'XRP',
];

// ── High-signal trading keywords ─────────────────────────────────────────────
const TRADING_KEYWORDS = [
  'order block', 'fair value gap', 'fvg', 'smart money', 'smc',
  'support', 'resistance', 'breakout', 'breakdown', 'liquidity sweep',
  'rsi', 'macd', 'ema', 'sma', 'bollinger', 'vwap', 'mfi',
  'leverage', 'futures', 'perpetual', 'spot', 'short', 'long',
  'dca', 'accumulation', 'distribution', 'stop loss', 'take profit',
  'risk reward', 'r:r', 'scalp', 'swing', 'position size',
  'on-chain', 'onchain', 'mvrv', 'sopr', 'funding rate',
  'open interest', 'etf', 'institutional', 'whale',
  'technical analysis', 'ta', 'chart', 'candle', 'pattern',
  'head and shoulders', 'triangle', 'wedge', 'flag', 'pennant',
  'lux algo', 'luxalgo', 'tradingview', 'pinescript',
];

// ── Utility markers — signals that content is actionable ─────────────────────
const PRICE_LEVEL_RE  = /\$[\d,]+k?|\b\d{4,6}k?\b|\b\d+[.,]\d+k\b/i;
const INDICATOR_RE    = /\b(rsi|macd|ema|sma|vwap|mfi|atr|bollinger|stoch|ichimoku|adx|obv)\b/i;
const RISK_PARAM_RE   = /\b(stop.?loss|take.?profit|sl|tp|risk.?reward|liquidat|position.?size)\b/i;
const PINESCRIPT_RE   = /\b(pinescript|pine.?script|strategy|alert|tradingview.?code)\b/i;
const PERCENTAGE_RE   = /\d+(\.\d+)?%/;

// ── Tier thresholds ───────────────────────────────────────────────────────────
const TIERS = {
  REJECT: { min: 0,    max: 0.35, label: 'REJECT',  confidenceCap: 0 },
  LOW:    { min: 0.35, max: 0.55, label: 'LOW',     confidenceCap: 0.45 },
  NORMAL: { min: 0.55, max: 0.75, label: 'NORMAL',  confidenceCap: 0.80 },
  HIGH:   { min: 0.75, max: 1.01, label: 'HIGH',    confidenceCap: 1.0, boost: 0.08 },
};

// ─────────────────────────────────────────────────────────────────────────────
// R — Relevance Score
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} text          - Combined title + description (lowercased)
 * @param {string} channelTag    - Optional category tag from channel metadata
 * @returns {number} 0.0 – 1.0
 */
function scoreRelevance(text, channelTag = '') {
  const lower = text.toLowerCase();

  // Symbol hits (each hit = +0.15, capped at 0.40)
  const symbolHits = TRADING_SYMBOLS.filter(sym =>
    lower.includes(sym.toLowerCase())
  ).length;
  const symbolScore = Math.min(0.40, symbolHits * 0.15);

  // Trading keyword hits (each = +0.08, capped at 0.40)
  const kwHits = TRADING_KEYWORDS.filter(kw => lower.includes(kw)).length;
  const kwScore = Math.min(0.40, kwHits * 0.08);

  // Channel category bonus
  const tagLower = channelTag.toLowerCase();
  const categoryBonus =
    tagLower.includes('crypto') || tagLower.includes('trading') ||
    tagLower.includes('finance') || tagLower.includes('invest') ||
    tagLower.includes('blockchain') || tagLower.includes('defi') ? 0.20 : 0;

  return Math.min(1.0, symbolScore + kwScore + categoryBonus);
}

// ─────────────────────────────────────────────────────────────────────────────
// A — Accuracy Score
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} credibility - Channel entry from channel_credibility.json
 *   { correct: number, total: number, weight: number }
 * @returns {number} 0.0 – 1.0
 */
function scoreAccuracy(credibility = {}) {
  const { correct = 0, total = 0 } = credibility;

  // New channels with fewer than 5 attributed trades → neutral 0.50
  if (total < 5) return 0.50;

  // Bayesian-smoothed accuracy: add 2 prior wins and 2 prior losses
  const smoothedAcc = (correct + 2) / (total + 4);
  return Math.min(1.0, Math.max(0.0, smoothedAcc));
}

// ─────────────────────────────────────────────────────────────────────────────
// U — Utility Score
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} text - Combined title + description
 * @returns {number} 0.0 – 1.0
 */
function scoreUtility(text) {
  let score = 0;

  if (PRICE_LEVEL_RE.test(text))  score += 0.30;
  if (INDICATOR_RE.test(text))    score += 0.25;
  if (RISK_PARAM_RE.test(text))   score += 0.25;
  if (PINESCRIPT_RE.test(text))   score += 0.20;

  // Bonus: percentage targets mentioned (TP/SL levels)
  const pctMatches = (text.match(new RegExp(PERCENTAGE_RE.source, 'gi')) || []).length;
  if (pctMatches >= 2) score += 0.10;

  return Math.min(1.0, score);
}

// ─────────────────────────────────────────────────────────────────────────────
// Composite RAU Score
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Score a learning insight on all three RAU dimensions.
 *
 * @param {object} opts
 * @param {string}  opts.title       - Video title
 * @param {string}  [opts.description] - Video description (first 800 chars)
 * @param {string}  [opts.channelTag]  - Channel category tag
 * @param {object}  [opts.credibility] - Channel credibility record
 * @returns {{
 *   rau: number,
 *   tier: string,
 *   accept: boolean,
 *   confidenceCap: number,
 *   boost: number,
 *   breakdown: { relevance: number, accuracy: number, utility: number }
 * }}
 */
function scoreRAU({ title = '', description = '', channelTag = '', credibility = {} }) {
  const text = `${title}. ${description}`.slice(0, 1000);

  const R = scoreRelevance(text, channelTag);
  const A = scoreAccuracy(credibility);
  const U = scoreUtility(text);

  const rau = parseFloat(((0.40 * R) + (0.35 * A) + (0.25 * U)).toFixed(4));

  // Determine tier
  let tier = TIERS.REJECT;
  for (const t of Object.values(TIERS)) {
    if (rau >= t.min && rau < t.max) { tier = t; break; }
  }

  return {
    rau,
    tier:          tier.label,
    accept:        tier.label !== 'REJECT',
    confidenceCap: tier.confidenceCap,
    boost:         tier.boost || 0,
    breakdown:     { relevance: R, accuracy: A, utility: U },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Channel-level trading relevance (used to skip non-trading subscriptions)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Given an array of recent video titles for a channel, returns the average
 * relevance score. Channels below 0.30 are skipped in the sentiment scan.
 *
 * @param {string[]} recentTitles - Up to 10 recent video titles
 * @param {string}   channelTag   - Channel category tag
 * @returns {number} Average relevance score 0–1
 */
function channelRelevanceAvg(recentTitles = [], channelTag = '') {
  if (!recentTitles.length) return 0;
  const scores = recentTitles.map(t => scoreRelevance(t, channelTag));
  return parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(4));
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  scoreRAU,
  scoreRelevance,
  scoreAccuracy,
  scoreUtility,
  channelRelevanceAvg,
  TIERS,
  TRADING_SYMBOLS,
  TRADING_KEYWORDS,
};
