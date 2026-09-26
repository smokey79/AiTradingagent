/**
 * improvementLoop.js — the "live data -> analyse -> improve" cycle.
 *
 * DESIGN RULE THAT MATTERS MOST
 *   This loop PROPOSES configuration changes. It never applies one that
 *   loosens risk. Tightening (lower size, higher confidence floor) may be
 *   auto-applied; loosening always needs a human. A self-tuning system that
 *   can relax its own safety rails will eventually relax them to zero,
 *   because a loose rail always looks better on a short winning streak.
 *
 * SECOND RULE
 *   Nothing is learned from a sample too small to carry information. Below
 *   MIN_SAMPLE resolved real trades the loop reports "insufficient evidence"
 *   and proposes nothing. This is the same discipline the strategy validator
 *   uses; it exists because the ledger has already been contaminated once by
 *   fabricated wins and once by phantom flash-loan profits.
 *
 * THIRD RULE
 *   Only real, resolved, non-simulated trades count. Records tagged
 *   simulated / excludeFromLearning / FLASHLOAN are read for reporting but
 *   never feed a proposal.
 */

'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'data');

/** Minimum resolved REAL trades before any proposal is made. */
const MIN_SAMPLE = parseInt(process.env.LEARN_MIN_SAMPLE || '30', 10);
/** Minimum trades attributed to one agent before judging that agent. */
const MIN_AGENT_SAMPLE = parseInt(process.env.LEARN_MIN_AGENT_SAMPLE || '20', 10);

/** Read a JSONL ledger. The file is line-delimited, not one JSON array. */
function readLedger() {
  const p = path.join(DATA, 'trade_ledger.json');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch (_) { return null; } })
    .filter(Boolean);
}

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8')); }
  catch (_) { return fallback; }
}

/** Split the ledger into what may be learned from and what may not. */
function partition(ledger) {
  const resolved = ledger.filter(t => t.outcome && t.outcome !== 'PENDING');
  const learnable = resolved.filter(t =>
    t.simulated !== true && t.excludeFromLearning !== true && t.side !== 'FLASHLOAN');
  const excluded = resolved.filter(t => !learnable.includes(t));
  const pending = ledger.filter(t => !t.outcome || t.outcome === 'PENDING');
  return { learnable, excluded, pending, total: ledger.length };
}

// tradeLedger.js writes the field as `pnlUsd`. Reading the wrong key here
// silently reports every trade as flat, which is how a losing system looks
// like a breakeven one. Check `pnlUsd` first.
const pnlOf = t => Number(t.pnlUsd ?? t.pnl ?? t.profit ?? t.realizedPnl ?? 0) || 0;
const isWin = t => t.outcome === 'WIN' || (t.outcome !== 'LOSS' && pnlOf(t) > 0);

function summarise(trades) {
  const wins = trades.filter(isWin).length;
  const pnl = trades.reduce((s, t) => s + pnlOf(t), 0);
  const gross = trades.filter(t => pnlOf(t) > 0).reduce((s, t) => s + pnlOf(t), 0);
  const loss = -trades.filter(t => pnlOf(t) < 0).reduce((s, t) => s + pnlOf(t), 0);
  return {
    trades: trades.length,
    wins, losses: trades.length - wins,
    winRate: trades.length ? wins / trades.length : null,
    netPnl: pnl,
    profitFactor: loss > 0 ? gross / loss : null,
    avgPnl: trades.length ? pnl / trades.length : null,
  };
}

/** Group by any key function, dropping groups below `minN`. */
function groupBy(trades, keyFn) {
  const out = {};
  for (const t of trades) {
    const k = keyFn(t);
    if (k === undefined || k === null || k === '') continue;
    (out[k] = out[k] || []).push(t);
  }
  return out;
}

/** Per-agent accuracy, only where an agent's vote was actually recorded. */
function agentAccuracy(trades) {
  const tally = {};
  for (const t of trades) {
    const votes = t.agentVotes || t.votes || null;
    if (!votes || typeof votes !== 'object') continue;
    const direction = (t.side || '').toUpperCase().includes('SELL') ? 'SELL' : 'BUY';
    for (const [agent, v] of Object.entries(votes)) {
      const sig = String((v && v.signal) || v || '').toUpperCase();
      if (sig !== 'BUY' && sig !== 'SELL') continue;      // HOLD carries no claim
      const a = (tally[agent] = tally[agent] || { withTrade: 0, correct: 0, agreed: 0 });
      a.withTrade++;
      if (sig === direction) a.agreed++;
      // An agent is right when it backed a winner OR opposed a loser.
      // Scoring only the trades it agreed with would reward an agent for
      // staying quiet on its own bad calls.
      const agreedWithTrade = sig === direction;
      if (agreedWithTrade === isWin(t)) a.correct++;
    }
  }
  for (const a of Object.values(tally)) {
    a.accuracy = a.withTrade >= MIN_AGENT_SAMPLE ? a.correct / a.withTrade : null;
  }
  return tally;
}

/**
 * Build proposals. Each carries a direction:
 *   'tighten'  - reduces risk. Safe to auto-apply.
 *   'loosen'   - increases risk. NEVER auto-applied; needs Alan.
 *   'investigate' - no config change, a thing to look at.
 */
