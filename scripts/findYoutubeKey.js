/**
 * scripts/findYoutubeKey.js — locate the YouTube/Google API key across both
 * projects WITHOUT ever printing its value. Reports key NAME, which file it
 * lives in, whether it has a value, and a length + last-4 fingerprint so two
 * copies can be compared without exposing either.
 *
 * Run: node scripts/findYoutubeKey.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CANDIDATE_FILES = [
  'F:\\aitradingagent\\.env',
  'F:\\aitradingagent\\.env.local',
  'F:\\aitradingagent\\.env.production',
  'F:\\aitradingagent\\config\\.env',
  'F:\\aitradingagent2\\.env',
  'F:\\aitradingagent2\\.env.local',
];

// Anything that could plausibly be a YouTube/Google data key.
const NAME_RE = /(YOUTUBE|YT_|GOOGLE|GAPI|DATA_API)/i;

function fingerprint(v) {
  if (!v) return 'EMPTY';
  const s = String(v).replace(/^["']|["']$/g, '');
  if (!s.length) return 'EMPTY';
  return `len=${s.length} ...${s.slice(-4)}`;
}

console.log('\nScanning for YouTube / Google API keys (values never shown)\n');

let found = 0;
for (const f of CANDIDATE_FILES) {
  if (!fs.existsSync(f)) { console.log(`  [missing] ${f}`); continue; }
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  const hits = [];
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) return;
    const key = line.slice(0, line.indexOf('=')).trim();
    const val = line.slice(line.indexOf('=') + 1).trim();
    if (NAME_RE.test(key)) hits.push({ key, val, line: i + 1 });
  });
  console.log(`  ${f}`);
  if (!hits.length) { console.log('      (no matching key names)'); continue; }
  hits.forEach((h) => {
    found++;
    console.log(`      line ${String(h.line).padStart(3)}  ${h.key.padEnd(34)} ${fingerprint(h.val)}`);
  });
}

// Also check whether the main project's youtube cache looks alive
const cache = 'F:\\aitradingagent\\data\\youtube_sentiment_cache.json';
if (fs.existsSync(cache)) {
  try {
    const j = JSON.parse(fs.readFileSync(cache, 'utf8'));
    const ch = j.channels || j;
    const names = Array.isArray(ch) ? ch : Object.keys(ch);
    console.log(`\n  youtube_sentiment_cache.json — ${names.length} channel entries, last modified ${fs.statSync(cache).mtime.toISOString().slice(0, 16).replace('T', ' ')}`);
    console.log(`      ${JSON.stringify(names).slice(0, 220)}`);
  } catch (e) { console.log('\n  youtube_sentiment_cache.json unreadable:', e.message); }
}

console.log(`\n${found} candidate key(s) found.\n`);
