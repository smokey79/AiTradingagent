'use strict';

// Both learning paths consume the same vetted dry-run/live SQLite rows.
function normaliseTrade(row) {
  let meta = {};
  try { meta = JSON.parse(row.meta || '{}') || {}; } catch (_) { /* optional context */ }
  return {
    ...meta,
    id: `${row.source}:${row.ext_id}`,
    timestamp: row.closed_at,
    pair: row.pair,
    symbol: row.pair?.split('/')[0],
    side: ['SELL', 'SHORT'].includes(row.side) ? 'SELL' : 'BUY',
    entryPrice: row.entry_price,
    exitPrice: row.exit_price,
    price: row.exit_price,
    pnlUsd: row.pnl_usd,
    pnlPct: row.pnl_pct,
    costUsd: row.fees_usd,
    outcome: row.outcome,
    source: row.source,
    engine: row.engine,
    paper: row.source === 'dry_run',
    feesIncluded: row.fees_included === 1,
    isSimulated: row.is_simulated === 1,
  };
}

function readLearningTrades() {
  return require('../utils/ledgerDb').realTrades().map(normaliseTrade)
    .filter(t => Number.isFinite(t.pnlUsd) && t.excludeFromLearning !== true);
}

module.exports = { readLearningTrades, normaliseTrade };
