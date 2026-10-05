// Round 2: of the 14 models that returned HTTP 200 in round 1, which ones
// actually produce a valid, parseable trading-signal JSON using the SAME
// system prompt and JSON-extraction logic as openrouterFreeAgent.js? A
// model can be reachable (200 OK) but still useless here (e.g. a music
// generator or a content-safety classifier won't return {"signal":...}).
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');
const KEY = process.env.OPENROUTER_API_KEY;

const CANDIDATES = [
  'stealth/space-bunny-alpha',
  'dots-studio/dots-3-note-preview:free',
  'liquid/lfm-2.5-2.6b:free',
  'nvidia/nemotron-3.5-lightning:free',
  'poolside/laguna-xs-2.1:free',
  'cohere/north-mini-code:free',
  'nvidia/nemotron-3.5-content-safety:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'google/lyria-3-pro-preview',
  'nvidia/nemotron-3-super-120b-a12b:free',
];

const SYSTEM_PROMPT = `You are a cryptocurrency research and market intelligence specialist in a multi-agent consensus system.
Analyze the asset's technical indicators, macro momentum, and fundamental structure.
Respond ONLY with strict JSON without code fences or formatting:
{
  "signal": "BUY" | "SELL" | "HOLD",
  "confidence": 0.70 to 0.95,
  "reason": "Clear concise 1-line justification",
  "constraints": ["Risk caveat 1", "Risk caveat 2"],
  "model_used": "string"
}`;

const SAMPLE_PAYLOAD = {
  symbol: 'BTC/USDT',
  price: 62000,
  rsi14: 55,
  ema20: 61800,
  ema50: 61200,
  volumeRatio: 1.2,
  btcChange24h: 1.1,
};

function cleanJson(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (match) return JSON.parse(match[0]);
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

async function main() {
  const usable = [];
  for (const id of CANDIDATES) {
    try {
      const { data } = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: id,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(SAMPLE_PAYLOAD) },
          ],
          max_tokens: 300,
          temperature: 0.2,
        },
        {
          headers: {
            Authorization: `Bearer ${KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/smokey79/aitradingagent',
            'X-Title': 'AiTradingAgent-ModelSurvey2',
          },
          timeout: 15000,
        }
      );
      const raw = data.choices?.[0]?.message?.content ?? '';
      const parsed = cleanJson(raw);
      const valid = parsed && ['BUY', 'SELL', 'HOLD'].includes(parsed.signal) && typeof parsed.confidence === 'number';
      if (valid) {
        usable.push(id);
        console.log(`USABLE: ${id} -> ${JSON.stringify(parsed)}`);
      } else {
        console.log(`REACHABLE BUT NOT USABLE: ${id} -> raw: ${raw.slice(0, 150)}`);
      }
    } catch (e) {
      console.log(`FAILED: ${id} -> ${e.response?.status || ''} ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  console.log('\n=== USABLE FOR TRADING SIGNALS ===');
  usable.forEach(id => console.log(`  '${id}',`));
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
