// Tiny test call to the Anthropic API using ANTHROPIC_API_KEY from .env (costs a fraction of a cent).
// Prints only status/model/usage — never the key. Also reports Claude-bot spend so far in the duel.
const path = require('path'); const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
(async () => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { console.log('ANTHROPIC_API_KEY not set in .env'); } else {
    for (const model of ['claude-sonnet-5-5', 'claude-haiku-4-5-20251001']) {
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: 5, messages: [{ role: 'user', content: 'Reply OK' }] }),
        });
        const j = await r.json();
        console.log(`${model}: HTTP ${r.status} ${r.ok ? 'OK' : (j.error && j.error.message || '').slice(0, 120)}`);
      } catch (e) { console.log(`${model}: ERROR ${e.message}`); }
    }
  }
  try {
    const st = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'duel', 'claude_state.json'), 'utf8'));
    const pick = {}; for (const k of Object.keys(st)) if (/spend|cost|budget|decision|equity|halt/i.test(k)) pick[k] = st[k];
    console.log('duel claude state:', JSON.stringify(pick));
  } catch (e) { console.log('duel state: ' + e.message); }
})();
