/**
 * src/agents/allocationAgent.js
 * =============================
 * Allocation Manager: turns an APPROVED risk-gate decision into a final trade size
 * using measured probabilities, evidence and the account's current drawdown.
 *
 * The one rule it never breaks: it can only shrink or keep what src/risk/riskGate.js
 * approved. It never enlarges a position beyond the risk gate's size, never raises
 * leverage, and never turns a rejected trade into an approved one. A strategy that
 * passes the evidence gate earns a LARGER SHARE of the risk gate's allowance, not a
 * way around it.
 *
 * Final size = min(risk-gate size, quarter-Kelly cap, exposure headroom)
 *              x evidence factor x drawdown factor x loss-streak factor
 *
 *  - Evidence factor: best tier among the agents that agreed with the trade
 *    (CONFIRMED 1.0, PAPER_CANDIDATE 0.8, validated agent 0.8, none 0.5, DEGRADED 0.25).
 *  - Kelly: p x (1 - 1/PF) = share of the account to RISK, from MEASURED numbers only;
 *    the position cap is that risk divided by the stop distance. Sources, in order:
 *      1) the bot's own last 50 real closed trades, if at least 20 exist
 *      2) the agreeing candidate's backtest evidence
 *      3) nothing measured: paper mode may take a small exploration trade (25% of the
 *         risk-gate size) so a record can be built; live mode is blocked.
 *    A measured negative edge blocks live trades and cuts paper trades to exploration size.
 *  - Drawdown: full size until 25% of the session loss limit is used, then scales
 *    down linearly to 25% size at the limit (the risk gate vetoes beyond it).
 *  - Loss streak: after 3 straight losses, x0.8 per extra loss (floor 0.3).
 *  - Leverage: min(risk-gate leverage, LEVERAGE_CAP, default 5x).
 *
 * Every decision is appended to data/allocation_log.jsonl for review.
 *
 * Env: LEVERAGE_CAP (5), MIN_ORDER_USD (10), PAPER_TRADING (anything but "false" = paper),
 *      VALIDATED_AGENTS (comma list, default "technical_lab"), KELLY_FRACTION (0.25)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const LOG_PATH = process.env.ALLOCATION_LOG_PATH || path.resolve(__dirname, '../../data/allocation_log.jsonl');
const cfg = () => ({
  leverageCap: Number(process.env.LEVERAGE_CAP || 5),
  minOrderUsd: Number(process.env.MIN_ORDER_USD || 10),
  paper: process.env.PAPER_TRADING !== 'false',
  validatedAgents: (process.env.VALIDATED_AGENTS || 'technical_lab').split(',').map((s) => s.trim()).filter(Boolean),
  kellyFraction: Number(process.env.KELLY_FRACTION || 0.25),
});

const TIER_SIZE = { CONFIRMED: 1.0, PAPER_CANDIDATE: 0.8, VALIDATED: 0.8, UNVERIFIED: 0.5, DEGRADED: 0.25, FAILED: 0.25 };

function realTrades() {
  try {
    const { loadLedger } = require('../risk/tradeLedger');
    return loadLedger().filter((t) => ['WIN', 'LOSS', 'BREAKEVEN'].includes(t.outcome)
      && t.simulated !== true && t.excludeFromLearning !== true && t.side !== 'FLASHLOAN');
  } catch { return []; }
}

function statsFromPnl(pnls) {
  const w = pnls.filter((x) => x > 0), l = pnls.filter((x) => x < 0);
  const gw = w.reduce((a, b) => a + b, 0), gl = -l.reduce((a, b) => a + b, 0);
  return { n: pnls.length, p: pnls.length ? w.length / pnls.length : null, pf: gl === 0 ? (gw > 0 ? 99 : 0) : gw / gl };
}

function lossStreak(trades) {
  let n = 0;
  for (let i = trades.length - 1; i >= 0; i--) { if (trades[i].outcome === 'LOSS') n++; else break; }
  return n;
}

function evidenceOfAgreeing(consensus, c) {
  const agreeing = (consensus.breakdown || []).filter((a) => a.signal === consensus.signal && a.signal !== 'HOLD');
  let best = { tier: 'UNVERIFIED', factor: TIER_SIZE.UNVERIFIED, from: null, backtest: null };
  for (const a of agreeing) {
    const d = a.details || {};
    let tier = null;
    if (d.evidenceTier) tier = d.evidenceTier;
    else if (c.validatedAgents.includes(a.agent)) tier = 'VALIDATED';
    if (!tier) continue;
    const f = TIER_SIZE[tier] ?? TIER_SIZE.UNVERIFIED;
    if (best.from == null || f > best.factor) {
      const cand = (d.candidates || [])[0];
      best = { tier, factor: f, from: a.agent, backtest: cand ? require('./evidenceCandidates/config').CANDIDATES.find((x) => x.id === cand.id) : null };
    }
  }
  return { ...best, agreeingAgents: agreeing.map((a) => a.agent) };
}

/**
 * @param {object} args
 * @param {string} args.pair
 * @param {object} args.consensus   consensus synthesis (signal, confidence, breakdown[])
 * @param {object} args.riskDecision result of riskGate.checkRiskGate (must be approved)
 * @param {Array}  [args.trades]    injected real trades (tests); defaults to the ledger
 * @returns riskDecision with positionSizeUsd/leverage adjusted and an `allocation` report
 */
