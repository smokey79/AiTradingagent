// duel_keycheck_2026-09-29.js — read-only: does the Anthropic key work, and which Alpaca key names exist? Never prints secrets.
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const axios = require('axios');
(async () => {
  const alpacaNames = Object.keys(process.env).filter(k => /^(ALPACA|APCA)/.test(k));
  console.log('Alpaca-related env names:', alpacaNames.map(k => `${k}=${/KEY|SECRET/.test(k) ? (process.env[k] ? '<set>' : '<EMPTY>') : process.env[k]}`).join(', '));
  for (const model of ['claude-sonnet-5-5', 'claude-haiku-4-5-20251001']) {
    try {
      const { data } = await axios.post('https://api.anthropic.com/v1/messages',
        { model, max_tokens: 5, messages: [{ role: 'user', content: 'Reply with OK' }] },
        { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 20000 });
      console.log(`Anthropic ${model}: OK ->`, data.content?.[0]?.text);
    } catch (e) {
      console.log(`Anthropic ${model}: FAIL ${e.response?.status} ${JSON.stringify(e.response?.data?.error || e.message).slice(0, 160)}`);
    }
  }
})();
