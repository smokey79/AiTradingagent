/**
 * src/engine/store.js (2026-10-03) -- SQLite log for the probability engine (data/engine/engine.db; override ENGINE_DB_PATH).
 *   market_log  one row per coin per cycle: price, spread, depth, order-book imbalance, volatility, candle source (the training data of the future).
 *               funding_rate and liquidations_usd exist as columns but are NOT collected yet (NULL): no free, reliable source wired in.
 *   forecasts   every forecast (per coin, per horizon) with the gate's decision, later filled with the realised outcome.
 * Evaluation answers: are the probabilities calibrated, do they beat the base rates, and would the gate have helped after costs?
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const dbPath = () => process.env.ENGINE_DB_PATH || path.join(ROOT, 'data', 'engine', 'engine.db');
let db = null, dbFile = null;

function open() {
  const p = dbPath();
  if (db && dbFile === p) return db;
  if (db) { try { db.close(); } catch (_) { /* ignore */ } }
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  db = new DatabaseSync(p); dbFile = p;
  db.exec(`PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS market_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, pair TEXT NOT NULL, price REAL, spread_pct REAL, depth_usd REAL,
      imbalance REAL, atr_pct REAL, vol24 REAL, candle_source TEXT, quality_ok INTEGER, funding_rate REAL, liquidations_usd REAL);
    CREATE INDEX IF NOT EXISTS idx_ml ON market_log (pair, id);
    CREATE TABLE IF NOT EXISTS forecasts (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, due_at TEXT NOT NULL, pair TEXT NOT NULL, horizon_h REAL NOT NULL,
      p_down REAL, p_flat REAL, p_up REAL, exp_ret REAL, exp_se REAL, price REAL, cost_rt REAL, side INTEGER, mode TEXT, gate_pass INTEGER, gate_reasons TEXT,
      net_edge_pct REAL, reviewer TEXT, model_validated INTEGER, flat_band REAL,
      resolved_at TEXT, elapsed_h REAL, realized_ret REAL, realized_class INTEGER, net_ret_side REAL);
    CREATE INDEX IF NOT EXISTS idx_fc ON forecasts (pair, resolved_at, due_at);`);
  return db;
}
const iso = (ms) => new Date(ms).toISOString();

function logMarket(r) {
  open().prepare(`INSERT INTO market_log (ts, pair, price, spread_pct, depth_usd, imbalance, atr_pct, vol24, candle_source, quality_ok, funding_rate, liquidations_usd) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,NULL)`)
    .run(iso(r.nowMs || Date.now()), r.pair, r.price ?? null, r.spreadPct ?? null, r.depthUsd ?? null, r.imbalance ?? null, r.atrPct ?? null, r.vol24 ?? null, r.candleSource || null, r.qualityOk ? 1 : 0);
}

