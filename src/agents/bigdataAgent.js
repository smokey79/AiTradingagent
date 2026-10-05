/**
 * src/agents/bigdataAgent.js
 * ===========================
 * Node-side reader for the Bigdata.com news/macro sentiment feed. Added
 * 2026-09-28 (Alan's explicit instruction: "add bigdata and all avadble
 * live data" as evidence feeding the bull/bear bias decision, wired in as
 * a 4th real voting agent alongside claude/openrouter_free/oanda_sentiment
 * -- see consensus.js).
 *
 * This file does NOT call the Bigdata.com API itself and never spawns a
 * Python subprocess on the fast consensus loop. All fetching, scoring and
 * caching is done by data_sources/bigdata_feed.py, run on its own slow
 * 30-min schedule by scripts/bigdata_analyst.py (a dedicated PM2 process).
 * This agent just reads the cached JSON that process writes
 * (data/external/bigdata_latest.json) and re-implements the exact same
 * scoring rules as bigdata_feed.py's get_consensus_input(), in JS, so the
 * two stay in lockstep -- see that Python file's header for the full
 * rationale (only real measured scores, no synthetic fallback figures,
 * abstains on missing key / stale cache / too few chunks).
 *
 * Env vars (shared with bigdata_feed.py via .env, same names/defaults so
 * tuning one side tunes both):
 *   BIGDATA_MIN_CHUNKS       default 8   (below this -> abstain, sample too small)
 *   BIGDATA_WEIGHT           default 0.15
 *   BIGDATA_MAX_CACHE_HOURS  default 6   (older cache = stale = abstain)
 *   BIGDATA_LOOKBACK_HOURS   default 24  (used only in the human-readable reason text)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const CACHE_PATH = path.join(__dirname, '..', '..', 'data', 'external', 'bigdata_latest.json');

const MIN_CHUNKS = parseInt(process.env.BIGDATA_MIN_CHUNKS || '8', 10);
const WEIGHT = parseFloat(process.env.BIGDATA_WEIGHT || '0.15');
const MAX_CACHE_HOURS = parseFloat(process.env.BIGDATA_MAX_CACHE_HOURS || '6');
const LOOKBACK_HOURS = parseFloat(process.env.BIGDATA_LOOKBACK_HOURS || '24');

function abstain(reason) {
  return {
    // NOTE: literal 0.0 here would trip consensus.js's processResult()
    // `parseFloat(...) || 0.70` fallback (0 is falsy in JS), silently
    // turning an honest "no data, abstaining" vote into a fake 70%
    // confidence HOLD in the logs/dashboard. 0.001 stays effectively zero
    // (displays as 0% and contributes negligible weight) while dodging
    // that falsy-zero trap. Found live while wiring this agent in.
    signal: 'HOLD',
    confidence: 0.001,
    reason: `Bigdata.com: ${reason}`,
    model_used: 'bigdata-sentiment',
    provider: 'bigdata_sentiment',
  };
}

function loadSnapshot() {
  if (!fs.existsSync(CACHE_PATH)) return null;
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    const snap = JSON.parse(raw);
    const fetchedMs = Date.parse(snap.fetched_utc);
    if (Number.isNaN(fetchedMs)) return null;
    const ageMinutes = (Date.now() - fetchedMs) / 60000;
    snap.age_minutes = Math.round(ageMinutes * 10) / 10;
    snap.stale = ageMinutes > MAX_CACHE_HOURS * 60;
    return snap;
  } catch (err) {
    logger.warn(`[bigdataAgent] cache unreadable: ${err.message}`);
    return null;
  }
}

async function getSignal(symbol, marketData, pair) {
  try {
    const asset = (symbol || pair || '').toUpperCase().split('/')[0];
    if (!asset) return abstain('no symbol to look up');

    const snap = loadSnapshot();
    if (!snap) {
      return abstain('no cached data yet (bigdata-analyst process may not have run, or BIGDATA_API_KEY is not set)');
    }
    if (snap.stale) {
      return abstain(`cache ${snap.age_minutes} min old (stale)`);
    }

    const s = (snap.assets || {})[asset];
    const nChunks = s ? (s.n_chunks || 0) : 0;
    if (!s || nChunks < MIN_CHUNKS) {
      return abstain(`only ${nChunks} news chunks for ${asset} in ${LOOKBACK_HOURS}h (< ${MIN_CHUNKS}) - sample too small`);
    }

    const sent = s.sentiment;
    const agree = s.agreement;
    let signal = 'HOLD';
    if (agree >= 0.6 && sent >= 0.15) signal = 'BUY';
    else if (agree >= 0.6 && sent <= -0.15) signal = 'SELL';

    let conf = WEIGHT * Math.min(1.0, Math.abs(sent) / 0.5) * agree;

    const macro = snap.macro || {};
    const m = macro.sentiment;
    let macroNote = 'n/a';
    if (m !== null && m !== undefined) {
      macroNote = Math.round(m * 100) / 100;
      if ((macro.n_chunks || 0) >= MIN_CHUNKS && m <= -0.15 && signal === 'BUY') {
        conf *= 0.5; // risk-off macro backdrop halves long conviction -- same rule as bigdata_feed.py
      }
    }

    const reason = `Bigdata.com ${asset}: sentiment ${sent >= 0 ? '+' : ''}${sent.toFixed(2)}, ` +
      `${Math.round(agree * 100)}% agreement, ${nChunks} chunks / ${s.n_docs || 0} docs (${LOOKBACK_HOURS}h); macro ${macroNote}`;

    return {
      signal,
      confidence: signal === 'HOLD' ? 0.001 : Math.round(conf * 1000) / 1000, // 0.001 not 0.0 — see abstain() note above
      reason,
      model_used: 'bigdata-sentiment',
      provider: 'bigdata_sentiment',
    };
  } catch (err) {
    logger.warn(`[bigdataAgent] ${symbol || pair}: ${err.message}`);
    return abstain(`check failed: ${err.message}`);
  }
}

module.exports = { getSignal };
