/**
 * Multi-timeframe robustness lab runner. Resumable: skips ids already in results.json.
 * For each cell: quick_backtest (full history) -> get_trades -> in-sample / OOS split,
 * pct-based profit factor, 15%-exposure resimulation, pass/fail against the cell bar.
 */
const fs = require('fs');
const path = require('path');
const tk = require('../../src/data/tradingKitFeed');
const { batch } = require('./batch');

const OUT = path.join(__dirname, 'results.json');
const FROM_TS = Date.UTC(2020, 2, 25);
const OOS_FROM = Date.UTC(2024, 0, 1);
const EXPOSURE = 0.15;
const BAR = { minTrades: 100, minOosTrades: 30, minPF: 1.2, minOosPF: 1.1, maxDD: 25 };

const load = () => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return []; } };
const save = (a) => { fs.writeFileSync(OUT + '.tmp', JSON.stringify(a, null, 2)); fs.renameSync(OUT + '.tmp', OUT); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function tradeTime(t) {
  for (const k of ['entryTime', 'entryTs', 'entry_time', 'openTime', 'entryDate', 'time', 'timestamp', 'entryBarTime']) {
    const v = t[k]; if (v == null) continue;
    const n = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}
function pf(ret) {
  let w = 0, l = 0; for (const p of ret) { if (p > 0) w += p; else l -= p; }
  return l === 0 ? (w > 0 ? 99 : 0) : w / l;
}
function resim(ret, f) {
  let eq = 1, peak = 1, dd = 0;
  for (const p of ret) { eq *= 1 + f * p / 100; peak = Math.max(peak, eq); dd = Math.max(dd, (peak - eq) / peak * 100); }
  return { net: (eq - 1) * 100, dd };
}

async function runOne(def) {
  const t0 = Date.now();
  const plan = await tk.planBacktestWindow(def.symbol, def.timeframe, FROM_TS, Date.now());
  const a = plan?.applied || {};
  const res = await tk.quickBacktest({ pineSource: def.pineSource, symbol: a.symbol || def.symbol, timeframe: def.timeframe,
    from: a.fromTs || FROM_TS, to: a.toTs || Date.now(), name: def.id, notes: 'multi_tf_lab_2026-09-24' });
  if (!res || res.error || !res.result) return { ...meta(def), status: 'ERROR', error: String(res?.error || res?.message || 'no result').slice(0, 300) };
  const kpi = res.result;
  let trades = [];
  try { const r = await tk.mcpCall('get_trades', { jobId: res.resultId }); trades = Array.isArray(r) ? r : (r?.trades || []); } catch (e) { /* keep kpi only */ }
  const all = trades.map(t => Number(t.profitPct)).filter(Number.isFinite);
  const timed = trades.map(t => ({ ts: tradeTime(t), p: Number(t.profitPct) })).filter(x => x.ts && Number.isFinite(x.p));
  const ins = timed.filter(x => x.ts < OOS_FROM).map(x => x.p);
  const oos = timed.filter(x => x.ts >= OOS_FROM).map(x => x.p);
  const r15 = resim(all, EXPOSURE);
  const cell = {
    ...meta(def), status: 'OK', resultId: res.resultId, viewUrl: res.viewUrl,
    engineTrades: kpi.totalTrades, engineWinRatePct: kpi.winRatePct, engineNetPct: kpi.netProfitPct,
    trades: all.length, pctPF: +pf(all).toFixed(3), inTrades: ins.length, inPF: +pf(ins).toFixed(3),
    oosTrades: oos.length, oosPF: +pf(oos).toFixed(3), oosTimed: timed.length > 0,
    winRatePct: all.length ? +(all.filter(p => p > 0).length / all.length * 100).toFixed(1) : null,
    net15Pct: +r15.net.toFixed(1), dd15Pct: +r15.dd.toFixed(1), durationMs: Date.now() - t0,
  };
  const why = [];
  if (cell.trades < BAR.minTrades) why.push(`trades ${cell.trades}<${BAR.minTrades}`);
  if (cell.pctPF < BAR.minPF) why.push(`PF ${cell.pctPF}<${BAR.minPF}`);
  if (!cell.oosTimed) why.push('no trade timestamps for OOS split');
  else { if (cell.oosTrades < BAR.minOosTrades) why.push(`OOS trades ${cell.oosTrades}<${BAR.minOosTrades}`);
         if (cell.oosPF < BAR.minOosPF) why.push(`OOS PF ${cell.oosPF}<${BAR.minOosPF}`); }
  if (cell.dd15Pct > BAR.maxDD) why.push(`DD@15% ${cell.dd15Pct}>${BAR.maxDD}`);
  cell.pass = why.length === 0; cell.failReasons = why;
  return cell;
}
const meta = (d) => ({ id: d.id, strat: d.strat, coin: d.coin, symbol: d.symbol, tfLabel: d.tfLabel, timeframe: d.timeframe });

(async () => {
  const results = load();
  const done = new Set(results.filter(r => r.status === 'OK').map(r => r.id));
  const todo = batch.filter(d => !done.has(d.id));
  console.log(`${new Date().toISOString()} | ${done.size} done, ${todo.length} to run`);
  let i = 0;
  for (const def of todo) {
    i++;
    let cell;
    try { cell = await runOne(def); } catch (e) { cell = { ...meta(def), status: 'ERROR', error: e.message }; }
    const idx = results.findIndex(r => r.id === def.id);
    if (idx >= 0) results[idx] = cell; else results.push(cell);
    save(results);
    console.log(`[${i}/${todo.length}] ${def.id}: ${cell.status === 'OK'
      ? `${cell.pass ? 'PASS' : 'fail'} PF=${cell.pctPF} OOS=${cell.oosPF} trades=${cell.trades} DD15=${cell.dd15Pct}%`
      : 'ERROR ' + cell.error}`);
    if (cell.status === 'ERROR' && /credit|quota|limit|429/i.test(cell.error || '')) { console.log('Stopping: credits/rate limit. Re-run later to resume.'); break; }
    await sleep(1500);
  }
  console.log('run complete');
  process.exit(0);
})();
