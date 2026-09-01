/**
 * YouTube Agent Continuous Learning Engine — RAU Edition
 * =======================================================
 * Ingests YouTube video URLs, scores them on Relevance × Accuracy × Utility,
 * and ONLY persists insights that pass the RAU quality gate (≥ 0.35).
 *
 * Critical fixes vs previous version:
 *   1. REMOVED hardcoded confidence: 0.82 — confidence is now RAU-derived.
 *   2. FIXED: updateChannelWeight() is NO LONGER called at ingest time.
 *      Channel credibility is updated ONLY after a real trade outcome is known
 *      (handled by strategyLearner.js → #updateChannelCredibility).
 *   3. Added LLM-via-Hermes sentiment analysis with keyword fallback.
 *   4. REJECT tier entries are logged but never stored in learning_memory.json.
 */

'use strict';

const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const logger = require('../utils/logger');
const { scoreRAU } = require('./rauScorer');

const DATA_DIR            = path.resolve(__dirname, '../../data');
const LEARNING_MEMORY_PATH = path.join(DATA_DIR, 'learning_memory.json');
const CREDIBILITY_PATH     = path.resolve(__dirname, '../sentiment/channel_credibility.json');
const MAX_MEMORY_ENTRIES   = 300;

// ── Utility helpers ──────────────────────────────────────────────────────────

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function extractVideoId(url) {
  if (!url) return null;
  const regExp = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match  = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : url;
}

function readLearningMemory() {
  ensureDataDir();
  try {
    if (fs.existsSync(LEARNING_MEMORY_PATH)) {
      return JSON.parse(fs.readFileSync(LEARNING_MEMORY_PATH, 'utf8'));
    }
  } catch (_) { /* ignore parse errors — start fresh */ }
  return [];
}

function saveLearningMemory(memory) {
  ensureDataDir();
  fs.writeFileSync(LEARNING_MEMORY_PATH, JSON.stringify(memory, null, 2));
}

function readCredibility(channelId) {
  try {
    if (fs.existsSync(CREDIBILITY_PATH)) {
      const creds = JSON.parse(fs.readFileSync(CREDIBILITY_PATH, 'utf8'));
      return creds[channelId] || {};
    }
  } catch (_) { /* ignore */ }
  return {};
}

// ── Sentiment via Hermes (local Ollama) ──────────────────────────────────────

async function scoreSentimentWithHermes(title, description) {
  const text = `${title}. ${description}`.slice(0, 800);
  try {
    const host  = process.env.OLLAMA_HOST      || 'http://localhost:11434';
    const model = process.env.HERMES_MODEL_NAME || 'hermes3';
    const prompt = `You are a crypto trading sentiment analyser.
Analyse this YouTube content and return ONLY valid JSON with no extra text.
Return: {"sentiment":"bullish|bearish|neutral","confidence":0.0-1.0,"reason":"one sentence","asset":"BTC|ETH|SOL|CRO|AVAX|ARB|general"}
Content: ${text}`;

    const { data } = await axios.post(
      `${host}/api/generate`,
      { model, prompt, stream: false, format: 'json' },
      { timeout: 8000 }
    );
    return JSON.parse(data.response);
  } catch (_) {
    return null; // fall back to keyword scoring
  }
}

function scoreSentimentKeywords(title, description) {
  const text = `${title} ${description}`.toLowerCase();

  const BULLISH_KW = ['moon', 'bull', 'breakout', 'accumulate', 'buy', 'surge',
    'rally', 'ath', 'pump', 'uptrend', 'golden cross', 'undervalued',
    'institutional', 'inflow', 'long', 'reversal', 'support holds'];
  const BEARISH_KW = ['crash', 'bear', 'dump', 'sell', 'panic', 'collapse',
    'liquidation', 'atl', 'downtrend', 'death cross', 'overvalued',
    'ban', 'hack', 'outflow', 'short', 'rejection', 'breakdown'];

  const bullHits = BULLISH_KW.filter(kw => text.includes(kw)).length;
  const bearHits = BEARISH_KW.filter(kw => text.includes(kw)).length;
  const total    = bullHits + bearHits || 1;
  const score    = (bullHits - bearHits) / total;

  return {
    sentiment:  score > 0.1 ? 'bullish' : score < -0.1 ? 'bearish' : 'neutral',
    confidence: Math.min(Math.abs(score) * 1.5, 0.80),
    reason:     `Keyword: ${bullHits} bullish vs ${bearHits} bearish`,
    asset:      'general',
  };
}