function recordForecast(r) {
  const now = r.nowMs || Date.now();
  open().prepare(`INSERT INTO forecasts (created_at, due_at, pair, horizon_h, p_down, p_flat, p_up, exp_ret, exp_se, price, cost_rt, side, mode, gate_pass, gate_reasons, net_edge_pct, reviewer, model_validated, flat_band)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(iso(now), iso(now + r.horizonH * 3600000), r.pair, r.horizonH, r.pDown, r.pFlat, r.pUp, r.expRet, r.expSe, r.price, r.costRt,
    r.side || 0, r.mode || 'shadow', r.gatePass == null ? null : (r.gatePass ? 1 : 0), r.gateReasons ? String(r.gateReasons).slice(0, 300) : null, r.netEdgePct ?? null, r.reviewer || null, r.modelValidated ? 1 : 0, r.flatBand);
}

/** Fill in the realised outcome of every due forecast for this coin using the current price. */
function resolveDue(pair, price, nowMs = Date.now()) {
  if (!(price > 0)) return 0;
  const d = open();
  const rows = d.prepare('SELECT id, created_at, horizon_h, price, side, cost_rt, flat_band FROM forecasts WHERE pair=? AND resolved_at IS NULL AND due_at<=?').all(pair, iso(nowMs));
  for (const r of rows) {
    const ret = price / r.price - 1, lr = Math.log(price / r.price), band = r.flat_band ?? 0.002;
    d.prepare('UPDATE forecasts SET resolved_at=?, elapsed_h=?, realized_ret=?, realized_class=?, net_ret_side=? WHERE id=?')
      .run(iso(nowMs), +((nowMs - Date.parse(r.created_at)) / 3600000).toFixed(3), ret, lr > band ? 2 : lr < -band ? 0 : 1, r.side ? r.side * ret - r.cost_rt : null, r.id);
  }
  return rows.length;
}

const tStats = (xs) => {
  const n = xs.length; if (!n) return { n: 0, mean: null, t: null, winRate: null };
  const m = xs.reduce((s, x) => s + x, 0) / n, sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, n - 1));
  return { n, mean: +m.toFixed(6), t: sd > 0 ? +(m / (sd / Math.sqrt(n))).toFixed(2) : null, winRate: +(xs.filter((x) => x > 0).length / n).toFixed(3) };
};

/** Resolved forecasts -> calibration, Brier skill, and the shadow-mode question: do gate-passed signals beat gate-rejected ones after costs? */
function evaluation(primaryH = 4) {
  const d = open();
  const total = d.prepare('SELECT COUNT(*) n FROM forecasts').get().n;
  const res = d.prepare('SELECT * FROM forecasts WHERE resolved_at IS NOT NULL ORDER BY created_at').all();
  const out = { forecasts: total, resolved: res.length, byHorizon: {}, gate: {} };
  for (const h of [...new Set(res.map((r) => r.horizon_h))].sort((a, b) => a - b)) {
    const rs = res.filter((r) => r.horizon_h === h), n = rs.length;
    const fr = [0, 0, 0]; rs.forEach((r) => fr[r.realized_class]++);
    const base = fr.map((x) => x / n);
    let bm = 0, bb = 0;
    for (const r of rs) { const y = r.realized_class; bm += (r.p_down - (y === 0)) ** 2 + (r.p_flat - (y === 1)) ** 2 + (r.p_up - (y === 2)) ** 2; bb += (base[0] - (y === 0)) ** 2 + (base[1] - (y === 1)) ** 2 + (base[2] - (y === 2)) ** 2; }
    const up = rs.filter((r) => r.p_up >= 0.5), dn = rs.filter((r) => r.p_down >= 0.5);
    out.byHorizon[h] = { n, brier: +(bm / n).toFixed(4), brierBase: +(bb / n).toFixed(4), brierSkill: +(1 - bm / bb).toFixed(4),
      hitRateWhenPUpOver50: up.length ? +(up.filter((r) => r.realized_class === 2).length / up.length).toFixed(3) : null, nPUpOver50: up.length,
      hitRateWhenPDownOver50: dn.length ? +(dn.filter((r) => r.realized_class === 0).length / dn.length).toFixed(3) : null, nPDownOver50: dn.length };
  }
  // signal outcomes at the primary horizon, one position per coin at a time so windows do not overlap
  const sig = res.filter((r) => r.horizon_h === primaryH && r.side !== 0 && r.net_ret_side != null);
  const nonOverlap = (rows) => { const free = {}, keep = []; for (const r of rows) { const t = Date.parse(r.created_at); if (t >= (free[r.pair] || 0)) { keep.push(r); free[r.pair] = t + primaryH * 3600000; } } return keep; };
  const net = (rows) => nonOverlap(rows).map((r) => r.net_ret_side);
  out.gate = { primaryHorizonH: primaryH, allSignals: tStats(net(sig)), gatePassed: tStats(net(sig.filter((r) => r.gate_pass === 1))), gateRejected: tStats(net(sig.filter((r) => r.gate_pass === 0))),
    note: 'net = signed return after fees, spread, slippage. If "gatePassed" is not clearly better than "gateRejected" with enough trades, the gate has not earned enforcement.' };
  return out;
}

const recent = (limit = 40) => open().prepare('SELECT id, created_at, pair, horizon_h, p_down, p_flat, p_up, exp_ret, side, gate_pass, gate_reasons, net_edge_pct, reviewer, realized_ret, net_ret_side FROM forecasts ORDER BY id DESC LIMIT ?').all(Math.min(300, limit | 0));
const marketCount = () => open().prepare('SELECT COUNT(*) n, COUNT(DISTINCT pair) pairs, MIN(ts) first, MAX(ts) last FROM market_log').get();
function gateReasonCounts() {
  // the gate decision is stored on the primary-horizon row only (other horizons have gate_pass NULL)
  const rows = open().prepare("SELECT gate_reasons g FROM forecasts WHERE gate_pass=0 AND gate_reasons IS NOT NULL").all();
  const c = {}; for (const r of rows) for (const code of r.g.split(',')) { const k = code.trim(); if (k) c[k] = (c[k] || 0) + 1; }
  return c;
}
function close() { if (db) { try { db.close(); } catch (_) { /* ignore */ } } db = null; dbFile = null; }

module.exports = { logMarket, recordForecast, resolveDue, evaluation, recent, marketCount, gateReasonCounts, close, dbPath };
