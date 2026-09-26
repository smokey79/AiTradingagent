/**
 * src/agents/evidenceCandidatesAgent.js
 * Consensus agent `evidence_candidates`: runs the 6 lab-passing strategy cells
 * (src/agents/evidenceCandidates/config.js) as forward paper tests and votes with
 * their CURRENT position (long = BUY, short = SELL, flat = HOLD).
 *
 * Vote strength comes from measured evidence (src/risk/strategyEvidence.js): a
 * candidate that keeps earning on paper gets a stronger vote; one that stops earning
 * is weakened automatically. It never vetoes and never places orders.
 * Fails safe to HOLD on any error.
 */
'use strict';
const logger = require('../utils/logger');
const { CANDIDATES } = require('./evidenceCandidates/config');
const engine = require('./evidenceCandidates/engine');
const { getCandles } = require('./evidenceCandidates/priceFeed');
const { tierFor } = require('../risk/strategyEvidence');

const MODEL = 'evidence-candidates-v1 (deterministic, no LLM)';
const hold = (reason) => ({ signal: 'HOLD', confidence: 0, reason, model_used: MODEL, provider: 'evidence_candidates', veto_flag: false });

/** Update every candidate for one coin, return their states + evidence tiers. */
async function refreshCoin(coin, { now = Date.now(), fetcher = getCandles } = {}) {
  const cands = CANDIDATES.filter((c) => c.coin === coin);
  const state = engine.loadState();
  const out = [];
  for (const cand of cands) {
    try {
      const { candles, source } = await fetcher(coin, cand.timeframe, { limit: 500 });
      state[cand.id] = engine.step(cand, candles, state[cand.id] || {}, now);
      const tier = tierFor(cand, engine.readLedger(cand.id));
      out.push({ cand, st: state[cand.id], tier, source });
    } catch (e) {
      logger.warn(`[evidence_candidates] ${cand.id}: ${e.message}`);
    }
  }
  engine.saveState(state);
  return out;
}

async function getSignal(symbol, _marketData, opts) {
  const coin = String(symbol).split('/')[0].toUpperCase();
  if (!CANDIDATES.some((c) => c.coin === coin)) return hold(`evidence_candidates: no lab-validated candidate for ${coin}`);
  try {
    const rows = await refreshCoin(coin, opts);
    const active = rows.filter((r) => r.st && r.st.pos);
    if (active.length === 0) return hold(`evidence_candidates: ${rows.length} candidate(s) for ${coin}, all flat`);
    // Net the positions, weighting each by its evidence vote multiplier.
    let score = 0, wsum = 0;
    for (const r of active) { const w = r.tier.vote; score += (r.st.pos === 'long' ? 1 : -1) * w; wsum += w; }
    const net = score / wsum;
    if (Math.abs(net) < 0.34) return hold(`evidence_candidates: candidates disagree on ${coin}`);
    const best = active.reduce((a, b) => (b.tier.vote > a.tier.vote ? b : a));
    // Confidence from the measured out-of-sample PF (1.1 -> 0.58, 1.7 -> 0.76), capped.
    const conf = Math.max(0.5, Math.min(0.8, 0.55 + (Math.min(best.cand.oosPf, 2) - 1) * 0.3));
    return {
      signal: net > 0 ? 'BUY' : 'SELL',
      confidence: +conf.toFixed(2),
      voteMultiplier: best.tier.vote,
      evidenceTier: best.tier.tier,
      evidenceBacked: ['CONFIRMED', 'PAPER_CANDIDATE'].includes(best.tier.tier),
      reason: `evidence_candidates: ${active.map((r) => `${r.cand.id} ${r.st.pos} [${r.tier.tier}, paper ${r.tier.paper.trades} trades]`).join('; ')}`,
      model_used: MODEL, provider: 'evidence_candidates', veto_flag: false,
      candidates: active.map((r) => ({ id: r.cand.id, pos: r.st.pos, entry: r.st.entry, tier: r.tier.tier, paper: r.tier.paper })),
    };
  } catch (e) {
    return hold(`evidence_candidates error: ${e.message}`);
  }
}

module.exports = { getSignal, refreshCoin };
