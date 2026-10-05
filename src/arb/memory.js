/**
 * src/arb/memory.js  (2026-10-03) -- the arbitrage module's OWN database (data/arb/arb.db, node:sqlite).
 *   observations  every spread the scanner looked at (also the memory the predictor learns from)
 *   arb_trades    paper trades with a full cost breakdown: this is the profit/loss shown on the dashboard
 *   hist_stats    24 h cross-exchange spread statistics from historical candles (indicative only: close vs close)
 * Nothing here ever sends an order. Rows are never deleted.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const dbPath = () => process.env.ARB_DB_PATH || path.join(ROOT, 'data', 'arb', 'arb.db');
let db = null, dbFile = null;

function open() {
  const p = dbPath();
  if (db && dbFile === p) return db;
  if (db) { try { db.close(); } catch (_) { /* ignore */ } }
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  db = new DatabaseSync(p); dbFile = p;
  db.exec(`PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS observations (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, symbol TEXT NOT NULL,
      buy_ex TEXT NOT NULL, sell_ex TEXT NOT NULL, gross_pct REAL, net_pct REAL, notional_usd REAL, persisted INTEGER DEFAULT 0);
    CREATE INDEX IF NOT EXISTS idx_obs_route ON observations (symbol, buy_ex, sell_ex, id);
    CREATE TABLE IF NOT EXISTS arb_trades (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, symbol TEXT NOT NULL, buy_ex TEXT NOT NULL,
      sell_ex TEXT NOT NULL, notional_usd REAL, buy_avg REAL, sell_avg REAL, qty REAL, gross_usd REAL, fees_usd REAL, latency_usd REAL,
      rebalance_usd REAL, net_usd REAL, net_pct REAL, prediction_id INTEGER, predicted_p REAL, debate TEXT, note TEXT);
    CREATE TABLE IF NOT EXISTS hist_stats (symbol TEXT PRIMARY KEY, computed_at TEXT, bars INTEGER, exchanges INTEGER, p50 REAL, p90 REAL,
      max_spread REAL, share_above_cost REAL, cost_pct REAL, hourly TEXT);`);
  return db;
}

const iso = (ms = Date.now()) => new Date(ms).toISOString();

function recordObservation(o) {
  open().prepare('INSERT INTO observations (ts, symbol, buy_ex, sell_ex, gross_pct, net_pct, notional_usd, persisted) VALUES (?,?,?,?,?,?,?,?)')
    .run(o.ts || iso(), o.symbol, o.buyEx, o.sellEx, o.grossPct ?? null, o.netPct ?? null, o.notionalUsd ?? null, o.persisted ? 1 : 0);
}

/** What this route has done before: how often it was profitable and how often a profitable spread was still there next scan. */
function routeStats(symbol, buyEx, sellEx) {
  const rows = open().prepare('SELECT net_pct n, persisted p FROM observations WHERE symbol=? AND buy_ex=? AND sell_ex=? ORDER BY id DESC LIMIT 500').all(symbol, buyEx, sellEx);
  const n = rows.length;
  const prof = rows.filter((r) => r.n != null && r.n > 0);
  const persisted = prof.filter((r) => r.p === 1).length;
  return { n, profitable: prof.length, profitableShare: n ? prof.length / n : 0,
    persistenceRate: (persisted + 0.35 * 2) / (prof.length + 2),            // smoothed toward 0.35 until there is evidence
    avgNetPct: n ? rows.reduce((s, r) => s + (r.n || 0), 0) / n : 0 };
}

