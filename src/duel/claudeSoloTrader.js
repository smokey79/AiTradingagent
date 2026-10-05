/**
 * claudeSoloTrader.js — "Bot B" for the 2026-09-29 duel (Alan: "do this vs a
 * claude only using same data sources and connectors, trade 250usdt over any
 * market, alpaca, oanda, crypto incl. meme scalping and arb, leverage can be
 * utilised, hard stop 30 usdt" — hard stop confirmed as a $30 balance FLOOR).
 *
 * Bot A = the existing multi-agent orchestrator. Bot B = this file: ONE model
 * (Claude via OpenRouter) makes every decision. Everything else is held equal:
 *   - same data modules (marketData / oandaMarketData / alpacaMarketData /
 *     dexScreenerFeed / arb engine output), same instrument universe
 *   - same paper-fill costs as Bot A's paper engines (0.10% fee + 0.05% slippage)
 *   - 250 USDT start, leverage <= 5x, stop trading at <= $30 equity
 * It keeps its OWN book in data/duel/ and never touches trade_ledger.json,
 * portfolio_state.json or any broker account. PAPER ONLY — there is no code
 * path in this file that can place a real order. Book maths: ./paperBook.js
 *
 * Flash-loan arb: no on-chain executor exists in this project, so (like Bot A)
 * Bot B can only SEE arb observations, not trade them.
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const fs = require('fs');
const axios = require('axios');
const logger = require('../utils/logger');
const { fetchMarketData } = require('../data/marketData');
const { fetchOandaMarketData } = require('../data/oandaMarketData');
const { fetchAlpacaMarketData } = require('../data/alpacaMarketData');
const { scanTrendingMemeCoins } = require('../data/dexScreenerFeed');
const { getOandaPairs, getAlpacaPairs } = require('../utils/instrumentUniverse');
const { parseLenient } = require('../utils/lenientJson');
const B = require('./paperBook');

const DIR = path.resolve(__dirname, '../../data/duel');
const STATE_FILE = path.join(DIR, 'claude_state.json');
const LEDGER_FILE = path.join(DIR, 'claude_ledger.jsonl');
const DECISION_FILE = path.join(DIR, 'claude_decisions.jsonl');

const CFG = {
  startUsd: parseFloat(process.env.DUEL_START_USD || '250'),
  floorUsd: parseFloat(process.env.DUEL_FLOOR_USD || '30'),
  maxOpen: parseInt(process.env.DUEL_MAX_OPEN || '6', 10),
  maxMarginFrac: 0.25,
  minNotional: 5,
  decisionMs: parseFloat(process.env.DUEL_DECISION_MIN || '15') * 60000,
  markMs: 120000,
  hours: parseFloat(process.env.DUEL_HOURS || '24'),
  model: process.env.DUEL_CLAUDE_MODEL || 'anthropic/claude-sonnet-5.5',
  budgetUsd: parseFloat(process.env.DUEL_CLAUDE_BUDGET_USD || '2.00'),
  usdPerInTok: 2 / 1e6, usdPerOutTok: 10 / 1e6,   // OpenRouter list price for claude-sonnet-5.5, 2026-09-29
};

// ── State (persisted so a PM2 restart resumes the same duel) ───────────────
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { /* fresh */ }
  const now = Date.now();
  return { startedAt: new Date(now).toISOString(), endsAt: new Date(now + CFG.hours * 3600000).toISOString(),
           spendUsd: 0, decisionsMade: 0, book: B.newBook(CFG.startUsd), memeMeta: {} };
}
let S = loadState();
function save() { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(S, null, 2)); }
function logClosed(recs) { for (const r of recs.filter(Boolean)) { fs.appendFileSync(LEDGER_FILE, JSON.stringify({ bot: 'claude_solo', ...r }) + '\n'); logger.info(`[ClaudeSolo] CLOSED ${r.side} ${r.key} ${r.closeReason} net $${r.netPnl}`); } }

// ── Prices: same data modules Bot A uses ────────────────────────────────────
async function priceFor(key) {
  const [market, ...rest] = key.split(':');
  const id = rest.join(':');
  try {
    if (market === 'crypto') return (await fetchMarketData(id))?.price?.price;
    if (market === 'oanda')  return (await fetchOandaMarketData(id))?.price?.price;
    if (market === 'alpaca') return (await fetchAlpacaMarketData(id))?.price?.price;
    if (market === 'meme') {
      const [chain, pair] = id.split('/');
      const { data } = await axios.get(`https://api.dexscreener.com/latest/dex/pairs/${chain}/${pair}`, { timeout: 6000 });
      return parseFloat(data?.pairs?.[0]?.priceUsd || data?.pair?.priceUsd) || null;
    }
  } catch (e) { logger.warn(`[ClaudeSolo] price ${key} failed: ${e.message}`); }
  return null;
}

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

