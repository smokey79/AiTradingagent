// One-off survey: which free-priced OpenRouter models actually work on this
// account now that ZDR is off (2026-09-27). Tests every free-priced model
// with a trivial completion call using the confirmed-funded key.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('No OPENROUTER_API_KEY found in .env'); process.exit(1); }

async function main() {
  const { data } = await axios.get('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${KEY}` },
    timeout: 15000,
  });
  const free = data.data.filter(m => {
    const p = m.pricing || {};
    return parseFloat(p.prompt || '1') === 0 && parseFloat(p.completion || '1') === 0;
  });
  console.log(`Found ${free.length} free-priced models. Testing each...`);

  const working = [];
  const blocked = [];
  for (const m of free) {
    try {
      await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: m.id,
          messages: [{ role: 'user', content: 'Reply with just: OK' }],
          max_tokens: 5,
        },
        {
          headers: {
            Authorization: `Bearer ${KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/smokey79/aitradingagent',
            'X-Title': 'AiTradingAgent-ModelSurvey',
          },
          timeout: 12000,
        }
      );
      working.push(m.id);
      console.log(`WORKING: ${m.id}`);
    } catch (e) {
      const status = e.response?.status;
      const msg = e.response?.data?.error?.message || e.message;
      blocked.push({ id: m.id, status, msg });
      console.log(`BLOCKED (${status}): ${m.id} -- ${msg}`);
    }
    await new Promise(r => setTimeout(r, 400));
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Working: ${working.length}`);
  working.forEach(id => console.log(`  '${id}',`));
  console.log(`Blocked: ${blocked.length}`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
