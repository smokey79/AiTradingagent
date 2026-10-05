/**
 * src/arb/arbAgent.js  (2026-10-03) -- the arbitrage agent. PAPER ONLY, never sends an order.
 *
 * Every scan:  live public quotes from several exchanges -> the best buy/sell venue per coin -> order-book depth for the
 * best candidates -> net result after taker fees, price impact, a latency haircut and a rebalancing cost ->
 * memory (what this route did before) -> bull/bear debate (free LLMs, heuristic fallback) -> predictor (probability the spread is
 * still there next scan, written to memory and scored later) -> paper execution only if the spread persisted across two scans,
 * the predictor agrees and the net result is positive. The paper trades, their cost breakdown and the P/L live in data/arb/arb.db.
 *
 * Why "paper" even when it looks profitable: a real cross-exchange trade needs money already sitting on BOTH exchanges, API keys,
 * and it competes with professional bots that are faster. The latency and rebalancing haircuts model that, so the numbers here are
 * an honest estimate, not a promise. Live execution is not implemented and stays locked (config/realism.json -> arbitrage).
 *
 * Run:  node src/arb/arbAgent.js          (loop)      node src/arb/arbAgent.js --once
 * Env:  ARB_SCAN_INTERVAL_SEC=60  ARB_NOTIONAL_USD=100  ARB_MIN_NET_USD=0.02  ARB_PROB_MIN=0.55  ARB_MAX_TRADES_PER_DAY=60
 *       ARB_LATENCY_PCT_PER_SIDE=0.03  ARB_REBALANCE_PCT=0.05  ARB_TOP_CANDIDATES=4
 */
'use strict';