// ── Detect mentioned coins ────────────────────────────────────────────────────

const COIN_MAP = {
  btc: 'BTC', bitcoin: 'BTC',
  eth: 'ETH', ethereum: 'ETH',
  sol: 'SOL', solana: 'SOL',
  cro: 'CRO', cronos: 'CRO',
  avax: 'AVAX', avalanche: 'AVAX',
  arb: 'ARB', arbitrum: 'ARB',
  op: 'OP', optimism: 'OP',
  link: 'LINK', chainlink: 'LINK',
  aave: 'AAVE',
};

function detectCoins(text) {
  const lower = text.toLowerCase();
  const found = new Set();
  for (const [kw, sym] of Object.entries(COIN_MAP)) {
    if (lower.includes(kw)) found.add(sym);
  }
  return found.size > 0 ? [...found] : ['BTC', 'ETH'];
}

// ── Main public API ──────────────────────────────────────────────────────────

/**
 * Ingest and learn from a YouTube video URL.
 * Scores the content on RAU before persisting.
 * Does NOT update channel credibility — that happens in strategyLearner.js
 * when a trade outcome is actually known.
 *
 * @param {string} url               - YouTube video URL or video ID
 * @param {string} [channelName]     - Optional channel title override
 * @param {string} [channelTag]      - Optional category tag ("crypto", "finance", etc.)
 * @param {string} [channelId]       - Optional YouTube channel ID (for credibility lookup)
 * @returns {object} Learned insight or rejection object
 */
async function learnFromYouTubeUrl(url, channelName = 'Crypto Analyst', channelTag = '', channelId = null) {
  const videoId = extractVideoId(url);
  logger.info(`[YouTubeLearner] Scoring: ${url} (id: ${videoId})`);

  let videoTitle   = `Crypto Market Update [${videoId}]`;
  let description  = '';

  // Fetch title + description via oEmbed
  try {
    const oembedUrl = `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`;
    const res = await axios.get(oembedUrl, { timeout: 5000 });
    if (res.data?.title)       videoTitle  = res.data.title;
    if (res.data?.author_name) channelName = res.data.author_name;
    // noembed doesn't return description — try youtube-transcript-api style endpoint
  } catch (e) {
    logger.debug(`[YouTubeLearner] oEmbed failed for ${videoId}: ${e.message}`);
  }

  // ── RAU scoring ────────────────────────────────────────────────────────────
  const credibility = channelId ? readCredibility(channelId) : {};
  const rauResult   = scoreRAU({
    title:       videoTitle,
    description,
    channelTag,
    credibility,
  });

  logger.info(
    `[YouTubeLearner] RAU=${rauResult.rau.toFixed(3)} | Tier=${rauResult.tier} ` +
    `| R=${rauResult.breakdown.relevance.toFixed(2)} A=${rauResult.breakdown.accuracy.toFixed(2)} U=${rauResult.breakdown.utility.toFixed(2)}`
  );

  if (!rauResult.accept) {
    logger.warn(`[YouTubeLearner] REJECTED (RAU=${rauResult.rau.toFixed(3)} < 0.35): "${videoTitle}"`);
    const insightId = `YT_${videoId}_${Date.now()}`;
    return {
      id:       insightId,
      rejected: true,
      reason:   `RAU score ${rauResult.rau.toFixed(3)} below minimum 0.35 gate`,
      rau:      rauResult,
      videoId,
      title:    videoTitle,
      channel:  channelName,
      mentionedCoins: ['BTC', 'ETH'],
      sentimentScore: 0.50,
      timestamp: new Date().toISOString(),
    };
  }

  // ── Sentiment scoring ──────────────────────────────────────────────────────
  let sentimentData = await scoreSentimentWithHermes(videoTitle, description);
  if (!sentimentData) {
    sentimentData = scoreSentimentKeywords(videoTitle, description);
  }

  // Confidence = RAU-derived, capped by tier, then blended with sentiment confidence
  const rauConfidence   = Math.min(rauResult.rau * 1.15, rauResult.confidenceCap);
  const finalConfidence = parseFloat(
    Math.min(rauResult.confidenceCap, (rauConfidence * 0.6 + sentimentData.confidence * 0.4) + rauResult.boost).toFixed(4)
  );

  const mentionedCoins = detectCoins(videoTitle + ' ' + description);

  const signal = sentimentData.sentiment === 'bullish' ? 'BUY'
               : sentimentData.sentiment === 'bearish' ? 'SELL'
               : 'HOLD';

  const insight = {
    id:               `YT_${Date.now()}_${videoId}`,
    timestamp:        new Date().toISOString(),
    videoId,
    url,
    channelId:        channelId || null,
    channel:          channelName,
    channelTag,
    title:            videoTitle,
    mentionedCoins,
    signal,
    sentiment:        sentimentData.sentiment,
    sentimentScore:   sentimentData.sentiment === 'bullish' ? finalConfidence
                    : sentimentData.sentiment === 'bearish' ? -finalConfidence : 0,
    confidence:       finalConfidence,
    scoredBy:         sentimentData.scoredBy || 'hermes',
    reason:           sentimentData.reason,
    // RAU metadata — stored for audit and future re-scoring
    rau: {
      score:      rauResult.rau,
      tier:       rauResult.tier,
      breakdown:  rauResult.breakdown,
      boost:      rauResult.boost,
    },
    // NOTE: channelReliability is NOT updated here.
    // It is updated by strategyLearner.js ONLY after a trade outcome is known.
    channelReliabilityAtIngest: credibility.weight ?? 1.0,
  };

  // Persist to learning memory
  const memory = readLearningMemory();
  memory.unshift(insight);
  if (memory.length > MAX_MEMORY_ENTRIES) memory.pop();
  saveLearningMemory(memory);

  logger.info(
    `[YouTubeLearner] ✅ Stored: "${videoTitle}" → ${signal} | confidence=${finalConfidence} | tier=${rauResult.tier}`
  );

  return insight;
}

