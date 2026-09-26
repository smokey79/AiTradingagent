/**
 * src/risk/strategyEvidence.js
 * One place that answers "how much should we trust this strategy right now?"
 * from MEASURED data only:
 *   1. its backtest evidence (same thresholds as orchestrator/strategy_evidence.py:
 *      >=100 trades, PF >= 1.2, out-of-sample PF >= 1.1, drawdown <= 25%)
 *   2. its forward paper record (data/evidence_candidates_ledger.jsonl)
 *
 * Tiers and what they mean for the bot:
 *   CONFIRMED        backtest passed AND >= 20 paper trades with PF >= 1.2   vote x1.5, size x1.0
 *   PAPER_CANDIDATE  backtest passed, paper record still small or neutral    vote x1.25, size x0.8
 *   UNVERIFIED       no usable evidence                                      vote x1.0, size x0.5
 *   DEGRADED         backtest passed but >= 20 paper trades with PF < 1.0    vote x0.5, size x0.25
 *   FAILED           backtest evidence failed the gate                       vote x0.5, size x0.25
 * Multipliers only ever scale WITHIN the risk gate's limits (see allocationAgent.js).
 */
'use strict';

const GATE = {
  minTrades: Number(process.env.EVIDENCE_MIN_TRADES || 100),
  minPF: Number(process.env.EVIDENCE_MIN_PF || 1.2),
  minOosPF: Number(process.env.EVIDENCE_MIN_OOS_PF || 1.1),
  maxDD: Number(process.env.EVIDENCE_MAX_DD_PCT || 25),
  paperMinTrades: Number(process.env.EVIDENCE_PAPER_MIN_TRADES || 20),
};

const TIERS = {
  CONFIRMED:       { vote: 1.5,  size: 1.0 },
  PAPER_CANDIDATE: { vote: 1.25, size: 0.8 },
  UNVERIFIED:      { vote: 1.0,  size: 0.5 },
  DEGRADED:        { vote: 0.5,  size: 0.25 },
  FAILED:          { vote: 0.5,  size: 0.25 },
};

function backtestPasses(bt) {
  if (!bt) return { passed: false, reasons: ['no backtest evidence'] };
  const r = [];
  if (!(bt.trades >= GATE.minTrades)) r.push(`trades ${bt.trades} < ${GATE.minTrades}`);
  if (!(bt.pf >= GATE.minPF)) r.push(`PF ${bt.pf} < ${GATE.minPF}`);
  if (!(bt.oosPf >= GATE.minOosPF)) r.push(`OOS PF ${bt.oosPf} < ${GATE.minOosPF}`);
  if (bt.dd15Pct != null && bt.dd15Pct > GATE.maxDD) r.push(`drawdown ${bt.dd15Pct}% > ${GATE.maxDD}%`);
  return { passed: r.length === 0, reasons: r };
}

function paperStats(trades) {
  const rets = trades.map((t) => Number(t.pnlPct)).filter(Number.isFinite);
  const wins = rets.filter((p) => p > 0);
  const gw = wins.reduce((a, b) => a + b, 0);
  const gl = -rets.filter((p) => p < 0).reduce((a, b) => a + b, 0);
  return {
    trades: rets.length,
    winRate: rets.length ? wins.length / rets.length : null,
    pf: rets.length ? (gl === 0 ? (gw > 0 ? 99 : 0) : gw / gl) : null,
    avgPct: rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : null,
  };
}

/** bt = {trades, pf, oosPf, dd15Pct, winRatePct}; paperTrades = closed paper trades for this strategy */
function tierFor(bt, paperTrades = []) {
  const b = backtestPasses(bt);
  const p = paperStats(paperTrades);
  let tier;
  if (!bt) tier = 'UNVERIFIED';
  else if (!b.passed) tier = 'FAILED';
  else if (p.trades >= GATE.paperMinTrades && p.pf < 1.0) tier = 'DEGRADED';
  else if (p.trades >= GATE.paperMinTrades && p.pf >= GATE.minPF) tier = 'CONFIRMED';
  else tier = 'PAPER_CANDIDATE';
  return { tier, ...TIERS[tier], backtest: b, paper: p };
}

module.exports = { tierFor, paperStats, backtestPasses, TIERS, GATE };
