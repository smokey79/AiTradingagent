// check_openrouter_free_2026-09-29.js - read-only: which models in FREE_MODELS still exist on OpenRouter?
const axios = require('axios');
const { FREE_MODELS } = require('../src/agents/openrouterFreeAgent');
(async () => {
  const { data } = await axios.get('https://openrouter.ai/api/v1/models', { timeout: 20000 });
  const ids = new Set(data.data.map(m => m.id));
  for (const m of FREE_MODELS) console.log(ids.has(m) ? 'LIVE   ' : 'GONE   ', m);
  const free = data.data.filter(m => m.id.endsWith(':free')).map(m => m.id);
  console.log('\nAll current :free models (' + free.length + '):\n' + free.join('\n'));
})().catch(e => console.log('ERR', e.message));
