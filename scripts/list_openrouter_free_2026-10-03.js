// list_openrouter_free_2026-10-03.js -- READ-ONLY. Lists the models OpenRouter currently offers for free (public endpoint, no key)
// in the families Alan asked for: Qwen, DeepSeek, Gemini, Gemma, Hermes.
'use strict';
(async () => {
  const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const { data } = await res.json();
  const free = data.filter((m) => /:free$/.test(m.id) || (Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0));
  console.log(`models total ${data.length}, free ${free.length}`);
  const fam = /qwen|deepseek|gemini|gemma|hermes/i;
  const rows = free.filter((m) => fam.test(m.id)).sort((a, b) => a.id.localeCompare(b.id));
  for (const m of rows) console.log(`${m.id.padEnd(62)} ctx ${String(m.context_length).padStart(7)}  tools:${(m.supported_parameters || []).includes('tools') ? 'y' : 'n'}  json:${(m.supported_parameters || []).some((p) => /response_format|structured/.test(p)) ? 'y' : 'n'}`);
  console.log('\nOther free models (for reference, first 25):');
  free.filter((m) => !fam.test(m.id)).slice(0, 25).forEach((m) => console.log('  ' + m.id));
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
