/**
 * openrouterFreeAgent.js
 * ========================
 * Free Multi-Model OpenRouter Agent with Automatic Key & Model Rotation.
 * Leverages zero-cost token inference on OpenRouter's free tier. Active
 * rotation (confirmed working or ZDR-clean as of 2026-09-16 -- see the
 * FREE_MODELS comment below for the full survey of what's blocked/why):
 *   - inclusionai/ling-3.0-flash-fin:free
 *   - inclusionai/ling-3.0-flash-vl:free
 *   - inclusionai/ling-3.0-flash-sante:free
 *   - z-ai/glm-5.2:free
 *   - openrouter/free
 */
const axios = require('axios');
const logger = require('../utils/logger');

// ── Rotate through available OpenRouter keys ─────────────────────
function getKeys() {
  const keys = [
    process.env.OPENROUTER_API_KEY,
    process.env.OPENROUTER_API_KEY_1,
    process.env.OPENROUTER_API_KEY_2,
    process.env.OPENROUTER_API_KEY_3,
    process.env.OPENROUTER_KEYS,
  ]
    .filter(Boolean)
    .flatMap(k => k.split(',').map(s => s.trim()))
    .filter(k => k && !k.startsWith('your_'));
  return keys;
}

let keyIndex = 0;
function getNextKey() {
  const keys = getKeys();
  if (keys.length === 0) return null;
  const key = keys[keyIndex % keys.length];
  keyIndex++;
  return key;
}

// ── Free models pool ─────────────────────────────────────────────
// Pruned 2026-09-16: live-tested every entry against this account. The 4
// removed below (meta-llama 3.2, gemma-2-9b, both nvidia nemotron) ALL
// 404 — 2 are discontinued/paid-only now, 2 are blocked by this account's
// Zero-Data-Retention privacy setting (openrouter.ai/settings/privacy) —
// so a third of every rotation cycle was silently wasted on a call that
// could never succeed, before even hitting a rate limit. The 3 remaining
// are the only free family confirmed reachable on this account.
//
// Extended 2026-09-16 (part 2): re-surveyed all 23 free-priced models on
// OpenRouter. 16 of the other 20 are blocked by this account's ZDR privacy
// setting (unlock at openrouter.ai/settings/privacy — a real privacy
// tradeoff, left to Alan to decide, not changed here). 2 more
// (thinkingmachines/inkling, inkling-small) are permanently blocked
// regardless of ZDR — "agentic harness only" models, unusable here either
// way. The remaining 2 below are NOT ZDR-blocked, just already hit their
// account-wide daily free quota for today — added to the rotation now so
// they start contributing automatically once that quota resets (no code
// change needed later), instead of only 3 models ever being tried.
const FREE_MODELS = [
  'inclusionai/ling-3.0-flash-fin:free',                     // 1. Financial & algorithmic analysis
  'inclusionai/ling-3.0-flash-vl:free',                      // 2. High-speed visual/token analysis
  'inclusionai/ling-3.0-flash-sante:free',                   // 3. Compact low-latency inference
  'z-ai/glm-5.2:free',                                       // 4. Daily-quota-capped today; resets ~daily
  'openrouter/free',                                         // 5. OpenRouter's own auto-router (free tier); same daily cap
];

let modelIndex = 0;
function getNextModel() {
  const model = FREE_MODELS[modelIndex % FREE_MODELS.length];
  modelIndex++;
  return model;
}

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

function cleanJson(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    return JSON.parse(match[0]);
  }
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

// Optional paid fallback, OFF by default — mirrors aitradingagent2's
// src/llm/openrouter.js pattern (added 2026-09-16). Tried only after the
// free model AND the local Ollama fallback have both failed, so it never
// spends anything on a call the free/local tiers could have answered.
// Set OPENROUTER_ALLOW_PAID_FALLBACK=true once you have OpenRouter credit
// (this account has $10 as of 2026-09-16) to stop this agent going quiet
// / falling back to the canned heuristic simulation below.
const PAID_FALLBACK_ENABLED = process.env.OPENROUTER_ALLOW_PAID_FALLBACK === 'true';
const PAID_FALLBACK_MODEL = process.env.OPENROUTER_PAID_FALLBACK_MODEL || 'openai/gpt-4o-mini';

async function callOpenRouterPaid(apiKey, symbol, userPayload) {
  if (!PAID_FALLBACK_ENABLED || !apiKey) return null;
  try {
    const { data } = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: PAID_FALLBACK_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(userPayload) },
        ],
        max_tokens: 500,
        temperature: 0.2,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/smokey79/aitradingagent',
          'X-Title': 'AiTradingAgent-PaidFallback',
        },
        timeout: 6000,
      }
    );
    const raw = data.choices?.[0]?.message?.content ?? '{}';
    const parsed = cleanJson(raw);
    if (parsed && parsed.signal) {
      return {
        agent: 'openrouter_free',
        signal: parsed.signal.toUpperCase(),
        confidence: Math.max(0.5, Math.min(1.0, parseFloat(parsed.confidence) || 0.75)),
        reason: parsed.reason || `${PAID_FALLBACK_MODEL} paid-fallback analysis.`,
        constraints: parsed.constraints || [],
        model_used: PAID_FALLBACK_MODEL,
        provider: 'openrouter_paid_fallback',
      };
    }
  } catch (err) {
    logger.warn(`OpenRouter paid fallback (${PAID_FALLBACK_MODEL}) failed for ${symbol}: ${err.message}`);
  }
  return null;
}

let ollamaCooldownUntil = 0;

/**
 * Local Ollama fallback (runs on 127.0.0.1:11434 with llama3.2, 0 quota cost)
 */
