/**
 * scripts/allocation_status.js - read-only status of the evidence candidates and the
 * Allocation Manager. Refreshes each candidate's paper position from live candles
 * (public exchange data, no keys, no orders), then prints tiers, paper records and
 * the last 5 allocation decisions.
 * Usage (from F:\aitradingagent): node scripts/allocation_status.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { CANDIDATES } = require('../src/agents/evidenceCandidates/config');
const { refreshCoin } = require('../src/agents/evidenceCandidatesAgent');

(async () => {
  const coins = [...new Set(CANDIDATES.map((c) => c.coin))];
  console.log('Evidence candidates (paper only)');
  for (const coin of coins) {
    const rows = await refreshCoin(coin);
    for (const r of rows) {
      const p = r.tier.paper;
      console.log(`  ${r.cand.id.padEnd(28)} ${String(r.st.pos || 'flat').padEnd(5)} ${r.tier.tier.padEnd(15)} vote x${r.tier.vote} size x${r.tier.size} | paper: ${p.trades} trades${p.trades ? `, win ${(p.winRate * 100).toFixed(0)}%, PF ${p.pf.toFixed(2)}` : ''} | data: ${r.source}`);
    }
    if (rows.length === 0) console.log(`  ${coin}: no data (see warnings above)`);
  }
  const log = path.resolve(__dirname, '../data/allocation_log.jsonl');
  const lines = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).slice(-5) : [];
  console.log(`\nLast ${lines.length} allocation decisions`);
  for (const l of lines) {
    const a = JSON.parse(l);
    console.log(`  ${a.at} ${a.pair} ${a.mode}: $${a.riskGateSizeUsd} -> ${a.blocked ? 'BLOCKED: ' + a.blocked : '$' + a.finalSizeUsd} (${a.evidence.tier}, ${a.leverage}x)`);
  }
  process.exit(0);
})().catch((e) => { console.log('ERROR', e.message); process.exit(1); });
