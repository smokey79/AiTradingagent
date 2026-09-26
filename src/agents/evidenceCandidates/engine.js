/**
 * src/agents/evidenceCandidates/engine.js
 * Forward paper-trading engine for the lab candidates. Replicates the Pine template
 * used in the backtests (research/btc_strategy_lab_2026-09-13/templates.js wrapTrend):
 *   - signals evaluated on CLOSED bars, orders fill at that bar's close
 *   - long:  EMA50 crosses above EMA100 [and close > VWAP] [and ADX > threshold]
 *   - short: the mirror image
 *   - ATR(14) x mult stop set at each entry signal; an opposite signal flips the position
 *   - 0.05% commission per side (same as the backtests)
 * Paper records only. Nothing here places an order.
 *
 * Starts FLAT on first run (no back-filled trades): the paper record is a genuine
 * forward test from the moment it is switched on.
 *
 * Files: data/evidence_candidates_state.json (open positions)
 *        data/evidence_candidates_ledger.jsonl (closed paper trades, one JSON per line)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ind = require('./indicators');
const { STRATEGIES } = require('./config');

const DATA_DIR = path.resolve(__dirname, '../../../data');
const STATE_PATH = path.join(DATA_DIR, 'evidence_candidates_state.json');
const LEDGER_PATH = path.join(DATA_DIR, 'evidence_candidates_ledger.jsonl');
const FEE_PCT_PER_SIDE = 0.05;
const TF_MS = { '1h': 3600e3, '2h': 7200e3, '4h': 14400e3, '1d': 86400e3 };

function loadState() { try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return {}; } }
function saveState(s) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH + '.tmp', JSON.stringify(s, null, 2));
  fs.renameSync(STATE_PATH + '.tmp', STATE_PATH);
}
function appendTrade(t) { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.appendFileSync(LEDGER_PATH, JSON.stringify(t) + '\n'); }

function readLedger(id = null) {
  try {
    return fs.readFileSync(LEDGER_PATH, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
      .filter((t) => !id || t.candidateId === id);
  } catch { return []; }
}

/** Signals for every closed bar. Returns arrays aligned with candles. */
function computeSignals(candles, stratName) {
  const s = STRATEGIES[stratName];
  const close = candles.map((c) => c.close);
  const e50 = ind.ema(close, 50), e100 = ind.ema(close, 100);
  const atr = ind.atr(candles, 14);
  const adx = s.useAdx ? ind.adx(candles, 14) : null;
  const vwap = s.useVwap ? ind.vwapDaily(candles) : null;
  const longE = [], shortE = [];
  for (let i = 0; i < candles.length; i++) {
    let L = false, S = false;
    if (i > 0 && e50[i] != null && e100[i] != null && e50[i - 1] != null && e100[i - 1] != null) {
      const up = e50[i] > e100[i] && e50[i - 1] <= e100[i - 1];
      const dn = e50[i] < e100[i] && e50[i - 1] >= e100[i - 1];
      const adxOk = !s.useAdx || (adx[i] != null && adx[i] > s.adxTh);
      L = up && adxOk && (!s.useVwap || close[i] > vwap[i]);
      S = dn && adxOk && (!s.useVwap || close[i] < vwap[i]);
    }
    longE.push(L); shortE.push(S);
  }
  return { longE, shortE, atr, atrMult: s.atrMult };
}

function pnlPct(side, entry, exit) {
  const gross = side === 'long' ? (exit / entry - 1) * 100 : (entry / exit - 1) * 100;
  return +(gross - 2 * FEE_PCT_PER_SIDE).toFixed(4);
}

/**
 * Advance one candidate over newly closed bars. Mutates and returns its state:
 * { pos: 'long'|'short'|null, entry, entryTime, longStop, shortStop, lastBarTs }
 */
function step(cand, candles, st, now = Date.now(), record = appendTrade) {
  const tfMs = TF_MS[cand.timeframe];
  const closed = candles.filter((c) => c.timestamp + tfMs <= now);
  if (closed.length < 150) return { ...st, note: 'not enough closed candles' };
  const sig = computeSignals(closed, cand.strategy);
  const s = { pos: null, entry: null, entryTime: null, longStop: null, shortStop: null, lastBarTs: null, ...st };

  if (s.lastBarTs == null) { // first run: start flat at the latest closed bar
    s.lastBarTs = closed[closed.length - 1].timestamp;
    s.startedAt = new Date(now).toISOString();
    return s;
  }
  const close = (i, exitPx, reason) => {
    const t = { candidateId: cand.id, coin: cand.coin, timeframe: cand.timeframe, strategy: cand.strategy,
      side: s.pos, entryPrice: s.entry, exitPrice: exitPx, entryTime: s.entryTime,
      exitTime: new Date(closed[i].timestamp + tfMs).toISOString(), pnlPct: pnlPct(s.pos, s.entry, exitPx),
      outcome: null, exitReason: reason, paper: true, source: 'evidence_candidates' };
    t.outcome = t.pnlPct > 0 ? 'WIN' : (t.pnlPct < 0 ? 'LOSS' : 'BREAKEVEN');
    record(t);
    s.pos = null; s.entry = null; s.entryTime = null;
  };

  for (let i = 0; i < closed.length; i++) {
    const b = closed[i];
    if (b.timestamp <= s.lastBarTs) continue;
    // 1) stop checks during the bar (orders placed on earlier bars)
    if (s.pos === 'long' && s.longStop != null && b.low <= s.longStop) close(i, Math.min(b.open, s.longStop), 'STOP');
    else if (s.pos === 'short' && s.shortStop != null && b.high >= s.shortStop) close(i, Math.max(b.open, s.shortStop), 'STOP');
    // 2) entries at the close (process_orders_on_close); opposite entry flips
    const atr = sig.atr[i];
    if (sig.longE[i] && atr != null) {
      if (s.pos === 'short') close(i, b.close, 'FLIP');
      if (s.pos !== 'long') { s.pos = 'long'; s.entry = b.close; s.entryTime = new Date(b.timestamp + tfMs).toISOString(); }
      s.longStop = b.close - atr * sig.atrMult;
    }
    if (sig.shortE[i] && atr != null) {
      if (s.pos === 'long') close(i, b.close, 'FLIP');
      if (s.pos !== 'short') { s.pos = 'short'; s.entry = b.close; s.entryTime = new Date(b.timestamp + tfMs).toISOString(); }
      s.shortStop = b.close + atr * sig.atrMult;
    }
    s.lastBarTs = b.timestamp;
  }
  return s;
}

module.exports = { step, computeSignals, pnlPct, loadState, saveState, readLedger, LEDGER_PATH, STATE_PATH, TF_MS };