try { require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') }); } catch (_) { /* dotenv optional */ }
const ex = require('./exchanges');
const math = require('./math');
const memory = require('./memory');
const realism = require('../utils/realism');
const predictor = require('../predictor/predictorAgent');
const store = require('../predictor/predictionStore');
const { llmJson } = require('../predictor/llm');

const cfg = () => ({
  intervalSec: Number(process.env.ARB_SCAN_INTERVAL_SEC || 60),
  maxNotional: Number(process.env.ARB_NOTIONAL_USD || 100),
  minNetUsd: Number(process.env.ARB_MIN_NET_USD || 0.02),
  probMin: Number(process.env.ARB_PROB_MIN || 0.55),
  maxTradesPerDay: Number(process.env.ARB_MAX_TRADES_PER_DAY || 60),
  latencyPct: Number(process.env.ARB_LATENCY_PCT_PER_SIDE || 0.03),
  rebalancePct: Number(process.env.ARB_REBALANCE_PCT || 0.05),
  topN: Number(process.env.ARB_TOP_CANDIDATES || 4),
});

const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)} [arb] ${m}`);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const routeKey = (s, b, c) => `${s}|${b}>${c}`;

const lastNet = new Map(); // route -> { net, at }
let scanning = false;

/** Bull/bear debate about whether this spread can really be captured. LLM first (free rotation), heuristic fallback. */
async function debate(opp, mem) {
  const compact = { symbol: opp.symbol, buyOn: opp.buyEx, sellOn: opp.sellEx, grossPct: +opp.grossPct.toFixed(3), netPct: +opp.netPct.toFixed(3),
    notionalUsd: +opp.notionalUsd.toFixed(0), depthRatio: +opp.depthRatio.toFixed(1), seenBefore: mem.n, profitableShare: +mem.profitableShare.toFixed(2),
    persistence: +mem.persistenceRate.toFixed(2), costsUsd: { fees: +opp.feesUsd.toFixed(3), latency: +opp.latencyUsd.toFixed(3), rebalance: +opp.rebalanceUsd.toFixed(3) } };
  const r = await llmJson({
    system: 'Two crypto traders debate whether a cross-exchange arbitrage can really be captured with pre-funded accounts. The BULL argues it can, the BEAR argues it cannot (competition, thin books, stale quotes, transfer risk). ' +
      'Answer ONLY JSON: {"bull":{"case":"max 35 words","confidence":0.0-1.0},"bear":{"case":"max 35 words","confidence":0.0-1.0}}',
    user: JSON.stringify(compact), maxTokens: 380 });
  const j = r?.json;
  if (j?.bull && j?.bear && Number.isFinite(Number(j.bull.confidence)) && Number.isFinite(Number(j.bear.confidence))) {
    return { source: 'llm', model: r.model, bullCase: String(j.bull.case || '').slice(0, 240), bullConfidence: clamp(Number(j.bull.confidence), 0, 1),
      bearCase: String(j.bear.case || '').slice(0, 240), bearConfidence: clamp(Number(j.bear.confidence), 0, 1) };
  }
  const bull = clamp(0.35 + opp.netPct * 2 + (mem.persistenceRate - 0.35), 0.05, 0.95);
  const bear = clamp(0.6 - opp.netPct * 2 + (opp.depthRatio < 1.5 ? 0.2 : 0) + (mem.n < 5 ? 0.1 : 0), 0.05, 0.95);
  return { source: 'heuristic', model: null, bullCase: `net ${opp.netPct.toFixed(3)}% after all costs, seen ${mem.n} times before`,
    bearCase: `competition and quote latency; depth x${opp.depthRatio.toFixed(1)}; only ${mem.n} past observations`, bullConfidence: bull, bearConfidence: bear };
}

/** Score the event predictions that came due: was the route's spread still profitable at this scan? */
function resolveDuePredictions(netByRoute) {
  let n = 0;
  for (const p of store.dueEvents('arb')) {
    const net = netByRoute.get(p.key);
    if (store.resolveEvent(p.id, net != null && net > 0, net == null ? 'no spread seen' : `net ${net.toFixed(3)}%`)) n++;
  }
  return n;
}

async function scanOnce() {
  if (scanning) return { skipped: 'previous scan still running' };
  scanning = true;
  const c = cfg();
  const t0 = Date.now();
  try {
    const symbols = ex.symbolList();
    const names = ex.exchangeNames();
    const settled = await Promise.allSettled(names.map((n) => ex.fetchQuotes(n, symbols)));
    const venues = {};
    const skipped = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled' && Object.keys(r.value).length) venues[names[i]] = r.value;
      else skipped.push(`${names[i]}(${r.status === 'rejected' ? String(r.reason?.message || r.reason).slice(0, 60) : 'no quotes'})`);
    });
    if (skipped.length) log(`skipped this scan: ${skipped.join(', ')}`);
    const live = Object.keys(venues);
    if (live.length < 2) { log(`only ${live.length} exchange(s) answered; need 2`); return { exchanges: live.length }; }

    // best buy (lowest ask) and best sell (highest bid) per coin, on different venues
    const cands = [];
    for (const s of symbols) {
      const q = live.filter((v) => venues[v][s]).map((v) => ({ v, ...venues[v][s] }));
      if (q.length < 2) continue;
      const buy = q.reduce((a, b) => (b.ask < a.ask ? b : a));
      const sell = q.filter((x) => x.v !== buy.v).reduce((a, b) => (b.bid > a.bid ? b : a));
      cands.push({ symbol: s, buyEx: buy.v, sellEx: sell.v, grossPct: (sell.bid / buy.ask - 1) * 100, feeBuy: buy.taker, feeSell: sell.taker });
    }
    cands.sort((a, b) => b.grossPct - a.grossPct);

    const results = [];
    const netByRoute = new Map();
    for (const cd of cands.slice(0, c.topN)) {
      try {
        const [bBook, sBook] = await Promise.all([ex.fetchBook(cd.buyEx, cd.symbol), ex.fetchBook(cd.sellEx, cd.symbol)]);
        const notional = math.suggestNotional(bBook.asks, sBook.bids, c.maxNotional);
        const fee = (x) => Math.max(realism.feePctPerSide(), x * 100);
        const net = math.netOpportunity({ asks: bBook.asks, bids: sBook.bids, notionalUsd: notional, feeBuyPct: fee(cd.feeBuy), feeSellPct: fee(cd.feeSell),
          latencyPctPerSide: c.latencyPct, rebalancePct: c.rebalancePct });
        if (!net.ok) { memory.recordObservation({ symbol: cd.symbol, buyEx: cd.buyEx, sellEx: cd.sellEx, grossPct: cd.grossPct, netPct: null, notionalUsd: notional }); continue; }
        const key = routeKey(cd.symbol, cd.buyEx, cd.sellEx);
        const prev = lastNet.get(key);
        const persisted = !!(prev && prev.net > 0 && Date.now() - prev.at < c.intervalSec * 3000);
        lastNet.set(key, { net: net.netPct, at: Date.now() });
        netByRoute.set(key, net.netPct);
        memory.recordObservation({ symbol: cd.symbol, buyEx: cd.buyEx, sellEx: cd.sellEx, grossPct: net.grossPct, netPct: net.netPct, notionalUsd: net.notionalUsd, persisted });
        results.push({ ...cd, ...net, persisted, depthRatio: Math.min(math.bookValueUsd(bBook.asks), math.bookValueUsd(sBook.bids)) / Math.max(net.notionalUsd, 1e-9) });
      } catch (e) { log(`${cd.symbol} ${cd.buyEx}>${cd.sellEx}: book fetch failed (${e.message})`); }
    }

    const resolved = resolveDuePredictions(netByRoute);
    let traded = 0;
    for (const o of results.filter((r) => r.netUsd > 0)) {
      const mem = memory.routeStats(o.symbol, o.buyEx, o.sellEx);
      const deb = await debate(o, mem);
      const pred = predictor.predictArb({ symbol: o.symbol, buyEx: o.buyEx, sellEx: o.sellEx, netPct: o.netPct, grossPct: o.grossPct, depthRatio: o.depthRatio,
        memory: mem, debate: deb, horizonMin: c.intervalSec / 60 });
      const why = [];
      if (!o.persisted) why.push('not seen in two consecutive scans');
      if (pred.probability < c.probMin) why.push(`predictor ${pred.probability.toFixed(2)} < ${c.probMin}`);
      if (o.netUsd < c.minNetUsd) why.push(`net $${o.netUsd.toFixed(3)} < $${c.minNetUsd}`);
      if (memory.tradesToday() >= c.maxTradesPerDay) why.push('daily trade cap reached');
      if (String(process.env.ARB_MODE || 'observe').toLowerCase() === 'live' && !realism.liveArbAllowed()) why.push('live mode requested but locked (fork test not passed)');
      if (why.length) { log(`${o.symbol} ${o.buyEx}>${o.sellEx} net ${o.netPct.toFixed(3)}% -> no paper trade: ${why.join('; ')}`); continue; }
      memory.recordTrade({ symbol: o.symbol, buyEx: o.buyEx, sellEx: o.sellEx, notionalUsd: o.notionalUsd, buyAvg: o.buyAvg, sellAvg: o.sellAvg, qty: o.qty,
        grossUsd: o.grossUsd, feesUsd: o.feesUsd, latencyUsd: o.latencyUsd, rebalanceUsd: o.rebalanceUsd, netUsd: o.netUsd, netPct: o.netPct,
        predictionId: pred.id, predictedP: pred.probability, debate: deb, note: 'PAPER: filled from live order books, never sent to an exchange' });
      traded++;
      log(`PAPER TRADE ${o.symbol} buy ${o.buyEx} @${o.buyAvg.toPrecision(6)} sell ${o.sellEx} @${o.sellAvg.toPrecision(6)} notional $${o.notionalUsd.toFixed(0)} net $${o.netUsd.toFixed(3)} (${o.netPct.toFixed(3)}%) p=${pred.probability.toFixed(2)} debate=${deb.source}`);
    }

    const best = results.slice().sort((a, b) => b.netPct - a.netPct)[0];
    log(`scan done in ${Date.now() - t0} ms | exchanges ${live.length}/${names.length} | coins ${cands.length} | candidates ${results.length} | profitable ${results.filter((r) => r.netUsd > 0).length} | paper trades ${traded} | scored predictions ${resolved}` +
      (best ? ` | best ${best.symbol} ${best.buyEx}>${best.sellEx} gross ${best.grossPct.toFixed(3)}% net ${best.netPct.toFixed(3)}%` : ''));
    return { exchanges: live.length, candidates: results.length, traded, resolved, best: best ? { symbol: best.symbol, netPct: best.netPct } : null };
  } finally { scanning = false; }
}

/** 24 h of 5-minute candles from every venue -> how big cross-exchange gaps were and how often they beat the cost. Indicative only (close vs close). */
async function backfill(limitSymbols = Number(process.env.ARB_BACKFILL_SYMBOLS || 6)) {
  const since = Date.now() - 24 * 3600 * 1000;
  const names = ex.exchangeNames();
  const c = cfg();
  const costPct = 2 * 0.1 + 2 * c.latencyPct + c.rebalancePct;
  for (const symbol of ex.symbolList().slice(0, limitSymbols)) {
    const series = [];
    for (const n of names) { try { const r = await ex.fetchCloses(n, symbol, since); if (r.length > 20) series.push(new Map(r)); } catch (_) { /* skip venue */ } }
    if (series.length < 2) continue;
    const spreads = [], byHour = {};
    for (const ts of series[0].keys()) {
      const vals = series.map((m) => m.get(ts)).filter((v) => v > 0);
      if (vals.length < 2) continue;
      const sp = (Math.max(...vals) / Math.min(...vals) - 1) * 100;
      spreads.push(sp);
      const h = new Date(ts).getUTCHours();
      byHour[h] = byHour[h] || { n: 0, above: 0 }; byHour[h].n++; if (sp > costPct) byHour[h].above++;
    }
    if (spreads.length < 20) continue;
    spreads.sort((a, b) => a - b);
    const q = (p) => spreads[Math.min(spreads.length - 1, Math.floor(p * spreads.length))];
    memory.saveHist({ symbol, bars: spreads.length, exchanges: series.length, p50: +q(0.5).toFixed(4), p90: +q(0.9).toFixed(4), max: +spreads[spreads.length - 1].toFixed(4),
      shareAboveCost: +(spreads.filter((s) => s > costPct).length / spreads.length).toFixed(4), costPct: +costPct.toFixed(3),
      hourly: Object.fromEntries(Object.entries(byHour).map(([h, v]) => [h, +(v.above / v.n).toFixed(3)])) });
    log(`history ${symbol}: ${spreads.length} bars, ${series.length} venues, median gap ${q(0.5).toFixed(3)}%, 90th ${q(0.9).toFixed(3)}%, ${(spreads.filter((s) => s > costPct).length / spreads.length * 100).toFixed(1)}% of bars above cost ${costPct.toFixed(2)}%`);
  }
}

async function start() {
  const c = cfg();
  log(`starting (PAPER ONLY) | every ${c.intervalSec}s | notional <= $${c.maxNotional} | exchanges ${ex.exchangeNames().join(',')} | LLM debate ${require('../predictor/llm').enabled() ? 'on (free models)' : 'off (heuristic)'}`);
  try { await backfill(); } catch (e) { log(`history backfill failed: ${e.message}`); }
  const tick = () => scanOnce().catch((e) => log(`scan error: ${e.message}`));
  await tick();
  setInterval(tick, c.intervalSec * 1000);
}

module.exports = { scanOnce, backfill, start, debate, resolveDuePredictions, cfg };

if (require.main === module) {
  if (process.argv.includes('--once')) scanOnce().then((r) => { console.log(JSON.stringify(r)); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
  else start();
}
