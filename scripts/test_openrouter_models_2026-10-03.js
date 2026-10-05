// test_openrouter_models_2026-10-03.js -- one tiny FREE completion per model to confirm it answers valid JSON through your OpenRouter key.
// Reads OPENROUTER_API_KEY from .env, never prints it. Usage: node scripts/test_openrouter_models_2026-10-03.js [model ...]
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const key = process.env.OPENROUTER_API_KEY;
if (!key) { console.error('OPENROUTER_API_KEY not set in .env'); process.exit(1); }
const models = process.argv.slice(2).length ? process.argv.slice(2) : ['qwen/qwen3.8-27b:free', 'google/gemma-4-31b-it:free', 'google/gemma-4-26b-a4b-it:free'];
(async () => {
  for (const model of models) {
    const t0 = Date.now();
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(60000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'AiTradingAgent model check' },
        body: JSON.stringify({ model, max_tokens: 120, temperature: 0,
          messages: [{ role: 'user', content: 'Return ONLY this JSON, nothing else: {"signal":"HOLD","confidence":0.5,"reason":"test"}' }] }),
      });
      const body = await res.json().catch(() => ({}));
      const text = body?.choices?.[0]?.message?.content || '';
      let parsed = null; const m = text.match(/\{[\s\S]*\}/); try { parsed = m ? JSON.parse(m[0]) : null; } catch (_) { /* not JSON */ }
      console.log(`${res.ok ? 'OK  ' : 'FAIL'} ${model.padEnd(40)} HTTP ${res.status}  ${Date.now() - t0} ms  json:${parsed ? 'yes' : 'no'}${res.ok ? '' : '  ' + String(body?.error?.message || '').slice(0, 120)}`);
    } catch (e) { console.log(`FAIL ${model.padEnd(40)} ${e.message}`); }
  }
})();
