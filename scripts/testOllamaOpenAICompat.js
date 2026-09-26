/**
 * scripts/testOllamaOpenAICompat.js — can gpt4oAgent.js point at LOCAL Ollama
 * with no code change? It speaks the OpenAI chat-completions shape, and Ollama
 * exposes an OpenAI-compatible endpoint at /v1, so in principle yes.
 * Free, unlimited, no quota, no network. Run: node scripts/testOllamaOpenAICompat.js
 */
'use strict';
const base = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

async function probe(model) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ollama' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the single word: ok' }], max_tokens: 10 }),
    });
    const body = await res.json().catch(() => ({}));
    const txt = body?.choices?.[0]?.message?.content;
    console.log(res.ok
      ? `  PASS  ${model.padEnd(16)} ${Date.now() - t0}ms -> ${String(txt).trim().slice(0, 40)}`
      : `  FAIL  ${model.padEnd(16)} HTTP ${res.status} ${JSON.stringify(body).slice(0, 90)}`);
    return res.ok;
  } catch (e) {
    console.log(`  FAIL  ${model.padEnd(16)} ${e.message.slice(0, 80)}`);
    return false;
  }
}

(async () => {
  console.log(`\n  Ollama OpenAI-compatible endpoint: ${base}/v1/chat/completions\n`);
  await probe('llama3.2');
  await probe('hermes3');
  console.log('');
})();
