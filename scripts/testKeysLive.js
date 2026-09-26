/**
 * scripts/testKeysLive.js — makes ONE real API call per key to find out which
 * credentials actually work. Never prints a key value; prints only the
 * provider's response status.
 *
 * Run: node scripts/testKeysLive.js
 */
'use strict';
const fs = require('fs');

function readKey(file, key) {
  if (!fs.existsSync(file)) return null;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    if (line.slice(0, line.indexOf('=')).trim() !== key) continue;
    const v = line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
    return v.length ? v : null;
  }
  return null;
}

async function testYouTube(label, key) {
  if (!key) return console.log(`  ${label.padEnd(38)} NO KEY SET`);
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=bitcoin&maxResults=1&type=video&key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      console.log(`  ${label.padEnd(38)} ✅ WORKS (HTTP 200, ${(body.items || []).length} result)`);
    } else {
      const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || '';
      console.log(`  ${label.padEnd(38)} ❌ HTTP ${res.status} ${reason} — ${String(body?.error?.message || '').slice(0, 90)}`);
    }
  } catch (e) { console.log(`  ${label.padEnd(38)} ❌ network error: ${e.message}`); }
}

async function testGemini(label, key) {
  if (!key) return console.log(`  ${label.padEnd(38)} NO KEY SET`);
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      const n = (body.models || []).length;
      console.log(`  ${label.padEnd(38)} ✅ WORKS (HTTP 200, ${n} models visible)`);
    } else {
      const reason = body?.error?.status || '';
      console.log(`  ${label.padEnd(38)} ❌ HTTP ${res.status} ${reason} — ${String(body?.error?.message || '').slice(0, 90)}`);
    }
  } catch (e) { console.log(`  ${label.padEnd(38)} ❌ network error: ${e.message}`); }
}

async function testOpenRouter(label, key) {
  if (!key) return console.log(`  ${label.padEnd(38)} NO KEY SET`);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/key', {
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      const d = body.data || {};
      console.log(`  ${label.padEnd(38)} ✅ WORKS (limit ${d.limit ?? 'n/a'}, used ${d.usage ?? 'n/a'})`);
    } else {
      console.log(`  ${label.padEnd(38)} ❌ HTTP ${res.status} — ${String(body?.error?.message || '').slice(0, 90)}`);
    }
  } catch (e) { console.log(`  ${label.padEnd(38)} ❌ network error: ${e.message}`); }
}

(async () => {
  console.log('\nLive credential test — one call each, values never printed\n');

  const MAIN_CFG = 'F:\\aitradingagent\\config\\.env';
  const MAIN = 'F:\\aitradingagent\\.env';
  const A2 = 'F:\\aitradingagent2\\.env';

  console.log('YouTube Data API v3:');
  await testYouTube('config/.env YOUTUBE_API_KEY', readKey(MAIN_CFG, 'YOUTUBE_API_KEY'));
  await testYouTube('aitradingagent2 YOUTUBE_API_KEY', readKey(A2, 'YOUTUBE_API_KEY'));
  await testYouTube('config/.env GOOGLE_API_KEY (as YT)', readKey(MAIN_CFG, 'GOOGLE_API_KEY'));

  console.log('\nGemini (generativelanguage):');
  await testGemini('aitradingagent2 GEMINI_API_KEY', readKey(A2, 'GEMINI_API_KEY'));
  await testGemini('config/.env GOOGLE_GEMINI_API_KEY', readKey(MAIN_CFG, 'GOOGLE_GEMINI_API_KEY'));
  await testGemini('main .env GEMINI_API_KEY', readKey(MAIN, 'GEMINI_API_KEY'));

  console.log('\nOpenRouter:');
  await testOpenRouter('aitradingagent2 OPENROUTER_API_KEY', readKey(A2, 'OPENROUTER_API_KEY'));
  await testOpenRouter('main .env OPENROUTER_API_KEY', readKey(MAIN, 'OPENROUTER_API_KEY'));

  console.log('');
})();
