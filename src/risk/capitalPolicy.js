'use strict';
const cfg = require('../../config/capital-policy.json');

function evaluate({ trades, initialAllocationUsd = cfg.initialAllocationUsd, balanceUsd, paper = true, holdHours = 1, executionEngine = cfg.executionEngine }) {
  if (!(Number.isFinite(initialAllocationUsd) && initialAllocationUsd > 0) || !Number.isFinite(balanceUsd) || !Number.isFinite(holdHours) || holdHours <= 0)
    return { allowed: false, reason: 'Capital or holding period is unknown.', availableTradingUsd: 0 };
  const source = paper ? 'dry_run' : 'live';
  const netProfitUsd = trades.filter(t => t.source === source && t.engine === executionEngine && t.feesIncluded === true && !t.isSimulated && !t.excludeFromLearning && Number.isFinite(t.pnlUsd))
    .reduce((sum, t) => sum + t.pnlUsd, 0);
  const originalRecovered = netProfitUsd >= initialAllocationUsd * cfg.requiredNetProfitMultiple;
  const reservedOriginalUsd = originalRecovered ? Math.min(balanceUsd, initialAllocationUsd) : 0;
  const availableTradingUsd = Math.max(0, balanceUsd - reservedOriginalUsd);
  const isLongHold = holdHours >= cfg.longHoldStartsHours;
  const allowed = (!isLongHold || originalRecovered) && availableTradingUsd > 0;
  return { allowed, paper, executionEngine, netProfitUsd, originalRecovered, reservedOriginalUsd, availableTradingUsd, holdHours,
    preferredHoldHours: cfg.preferredHoldHours, reserveDestination: cfg.reserveDestination, transferStatus: 'accounting_reserve_only',
    reason: allowed ? 'Holding period clears the capital recovery policy.' : isLongHold && !originalRecovered ? 'Seven-day or longer holds require net profit equal to the original allocation.' : 'No unreserved trading funds available.' };
}

function check(holdHours = 1) {
  const { getPortfolioState, INITIAL_DEPOSIT } = require('./riskGate');
  return evaluate({ trades: require('../learning/learningTrades').readLearningTrades(), initialAllocationUsd: INITIAL_DEPOSIT,
    balanceUsd: getPortfolioState().currentBalance, paper: process.env.PAPER_TRADING !== 'false', holdHours });
}

function costReview(trades, nowMs = Date.now()) {
  const cutoff = nowMs - cfg.costReviewDays * 86400000;
  const rows = trades.filter(t => Number.isFinite(t.costUsd) && Date.parse(t.timestamp) >= cutoff && Date.parse(t.timestamp) <= nowMs);
  return { days: cfg.costReviewDays, trades: rows.length, feesAndSlippageUsd: rows.reduce((s, t) => s + t.costUsd, 0),
    netPnlUsd: rows.reduce((s, t) => s + t.pnlUsd, 0), note: 'Recorded costs only; unknown funding, borrowing, withdrawal and network costs are not assumed to be zero.' };
}
module.exports = { evaluate, check, costReview, cfg };
