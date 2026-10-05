// duel_snapshot_dryrun_2026-09-29.js — builds Bot B's market snapshot WITHOUT calling Claude or trading. Prints coverage.
const t0 = Date.now();
const bot = require('../src/duel/claudeSoloTrader');
(async () => {
  const s = await bot.buildSnapshot();
  const by = {};
  for (const k of Object.keys(s.prices)) { const m = k.split(':')[0]; by[m] = (by[m] || 0) + 1; }
  console.log('instruments with live prices by market:', JSON.stringify(by), '| total', s.rows.length, `| ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const m of ['crypto', 'oanda', 'alpaca', 'meme']) { const r = s.rows.find(x => x.startsWith(m + ':')); if (r) console.log('  sample', r.slice(0, 170)); }
  console.log('context lines:', s.ctx.map(c => c.slice(0, 90)).join(' || '));
  console.log('approx prompt tokens:', Math.round(s.rows.join('\n').length / 3.5));
  process.exit(0);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
