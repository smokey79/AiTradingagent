'use strict';
const fs = require('fs');
const path = require('path');
let db, currentPath;

function open() {
  const file = process.env.EXPERT_DB_PATH || path.resolve(__dirname, '../../data/expert/expert.db');
  if (db && currentPath === file) return db;
  close();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new (require('node:sqlite').DatabaseSync)(file); currentPath = file;
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS observations(id INTEGER PRIMARY KEY, at_ms INTEGER, pair TEXT, timeframe TEXT, candle_ms INTEGER, patterns TEXT, sources TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS obs_identity ON observations(pair,timeframe,candle_ms);
    CREATE TABLE IF NOT EXISTS advice(id INTEGER PRIMARY KEY, at_ms INTEGER, pair TEXT, agent TEXT, data TEXT);
    CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY, day TEXT, purpose TEXT, reserved REAL, cost REAL, status TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER);
    CREATE INDEX IF NOT EXISTS request_day ON requests(day);
    CREATE TABLE IF NOT EXISTS source_outcomes(source TEXT, pair TEXT, timeframe TEXT, correct INTEGER, total INTEGER, PRIMARY KEY(source,pair,timeframe));
    CREATE TABLE IF NOT EXISTS pattern_outcomes(pattern TEXT, pair TEXT, timeframe TEXT, correct INTEGER, total INTEGER, PRIMARY KEY(pattern,pair,timeframe));
    CREATE TABLE IF NOT EXISTS observation_scores(observation_id INTEGER PRIMARY KEY, scored_ms INTEGER);
  `);
  return db;
}

function observe({ pair, timeframe, candleMs, patterns, sources, nowMs = Date.now() }) {
  const existing = open().prepare('SELECT sources FROM observations WHERE pair=? AND timeframe=? AND candle_ms=?').get(pair, timeframe, candleMs);
  if (existing) {
    const merged = new Map(JSON.parse(existing.sources).map(s => [s.name, s]));
    for (const source of sources) if (source.status === 'available' || !merged.has(source.name)) merged.set(source.name, source);
    return open().prepare('UPDATE observations SET sources=? WHERE pair=? AND timeframe=? AND candle_ms=?')
      .run(JSON.stringify([...merged.values()]), pair, timeframe, candleMs);
  }
  return open().prepare('INSERT OR IGNORE INTO observations(at_ms,pair,timeframe,candle_ms,patterns,sources) VALUES(?,?,?,?,?,?)')
    .run(nowMs, pair, timeframe, candleMs, JSON.stringify(patterns), JSON.stringify(sources));
}
function remember(pair, agent, data, nowMs = Date.now()) {
  open().prepare('INSERT INTO advice(at_ms,pair,agent,data) VALUES(?,?,?,?)').run(nowMs, pair, agent, JSON.stringify(data));
  open().prepare('DELETE FROM advice WHERE id NOT IN (SELECT id FROM advice ORDER BY id DESC LIMIT 2000)').run();
}
function lessons(pair) {
  const d = open();
  return {
    recentPeerAdvice: d.prepare('SELECT agent,data FROM advice WHERE pair=? ORDER BY id DESC LIMIT 4').all(pair)
      .map(r => ({ agent: r.agent, ...JSON.parse(r.data) })),
    sourceEvidence: d.prepare('SELECT * FROM source_outcomes WHERE pair=? ORDER BY total DESC LIMIT 12').all(pair).map(r => ({ ...r, reliability: r.total >= 30 ? r.correct / r.total : null })),
    patternEvidence: d.prepare('SELECT * FROM pattern_outcomes WHERE pair=? ORDER BY total DESC LIMIT 12').all(pair).map(r => ({ ...r, reliability: r.total >= 30 ? r.correct / r.total : null })),
    note: 'Advice is context, not ground truth. Accuracy is measured only after a later closed candle; correlated sources are not independent votes.',
  };
}

// Score each recorded pattern/source direction against the NEXT closed candle on the SAME timeframe.
function score(pair, timeframe, candles) {
  const d = open();
  const rows = d.prepare('SELECT o.* FROM observations o LEFT JOIN observation_scores s ON s.observation_id=o.id WHERE o.pair=? AND o.timeframe=? AND s.observation_id IS NULL').all(pair, timeframe);
  let scored = 0;
  const byTime = new Map(candles.map((c, i) => [c[0], i]));
  d.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      const i = byTime.get(row.candle_ms);
      if (i === undefined || i + 1 >= candles.length) continue;
      if (candles[i + 1][0] - candles[i][0] !== ({ '5m': 5, '1h': 60, '1d': 1440 }[timeframe] * 60000)) continue;
      const ret = candles[i + 1][4] / candles[i][4] - 1;
      const direction = ret > 0 ? 1 : ret < 0 ? -1 : 0;
      for (const p of JSON.parse(row.patterns || '[]')) {
        if (!p.direction) continue;
        d.prepare('INSERT INTO pattern_outcomes VALUES(?,?,?, ?,1) ON CONFLICT(pattern,pair,timeframe) DO UPDATE SET correct=correct+excluded.correct,total=total+1')
          .run(p.name, pair, timeframe, p.direction === direction ? 1 : 0);
      }
      for (const s of JSON.parse(row.sources || '[]')) {
        if (!s.direction || s.status !== 'available') continue;
        d.prepare('INSERT INTO source_outcomes VALUES(?,?,?, ?,1) ON CONFLICT(source,pair,timeframe) DO UPDATE SET correct=correct+excluded.correct,total=total+1')
          .run(s.name, pair, timeframe, s.direction === direction ? 1 : 0);
      }
      d.prepare('INSERT INTO observation_scores VALUES(?,?)').run(row.id, Date.now()); scored++;
    }
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
  return scored;
}

function reserve(purpose, amount, dailyUsd, dailyRequests, nowMs = Date.now()) {
  const d = open(), day = new Date(nowMs).toISOString().slice(0, 10);
  d.exec('BEGIN IMMEDIATE');
  try {
    const used = d.prepare('SELECT COUNT(*) n,COALESCE(SUM(COALESCE(cost,reserved)),0) usd FROM requests WHERE day=?').get(day);
    if (used.n >= dailyRequests || used.usd + amount > dailyUsd) { d.exec('ROLLBACK'); return null; }
    const result = d.prepare("INSERT INTO requests(day,purpose,reserved,status) VALUES(?,?,?,'pending')").run(day, purpose, amount);
    d.exec('COMMIT'); return Number(result.lastInsertRowid);
  } catch (e) { d.exec('ROLLBACK'); throw e; }
}
function finish(id, { status, model = null, cost = null, inputTokens = null, outputTokens = null }) {
  open().prepare('UPDATE requests SET status=?,model=?,cost=?,input_tokens=?,output_tokens=? WHERE id=?')
    .run(status, model, cost, inputTokens, outputTokens, id);
}
function budget(nowMs = Date.now()) {
  return open().prepare('SELECT COUNT(*) requests,COALESCE(SUM(COALESCE(cost,reserved)),0) usd FROM requests WHERE day=?')
    .get(new Date(nowMs).toISOString().slice(0, 10));
}
function close() { if (db) db.close(); db = null; currentPath = null; }
module.exports = { open, observe, remember, lessons, score, reserve, finish, budget, close };
