/**
 * tests/test_allocation_and_candidates.js
 * Offline tests for the Allocation Manager, evidence tiers, indicators and the
 * candidate paper engine. No network, no orders, no writes to data/ (the audit
 * log goes to the temp folder).
 * Run from F:\aitradingagent:  node tests/test_allocation_and_candidates.js
 */
'use strict';
const assert = require('assert');
process.env.ALLOCATION_LOG_PATH = require('path').join(require('os').tmpdir(), 'allocation_log_test.jsonl');
const ind = require('../src/agents/evidenceCandidates/indicators');
const engine = require('../src/agents/evidenceCandidates/engine');
const { CANDIDATES } = require('../src/agents/evidenceCandidates/config');
const { tierFor } = require('../src/risk/strategyEvidence');
const { allocate, lossStreak } = require('../src/agents/allocationAgent');

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

// ── indicators ───────────────────────────────────────────────────────────────
{
  const e = ind.ema([1, 2, 3, 4, 5, 6], 3);
  ok(e[1] === null && e[2] === 2, 'EMA seeded with SMA');
  ok(Math.abs(e[3] - 3) < 1e-9, 'EMA step');
  const day = 86400000;
  const v = ind.vwapDaily([
    { timestamp: 0, close: 10, volume: 1 }, { timestamp: 3600e3, close: 20, volume: 1 },
    { timestamp: day, close: 30, volume: 1 }]);
  ok(v[1] === 15 && v[2] === 30, 'VWAP resets each UTC day');
}

// ── engine: synthetic down-then-up market produces a long, then a stop-out ──
{
  const H = 3600e3, t0 = Date.UTC(2026, 0, 1);
  const candles = [];
  let px = 100;
  for (let i = 0; i < 420; i++) {
    const drift = i < 250 ? -0.15 : (i < 400 ? 0.6 : -8);
    const open = px; px = Math.max(1, px + drift);
    candles.push({ timestamp: t0 + i * H, open, high: Math.max(open, px) + 0.2, low: Math.min(open, px) - 0.2, close: px, volume: 10 });
  }
  const cand = { id: 'TEST', coin: 'TST', timeframe: '1h', strategy: 'EMA_VWAP' };
  const trades = [];
  // first run with only the first 200 bars closed: must start flat, record nothing
  let st = engine.step(cand, candles.slice(0, 200), {}, t0 + 200 * H, (t) => trades.push(t));
  ok(st.pos === null && st.lastBarTs != null && trades.length === 0, 'first run starts flat');
  st = engine.step(cand, candles, st, t0 + 420 * H, (t) => trades.push(t));
  ok(trades.some((t) => t.side === 'long'), 'long opened on EMA cross and closed');
  const stopped = trades.find((t) => t.exitReason === 'STOP');
  ok(stopped && stopped.pnlPct < 100, 'stop-out recorded with fees');
  // 2026-10-03: costs per side are the shared 0.06% fee + 0.02% slippage (config/realism.json): 10% gross -> 9.84% net.
ok(engine.pnlPct('long', 100, 110) === 9.84, 'pnl includes 0.06% fee + 0.02% slippage per side');
}

// ── evidence tiers ──────────────────────────────────────────────────────────
{
  // 2026-10-03 promotion bar: >= 60 out-of-sample trades, PF > 1.3, drawdown < 20%, fees included. The recorded
  // candidates do not carry an OOS trade count or a fee confirmation, so they no longer pass; the tier mechanics are
  // tested with a fixture that does meet the bar.
  ok(tierFor(CANDIDATES[0], []).tier === 'FAILED', 'recorded candidate without OOS trade count / fee confirmation fails the 2026-10-03 bar');
  const bt = { ...CANDIDATES[0], trades: 244, pf: 1.5, oosPf: 1.4, dd15Pct: 12, oosTrades: 80, feesIncluded: true };
  ok(tierFor(bt, []).tier === 'PAPER_CANDIDATE', 'lab pass + no paper = PAPER_CANDIDATE');
  const good = Array.from({ length: 20 }, (_, i) => ({ pnlPct: i % 4 === 0 ? 6 : -1 }));
  ok(tierFor(bt, good).tier === 'CONFIRMED', 'profitable paper record = CONFIRMED');
  const bad = Array.from({ length: 20 }, (_, i) => ({ pnlPct: i % 10 === 0 ? 2 : -1 }));
  ok(tierFor(bt, bad).tier === 'DEGRADED', 'losing paper record = DEGRADED');
  ok(tierFor({ ...bt, oosPf: 0.9 }, []).tier === 'FAILED', 'failed backtest = FAILED');
  ok(tierFor(null, []).tier === 'UNVERIFIED', 'no evidence = UNVERIFIED');
}

