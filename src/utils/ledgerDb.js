/**
 * src/utils/ledgerDb.js  (2026-10-03 calibration)
 * SQLite mirror of the trade ledger (data/ledger.db) using Node's built-in node:sqlite -- no extra
 * dependency. The JSON ledger (data/trade_ledger.json) stays the primary store; every recorded trade is
 * also upserted here with source / fees_included / is_simulated so Python and Node learning code can
 * read the same vetted rows (view real_trades). All functions fail soft: a SQLite problem is logged
 * once and never stops trading.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const DB_PATH = process.env.LEDGER_DB_PATH || path.join(ROOT, 'data', 'ledger.db');
const SCHEMA_PATH = path.join(ROOT, 'config', 'ledger_schema.sql');

let db = null;
let failed = false;

function open() {
  if (db || failed) return db;
  try {
    const { DatabaseSync } = require('node:sqlite');
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  } catch (e) {
    failed = true;
    db = null;
    // eslint-disable-next-line no-console
    console.warn(`[ledgerDb] SQLite mirror disabled: ${e.message}`);
  }
  return db;
}

const UPSERT = `
INSERT INTO trades (ext_id, source, engine, is_simulated, fees_included, strategy, enter_tag, exit_reason, pair, side,
                    opened_at, closed_at, entry_price, exit_price, stake_usd, leverage, pnl_usd, pnl_pct, fees_usd,
                    slippage_usd, outcome, meta, imported_at)
VALUES (@ext_id, @source, @engine, @is_simulated, @fees_included, @strategy, @enter_tag, @exit_reason, @pair, @side,
        @opened_at, @closed_at, @entry_price, @exit_price, @stake_usd, @leverage, @pnl_usd, @pnl_pct, @fees_usd,
        @slippage_usd, @outcome, @meta, @imported_at)
ON CONFLICT (source, ext_id) DO UPDATE SET
  engine=excluded.engine, is_simulated=excluded.is_simulated, fees_included=excluded.fees_included,
  opened_at=excluded.opened_at, entry_price=excluded.entry_price,
  closed_at=excluded.closed_at, exit_price=excluded.exit_price, pnl_usd=excluded.pnl_usd, pnl_pct=excluded.pnl_pct,
  fees_usd=excluded.fees_usd, outcome=excluded.outcome, meta=excluded.meta, imported_at=excluded.imported_at`;

/** Map a data/trade_ledger.json entry (see tradeLedger.recordTrade) to a ledger.db row. */
function fromLedgerEntry(e) {
  const pending = e.outcome === 'PENDING';
  const source = e.source === 'live' || e.source === 'dry_run' ? e.source : (e.paper === false ? 'live' : 'dry_run');
  return {
    ext_id: String(e.id),
    source,
    engine: e.engine || 'node_paper',
    is_simulated: e.excludeFromLearning === true || e.isSimulated === true || e.simulated === true || String(e.side).toUpperCase() === 'FLASHLOAN' ? 1 : 0,
    fees_included: e.feesIncluded === false ? 0 : (e.feesIncluded === true || (e.costUsd !== null && e.costUsd !== undefined) ? 1 : 0),
    strategy: e.strategy || null,
    enter_tag: e.enterTag || null,
    exit_reason: null,
    pair: e.pair || e.symbol || 'UNKNOWN',
    side: String(e.side || 'BUY').toUpperCase(),
    opened_at: e.openedAt || null,
    closed_at: pending ? null : (e.closedAt || e.timestamp || null),
    entry_price: e.entryPrice ?? null,
    exit_price: pending ? null : (e.exitPrice ?? e.price ?? null),
    stake_usd: e.positionSizeUsd ?? null,
    leverage: e.leverage ?? 1,
    pnl_usd: e.pnlUsd ?? null,
    pnl_pct: e.pnlPct ?? null,
    fees_usd: e.costUsd ?? null,
    slippage_usd: null,
    outcome: e.outcome || null,
    meta: JSON.stringify({ confidence: e.confidence, agentsAgreeing: e.agentsAgreeing, totalAgents: e.totalAgents,
      regime: e.regime, reason: e.reason, grossPnlUsd: e.grossPnlUsd, costPct: e.costPct,
      agentVotes: e.agentVotes, excludeFromLearning: e.excludeFromLearning }),
    imported_at: new Date().toISOString(),
  };
}

function upsertTrade(entry) {
  const d = open();
  if (!d) return false;
  d.prepare(UPSERT).run(fromLedgerEntry(entry));
  return true;
}

/** Real, fee-inclusive closed trades (view real_trades), oldest first. */
function realTrades(limit = null) {
  const d = open();
  if (!d) return [];
  const sql = 'SELECT * FROM real_trades ORDER BY closed_at' + (limit ? ` LIMIT ${Number(limit) | 0}` : '');
  return d.prepare(sql).all();
}

function counts() {
  const d = open();
  if (!d) return null;
  return {
    total: d.prepare('SELECT COUNT(*) AS n FROM trades').get().n,
    real: d.prepare('SELECT COUNT(*) AS n FROM real_trades').get().n,
    simulated: d.prepare('SELECT COUNT(*) AS n FROM trades WHERE is_simulated = 1').get().n,
  };
}

/** Close the database handle (tests need this on Windows before deleting a temp folder). */
function close() {
  if (db) { try { db.close(); } catch (_) { /* already closed */ } }
  db = null;
  failed = false;
}

module.exports = { upsertTrade, realTrades, counts, fromLedgerEntry, close, DB_PATH, SCHEMA_PATH };