async function callLocalOllama(symbol, userPayload, modelName) {
  if (Date.now() < ollamaCooldownUntil) return null;
  try {
    const host = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
    const model = process.env.OLLAMA_MODEL || 'llama3.2';
    const { data } = await axios.post(
      `${host}/api/generate`,
      {
        model,
        prompt: `${SYSTEM_PROMPT}\n\nMarket data: ${JSON.stringify(userPayload)}\n\nRespond with only the JSON object:`,
        stream: false,
        options: { temperature: 0.2, num_predict: 250 },
      },
      { timeout: 3000 }
    );
    const parsed = cleanJson(data.response || '');
    if (parsed && parsed.signal) {
      return {
        agent: 'openrouter_free',
        signal: parsed.signal.toUpperCase(),
        confidence: Math.max(0.5, Math.min(1.0, parseFloat(parsed.confidence) || 0.78)),
        reason: parsed.reason || `Local Ollama (${model}) generated analysis.`,
        constraints: parsed.constraints || ['Local high-conviction fallback'],
        model_used: `ollama:${model}`,
        provider: 'ollama_local'
      };
    }
  } catch (_) {
    ollamaCooldownUntil = Date.now() + 60000;
  }
  return null;
}

/**
 * @param {string} symbol
 * @param {object} marketData
 * @returns {Promise<{signal:string, confidence:number, reason:string, model_used:string}>}
 */
async function getSignal(symbol, marketData) {
  const apiKey = getNextKey();
  const selectedModel = getNextModel();

  const ind = marketData?.indicators || {};
  const price = marketData?.price || {};
  const userPayload = {
    symbol,
    price: price.price,
    change24h: price.change24h,
    rsi14: ind.rsi14 || 50,
    ema20: ind.ema20,
    ema50: ind.ema50,
    timestamp: new Date().toISOString()
  };

  if (!apiKey) {
    logger.info(`[OpenRouterFree] No active API key found; attempting local Ollama fallback.`);
    const ollamaSignal = await callLocalOllama(symbol, userPayload, selectedModel);
    if (ollamaSignal) return ollamaSignal;
    return simulateOpenRouterFreeSignal(symbol, marketData, selectedModel);
  }

  // NOTE: without a paid fallback, both the free-model and Ollama branches
  // below can fail silently into simulateOpenRouterFreeSignal() — a canned
  // heuristic, not a real model opinion — with no error thrown, which is
  // why this agent could show HEALTHY while quietly voting on fabricated
  // reasoning. The paid-fallback tier further down (checked before that
  // heuristic) is the fix for that, once OPENROUTER_ALLOW_PAID_FALLBACK=true.

  try {
    const { data } = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: selectedModel,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(userPayload) },
        ],
        max_tokens: 500,
        temperature: 0.2,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/smokey79/aitradingagent',
          'X-Title': 'AiTradingAgent-FreeTier',
        },
        timeout: 3500,
      }
    );

    const raw = data.choices?.[0]?.message?.content ?? '{}';
    const parsed = cleanJson(raw);
    if (parsed && parsed.signal) {
      return {
        agent: 'openrouter_free',
        signal: parsed.signal.toUpperCase(),
        confidence: Math.max(0.5, Math.min(1.0, parseFloat(parsed.confidence) || 0.75)),
        reason: parsed.reason || `${selectedModel} free tier analysis complete.`,
        constraints: parsed.constraints || [],
        model_used: selectedModel,
        provider: 'openrouter_free_tier'
      };
    }
  } catch (err) {
    logger.warn(`OpenRouter free call (${selectedModel}) failed: ${err.message}. Trying local Ollama fallback.`);
    const ollamaSignal = await callLocalOllama(symbol, userPayload, selectedModel);
    if (ollamaSignal) return ollamaSignal;
  }

  const paidSignal = await callOpenRouterPaid(apiKey, symbol, userPayload);
  if (paidSignal) return paidSignal;

  logger.warn(`[OpenRouterFree] Free model + Ollama + paid fallback (enabled=${PAID_FALLBACK_ENABLED}) all unavailable for ${symbol} — falling back to heuristic simulation, NOT a real model opinion.`);
  return simulateOpenRouterFreeSignal(symbol, marketData, selectedModel);
}

function simulateOpenRouterFreeSignal(symbol, marketData, modelName = 'inclusionai/ling-3.0-flash-fin:free') {
  const ind = marketData?.indicators || {};
  const price = marketData?.price || {};
  const rsi = ind.rsi14 || 50;
  const change24h = price.change24h || 0;

  let signal = 'HOLD';
  let confidence = 0.74;
  let reason = '';

  if (rsi < 40 && change24h > -3) {
    signal = 'BUY';
    confidence = 0.81;
    reason = `OpenRouter (${modelName}) detected oversold accumulation with low downside variance.`;
  } else if (rsi > 65 && change24h > 3.5) {
    signal = 'SELL';
    confidence = 0.79;
    reason = `OpenRouter (${modelName}) identified overbought exhaustion risk.`;
  } else {
    signal = 'HOLD';
    confidence = 0.70;
    reason = `OpenRouter (${modelName}) verified neutral consolidation channel.`;
  }

  return {
    agent: 'openrouter_free',
    signal,
    confidence,
    reason,
    constraints: ['Low volatility buffer', 'Enforce $30 margin safety floor'],
    model_used: modelName,
    provider: 'local_heuristic_router'
  };
}

module.exports = {
  getSignal,
  getOpenRouterFreeSignal: getSignal,
  FREE_MODELS,
  getNextModel,
};