// ── Allocation Manager ──────────────────────────────────────────────────────
{
  const ps = { currentBalance: 1000, maxExposurePct: 95, exposurePct: 0, sessionDrawdownPct: 0, maxSessionLossPct: 8 };
  const rg = { approved: true, positionSizeUsd: 100, leverage: 12, stopLossPct: 2, portfolioState: ps, vetoes: [] };
  const consensus = (tier, cand = CANDIDATES[0]) => ({ signal: 'BUY', breakdown: [
    { agent: 'evidence_candidates', signal: 'BUY', details: { evidenceTier: tier, candidates: [{ id: cand.id }] } },
    { agent: 'claude', signal: 'BUY', details: {} }] });

  process.env.PAPER_TRADING = 'true';
  // 2026-10-03: the minimum order comes from the exchange's own market info; give the test its own fixture.
  const tmpLim = require('path').join(require('os').tmpdir(), `limits-alloc-${process.pid}.json`);
  require('fs').writeFileSync(tmpLim, JSON.stringify({ exchange: 'bitget', fetchedAt: new Date().toISOString(),
    markets: { 'ETH/USDT': { minCostUsd: 1, minAmount: 0.0005, lastPrice: 3000 } } }));
  process.env.EXCHANGE_LIMITS_PATH = tmpLim;
  const rej = { approved: false, reason: 'x' };
  ok(allocate({ pair: 'ETH/USDT', consensus: consensus('CONFIRMED'), riskDecision: rej, trades: [] }) === rej, 'never overrides a rejection');

  const conf = allocate({ pair: 'ETH/USDT', consensus: consensus('CONFIRMED'), riskDecision: rg, trades: [] });
  const cand = allocate({ pair: 'ETH/USDT', consensus: consensus('PAPER_CANDIDATE'), riskDecision: rg, trades: [] });
  const none = allocate({ pair: 'ETH/USDT', consensus: { signal: 'BUY', breakdown: [{ agent: 'claude', signal: 'BUY' }] }, riskDecision: rg, trades: [] });
  ok(conf.approved && conf.positionSizeUsd <= 100, 'never above risk-gate size');
  ok(conf.positionSizeUsd > cand.positionSizeUsd, 'CONFIRMED gets a larger share than PAPER_CANDIDATE');
  ok(conf.leverage === 5, 'leverage capped at 5x');
  ok(!none.approved || none.positionSizeUsd < cand.positionSizeUsd, 'no evidence = smaller exploration size (or skipped)');

  const ddState = { ...ps, sessionDrawdownPct: 6 };
  const dd = allocate({ pair: 'ETH/USDT', consensus: consensus('CONFIRMED'), riskDecision: { ...rg, portfolioState: ddState }, trades: [] });
  ok(!dd.approved || dd.positionSizeUsd < conf.positionSizeUsd, 'drawdown shrinks size');

  const losers = Array.from({ length: 25 }, () => ({ outcome: 'LOSS', pnlUsd: -1 }));
  ok(lossStreak(losers) === 25, 'loss streak counted');
  process.env.PAPER_TRADING = 'false';
  const live = allocate({ pair: 'ETH/USDT', consensus: consensus('CONFIRMED'), riskDecision: rg, trades: losers });
  ok(!live.approved && /negative/.test(live.reason), 'live blocked when measured edge is negative');
  const liveNone = allocate({ pair: 'ETH/USDT', consensus: { signal: 'BUY', breakdown: [] }, riskDecision: rg, trades: [] });
  ok(!liveNone.approved && /no measured edge/.test(liveNone.reason), 'live blocked with no measured edge');
  process.env.PAPER_TRADING = 'true';

  // 2026-10-03: minimum order is the exchange's, not a fixed $10
  const tiny = allocate({ pair: 'ETH/USDT', consensus: consensus('CONFIRMED'), riskDecision: { ...rg, positionSizeUsd: 1.2 }, trades: [] });
  ok(!tiny.approved && /exchange minimum order/.test(tiny.reason), 'size below the exchange minimum is blocked');
  const small = allocate({ pair: 'ETH/USDT', consensus: consensus('CONFIRMED'), riskDecision: { ...rg, positionSizeUsd: 20 }, trades: [] });
  ok(small.approved, 'a $20 exploration-size order is fine: the real minimum for ETH/USDT is about $1.6, not $10');
  const unknown = allocate({ pair: 'ZZZ/USDT', consensus: consensus('CONFIRMED'), riskDecision: rg, trades: [] });
  ok(!unknown.approved && /minimum order unknown/.test(unknown.reason), 'unknown exchange minimum on a crypto pair is blocked (never guessed)');
  delete process.env.EXCHANGE_LIMITS_PATH;
  try { require('fs').unlinkSync(tmpLim); } catch (_) { /* temp file */ }
}

console.log(`allocation + candidates tests passed (${checks} checks)`);