function allocate({ pair, consensus = {}, riskDecision, trades = null }) {
  if (!riskDecision || !riskDecision.approved) return riskDecision; // never overrides a rejection
  const c = cfg();
  const ps = riskDecision.portfolioState || {};
  const balance = Number(ps.currentBalance) || 0;
  const rgSize = Number(riskDecision.positionSizeUsd) || 0;
  const reasons = [];

  // 1) evidence
  const ev = evidenceOfAgreeing(consensus, c);
  reasons.push(`evidence ${ev.tier}${ev.from ? ` via ${ev.from}` : ''} -> x${ev.factor}`);

  // 2) probability / edge (measured only)
  const hist = (trades || realTrades()).slice(-50);
  const own = statsFromPnl(hist.map((t) => Number(t.pnlUsd ?? t.pnlPct ?? 0)));
  let p = null, pf = null, edgeSource = 'none';
  if (own.n >= 20) { p = own.p; pf = own.pf; edgeSource = `own ${own.n} real trades`; }
  else if (ev.backtest) { p = ev.backtest.winRatePct / 100; pf = ev.backtest.oosPf; edgeSource = `backtest ${ev.backtest.id} (OOS PF)`; }
  const kelly = p == null ? null : (pf > 0 ? p * (1 - 1 / pf) : -1); // PF 0 = no winners at all
  let kellyCapUsd, blocked = null;
  if (kelly == null) {
    if (c.paper) { kellyCapUsd = rgSize * 0.25; reasons.push('no measured edge: paper exploration size (25%)'); }
    else blocked = 'no measured edge (live trading needs a measured positive edge)';
  } else if (kelly <= 0) {
    if (c.paper) { kellyCapUsd = rgSize * 0.25; reasons.push(`measured edge negative (${edgeSource}): paper exploration size only`); }
    else blocked = `measured edge is negative (${edgeSource}, win ${(p * 100).toFixed(1)}%, PF ${pf.toFixed(2)})`;
  } else {
    // Kelly gives the fraction of the account to RISK; the position that risks it is
    // risk / stop distance (a 2% stop means a position 50x the amount at risk).
    const stopPct = Math.max(0.5, Number(riskDecision.stopLossPct) || 2);
    kellyCapUsd = (balance * kelly * c.kellyFraction) / (stopPct / 100);
    reasons.push(`Kelly ${(kelly * 100).toFixed(2)}% risk from ${edgeSource}, ${(c.kellyFraction * 100).toFixed(0)}% Kelly at ${stopPct}% stop -> cap $${kellyCapUsd.toFixed(2)}`);
  }

  // 3) drawdown throttle
  const dd = Number(ps.sessionDrawdownPct) || 0, maxDD = Number(ps.maxSessionLossPct) || 8;
  const r = dd / maxDD;
  const ddFactor = r <= 0.25 ? 1 : Math.max(0.25, 1 - ((r - 0.25) / 0.75) * 0.75);
  if (ddFactor < 1) reasons.push(`session drawdown ${dd}% of ${maxDD}% limit -> x${ddFactor.toFixed(2)}`);

  // 4) loss streak
  const streak = lossStreak(hist);
  const streakFactor = streak >= 3 ? Math.max(0.3, Math.pow(0.8, streak - 2)) : 1;
  if (streakFactor < 1) reasons.push(`${streak} losses in a row -> x${streakFactor.toFixed(2)}`);

  // 5) exposure headroom
  const headroomUsd = balance > 0 && ps.maxExposurePct != null
    ? Math.max(0, balance * (Number(ps.maxExposurePct) - Number(ps.exposurePct || 0)) / 100) : rgSize;

  const leverage = Math.min(Number(riskDecision.leverage) || 1, c.leverageCap);
  if (leverage < riskDecision.leverage) reasons.push(`leverage capped ${riskDecision.leverage}x -> ${leverage}x`);

  let size = 0;
  if (!blocked) {
    size = Math.min(rgSize, kellyCapUsd, headroomUsd) * ev.factor * ddFactor * streakFactor;
    size = Math.min(size, rgSize); // hard guarantee: never above the risk gate
    if (size < c.minOrderUsd) blocked = `allocated $${size.toFixed(2)} is below the $${c.minOrderUsd} minimum order`;
  }

  const report = {
    pair, mode: c.paper ? 'paper' : 'live', riskGateSizeUsd: rgSize, finalSizeUsd: blocked ? 0 : +size.toFixed(2),
    evidence: { tier: ev.tier, factor: ev.factor, from: ev.from, agreeingAgents: ev.agreeingAgents },
    probability: { winRate: p, profitFactor: pf, kelly, source: edgeSource },
    drawdownFactor: +ddFactor.toFixed(3), streak, streakFactor: +streakFactor.toFixed(3),
    headroomUsd: +headroomUsd.toFixed(2), leverage, blocked, reasons, at: new Date().toISOString(),
  };
  try { fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true }); fs.appendFileSync(LOG_PATH, JSON.stringify(report) + '\n'); } catch { /* audit log is best-effort */ }

  if (blocked) {
    return { ...riskDecision, approved: false, positionSizeUsd: 0, reason: `Allocation Manager: ${blocked}`,
      vetoes: [...(riskDecision.vetoes || []), `Allocation Manager: ${blocked}`], allocation: report };
  }
  return { ...riskDecision, positionSizeUsd: report.finalSizeUsd, leverage, allocation: report };
}

module.exports = { allocate, statsFromPnl, lossStreak, TIER_SIZE };