function buildProposals({ overall, byRegime, byPair, agents, gate }) {
  const p = [];

  if (overall.trades < MIN_SAMPLE) {
    p.push({
      direction: 'investigate',
      title: 'Insufficient evidence — no tuning this cycle',
      detail: `${overall.trades} resolved real trades on record; ${MIN_SAMPLE} are `
            + 'required before any parameter is changed. Anything tuned on this '
            + 'sample would be fitting noise.',
    });
    return p;
  }

  // Losing overall -> tighten, never loosen.
  if (overall.netPnl < 0 && overall.winRate !== null && overall.winRate < 0.5) {
    p.push({
      direction: 'tighten',
      key: 'MIN_CONFIDENCE',
      title: 'Raise the confidence floor',
      detail: `Win rate ${(overall.winRate * 100).toFixed(1)}% over ${overall.trades} `
            + `trades with net ${overall.netPnl.toFixed(2)}. Raising MIN_CONFIDENCE `
            + 'takes fewer, higher-conviction trades.',
      suggested: Math.min(0.80, (parseFloat(process.env.MIN_CONFIDENCE || '0.68') + 0.03)),
    });
  }

  // A regime that consistently loses money should be switched off, not resized up.
  for (const [regime, s] of Object.entries(byRegime)) {
    if (s.trades >= MIN_AGENT_SAMPLE && s.netPnl < 0 && s.winRate < 0.45) {
      p.push({
        direction: 'tighten',
        key: `REGIME_DISABLE_${regime}`,
        title: `Stop trading in ${regime}`,
        detail: `${s.trades} trades, ${(s.winRate * 100).toFixed(1)}% win rate, `
              + `net ${s.netPnl.toFixed(2)}.`,
      });
    }
  }

  // An agent below coin-flip on its own directional calls is worse than useless.
  for (const [agent, a] of Object.entries(agents)) {
    if (a.accuracy !== null && a.accuracy < 0.45) {
      p.push({
        direction: 'tighten',
        key: `AGENT_DEMOTE_${agent}`,
        title: `Demote ${agent}`,
        detail: `${(a.accuracy * 100).toFixed(1)}% correct on ${a.withTrade} directional `
              + 'votes — below a coin flip. Reduce its weight or drop it from consensus.',
      });
    }
  }

  // Gate blocking everything is a configuration problem, not a market one.
  if (gate && gate.evaluated > 50 && gate.passed === 0) {
    p.push({
      direction: 'investigate',
      title: 'Risk gate has passed nothing',
      detail: `${gate.evaluated} evaluations, 0 passes. Check whether agents are `
            + 'actually responding before concluding the market offers nothing.',
    });
  }

  if (!p.length) {
    p.push({ direction: 'investigate', title: 'No change proposed',
             detail: 'Nothing in this cycle clears the evidence bar for a change.' });
  }
  return p;
}

/** Run one full analyse cycle. Pure read + report; changes nothing. */
function runCycle() {
  const ledger = readLedger();
  const { learnable, excluded, pending, total } = partition(ledger);

  const overall = summarise(learnable);
  const byRegime = {};
  for (const [k, v] of Object.entries(groupBy(learnable, t => t.regime || t.marketRegime)))
    byRegime[k] = summarise(v);
  const byPair = {};
  for (const [k, v] of Object.entries(groupBy(learnable, t => t.pair || t.symbol)))
    byPair[k] = summarise(v);

  const agents = agentAccuracy(learnable);
  const gate = readJson('risk_gate_stats.json', null);

  const proposals = buildProposals({ overall, byRegime, byPair, agents, gate });

  return {
    generatedAt: new Date().toISOString(),
    mode: process.env.PAPER_TRADING === 'true' ? 'PAPER' : 'LIVE',
    evidence: {
      ledgerRecords: total,
      resolvedLearnable: learnable.length,
      excludedFromLearning: excluded.length,
      stillOpen: pending.length,
      minSampleRequired: MIN_SAMPLE,
      sampleSufficient: learnable.length >= MIN_SAMPLE,
    },
    overall, byRegime, byPair, agents,
    proposals,
    autoApplied: [],   // populated only by applyProposals(), tighten-only
  };
}

/**
 * Apply only the tightening proposals, and only when explicitly asked.
 * Returns the list it would apply; writes nothing unless commit === true.
 */
function applyProposals(report, { commit = false } = {}) {
  const safe = report.proposals.filter(p => p.direction === 'tighten' && p.key && p.suggested !== undefined);
  const blocked = report.proposals.filter(p => p.direction === 'loosen');
  if (!commit) return { wouldApply: safe, refused: blocked, committed: false };

  const envPath = path.join(ROOT, '.env');
  let env = fs.readFileSync(envPath, 'utf8');
  fs.writeFileSync(`${envPath}.backup_${Date.now()}`, env);
  const applied = [];
  for (const p of safe) {
    const re = new RegExp(`^${p.key}=.*$`, 'm');
    if (re.test(env)) { env = env.replace(re, `${p.key}=${p.suggested}`); applied.push(p); }
  }
  fs.writeFileSync(envPath, env);
  return { wouldApply: safe, applied, refused: blocked, committed: true };
}

function writeReport(report) {
  const dir = path.join(DATA, 'learning');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(dir, `cycle_${stamp}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(report, null, 2));
  return path.join(dir, 'latest.json');
}

module.exports = { runCycle, applyProposals, writeReport, MIN_SAMPLE };
