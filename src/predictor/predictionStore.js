/**
 * src/predictor/predictionStore.js  (2026-10-03)
 * Memory for the predictor agents: every prediction is stored (SQLite, node:sqlite, data/predictions.db) with its
 * probability, then SCORED against what really happened. That gives a hit rate, a Brier score and a calibration table,
 * and lets the predictor correct its own over/under-confidence over time.
 *
 * kind 'price'  P(direction is right after horizon). Resolved by the next real price (resolveDuePrice).
 * kind 'event'  P(an event happens/persists), e.g. an arbitrage spread still profitable next scan. Resolved explicitly.
 * scope         'trade' (main module) or 'arb' (arbitrage module). Rows are never deleted.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const dbPath = () => process.env.PREDICTIONS_DB_PATH || path.join(ROOT, 'data', 'predictions.db');
let db = null;
let dbFile = null;

function open() {
  const p = dbPath();
  if (db && dbFile === p) return db;
  if (db) { try { db.close(); } catch (_) { /* ignore */ } }
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  db = new DatabaseSync(p);
  dbFile = p;
  db.exec(`PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('price','event')), key TEXT NOT NULL,
      created_at TEXT NOT NULL, due_at TEXT NOT NULL, horizon_min REAL,
      direction TEXT, probability REAL NOT NULL CHECK (probability >= 0 AND probability <= 1),
      entry_price REAL, expected_move_pct REAL, method TEXT, model TEXT, reasoning TEXT, features TEXT, debate TEXT,
      resolved_at TEXT, outcome INTEGER, exit_price REAL, realized_move_pct REAL, brier REAL
    );
    CREATE INDEX IF NOT EXISTS idx_pred_open ON predictions (scope, key, resolved_at);`);
  return db;
}

const iso = (ms) => new Date(ms).toISOString();

function record(p) {
  const d = open();
  const now = p.nowMs || Date.now();
  const horizon = Number(p.horizonMin) || 60;
  const prob = Math.min(1, Math.max(0, Number(p.probability)));
  const r = d.prepare(`INSERT INTO predictions (scope, kind, key, created_at, due_at, horizon_min, direction, probability, entry_price,
      expected_move_pct, method, model, reasoning, features, debate) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    p.scope, p.kind || 'price', p.key, iso(now), iso(now + horizon * 60000), horizon, p.direction || null, prob,
    p.entryPrice ?? null, p.expectedMovePct ?? null, p.method || null, p.model || null,
    String(p.reasoning || '').slice(0, 600), p.features ? JSON.stringify(p.features).slice(0, 4000) : null,
    p.debate ? JSON.stringify(p.debate).slice(0, 4000) : null);
  return Number(r.lastInsertRowid);
}

/** Score due, unresolved PRICE predictions for one key with the current real price. Returns the resolved rows. */
function resolveDuePrice(scope, key, price, nowMs = Date.now(), flatBandPct = 0.15) {
  const d = open();
  if (!(price > 0)) return [];
  const due = d.prepare(`SELECT * FROM predictions WHERE scope=? AND key=? AND kind='price' AND resolved_at IS NULL AND due_at<=?`).all(scope, key, iso(nowMs));
  const out = [];
  for (const r of due) {
    const move = (price / r.entry_price - 1) * 100;
    const correct = r.direction === 'UP' ? move > flatBandPct : r.direction === 'DOWN' ? move < -flatBandPct : Math.abs(move) <= flatBandPct;
    const outcome = correct ? 1 : 0;
    const brier = (r.probability - outcome) ** 2;
    d.prepare('UPDATE predictions SET resolved_at=?, outcome=?, exit_price=?, realized_move_pct=?, brier=? WHERE id=?')
      .run(iso(nowMs), outcome, price, +move.toFixed(4), +brier.toFixed(4), r.id);
    out.push({ id: r.id, direction: r.direction, outcome, move });
  }
  return out;
}

function resolveEvent(id, outcome, info = null) {
  const d = open();
  const r = d.prepare('SELECT probability FROM predictions WHERE id=? AND resolved_at IS NULL').get(id);
  if (!r) return false;
  const o = outcome ? 1 : 0;
  d.prepare("UPDATE predictions SET resolved_at=?, outcome=?, brier=?, reasoning=COALESCE(reasoning,'') || ? WHERE id=?")
    .run(iso(Date.now()), o, +((r.probability - o) ** 2).toFixed(4), info ? ` | result: ${String(info).slice(0, 120)}` : '', id);
  return true;
}

function dueEvents(scope, nowMs = Date.now()) {
  return open().prepare(`SELECT * FROM predictions WHERE scope=? AND kind='event' AND resolved_at IS NULL AND due_at<=?`).all(scope, iso(nowMs));
}

function stats(scope) {
  const d = open();
  const total = d.prepare('SELECT COUNT(*) n FROM predictions WHERE scope=?').get(scope).n;
  const res = d.prepare('SELECT probability p, outcome o, brier b FROM predictions WHERE scope=? AND resolved_at IS NOT NULL').all(scope);
  const n = res.length;
  const hit = n ? res.reduce((s, r) => s + r.o, 0) / n : null;
  const brier = n ? res.reduce((s, r) => s + r.b, 0) / n : null;
  const edges = [0, 0.5, 0.6, 0.7, 0.8, 1.0001];
  const buckets = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const rows = res.filter((r) => r.p >= edges[i] && r.p < edges[i + 1]);
    if (rows.length) buckets.push({ range: `${edges[i].toFixed(1)}-${Math.min(edges[i + 1], 1).toFixed(1)}`, n: rows.length,
      avgPredicted: +(rows.reduce((s, r) => s + r.p, 0) / rows.length).toFixed(3), hitRate: +(rows.reduce((s, r) => s + r.o, 0) / rows.length).toFixed(3) });
  }
  return { scope, total, resolved: n, open: total - n, hitRate: hit == null ? null : +hit.toFixed(3), brier: brier == null ? null : +brier.toFixed(4),
    note: n < 30 ? `only ${n} scored predictions so far: too few to trust the hit rate` : 'enough scored predictions to read the calibration table', calibration: buckets };
}

function recent(scope, limit = 30) {
  return open().prepare(`SELECT id, key, kind, created_at, due_at, direction, probability, entry_price, expected_move_pct, method, model, reasoning,
      resolved_at, outcome, realized_move_pct, brier FROM predictions WHERE scope=? ORDER BY id DESC LIMIT ?`).all(scope, Math.min(200, limit | 0));
}

/**
 * Pull a raw probability toward the observed hit rate once enough predictions have been scored
 * (weight grows with sample size, capped at 0.5): the predictor learns whether it is over- or under-confident.
 */
function calibrate(scope, p) {
  const s = stats(scope);
  if (!s.resolved || s.resolved < 20 || s.hitRate == null) return { p, weight: 0 };
  const w = Math.min(0.5, s.resolved / 200);
  return { p: +(p * (1 - w) + s.hitRate * w).toFixed(4), weight: +w.toFixed(3) };
}

function close() { if (db) { try { db.close(); } catch (_) { /* ignore */ } } db = null; dbFile = null; }

module.exports = { record, resolveDuePrice, resolveEvent, dueEvents, stats, recent, calibrate, close, dbPath };
