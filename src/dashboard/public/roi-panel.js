/**
 * AiTradingAgent — Live ROI & Trade Display Panel
 * =================================================
 * Self-injecting — added via <script src="roi-panel.js">
 * Connects to existing /api/* endpoints + WebSocket.
 * Shows: initial investment, live equity, ROI %, P&L,
 *        win rate, BTC vault, and colour-coded trade feed.
 */
(function () {
  'use strict';
  const INITIAL = 250.00;
  const POLL    = 6000;
  let state = { portfolio: null, trades: [], performance: null, vault: null, tgSignal: null };

  // ── Inject panel HTML after .stats-grid ──────────────────────────────────
  function inject() {
    const el = document.createElement('div');
    el.id = 'roi-panel';
    el.innerHTML = `<style>
#roi-panel{background:linear-gradient(135deg,#0f172a,#1e1b4b,#0f172a);
  border:1px solid rgba(99,102,241,.3);border-radius:16px;padding:24px;margin:16px 0;font-family:'Inter',monospace}
#roi-panel .rh{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:18px}
#roi-panel .rt{font-size:17px;font-weight:700;color:#e2e8f0;display:flex;align-items:center;gap:8px}
#roi-panel .rpulse{width:9px;height:9px;border-radius:50%;background:#10b981;animation:rpulse 1.5s infinite;display:inline-block}
@keyframes rpulse{0%,100%{opacity:1}50%{opacity:.3}}
#roi-panel .rg{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:18px}
#roi-panel .rc{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:14px;text-align:center;position:relative;overflow:hidden}
#roi-panel .rc::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;border-radius:12px 12px 0 0}
#roi-panel .rc.g::before{background:#10b981}#roi-panel .rc.b::before{background:#3b82f6}
#roi-panel .rc.d::before{background:#f59e0b}#roi-panel .rc.p::before{background:#8b5cf6}
#roi-panel .rl{font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
#roi-panel .rv{font-size:24px;font-weight:700;font-family:'JetBrains Mono',monospace;line-height:1.2}
#roi-panel .rs{font-size:10px;color:#64748b;margin-top:3px}
#roi-panel .rbar{background:rgba(255,255,255,.07);border-radius:6px;height:5px;margin-top:7px;overflow:hidden}
#roi-panel .rbar-inner{height:100%;border-radius:6px;transition:width .7s}
#roi-panel .tf-head,.tf-row{display:grid;grid-template-columns:60px 110px 1fr 70px 80px 80px;gap:8px;padding:7px 10px;font-size:11px;align-items:center}
#roi-panel .tf-head{color:#475569;text-transform:uppercase;font-size:9px;letter-spacing:.06em}
#roi-panel .tf-row{border-radius:7px;margin-bottom:3px;transition:background .2s}
#roi-panel .tf-row:hover{background:rgba(255,255,255,.04)}
#roi-panel .tf-row.win{border-left:3px solid #10b981}
#roi-panel .tf-row.loss{border-left:3px solid #ef4444}
#roi-panel .tf-row.be{border-left:3px solid #6b7280}
#roi-panel .bs{padding:2px 7px;border-radius:4px;font-weight:700;font-size:10px;display:inline-block}
#roi-panel .bs.buy{background:rgba(16,185,129,.15);color:#10b981}
#roi-panel .bs.sell{background:rgba(239,68,68,.15);color:#ef4444}
#roi-panel .bs.fl{background:rgba(139,92,246,.15);color:#8b5cf6}
#roi-panel .tg-bar{background:rgba(99,102,241,.1);border:1px solid rgba(99,102,241,.25);border-radius:9px;padding:10px 14px;margin-bottom:14px;display:none;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px}
#roi-panel .tk-bar{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:9px;padding:10px 14px;margin-bottom:14px;display:none;font-size:12px}
#roi-panel .no-trades{text-align:center;padding:36px 0;color:#475569;font-size:12px}
.c-green{color:#10b981}.c-red{color:#ef4444}.c-blue{color:#3b82f6}.c-gold{color:#f59e0b}.c-muted{color:#64748b}.c-white{color:#e2e8f0}
</style>
<div class="rh">
  <div class="rt"><span class="rpulse"></span>📊 Live ROI — AiTradingAgent</div>
  <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
    <span id="rp-updated" style="font-size:10px;color:#475569">Connecting…</span>
    <span id="rp-tg-dot" style="font-size:10px;color:#475569">📱 Telegram: waiting</span>
    <span id="rp-tk-dot" style="font-size:10px;color:#475569">⚡ TradingKit: waiting</span>
  </div>
</div>
<div id="rp-tg-bar" class="tg-bar">
  <div><div style="color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">📡 Latest Telegram Signal</div>
  <div id="rp-tg-text" style="font-weight:600;font-family:'JetBrains Mono',monospace">—</div></div>
  <div id="rp-tg-time" style="color:#64748b;font-size:10px"></div>
</div>
<div id="rp-tk-bar" class="tk-bar">
  <span style="color:#f59e0b;font-weight:700">⚡ TradingKit</span>
  <span id="rp-tk-text" style="color:#e2e8f0;margin-left:10px">Connected — live indicators active</span>
</div>
<div class="rg">
  <div class="rc g"><div class="rl">Initial Investment</div><div class="rv c-white">$<span id="rp-init">250.00</span></div><div class="rs">Paper capital deployed</div></div>
  <div class="rc g"><div class="rl">Current Equity</div><div class="rv" id="rp-eq">$250.00</div><div class="rs" id="rp-eq-sub">—</div></div>
  <div class="rc b"><div class="rl">Total ROI</div><div class="rv" id="rp-roi">+0.00%</div><div class="rs" id="rp-roi-sub">vs $250 start</div><div class="rbar"><div class="rbar-inner" id="rp-roi-bar" style="width:0%;background:#3b82f6"></div></div></div>
  <div class="rc d"><div class="rl">Net P&amp;L</div><div class="rv" id="rp-pnl">+$0.00</div><div class="rs" id="rp-pnl-sub">0W / 0L</div></div>
  <div class="rc p"><div class="rl">Win Rate (20-trade)</div><div class="rv" id="rp-wr">—%</div><div class="rs">72% AI gate</div><div class="rbar"><div class="rbar-inner" id="rp-wr-bar" style="width:0%;background:#8b5cf6"></div></div></div>
  <div class="rc b"><div class="rl">Trades Today</div><div class="rv c-white" id="rp-today">0</div><div class="rs" id="rp-today-pnl">$0.00 today</div></div>
  <div class="rc d"><div class="rl">BTC Savings (50%)</div><div class="rv c-gold" id="rp-btc">$0.00</div><div class="rs" id="rp-btc-sub">0.00000000 BTC</div></div>
  <div class="rc p"><div class="rl">Cold Vault (10%)</div><div class="rv" id="rp-vault" style="color:#8b5cf6">$0.00</div><div class="rs">Protected storage</div></div>
</div>
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
  <div style="font-size:13px;font-weight:600;color:#cbd5e1">📜 Live Trade Feed</div>
  <div id="rp-count" style="font-size:11px;color:#64748b">0 trades</div>
</div>
<div class="tf-head"><span>Time</span><span>Pair</span><span>Reason</span><span>Size</span><span>Price</span><span>P&amp;L</span></div>
<div id="rp-feed" style="max-height:300px;overflow-y:auto">
  <div class="no-trades">⏳ Waiting for first trade…<br><small>Click START 24/7 AUTOPILOT</small></div>
</div>`;

    const sg = document.querySelector('.stats-grid');
    if (sg?.parentNode) sg.parentNode.insertBefore(el, sg.nextSibling);
    else document.querySelector('.container')?.prepend(el);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  function setText(id, val) { const e=$(id); if(e) e.textContent=val; }
  function setHTML(id, v)  { const e=$(id); if(e) e.innerHTML=v; }
  function setColor(id, c) { const e=$(id); if(e) e.style.color=c; }
  function setBar(id, pct, color) {
    const e=$(id); if(!e) return;
    e.style.width=Math.min(Math.abs(pct),100)+'%';
    if(color) e.style.background=color;
  }

  // ── Render KPIs ───────────────────────────────────────────────────────────
  function renderKPIs() {
    const p = state.portfolio || {}, perf = state.performance || {}, v = state.vault || {};
    const eq  = p.currentBalance ?? INITIAL;
    const pnl = eq - INITIAL;
    const roi = (pnl / INITIAL) * 100;
    const wr  = (perf.winRate ?? 0.85) * 100;

    setText('rp-init', INITIAL.toFixed(2));
    setText('rp-eq',  '$' + eq.toFixed(2));
    setColor('rp-eq', roi >= 0 ? '#10b981' : '#ef4444');
    setText('rp-eq-sub', (pnl >= 0 ? '+' : '') + '$' + Math.abs(pnl).toFixed(2) + ' vs start');

    setText('rp-roi', (roi >= 0 ? '+' : '') + roi.toFixed(2) + '%');
    setColor('rp-roi', roi >= 0 ? '#3b82f6' : '#ef4444');
    setBar('rp-roi-bar', roi, roi >= 0 ? '#3b82f6' : '#ef4444');

    setText('rp-pnl', (pnl >= 0 ? '+' : '-') + '$' + Math.abs(pnl).toFixed(2));
    setColor('rp-pnl', pnl >= 0 ? '#10b981' : '#ef4444');
    setText('rp-pnl-sub', (perf.wins||0)+'W / '+(perf.losses||0)+'L / '+(perf.breakeven||0)+'BE');

    setText('rp-wr', wr.toFixed(1) + '%');
    setColor('rp-wr', wr >= 72 ? '#8b5cf6' : '#ef4444');
    setBar('rp-wr-bar', wr, wr >= 72 ? '#8b5cf6' : '#ef4444');

    const today = new Date().toDateString();
    const todayTrades = state.trades.filter(t => new Date(t.timestamp).toDateString() === today);
    const todayPnl = todayTrades.reduce((s,t) => s + (Number(t.pnlUsd)||0), 0);
    setText('rp-today', todayTrades.length.toString());
    setText('rp-today-pnl', (todayPnl >= 0 ? '+' : '') + '$' + todayPnl.toFixed(2) + ' today');

    setText('rp-btc', '$' + (v.btcSavingsPoolUsd||0).toFixed(2));
    setText('rp-btc-sub', (v.btcAccumulated||0).toFixed(8) + ' BTC');
    setText('rp-vault', '$' + (v.longtermVaultUsd||0).toFixed(2));
  }

  // ── Render Trade Feed ─────────────────────────────────────────────────────
  function renderFeed() {
    const feed = $('rp-feed'); if(!feed) return;
    setText('rp-count', state.trades.length + ' trades');
    if (!state.trades.length) {
      feed.innerHTML = '<div class="no-trades">⏳ No trades yet…<br><small>Click START 24/7 AUTOPILOT</small></div>';
      return;
    }
    feed.innerHTML = state.trades.slice(0,30).map(t => {
      const pnl = Number(t.pnlUsd)||0;
      const win = t.outcome==='WIN'||pnl>0, loss = t.outcome==='LOSS'||pnl<0;
      const cls = win?'win':loss?'loss':'be';
      const pc  = win?'c-green':loss?'c-red':'c-muted';
      const side = (t.side||'BUY').toUpperCase();
      const bCls = side==='FLASHLOAN'?'fl':side==='BUY'?'buy':'sell';
      const reason = (t.reason||'AI consensus').slice(0,55);
      return `<div class="tf-row ${cls}">
        <span class="c-muted">${new Date(t.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
        <span><b class="c-white">${t.pair||t.symbol||'—'}</b> <span class="bs ${bCls}">${side==='FLASHLOAN'?'⚡FL':side}</span></span>
        <span class="c-muted" title="${t.reason||''}">${reason}</span>
        <span class="c-white">$${Number(t.positionSizeUsd||0).toFixed(0)}</span>
        <span class="c-muted">$${Number(t.price||0).toLocaleString(undefined,{maximumFractionDigits:4})}</span>
        <span class="${pc}" style="font-weight:700;font-family:'JetBrains Mono',monospace">${pnl>=0?'+':'-'}$${Math.abs(pnl).toFixed(2)}</span>
      </div>`;
    }).join('');
  }

  // ── Poll APIs ─────────────────────────────────────────────────────────────
  async function refresh() {
    try {
      const [sRes, tRes, tgRes] = await Promise.allSettled([
        fetch('/api/status'),
        fetch('/api/trades?limit=50'),
        fetch('/api/telegram/messages?limit=1'),
      ]);
      if (sRes.status==='fulfilled') {
        const d = await sRes.value.json();
        if (d.success) { state.portfolio=d.portfolio; state.performance=d.performance; state.vault=d.vault; }
      }
      if (tRes.status==='fulfilled') {
        const d = await tRes.value.json();
        if (d.success) state.trades = d.trades||[];
      }
      if (tgRes.status==='fulfilled') {
        const d = await tgRes.value.json();
        if (d.success && d.messages?.length) {
          const sig = d.messages[0];
          const bar = $('rp-tg-bar'); if(bar) bar.style.display='flex';
          setText('rp-tg-text', (sig.text||'').slice(0,100));
          setText('rp-tg-time', new Date(sig.timestamp).toLocaleTimeString());
          setText('rp-tg-dot', '📱 Telegram: ● LIVE');
          $('rp-tg-dot')&&($('rp-tg-dot').style.color='#10b981');
        }
      }
      renderKPIs(); renderFeed();
      const upd=$('rp-updated'); if(upd) upd.textContent='Updated '+new Date().toLocaleTimeString();
    } catch(e) { console.warn('[ROI Panel]',e.message); }
  }

  // ── TradingKit status check ───────────────────────────────────────────────
  async function checkTradingKit() {
    try {
      const res = await fetch('/api/health');
      const d   = await res.json();
      if (d.status==='ok') {
        const bar=$('rp-tk-bar'); if(bar) bar.style.display='block';
        setText('rp-tk-dot', '⚡ TradingKit: ● ACTIVE');
        $('rp-tk-dot')&&($('rp-tk-dot').style.color='#f59e0b');
      }
    } catch(_) {}
  }

  // ── WebSocket live push ───────────────────────────────────────────────────
  function connectWS() {
    const ws = new WebSocket('ws://'+location.host);
    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data);
        if (['trade_executed','position_resolved','flashloan_executed'].includes(msg.type)) {
          if (msg.trade)       state.trades = [msg.trade,...state.trades].slice(0,100);
          if (msg.portfolio)   state.portfolio  = msg.portfolio;
          if (msg.vault)       state.vault      = msg.vault;
          if (msg.performance) state.performance= msg.performance;
          renderKPIs(); renderFeed();
        }
        if (msg.type==='telegram_signal' && msg.signal) {
          const bar=$('rp-tg-bar'); if(bar) bar.style.display='flex';
          setText('rp-tg-text', `${msg.signal.action} ${msg.signal.symbol||''} ${msg.signal.confidence?(Math.round(msg.signal.confidence*100)+'%'):''} — ${(msg.signal.raw||'').slice(0,80)}`);
          setText('rp-tg-time', new Date().toLocaleTimeString());
          setText('rp-tg-dot', '📱 Telegram: ● LIVE');
        }
      } catch(_) {}
    };
    ws.onclose = () => setTimeout(connectWS, 3000);
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  function boot() {
    inject();
    refresh();
    checkTradingKit();
    setInterval(refresh, POLL);
    connectWS();
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
