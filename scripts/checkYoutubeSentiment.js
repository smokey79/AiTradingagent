/**
 * scripts/checkYoutubeSentiment.js — is there any REAL YouTube sentiment
 * data in this project, or only seeded/fabricated values?
 * Read-only. Prints key SHAPE only, never a key value.
 * Run: node scripts/checkYoutubeSentiment.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });
require('dotenv').config({ path: path.join(ROOT, 'config', '.env') });

(async () => {
  const key = process.env.YOUTUBE_API_KEY || '';
  console.log('\n=== YOUTUBE_API_KEY SHAPE (value never printed) ===');
  if (!key) {
    console.log('  NOT SET in either .env');
  } else {
    const real = key.startsWith('AIza') && key.length === 39;
    console.log(`  length=${key.length} (a real Google key is 39), prefix="${key.slice(0, 4)}" (real keys start AIza)`);
    console.log(`  looks like a real key: ${real ? 'YES' : 'NO — placeholder/invalid'}`);
    // Live probe — cheapest possible call
    try {
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=bitcoin&maxResults=1&key=${key}`;
      const res = await fetch(url);
      console.log(`  live API probe: HTTP ${res.status} ${res.ok ? 'WORKS' : '— NOT WORKING'}`);
    } catch (e) {
      console.log(`  live API probe failed: ${e.message}`);
    }
  }

  console.log('\n=== WHAT IS IN THE SENTIMENT CACHE ===');
  const cachePath = path.join(ROOT, 'data', 'youtube_sentiment_cache.json');
  if (!fs.existsSync(cachePath)) {
    console.log('  no youtube_sentiment_cache.json');
  } else {
    const stat = fs.statSync(cachePath);
    const j = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    console.log(`  file last modified: ${stat.mtime.toISOString()}`);
    const chans = j.channels || j.creators || {};
    const names = Object.keys(chans);
    console.log(`  channels: ${names.length}${names.length ? ' -> ' + names.join(', ') : ''}`);
    if (j.composite_polarity !== undefined) console.log(`  composite_polarity: ${j.composite_polarity} (${j.regime || j.state || 'no label'})`);
    // The tell: fabricated seed data is unanimous and carries invented accuracy figures.
    const sentiments = names.map((n) => chans[n].sentiment || chans[n].signal).filter(Boolean);
    const uniq = [...new Set(sentiments)];
    if (sentiments.length) {
      console.log(`  distinct sentiment values across all channels: ${uniq.length} (${uniq.join(', ')})`);
      if (uniq.length === 1) console.log('  >> UNANIMOUS across every channel — a hallmark of seeded, not fetched, data');
    }
    const acc = names.filter((n) => chans[n].accuracy_hit_rate !== undefined);
    if (acc.length) {
      console.log(`  channels carrying an "accuracy_hit_rate": ${acc.length}`);
      acc.slice(0, 6).forEach((n) => console.log(`     ${n}: accuracy_hit_rate=${chans[n].accuracy_hit_rate}, credibility_weight=${chans[n].credibility_weight}`));
      console.log('  >> these figures cannot have been measured: the API has never returned data');
    }
  }

  console.log('\n=== DOES ANY LIVE CODE READ IT? ===');
  let hits = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) {
        const txt = fs.readFileSync(p, 'utf8');
        if (txt.includes('youtube_sentiment_cache')) { console.log(`  READ BY: ${path.relative(ROOT, p)}`); hits++; }
      }
    }
  };
  try { walk(path.join(ROOT, 'src')); } catch {}
  if (!hits) console.log('  NOTHING in src/ reads it — the file is orphaned and is NOT feeding the consensus.');
  console.log('');
})();
