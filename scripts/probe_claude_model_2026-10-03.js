// probe_claude_model_2026-10-03.js -- free check (no tokens used): can NODE reach api.anthropic.com with the .env key quickly, and is the model the agent asks for still available?
// Reads the key from .env, never prints it. Usage: node scripts/probe_claude_model_2026-10-03.js
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const key = (process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || '').trim();
if (!key) { console.log('no key in .env'); process.exit(1); }
const model = process.env.CLAUDE_MODEL || 'claude-3-7-sonnet-20250219';
const h = { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
(async () => {
  for (const [label, url] of [['list models', 'https://api.anthropic.com/v1/models?limit=40'], [`model ${model}`, `https://api.anthropic.com/v1/models/${model}`]]) {
    const t0 = Date.now();
    try {
      const r = await fetch(url, { headers: h, signal: AbortSignal.timeout(20000) });
      const body = await r.json().catch(() => ({}));
      console.log(`${label.padEnd(44)} HTTP ${r.status}  ${Date.now() - t0} ms`);
      if (label === 'list models' && body.data) console.log('  available (first 12):', body.data.slice(0, 12).map((m) => m.id).join(', '));
      if (r.status !== 200 && body.error) console.log('  error type:', body.error.type);
    } catch (e) { console.log(`${label.padEnd(44)} FAILED ${e.name} after ${Date.now() - t0} ms`); }
  }
  console.log('CLAUDE_MODEL env set:', !!process.env.CLAUDE_MODEL, '| CLAUDE_BASE_URL set:', !!process.env.CLAUDE_BASE_URL, '| HTTPS_PROXY set:', !!(process.env.HTTPS_PROXY || process.env.https_proxy));
})();
