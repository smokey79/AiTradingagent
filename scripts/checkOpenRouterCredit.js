/**
 * scripts/checkOpenRouterCredit.js — current OpenRouter balance and what the
 * bot's measured call rate would cost against it. Read-only, never prints a key.
 * Run: node scripts/checkOpenRouterCredit.js [evalsPerMinute]
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const RATE = parseFloat(process.argv[2] || '47.5'); // measured consensus evals/min

(async () => {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) { console.log('  OPENROUTER_API_KEY not set'); process.exit(1); }
  try {
    const r = await fetch('https://openrouter.ai/api/v1/credits', { headers: { Authorization: `Bearer ${key}` } });
    const b = await r.json().catch(() => ({}));
    if (!r.ok || !b.data) { console.log(`  credits endpoint HTTP ${r.status}`); process.exit(1); }
    const granted = Number(b.data.total_credits || 0);
    const used = Number(b.data.total_usage || 0);
    const left = granted - used;
    console.log(`\n  OpenRouter balance: $${granted.toFixed(2)} granted - $${used.toFixed(4)} used = $${left.toFixed(4)} REMAINING\n`);

    // Cost model: 2 paid agents fire per consensus evaluation.
    // gpt-4o-mini ~$0.15/1M in + $0.60/1M out; claude-3.5-haiku ~$0.80/1M in + $4/1M out.
    // Assume ~400 input + ~150 output tokens per call (this project's prompts).
    const perCallMini = (400 / 1e6) * 0.15 + (150 / 1e6) * 0.60;
    const perCallHaiku = (400 / 1e6) * 0.80 + (150 / 1e6) * 4.00;
    const perEval = perCallMini + perCallHaiku;
    const perDay = RATE * 60 * 24 * perEval;

    console.log(`  At the measured rate of ${RATE} consensus evaluations/min:`);
    console.log(`    calls/day (2 paid agents each) : ${Math.round(RATE * 60 * 24 * 2).toLocaleString()}`);
    console.log(`    estimated cost/day             : $${perDay.toFixed(2)}`);
    console.log(`    your balance lasts             : ${perDay > 0 ? (left / perDay).toFixed(2) : 'n/a'} days`);

    const sane = 3.2; // 16 pairs on a 300s interval, single driver
    const saneDay = sane * 60 * 24 * perEval;
    console.log(`\n  If the duplicate cycle drivers were fixed (${sane}/min, one driver):`);
    console.log(`    estimated cost/day             : $${saneDay.toFixed(2)}`);
    console.log(`    your balance lasts             : ${saneDay > 0 ? (left / saneDay).toFixed(0) : 'n/a'} days`);
    console.log(`\n  Ratio: the leak makes paid agents ${(perDay / saneDay).toFixed(0)}x more expensive than they need to be.\n`);
  } catch (e) {
    console.log('  failed:', e.message);
  }
})();
