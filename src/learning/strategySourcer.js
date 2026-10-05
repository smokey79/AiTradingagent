/**
 * strategySourcer.js — 2026-10-05
 * ================================
 * Sources NEW candidate trading-strategy ideas from outside the bot (GitHub,
 * and Twitter/X when configured), for scripts/strategy_advisor.js to
 * backtest alongside the 4 built-in presets in pineScriptGenerator.js. This
 * module NEVER backtests anything itself and NEVER fabricates a result — it
 * only produces candidate PARAMETER sets mapped onto one of the existing
 * STRATEGY_PRESETS, for the real backtest engine (backtestEngine.js, via
 * strategyLearningAgent.optimizeStrategy) to actually test against real
 * historical candles.
 *
 * Sources are opt-in and fail CLOSED with a clear one-time log line, never a
 * silent no-op:
 *   - GitHub code search for public Pine Script strategy files. Needs
 *     GITHUB_TOKEN (any classic PAT, public_repo scope — GitHub's code
 *     search API has required auth for years, even for public repos; a
 *     free token at github.com/settings/tokens is enough, no paid tier).
 *   - Twitter/X recent search for strategy-sharing accounts/hashtags. Needs
 *     TWITTER_BEARER_TOKEN (X API v2). As of 2026 X's free API tier does
 *     not include search, so this stays a documented no-op for most
 *     accounts until Alan has a paid X API tier — it is wired and ready,
 *     not faked.
 *
 * A fetched strategy only becomes USEFUL once an LLM reads its source text
 * and maps it onto one of our 4 known presets (or says "unmappable"). That
 * classification step reuses openrouterFreeAgent.callFreeModelRaw() — the
 * same free-model rotation + local-Ollama + paid-fallback chain every other
 * agent in this bot already relies on, so this needs no new LLM key and
 * costs nothing beyond what's already configured.
 */
'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { parseLenient } = require('../utils/lenientJson');
const { STRATEGY_PRESETS } = require('./pineScriptGenerator');

const DATA_DIR = path.resolve(__dirname, '../../data');
const STATE_PATH = path.join(DATA_DIR, 'strategy_sourcer_state.json');

const GITHUB_TOKEN = (process.env.GITHUB_TOKEN || '').trim();
const TWITTER_BEARER_TOKEN = (process.env.TWITTER_BEARER_TOKEN || '').trim();

let warnedGithub = false;
let warnedTwitter = false;

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return { seenGithub: {} }; }
}
function saveState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// Curated, deliberately narrow search terms — broad terms like "strategy"
// return mostly noise on GitHub code search and burn through the rate limit.
const GITHUB_QUERIES = [
  'strategy.entry pyramiding language:Pine',
  'ta.crossover ta.ema strategy language:Pine',
  'smc order block fair value gap language:Pine',
];

async function sourceFromGithub(limitPerQuery = 3) {
  if (!GITHUB_TOKEN) {
    if (!warnedGithub) {
      logger.info('[StrategySourcer] GitHub sourcing disabled — no GITHUB_TOKEN. '
        + 'Generate a free classic PAT (public_repo scope only) at '
        + 'github.com/settings/tokens and add GITHUB_TOKEN=... to .env to enable.');
      warnedGithub = true;
    }
    return [];
  }

  const state = loadState();
  const found = [];
  for (const q of GITHUB_QUERIES) {
    try {
      const { data } = await axios.get('https://api.github.com/search/code', {
        params: { q, per_page: limitPerQuery },
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'AiTradingAgent-StrategySourcer',
        },
        timeout: 10000,
      });
      for (const item of (data.items || [])) {
        const key = item.sha || item.html_url;
        if (state.seenGithub[key]) continue;
        state.seenGithub[key] = { seenAt: new Date().toISOString() };
        found.push({
          origin: 'github',
          repo: item.repository?.full_name,
          path: item.path,
          url: item.html_url,
          rawUrl: `https://raw.githubusercontent.com/${item.repository?.full_name}/HEAD/${item.path}`,
          query: q,
        });
      }
    } catch (err) {
      logger.warn(`[StrategySourcer] GitHub search failed for "${q}": ${err.response?.status || err.message}`);
    }
    await new Promise(r => setTimeout(r, 2000)); // stay gentle on GitHub's rate limits
  }
  saveState(state);
  return found;
}