function fmt(n, d = 2) { return Number.isFinite(n) ? Number(n).toFixed(d) : 'n/a'; }

// ── Market snapshot (the same universe Bot A trades) ───────────────────────
async function buildSnapshot() {
  const crypto = (process.env.TRADING_PAIRS || 'BTC/USDT,ETH/USDT,SOL/USDT').split(',').map(s => s.trim()).filter(Boolean);
  const oanda = getOandaPairs();
  const alpaca = getAlpacaPairs();
  const rows = []; const prices = {};
  const add = (key, md) => {
    const px = md?.price?.price; if (!(px > 0)) return;
    const i = md.indicators || {};
    prices[key] = px;
    const sig = v => (Number.isFinite(v) ? Number(v).toPrecision(6) : 'n/a');   // keeps forex decimals
    rows.push(`${key} | px ${px} | 24h ${fmt(md.price.change24h)}% | RSI ${fmt(i.rsi14 ?? i.rsi, 1)} | EMA20 ${sig(i.ema20)} | EMA50 ${sig(i.ema50)} | ATR ${sig(i.atr14 ?? i.atr)}` +
      (md.fearGreed && md.venue !== 'oanda' ? ` | F&G ${md.fearGreed.value}` : ''));
  };
  await pool(crypto, 4, async p => add(`crypto:${p}`, await fetchMarketData(p).catch(() => null)));
  await pool(oanda, 4, async p => add(`oanda:${p}`, await fetchOandaMarketData(p).catch(() => null)));
  await pool(alpaca, 3, async p => add(`alpaca:${p}`, await fetchAlpacaMarketData(p).catch(() => null)));

  // Meme scalping universe — live DexScreener only (the feed's curated fallback uses stale seed prices).
  const memes = (await scanTrendingMemeCoins().catch(() => [])).filter(m => m.source === 'dexscreener_live' && m.priceUsd > 0).slice(0, 10);
  for (const m of memes) {
    const key = `meme:${m.chain}/${m.pairAddress}`;
    prices[key] = m.priceUsd; S.memeMeta[key] = m.symbol;
    rows.push(`${key} (${m.symbol}) | px ${m.priceUsd} | 5m ${m.change5m}% | 1h ${m.change1h}% | 24h ${m.change24h}% | liq $${Math.round(m.liquidityUsd)} | vol24h $${Math.round(m.volume24hUsd)} | safety ${m.safetyScore}`);
  }

  // Context both bots can see
  const ctx = [];
  try { const bd = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/external/bigdata_latest.json'), 'utf8')); ctx.push(`Bigdata.com news sentiment (cached): ${JSON.stringify(bd).slice(0, 600)}`); } catch (_) {}
  try { const arb = fs.readFileSync(path.resolve(__dirname, '../../data/arb_paper_log.jsonl'), 'utf8').trim().split('\n').slice(-3); if (arb[0]) ctx.push(`Recent same-chain arb observations (NOT tradeable, no on-chain executor): ${arb.join(' ')}`); } catch (_) { ctx.push('Arb engine: no same-chain flash-loan opportunities after costs recently (observation-only; not tradeable).'); }
  return { rows, prices, ctx };
}

// ── Claude decision ─────────────────────────────────────────────────────────
const SYSTEM = `You are the sole decision-maker of a PAPER trading account in a 24-hour contest against a multi-agent bot. Both see identical data.
Goal: finish with the highest equity. Protect capital: a bad trade is worse than no trade; only act when the setup has a clear, specific edge in the data shown.
HARD RULES (the engine rejects violations):
- Markets: crypto (CEX perps, LONG/SHORT, leverage <=5), oanda (forex/commodities/indices CFDs, LONG/SHORT, leverage <=5), alpaca (US stocks, LONG/SHORT, leverage <=2; US market may be closed and prices stale outside 14:30-21:00 UK), meme (DEX spot, LONG only, 1x, ~1% cost per side, extremely volatile).
- Every OPEN needs stopLossPct (0.2-25) and takeProfitPct. notionalUsd >= 5. Margin (= notional/leverage) <= 25% of equity. Max ${CFG.maxOpen} open positions, one per instrument.
- Costs: 0.15% per side on crypto/oanda/alpaca, 1% per side on meme. Leverage multiplies both gains and losses; a position cannot lose more than its margin.
- If equity reaches $${CFG.floorUsd} all positions close and trading stops for good.
- Flash-loan arbitrage cannot be executed (observation data only).
- You are consulted every ${CFG.decisionMs / 60000} minutes; stops/targets are checked every 2 minutes between consultations.
Reply with ONLY one JSON object:
{"actions":[{"action":"OPEN","key":"<exact instrument key>","side":"LONG|SHORT","notionalUsd":number,"leverage":number,"stopLossPct":number,"takeProfitPct":number,"reason":"one sentence citing the data"},{"action":"CLOSE","id":number,"reason":"..."}],"note":"one sentence market view"}
An empty actions array is a valid, often correct, answer.`;

async function askClaude(snapshot) {
  const key = (process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEYS || '').split(',')[0].trim();
  const b = S.book;
  const eq = B.equity(b, snapshot.prices);
  const open = b.positions.map(p => `id ${p.id} ${p.side} ${p.key} ${p.leverage}x notional $${fmt(p.notional)} entry ${p.entry} now ${snapshot.prices[p.key] ?? p.lastPrice} uPnL $${fmt(B.unrealized(p, snapshot.prices[p.key] ?? p.lastPrice))} SL ${fmt(p.stopPrice, 6)} TP ${fmt(p.takePrice, 6)}`);
  const recent = b.closed.slice(-8).map(r => `${r.side} ${r.key} ${r.closeReason} net $${r.netPnl}`);
  const user = [
    `Time (UTC): ${new Date().toISOString()} | contest ends ${S.endsAt}`,
    `Equity $${fmt(eq)} | free cash $${fmt(b.cash)} | start $${b.startUsd} | floor $${CFG.floorUsd}`,
    `OPEN POSITIONS:\n${open.join('\n') || 'none'}`,
    `RECENT CLOSED:\n${recent.join('\n') || 'none'}`,
    `CONTEXT:\n${snapshot.ctx.join('\n')}`,
    `MARKET DATA (key | price | 24h | RSI14 | EMA20 | EMA50 | ATR14 on 1h candles):\n${snapshot.rows.join('\n')}`,
  ].join('\n\n');
  // Provider: direct Anthropic API when DUEL_CLAUDE_PROVIDER=anthropic (same Sonnet 5.5 model, same prompt,
  // same temperature), otherwise OpenRouter. If the direct call fails, falls back to OpenRouter once.
  let text = '', inTok = 0, outTok = 0, via = 'openrouter';
  const aKey = process.env.ANTHROPIC_API_KEY;
  if ((process.env.DUEL_CLAUDE_PROVIDER || '').toLowerCase() === 'anthropic' && aKey) {
    try {
      const { data } = await axios.post('https://api.anthropic.com/v1/messages', {
        model: process.env.DUEL_CLAUDE_ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 900, temperature: 0.2,
        system: SYSTEM, messages: [{ role: 'user', content: user }],
      }, { headers: { 'x-api-key': aKey, 'anthropic-version': '2023-06-01' }, timeout: 90000 });
      text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
      inTok = data.usage?.input_tokens || 0; outTok = data.usage?.output_tokens || 0; via = 'anthropic';
    } catch (e) { logger.warn(`[ClaudeSolo] Anthropic direct failed (${e.response?.status || e.message}) - falling back to OpenRouter`); }
  }
  if (via !== 'anthropic') {
    if (!key) throw new Error('no OPENROUTER_API_KEY');
    const { data } = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: CFG.model, max_tokens: 900, temperature: 0.2,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
    }, { headers: { Authorization: `Bearer ${key}`, 'X-Title': 'AiTradingAgent-Duel-ClaudeSolo' }, timeout: 90000 });
    text = data.choices?.[0]?.message?.content || '';
    inTok = data.usage?.prompt_tokens || 0; outTok = data.usage?.completion_tokens || 0;
  }
  const cost = inTok * CFG.usdPerInTok + outTok * CFG.usdPerOutTok;
  S.spendUsd += cost;
  return { parsed: parseLenient(text, 'actions'), text, cost, eq, via };
}

