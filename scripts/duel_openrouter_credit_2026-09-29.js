// duel_openrouter_credit_2026-09-29.js — read-only: OpenRouter credit left + one tiny Claude call via OpenRouter. Never prints keys.
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const axios = require('axios');
const key = (process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEYS || '').split(',')[0].trim();
(async () => {
  try {
    const { data } = await axios.get('https://openrouter.ai/api/v1/credits', { headers: { Authorization: `Bearer ${key}` }, timeout: 15000 });
    const d = data.data || {};
    console.log(`OpenRouter credits: purchased $${d.total_credits} used $${(+d.total_usage).toFixed(2)} left $${(d.total_credits - d.total_usage).toFixed(2)}`);
  } catch (e) { console.log('credits check FAIL', e.response?.status, JSON.stringify(e.response?.data || e.message).slice(0, 120)); }
  const { data: models } = await axios.get('https://openrouter.ai/api/v1/models', { timeout: 15000 });
  const claude = models.data.filter(m => m.id.startsWith('anthropic/')).map(m => `${m.id} ($${(+m.pricing.prompt * 1e6).toFixed(2)}/$${(+m.pricing.completion * 1e6).toFixed(2)} per M tok)`);
  console.log('Claude models on OpenRouter:\n  ' + claude.slice(0, 8).join('\n  '));
  const pick = models.data.find(m => /anthropic\/claude-(sonnet|haiku)/.test(m.id))?.id;
  try {
    const { data } = await axios.post('https://openrouter.ai/api/v1/chat/completions', { model: pick, max_tokens: 5, messages: [{ role: 'user', content: 'Reply with OK' }] },
      { headers: { Authorization: `Bearer ${key}` }, timeout: 30000 });
    console.log(`test call ${pick}: OK ->`, data.choices?.[0]?.message?.content);
  } catch (e) { console.log(`test call ${pick}: FAIL`, e.response?.status, JSON.stringify(e.response?.data?.error || e.message).slice(0, 160)); }
})();
