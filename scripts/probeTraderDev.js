/**
 * scripts/probeTraderDev.js — queries TraderDev exactly as traderDevAgent.js
 * does, and reports what comes back so the numbers can be judged rather than
 * trusted. Read-only.
 *
 * Run: node scripts/probeTraderDev.js
 */
'use strict';
require('dotenv').config();
const axios = require('axios');

const API_BASE = process.env.TRADERDEV_API_BASE || 'https://mcp-api.trader.dev';

async function query(symbol) {
  const url = `${API_BASE}/strategies/search`;
  const params = { symbol, sort: 'sharpe', minWinRatePct: 55, minTrades: 50, limit: 5 };
  try {
    const { data } = await axios.get(url, { params, timeout: 8000, headers: { Accept: 'application/json' } });
    return data?.results || data || [];
  } catch (e) {
    return { error: e.response ? `HTTP ${e.response.status}` : e.message };
  }
}

(async () => {
  console.log(`\nQuerying ${API_BASE}/strategies/search — the exact call traderDevAgent.js makes\n`);

  for (const sym of ['BTCUSDT', 'ETHUSDT']) {
    const r = await query(sym);
    if (r.error) { console.log(`  ${sym}: ${r.error}\n`); continue; }
    const list = Array.isArray(r) ? r : [];
    console.log(`  ${sym} — ${list.length} strategies returned (top 5 by Sharpe):`);
    list.forEach((s, i) => {
      const k = s.latestResult || s.result || s.kpis || s;
      const sharpe = k.sharpe ?? k.sharpeRatio ?? '?';
      const wr = k.winRatePct ?? k.winRate ?? '?';
      const trades = k.trades ?? k.totalTrades ?? k.numTrades ?? '?';
      const ret = k.totalReturnPct ?? k.returnPct ?? k.pnlPct ?? '?';
      console.log(`    ${i + 1}. ${String(s.name || s.id || 'unnamed').slice(0, 42).padEnd(44)}`);
      console.log(`        sharpe=${String(sharpe).padStart(8)}  winRate=${String(wr).padStart(6)}  trades=${String(trades).padStart(6)}  return=${ret}`);
    });
    if (list.length) {
      const sharpes = list.map((s) => {
        const k = s.latestResult || s.result || s.kpis || s;
        return Number(k.sharpe ?? k.sharpeRatio ?? NaN);
      }).filter(Number.isFinite).sort((a, b) => a - b);
      if (sharpes.length) {
        const med = sharpes[Math.floor(sharpes.length / 2)];
        console.log(`\n    median Sharpe across the top 5: ${med}`);
        console.log(`    for scale — a Sharpe above ~3 is exceptional for a real strategy;`);
        console.log(`    top quant funds run roughly 2-3 sustained.`);
      }
    }
    console.log('');
  }

  console.log(`What the query actually does:
  sort=sharpe, limit=5, drawn from a pool the agent's own header describes as
  "1M+ backtests, 240K+ strategies". Taking the 5 highest-Sharpe results from a
  quarter of a million backtests selects the extreme tail of that distribution.
  With that many attempts, the top of the list is dominated by curve-fits that
  got lucky, not by strategies with a real edge. The filters (winRate>=55,
  trades>=50) do not fix this — they narrow the pool, then the sort still picks
  its luckiest member.

  This is the same failure the walk-forward validator caught earlier today: a
  result that looks outstanding because it was selected for looking outstanding.
`);
})();
