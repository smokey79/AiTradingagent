/**
 * duelDashboard.js — 2026-09-29. Side-by-side scoreboard for the duel at
 * http://localhost:3005 (Alan: "is localhost 3001 still my stack? use another
 * to show claude's"). 3001 stays Bot A's own dashboard; this page shows BOTH
 * bots plus Claude's trades and reasoning. Read-only: it only reads files.
 * Bound to 127.0.0.1 so it is not reachable from other machines.
 * Started from claudeSoloTrader.js (no extra PM2 process / RAM). No dependencies.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const DATA = path.resolve(__dirname, '../../data');
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } };
const readLines = (f, n) => { try { return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).slice(-n).map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean); } catch (_) { return []; } };

function botA() {
  const ps = readJson(path.join(DATA, 'portfolio_state.json')) || {};
  const all = readLines(path.join(DATA, 'trade_ledger.json'), 5000).filter(t => t.side !== 'FLASHLOAN');
  const resolved = all.filter(t => t.outcome === 'WIN' || t.outcome === 'LOSS');
  const wins = resolved.filter(t => t.outcome === 'WIN').length;
  return {
    name: 'Bot A — your multi-agent bot', equity: ps.currentBalance ?? null, start: 250,
    trades: all.length, resolved: resolved.length, wins, openCount: all.filter(t => t.outcome === 'PENDING').length,
    pnl: resolved.reduce((s, t) => s + (Number(t.pnlUsd) || 0), 0),
    recent: all.slice(-12).reverse().map(t => ({ time: t.timestamp, what: `${t.side} ${t.pair || t.symbol}`, size: t.positionSizeUsd, lev: t.leverage, result: t.outcome, pnl: t.pnlUsd, why: t.reason })),
  };
}

function botB(status) {
  const st = readJson(path.join(DATA, 'duel', 'claude_state.json'));
  const b = st?.book || { closed: [], positions: [] };
  const wins = b.closed.filter(r => r.netPnl > 0).length;
  const decisions = readLines(path.join(DATA, 'duel', 'claude_decisions.jsonl'), 6).reverse();
  return {
    name: 'Bot B — Claude only', equity: status?.equity ?? null, start: b.startUsd || 250, halted: b.halted, haltReason: b.haltReason,
    trades: b.closed.length + b.positions.length, resolved: b.closed.length, wins, openCount: b.positions.length,
    pnl: b.closed.reduce((s, r) => s + r.netPnl, 0), spend: st?.spendUsd, decisionsMade: st?.decisionsMade, endsAt: st?.endsAt, startedAt: st?.startedAt,
    open: b.positions.map(p => ({ what: `${p.side} ${p.key}`, size: p.notional, lev: p.leverage, entry: p.entry, now: p.lastPrice, sl: p.stopPrice, tp: p.takePrice, why: p.reason })),
    recent: b.closed.slice(-12).reverse().map(r => ({ time: r.closedAt, what: `${r.side} ${r.key}`, size: r.notional, lev: r.leverage, result: r.closeReason, pnl: r.netPnl, why: r.reason })),
    decisions: decisions.map(d => ({ at: d.at, equity: d.equity, note: d.note, actions: (d.results || []).map(x => `${x.a?.action} ${x.a?.key || x.a?.id || ''} ${x.ok ? '✓' : '✗ ' + (x.reason || '')}`) })),
  };
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = n => (Number.isFinite(Number(n)) ? `$${Number(n).toFixed(2)}` : '—');
const signed = n => (Number.isFinite(Number(n)) ? `${n >= 0 ? '+' : '−'}$${Math.abs(n).toFixed(2)}` : '—');
const t = s => (s ? new Date(s).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }) : '');

function card(x) {
  const ret = Number.isFinite(x.equity) ? ((x.equity - x.start) / x.start) * 100 : null;
  const rows = x.recent.map(r => `<tr><td>${t(r.time)}</td><td>${esc(r.what)}</td><td>${money(r.size)}${r.lev > 1 ? ` · ${r.lev}x` : ''}</td><td>${esc(r.result)}</td><td class="${r.pnl > 0 ? 'up' : r.pnl < 0 ? 'down' : ''}">${signed(r.pnl)}</td></tr>`).join('');
  const open = (x.open || []).map(p => `<tr><td colspan="2">${esc(p.what)}</td><td>${money(p.size)} · ${p.lev}x</td><td colspan="2">entry ${p.entry} · now ${p.now}<br><small>SL ${Number(p.sl).toPrecision(6)} · TP ${Number(p.tp).toPrecision(6)}</small></td></tr>`).join('');
  return `<section class="card"><h2>${esc(x.name)}</h2>
  <div class="big">${money(x.equity)} <span class="${ret > 0 ? 'up' : ret < 0 ? 'down' : ''}">${ret == null ? '' : (ret >= 0 ? '+' : '') + ret.toFixed(2) + '%'}</span></div>
  <div class="stats"><span>Trades <b>${x.trades}</b></span><span>Closed <b>${x.resolved}</b></span><span>Win rate <b>${x.resolved ? Math.round(x.wins / x.resolved * 100) + '%' : '—'}</b></span><span>Open <b>${x.openCount}</b></span><span>Realised <b>${signed(x.pnl)}</b></span></div>
  ${x.halted ? `<p class="warn">Stopped: ${esc(x.haltReason)}</p>` : ''}
  ${open ? `<h3>Open positions</h3><table>${open}</table>` : ''}
  <h3>Recent trades</h3>${rows ? `<table>${rows}</table>` : '<p class="muted">No trades yet.</p>'}</section>`;
}

function page(a, b) {
  const dec = (b.decisions || []).map(d => `<li><b>${t(d.at)}</b> · equity ${money(d.equity)} — ${esc(d.note)}${d.actions.length ? `<br><small>${esc(d.actions.join(' | '))}</small>` : ''}</li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30"><title>Bot Duel</title><style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#16181d;--muted:#667085;--line:#e4e7ec;--up:#067647;--down:#b42318;--warn:#b54708}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#181b21;--ink:#e8eaee;--muted:#98a2b3;--line:#2a2f38;--up:#47cd89;--down:#f97066;--warn:#fdb022}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,Segoe UI,sans-serif}
main{max-width:1200px;margin:0 auto;padding:16px}h1{font-size:20px;margin:0 0 4px}.muted,small{color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px;margin-top:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;overflow-x:auto}
h2{font-size:16px;margin:0 0 8px}h3{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:16px 0 6px}
.big{font-size:32px;font-weight:650;font-variant-numeric:tabular-nums}.big span{font-size:16px;margin-left:6px}
.stats{display:flex;flex-wrap:wrap;gap:14px;color:var(--muted);font-size:13px}.stats b{color:var(--ink)}
table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}td{padding:6px 4px;border-top:1px solid var(--line);vertical-align:top}
.up{color:var(--up)}.down{color:var(--down)}.warn{color:var(--warn)}ul{padding-left:18px;margin:0}li{margin:0 0 8px}
</style></head><body><main>
<h1>Bot duel — multi-agent vs Claude only</h1>
<div class="muted">Paper trading · both start at $250 · max 5x leverage · each stops at $30 · started ${t(b.startedAt)} · ends ${b.endsAt ? new Date(b.endsAt).toLocaleString('en-GB', { timeZone: 'Europe/London' }) : ''} · Claude spend $${Number(b.spend || 0).toFixed(3)} · page refreshes every 30s</div>
<div class="grid">${card(a)}${card(b)}</div>
<section class="card" style="margin-top:16px"><h2>Claude's latest thinking (every 15 min)</h2>${dec ? `<ul>${dec}</ul>` : '<p class="muted">Waiting for the first decision.</p>'}</section>
<p class="muted">Bot A's own dashboard is still at <a href="http://localhost:3001">localhost:3001</a>. Alpaca stocks are excluded for both bots (keys rejected, 401). Flash-loan arb is observation-only for both (no on-chain executor).</p>
</main></body></html>`;
}

function startDuelDashboard(getStatus, port = Number(process.env.DUEL_DASHBOARD_PORT || 3005)) {
  const srv = http.createServer((req, res) => {
    try {
      const a = botA(), b = botB(getStatus());
      if (req.url.startsWith('/api/duel')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ botA: a, botB: b })); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page(a, b));
    } catch (e) { res.writeHead(500); res.end('duel dashboard error: ' + e.message); }
  });
  srv.on('error', e => console.warn(`[DuelDashboard] could not listen on ${port}: ${e.message}`));
  srv.listen(port, '127.0.0.1');
  return srv;
}

module.exports = { startDuelDashboard, botA, botB };