async function sourceFromTwitter(limit = 5) {
  if (!TWITTER_BEARER_TOKEN) {
    if (!warnedTwitter) {
      logger.info('[StrategySourcer] Twitter/X sourcing disabled — no TWITTER_BEARER_TOKEN '
        + "(X API v2). X's free tier does not include search as of 2026; this "
        + 'activates automatically once a bearer token with search access is '
        + 'added to .env.');
      warnedTwitter = true;
    }
    return [];
  }
  try {
    const { data } = await axios.get('https://api.twitter.com/2/tweets/search/recent', {
      params: { query: '(pine script strategy OR tradingview strategy) -is:retweet lang:en', max_results: limit },
      headers: { Authorization: `Bearer ${TWITTER_BEARER_TOKEN}` },
      timeout: 10000,
    });
    return (data.data || []).map(t => ({ origin: 'twitter', id: t.id, text: t.text }));
  } catch (err) {
    logger.warn(`[StrategySourcer] Twitter search failed: ${err.response?.status || err.message}`);
    return [];
  }
}

/** Fetch a GitHub candidate's raw file text (small cap — classification only needs a sample). */
async function fetchRawText(candidate) {
  if (!candidate.rawUrl) return candidate.text || null;
  try {
    const { data } = await axios.get(candidate.rawUrl, { timeout: 8000, responseType: 'text' });
    return String(data).slice(0, 4000);
  } catch (err) {
    logger.debug(`[StrategySourcer] raw fetch failed for ${candidate.rawUrl}: ${err.message}`);
    return null;
  }
}

const PRESET_IDS = Object.keys(STRATEGY_PRESETS);

/**
 * Ask a free LLM (via the bot's existing rotation) to map arbitrary sourced
 * strategy text onto one of our 4 known, already-backtestable presets.
 * Never invents a result: on any failure or low confidence, returns
 * matchesPreset: null, which the caller must treat as "skip this one".
 */
async function classifyCandidate(candidate, rawText) {
  if (!rawText || rawText.trim().length < 20) return { ...candidate, matchesPreset: null, reason: 'no readable content' };
  const { callFreeModelRaw } = require('../agents/openrouterFreeAgent'); // lazy require avoids a load-order cycle
  const prompt = `You are classifying a trading strategy found on ${candidate.origin}. `
    + `We only support backtesting strategies that resemble one of these presets: ${PRESET_IDS.join(', ')}. `
    + `Known preset meanings: smc_luxalgo_5x = order blocks/liquidity sweeps/FVG; `
    + `casper_orb_retest = opening-range breakout + retest; `
    + `multi_factor_breakout = EMA50/200 trend + volume breakout; `
    + `oscillator_divergence = RSI/MFI/MACD divergence. `
    + `Read this source text and reply with STRICT JSON only, no prose: `
    + `{"matchesPreset": one of [${PRESET_IDS.map(p => `"${p}"`).join(', ')}, "unmappable"], `
    + `"paramHints": {}, "confidence": 0.0-1.0, "summary": "one line"}. `
    + `Source text (may be truncated):\n\n${rawText}`;
  try {
    const { text, model } = await callFreeModelRaw(prompt);
    const parsed = parseLenient(text, 'matchesPreset');
    const matchesPreset = PRESET_IDS.includes(parsed.matchesPreset) ? parsed.matchesPreset : null;
    return { ...candidate, matchesPreset, paramHints: parsed.paramHints || {}, confidence: Number(parsed.confidence) || 0, summary: parsed.summary || '', classifiedBy: model };
  } catch (err) {
    logger.debug(`[StrategySourcer] classification failed for ${candidate.url || candidate.id}: ${err.message}`);
    return { ...candidate, matchesPreset: null, reason: err.message };
  }
}

/**
 * Main entry point for scripts/strategy_advisor.js's slower sourcing pass.
 * Returns only candidates that classified as a KNOWN preset with
 * confidence >= minConfidence — never the raw, unmapped list.
 */
async function sourceCandidateStrategies({ minConfidence = 0.5 } = {}) {
  const githubCandidates = await sourceFromGithub();
  const twitterCandidates = await sourceFromTwitter();
  const all = [...githubCandidates, ...twitterCandidates];
  if (!all.length) return [];

  logger.info(`[StrategySourcer] ${all.length} new raw candidate(s) found (${githubCandidates.length} GitHub, ${twitterCandidates.length} Twitter) — classifying...`);

  const accepted = [];
  for (const c of all) {
    const rawText = c.text || await fetchRawText(c);
    const classified = await classifyCandidate(c, rawText);
    if (classified.matchesPreset && classified.confidence >= minConfidence) {
      accepted.push(classified);
      logger.info(`[StrategySourcer] Accepted ${classified.origin} candidate as "${classified.matchesPreset}" `
        + `(conf ${classified.confidence.toFixed(2)}): ${classified.summary}`);
    }
  }
  return accepted;
}

module.exports = { sourceCandidateStrategies, sourceFromGithub, sourceFromTwitter, classifyCandidate };