function applyActions(actions, prices) {
  const results = [];
  for (const a of Array.isArray(actions) ? actions : []) {
    const act = String(a.action || '').toUpperCase();
    if (act === 'CLOSE') {
      const p = S.book.positions.find(x => x.id === Number(a.id));
      if (!p) { results.push({ a, ok: false, reason: 'no such position' }); continue; }
      const rec = B.close(S.book, p.id, prices[p.key] ?? p.lastPrice, `CLAUDE_CLOSE: ${String(a.reason || '').slice(0, 120)}`);
      logClosed([rec]); results.push({ a, ok: true });
    } else if (act === 'OPEN') {
      const key = String(a.key || '');
      const market = key.split(':')[0];
      const r = B.open(S.book, { key, market, side: String(a.side || '').toUpperCase(), notional: a.notionalUsd, leverage: a.leverage,
        stopLossPct: a.stopLossPct, takeProfitPct: a.takeProfitPct, reason: a.reason }, prices[key],
        { maxOpen: CFG.maxOpen, maxMarginFrac: CFG.maxMarginFrac, minNotional: CFG.minNotional });
      if (r.ok) {
        fs.appendFileSync(LEDGER_FILE, JSON.stringify({ bot: 'claude_solo', event: 'OPEN', ...r.position }) + '\n');
        logger.info(`[ClaudeSolo] OPEN ${r.position.side} ${key}${S.memeMeta[key] ? ` (${S.memeMeta[key]})` : ''} ${r.position.leverage}x $${fmt(r.position.notional)} @ ${r.position.entry} — ${r.position.reason}`);
      } else logger.info(`[ClaudeSolo] rejected OPEN ${key}: ${r.reason}`);
      results.push({ a, ok: r.ok, reason: r.reason });
    }
  }
  return results;
}

