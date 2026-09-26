/**
 * scripts/checkTelegramPipeline.js — is the Telegram signal pipeline actually
 * feeding the consensus, and do real messages parse to a usable score?
 * Read-only. Reports credential PRESENCE only, never a value.
 * Run: node scripts/checkTelegramPipeline.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const present = (k) => {
  const v = process.env[k];
  if (!v) return 'NOT SET';
  if (/^your_|placeholder|CHANGEME/i.test(v)) return 'PLACEHOLDER';
  return `set (${v.length} chars)`;
};

console.log('\n=== CREDENTIALS (presence only) ===');
for (const k of ['TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'TELEGRAM_SESSION',
                 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
                 'TELEGRAM_BUY_THRESHOLD', 'TELEGRAM_SELL_THRESHOLD']) {
  console.log(`  ${k.padEnd(24)} ${present(k)}`);
}

console.log('\n=== INGESTED MESSAGE FILES ===');
const files = ['telegram_alpha.json', 'telegram_signals.json'];
const loaded = {};
for (const f of files) {
  const p = path.join(ROOT, 'data', f);
  if (!fs.existsSync(p)) { console.log(`  ${f}: MISSING`); continue; }
  const stat = fs.statSync(p);
  let arr = [];
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    arr = Array.isArray(j) ? j : (j.messages || j.signals || []);
  } catch (e) { console.log(`  ${f}: UNPARSEABLE (${e.message})`); continue; }
  loaded[f] = arr;
  const ageMin = (Date.now() - stat.mtimeMs) / 60000;
  console.log(`  ${f}: ${arr.length} records, file last written ${ageMin.toFixed(0)} min ago`);
  const stamps = arr.map((m) => Date.parse(m.timestamp || m.date || 0)).filter(Boolean).sort();
  if (stamps.length) {
    const newest = (Date.now() - stamps[stamps.length - 1]) / 60000;
    console.log(`     newest message: ${newest.toFixed(0)} min old  (${new Date(stamps[stamps.length - 1]).toISOString()})`);
  }
}

console.log('\n=== THE FRESHNESS GATE ===');
console.log('  intelligentSignalsAgent.js only accepts messages younger than 10 MINUTES.');
const alpha = loaded['telegram_alpha.json'] || [];
const fresh = alpha.filter((m) => Date.now() - Date.parse(m.timestamp || m.date || 0) < 10 * 60 * 1000);
console.log(`  messages currently inside that window: ${fresh.length} of ${alpha.length}`);
if (!fresh.length && alpha.length) {
  console.log('  -> This is why the agent reports no signal: the data exists but is stale,');
  console.log('     which means the LISTENER is not running to top it up.');
}

console.log('\n=== DO REAL MESSAGES PARSE TO A SCORE? (the open question from 2026-09-02) ===');
const RE = /(?:score|val|value)\s*[:=]?\s*([+-]?\d*(?:\.\d+)?)/i;
const FALLBACK = /([+-]?\d+\.\d+)/;
const sample = alpha.slice(-6);
if (!sample.length) console.log('  no messages to test');
for (const m of sample) {
  const text = String(m.text || '').replace(/\s+/g, ' ').trim();
  const primary = text.match(RE);
  const fb = text.match(FALLBACK);
  const score = primary ? parseFloat(primary[1]) : (fb ? parseFloat(fb[1]) : null);
  console.log(`  "${text.slice(0, 68)}${text.length > 68 ? '...' : ''}"`);
  console.log(`     -> primary regex: ${primary ? primary[1] : 'NO MATCH'} | fallback: ${fb ? fb[1] : 'none'} | SCORE USED: ${score ?? 'NONE -> agent abstains'}`);
}

console.log('\n=== IS THE LISTENER RUNNING? ===');
console.log('  (check separately: a node process running src/notifications/telegramListener.js)');
console.log('');