function recordTrade(t) {
  const r = open().prepare(`INSERT INTO arb_trades (ts, symbol, buy_ex, sell_ex, notional_usd, buy_avg, sell_avg, qty, gross_usd, fees_usd, latency_usd,
      rebalance_usd, net_usd, net_pct, prediction_id, predicted_p, debate, note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    t.ts || iso(), t.symbol, t.buyEx, t.sellEx, t.notionalUsd, t.buyAvg, t.sellAvg, t.qty, t.grossUsd, t.feesUsd, t.latencyUsd, t.rebalanceUsd,
    t.netUsd, t.netPct, t.predictionId ?? null, t.predictedP ?? null, t.debate ? JSON.stringify(t.debate).slice(0, 3000) : null, t.note || null);
  return Number(r.lastInsertRowid);
}

function tradesToday(nowMs = Date.now()) {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  return open().prepare('SELECT COUNT(*) n FROM arb_trades WHERE ts >= ?').get(day).n;
}

/** Profit and loss, win rate, profit factor, drawdown and the equity curve of the paper trades. */
function summary(startCapital = Number(process.env.ARB_PAPER_CAPITAL || 1000)) {
  const rows = open().prepare('SELECT ts, net_usd n, fees_usd f, latency_usd l, rebalance_usd r, gross_usd g, symbol, buy_ex, sell_ex, notional_usd FROM arb_trades ORDER BY id').all();
  let eq = startCapital, peak = eq, maxDd = 0, gw = 0, gl = 0;
  const curve = [];
  for (const r of rows) {
    eq += r.n; if (eq > peak) peak = eq; maxDd = Math.max(maxDd, peak - eq);
    if (r.n > 0) gw += r.n; else gl += -r.n;
    curve.push({ ts: r.ts, equity: +eq.toFixed(4) });
  }
  const wins = rows.filter((r) => r.n > 0).length;
  const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  return { trades: rows.length, wins, losses: rows.length - wins, winRate: rows.length ? +(wins / rows.length).toFixed(3) : null,
    netUsd: +sum('n').toFixed(4), grossUsd: +sum('g').toFixed(4), feesUsd: +sum('f').toFixed(4), latencyUsd: +sum('l').toFixed(4), rebalanceUsd: +sum('r').toFixed(4),
    avgNetUsd: rows.length ? +(sum('n') / rows.length).toFixed(4) : null, profitFactor: gl === 0 ? (gw > 0 ? null : 0) : +(gw / gl).toFixed(3),
    maxDrawdownUsd: +maxDd.toFixed(4), startCapital, equity: +eq.toFixed(4), curve: curve.slice(-300) };
}

const recentTrades = (limit = 50) => open().prepare('SELECT * FROM arb_trades ORDER BY id DESC LIMIT ?').all(Math.min(300, limit | 0));
const recentObservations = (limit = 50) => open().prepare('SELECT * FROM observations ORDER BY id DESC LIMIT ?').all(Math.min(500, limit | 0));

function topRoutes(limit = 15) {
  return open().prepare(`SELECT symbol, buy_ex, sell_ex, COUNT(*) n, ROUND(AVG(net_pct),4) avg_net_pct, ROUND(MAX(net_pct),4) best_net_pct,
      ROUND(100.0 * SUM(CASE WHEN net_pct > 0 THEN 1 ELSE 0 END) / COUNT(*), 1) profitable_pct
      FROM observations GROUP BY symbol, buy_ex, sell_ex ORDER BY avg_net_pct DESC LIMIT ?`).all(limit | 0);
}

function saveHist(s) {
  open().prepare(`INSERT INTO hist_stats (symbol, computed_at, bars, exchanges, p50, p90, max_spread, share_above_cost, cost_pct, hourly) VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(symbol) DO UPDATE SET computed_at=excluded.computed_at, bars=excluded.bars, exchanges=excluded.exchanges, p50=excluded.p50, p90=excluded.p90,
    max_spread=excluded.max_spread, share_above_cost=excluded.share_above_cost, cost_pct=excluded.cost_pct, hourly=excluded.hourly`)
    .run(s.symbol, iso(), s.bars, s.exchanges, s.p50, s.p90, s.max, s.shareAboveCost, s.costPct, JSON.stringify(s.hourly || {}));
}
const histAll = () => open().prepare('SELECT * FROM hist_stats ORDER BY share_above_cost DESC').all();

function close() { if (db) { try { db.close(); } catch (_) { /* ignore */ } } db = null; dbFile = null; }

module.exports = { recordObservation, routeStats, recordTrade, tradesToday, summary, recentTrades, recentObservations, topRoutes, saveHist, histAll, close, dbPath };
