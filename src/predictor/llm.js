/**
 * src/predictor/llm.js  (2026-10-03)
 * Tiny JSON-only helper for the predictor/arbitrage debates, using OpenRouter FREE models in rotation
 * (Qwen first, then Gemma, then Nemotron). Returns null when there is no key or every model fails, so callers
 * always have a deterministic fallback and nothing ever blocks on an LLM.
 * Env: OPENROUTER_API_KEY, PREDICTOR_MODELS (comma list to override), PREDICTOR_LLM=false to switch off.
 */
'use strict';

const DEFAULT_MODELS = [
  'qwen/qwen3.8-27b:free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
];
const parked = new Map(); // model -> until ms (429/404 parks a model for a while)

const models = () => (process.env.PREDICTOR_MODELS ? process.env.PREDICTOR_MODELS.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_MODELS);
const enabled = () => String(process.env.PREDICTOR_LLM || 'true').toLowerCase() !== 'false' && !!process.env.OPENROUTER_API_KEY;

function extractJson(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```json|```/gi, '');
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (_) { return null; }
}

async function llmJson({ system, user, maxTokens = 450, tries = 3, timeoutMs = 25000 }) {
  if (process.env.AI_ROUTER_ENABLED === 'true' && process.env.PREDICTOR_LLM !== 'false')
    return require('../utils/openrouterGateway').requestJson({ system, user, maxTokens, purpose: 'risk_or_arb_review' });
  if (!enabled()) return null;
  const now = Date.now();
  const pool = models().filter((m) => !(parked.get(m) > now));
  for (const model of pool.slice(0, tries)) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'X-Title': 'AiTradingAgent predictor' },
        body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.2,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      });
      if (res.status === 429 || res.status === 404 || res.status === 402) { parked.set(model, Date.now() + (res.status === 429 ? 10 : 60) * 60000); continue; }
      if (!res.ok) continue;
      const body = await res.json();
      const json = extractJson(body?.choices?.[0]?.message?.content);
      if (json) return { json, model };
    } catch (_) { parked.set(model, Date.now() + 2 * 60000); }
  }
  return null;
}

module.exports = { llmJson, extractJson, enabled, models };