/**
 * Get the most recent N entries from learning memory.
 * Optionally filter by minimum RAU score.
 *
 * @param {number} limit      - Max entries to return (default 20)
 * @param {number} minRau     - Minimum RAU score to include (default 0)
 */
function getLearnedAlpha(limit = 20, minRau = 0) {
  const memory = readLearningMemory();
  return memory
    .filter(m => (m.rau?.score ?? 1) >= minRau)
    .slice(0, limit);
}

/**
 * Get a summary of what's currently in learning memory.
 * Grouped by tier, with hit-rate and average confidence.
 */
function getLearningMemoryStats() {
  const memory = readLearningMemory();
  const byTier = { HIGH: [], NORMAL: [], LOW: [] };

  for (const m of memory) {
    const tier = m.rau?.tier || 'NORMAL';
    if (byTier[tier]) byTier[tier].push(m);
  }

  const stats = {};
  for (const [tier, entries] of Object.entries(byTier)) {
    const avgConf = entries.length
      ? entries.reduce((a, b) => a + (b.confidence || 0), 0) / entries.length
      : 0;
    stats[tier] = { count: entries.length, avgConfidence: parseFloat(avgConf.toFixed(4)) };
  }

  return {
    totalEntries: memory.length,
    byTier:       stats,
    topChannels:  _topChannels(memory, 5),
  };
}

function _topChannels(memory, n) {
  const counts = {};
  for (const m of memory) {
    const ch = m.channel || 'Unknown';
    if (!counts[ch]) counts[ch] = { count: 0, avgRau: 0, rauSum: 0 };
    counts[ch].count++;
    counts[ch].rauSum += m.rau?.score || 0;
  }
  return Object.entries(counts)
    .map(([ch, v]) => ({ channel: ch, videos: v.count, avgRau: parseFloat((v.rauSum / v.count).toFixed(3)) }))
    .sort((a, b) => b.avgRau - a.avgRau)
    .slice(0, n);
}

module.exports = {
  extractVideoId,
  learnFromYouTubeUrl,
  getLearnedAlpha,
  getLearningMemoryStats,
};
