/**
 * scripts/auditTelegramCorpus.js — what is ACTUALLY in the ingested Telegram
 * messages, and what would the agent's regex turn each one into?
 * Read-only. Run: node scripts/auditTelegramCorpus.js
 *
 * Asked because a 6-message sample showed the parser extracting "0.85" from
 * the CHANNEL'S OWN DESCRIPTION TEXT — i.e. a BUY vote at 0.85 confidence
 * manufactured out of marketing copy.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const RE = /(?:score|val|value)\s*[:=]?\s*([+-]?\d*(?:\.\d+)?)/i;
const FALLBACK = /([+-]?\d+\.\d+)/;
const BUY = 0.15, SELL = -0.15;

for (const f of ['telegram_alpha.json', 'telegram_signals.json']) {
  const p = path.join(ROOT, 'data', f);
  if (!fs.existsSync(p)) continue;
  let arr = [];
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    arr = Array.isArray(j) ? j : (j.messages || j.signals || []);
  } catch { continue; }

  console.log(`\n===== ${f} — ${arr.length} records =====`);

  const uniqueTexts = new Map();
  let parsed = 0, wouldBuy = 0, wouldSell = 0, abstain = 0;

  for (const m of arr) {
    const text = String(m.text || m.message || '').replace(/\s+/g, ' ').trim();
    uniqueTexts.set(text, (uniqueTexts.get(text) || 0) + 1);
    const pm = text.match(RE);
    const fb = text.match(FALLBACK);
    const score = pm ? parseFloat(pm[1]) : (fb ? parseFloat(fb[1]) : null);
    if (score === null || Number.isNaN(score)) { abstain++; continue; }
    parsed++;
    if (score >= BUY) wouldBuy++;
    else if (score <= SELL) wouldSell++;
  }

  console.log(`  unique message texts : ${uniqueTexts.size} (so ${arr.length - uniqueTexts.size} are duplicates)`);
  console.log(`  parse to a number    : ${parsed}`);
  console.log(`  would vote BUY       : ${wouldBuy}`);
  console.log(`  would vote SELL      : ${wouldSell}`);
  console.log(`  abstain (no number)  : ${abstain}`);

  console.log(`\n  --- every distinct message, with what the agent would do ---`);
  const sorted = [...uniqueTexts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [text, count] of sorted.slice(0, 14)) {
    const pm = text.match(RE);
    const fb = text.match(FALLBACK);
    const score = pm ? parseFloat(pm[1]) : (fb ? parseFloat(fb[1]) : null);
    let verdict = 'ABSTAIN';
    if (score !== null && !Number.isNaN(score)) {
      verdict = score >= BUY ? `BUY  (score ${score}, conf ${Math.min(0.95, Math.max(0.5, Math.abs(score))).toFixed(2)})`
        : score <= SELL ? `SELL (score ${score})` : `HOLD (score ${score})`;
    }
    console.log(`  x${String(count).padStart(2)}  ${verdict.padEnd(34)} "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`);
  }
  if (sorted.length > 14) console.log(`  ... and ${sorted.length - 14} more distinct texts`);
}
console.log('');