let deciding = false;
async function decisionCycle() {
  if (deciding || S.book.halted) return;
  if (Date.now() >= Date.parse(S.endsAt)) return finish();
  if (S.spendUsd >= CFG.budgetUsd) { logger.warn(`[ClaudeSolo] Claude budget $${CFG.budgetUsd} used ($${fmt(S.spendUsd, 3)}) — no new decisions; stops/targets still managed.`); return; }
  deciding = true;
  try {
    const snap = await buildSnapshot();
    const { parsed, cost, eq } = await askClaude(snap);
    const results = applyActions(parsed.actions, snap.prices);
    S.decisionsMade++;
    fs.appendFileSync(DECISION_FILE, JSON.stringify({ at: new Date().toISOString(), equity: +eq.toFixed(2), instruments: snap.rows.length, note: parsed.note, actions: parsed.actions, results, costUsd: +cost.toFixed(4), spendUsd: +S.spendUsd.toFixed(4) }) + '\n');
    logger.info(`[ClaudeSolo] decision #${S.decisionsMade}: ${results.length} action(s) | equity $${fmt(eq)} | ${snap.rows.length} instruments | spend $${fmt(S.spendUsd, 3)} — ${parsed.note || ''}`);
    save();
  } catch (e) {
    logger.warn(`[ClaudeSolo] decision failed: ${e.response?.status || ''} ${e.response?.data?.error?.message || e.message}`);
  } finally { deciding = false; }
}

let marking = false;
async function markCycle() {
  if (marking || S.book.positions.length === 0) return;
  marking = true;
  try {
    const prices = {};
    for (const p of S.book.positions) prices[p.key] = await priceFor(p.key);
    logClosed(B.mark(S.book, prices));
    const floorClosed = B.enforceFloor(S.book, prices, CFG.floorUsd);
    if (floorClosed.length || S.book.halted) { logClosed(floorClosed); if (S.book.halted) logger.warn(`[ClaudeSolo] HALTED: ${S.book.haltReason}`); }
    save();
  } finally { marking = false; }
}

async function finish() {
  if (S.finishedAt) return;
  const prices = {};
  for (const p of S.book.positions) prices[p.key] = await priceFor(p.key);
  for (const p of [...S.book.positions]) logClosed([B.close(S.book, p.id, prices[p.key] ?? p.lastPrice, 'CONTEST_END')]);
  S.finishedAt = new Date().toISOString();
  S.book.halted = true; S.book.haltReason = S.book.haltReason || 'contest finished';
  save();
  logger.info(`[ClaudeSolo] CONTEST FINISHED — final equity $${fmt(B.equity(S.book))}`);
}

function status() {
  return { bot: 'claude_solo', startedAt: S.startedAt, endsAt: S.endsAt, equity: B.equity(S.book), cash: S.book.cash,
    open: S.book.positions.length, closed: S.book.closed.length, halted: S.book.halted, haltReason: S.book.haltReason,
    decisions: S.decisionsMade, spendUsd: S.spendUsd };
}

if (require.main === module) {
  save();
  logger.info(`[ClaudeSolo] STARTED — PAPER duel vs multi-agent | $${S.book.startUsd} start | floor $${CFG.floorUsd} | ${CFG.model} every ${CFG.decisionMs / 60000} min | budget $${CFG.budgetUsd} | ends ${S.endsAt}`);
  decisionCycle();
  setInterval(decisionCycle, CFG.decisionMs);
  setInterval(() => markCycle().catch(e => logger.warn(`[ClaudeSolo] mark failed: ${e.message}`)), CFG.markMs);
  setInterval(() => { if (Date.now() >= Date.parse(S.endsAt)) finish(); }, 60000);
  // Side-by-side scoreboard for both bots at http://localhost:3005 (3001 stays Bot A's dashboard)
  require('./duelDashboard').startDuelDashboard(status);
  logger.info('[ClaudeSolo] Duel scoreboard at http://localhost:3005');
}

module.exports = { status, buildSnapshot, applyActions, _state: () => S };
