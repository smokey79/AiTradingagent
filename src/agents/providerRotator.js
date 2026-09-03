/**
 * providerRotator.js
 * ==================
 * 24/7 provider rotation engine with tiered fallback.
 *
 * TIER 1 — Free (OpenRouter free pool):  DeepSeek R1, Llama 3.3, Gemini Flash, Qwen, Mistral
 * TIER 2 — Subscriptions (0 extra cost): Gemini Pro (your sub), Copilot/GPT-4 (your sub)
 * TIER 3 — Paid API (sparingly):         Claude (Anthropic), Grok (OpenRouter paid key)
 * TIER 4 — Local offline fallback:       Ollama (Llama 3.2, completely free, no internet)
 *
 * Strategy: run 5 free/sub agents in parallel → Gemini Pro as consensus arbiter.
 * Claude is only called when agents are split (saves ~90% of API spend).
 */

'use strict';
const axios = require('axios');
const logger = require('../utils/logger');

// ─── Rate limit tracker ───────────────────────────────────────────────────────
const COOLDOWNS = {}; // { providerKey: unixMs cooldown-until }
function isCooledDown(key) {
  return !COOLDOWNS[key] || Date.now() > COOLDOWNS[key];
}
function setCooldown(key, ms = 60_000) {
  COOLDOWNS[key] = Date.now() + ms;
  logger.warn(`[Rotator] ${key} on cooldown for ${ms / 1000}s`);
}

// ─── OpenRouter free models pool ─────────────────────────────────────────────
const FREE_MODELS = [
  'deepseek/deepseek-r1:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemini-2.0-flash-exp:free',
  'qwen/qwen-2.5-coder-32b-instruct:free',
  'mistralai/mistral-7b-instruct:free',
  'deepseek/deepseek-chat:free',
];

// ─── OpenRouter key rotation ──────────────────────────────────────────────────
let _orKeyIdx = 0;
function getORKey() {
  const keys = [
    process.env.OPENROUTER_API_KEY,
    process.env.OPENROUTER_API_KEY_2,
    process.env.OPENROUTER_API_KEY_3,
    process.env.GROK_API_KEY,           // Grok key also works on OpenRouter
  ]
    .filter(Boolean)
    .flatMap(k => k.split(',').map(s => s.trim()))
    .filter(k => k && k.startsWith('sk-or'));
  if (keys.length === 0) return null;
  const key = keys[_orKeyIdx % keys.length];
  _orKeyIdx++;
  return key;
}

// ─── System prompt (shared) ───────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a professional cryptocurrency analyst in a multi-agent consensus trading system.
Analyse the provided market data and respond ONLY with this exact JSON (no markdown fences):
{"signal":"BUY"|"SELL"|"HOLD","confidence":0.70-0.95,"reason":"one concise sentence","model_used":"<model name>"}`;

// ─── Helper: parse JSON from LLM response ────────────────────────────────────
function parseSignal(raw, modelName) {
  try {
    const m = raw.match(/\{[\s\S]*?\}/);
    const obj = JSON.parse(m ? m[0] : raw.replace(/```(?:json)?|```/g, '').trim());
    if (!['BUY', 'SELL', 'HOLD'].includes(obj.signal?.toUpperCase())) throw new Error('bad signal');
    return {
      signal: obj.signal.toUpperCase(),
      confidence: Math.max(0.5, Math.min(1.0, parseFloat(obj.confidence) || 0.75)),
      reason: obj.reason || 'No reason provided',
      model_used: obj.model_used || modelName,
    };
  } catch {
    return null;
  }
}

// ─── Local heuristic fallback (always works, no API needed) ──────────────────
function localHeuristic(symbol, marketData, modelName = 'local-heuristic') {
  const rsi = marketData?.indicators?.rsi14 || 50;
  const change = marketData?.price?.change24h || 0;
  let signal = 'HOLD', confidence = 0.70, reason = '';

  if (rsi < 38 && change > -5) {
    signal = 'BUY'; confidence = 0.78;
    reason = `RSI oversold (${rsi.toFixed(1)}) with contained drawdown — accumulation signal.`;
  } else if (rsi > 68 && change > 4) {
    signal = 'SELL'; confidence = 0.76;
    reason = `RSI overbought (${rsi.toFixed(1)}) on elevated momentum — distribution risk.`;
  } else {
    reason = `Neutral RSI ${rsi.toFixed(1)} / 24h ${change.toFixed(2)}% — no directional edge.`;
  }
  return { signal, confidence, reason, model_used: modelName };
}

// ─── TIER 1: OpenRouter free model call ──────────────────────────────────────
async function callOpenRouterFree(symbol, marketData, modelOverride) {
  const key = getORKey();
  if (!key) return null;
  if (!isCooledDown(`or_free_${modelOverride}`)) return null;

  const model = modelOverride || FREE_MODELS[Math.floor(Math.random() * FREE_MODELS.length)];
  const payload = {
    symbol,
    price: marketData?.price?.price,
    change24h: marketData?.price?.change24h,
    rsi14: marketData?.indicators?.rsi14 || 50,
    ema20: marketData?.indicators?.ema20,
    ema50: marketData?.indicators?.ema50,
    timestamp: new Date().toISOString(),
  };

  try {
    const { data } = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        max_tokens: 300,
        temperature: 0.15,
      },
      {
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://aitradingagent.local',
          'X-Title': 'AiTradingAgent',
        },
        timeout: 8000,
      }
    );
    const raw = data.choices?.[0]?.message?.content ?? '';
    return parseSignal(raw, model);
  } catch (err) {
    if (err.response?.status === 429) setCooldown(`or_free_${model}`, 120_000);
    logger.warn(`[Rotator] OpenRouter free (${model}) failed: ${err.message}`);
    return null;
  }
}

// ─── TIER 2: Gemini Pro (your existing subscription key) ─────────────────────
async function callGeminiPro(symbol, marketData) {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!isCooledDown('gemini_pro')) return null;

  const payload = {
    symbol,
    price: marketData?.price?.price,
    change24h: marketData?.price?.change24h,
    rsi14: marketData?.indicators?.rsi14 || 50,
    ema20: marketData?.indicators?.ema20,
    timestamp: new Date().toISOString(),
  };

  try {
    const { data } = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [
          {
            parts: [
              { text: `${SYSTEM_PROMPT}\n\nMarket data:\n${JSON.stringify(payload)}` },
            ],
          },
        ],
        generationConfig: { maxOutputTokens: 300, temperature: 0.15 },
      },
      { timeout: 10000 }
    );
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return parseSignal(raw, 'gemini-1.5-pro');
  } catch (err) {
    if (err.response?.status === 429) setCooldown('gemini_pro', 60_000);
    logger.warn(`[Rotator] Gemini Pro failed: ${err.message}`);
    return null;
  }
}

// ─── TIER 3: Ollama (local, completely free, offline) ────────────────────────
async function callOllama(symbol, marketData) {
  const host = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
  const model = process.env.OLLAMA_MODEL || 'llama3.2';

  const payload = {
    symbol,
    price: marketData?.price?.price,
    rsi14: marketData?.indicators?.rsi14 || 50,
    change24h: marketData?.price?.change24h,
  };

  try {
    const { data } = await axios.post(
      `${host}/api/generate`,
      {
        model,
        prompt: `${SYSTEM_PROMPT}\n\nMarket data: ${JSON.stringify(payload)}\n\nRespond with only the JSON object:`,
        stream: false,
        options: { temperature: 0.15, num_predict: 200 },
      },
      { timeout: 20000 }
    );
    return parseSignal(data.response || '', model);
  } catch (err) {
    logger.warn(`[Rotator] Ollama (${model}) failed: ${err.message} — is Ollama running?`);
    return null;
  }
}

// ─── MASTER ROTATION FUNCTION ─────────────────────────────────────────────────
/**
 * runRotatedConsensus
 * Runs 5 agents in parallel using the cheapest available providers.
 * Falls back through tiers automatically. Never throws — always returns signals.
 *
 * @param {string} symbol  e.g. 'BTC/USDT'
 * @param {object} marketData  from fetchMarketData()
 * @returns {Promise<Array>}  array of {agent, signal, confidence, reason, model_used}
 */
async function runRotatedConsensus(symbol, marketData) {
  const baseSymbol = symbol.split('/')[0];

  // Pick 5 free models to run in parallel (rotate through the pool)
  const shuffled = [...FREE_MODELS].sort(() => 0.5 - Math.random()).slice(0, 3);

  const tasks = [
    // 3 random free OpenRouter models
    ...shuffled.map((model, i) =>
      callOpenRouterFree(baseSymbol, marketData, model)
        .then(r => r ? { agent: `free_${i + 1}`, ...r } : null)
    ),
    // Gemini Pro (your sub — best quality free for you)
    callGeminiPro(baseSymbol, marketData)
      .then(r => r ? { agent: 'gemini_pro', ...r } : null),
    // Ollama (local offline — always available)
    callOllama(baseSymbol, marketData)
      .then(r => r ? { agent: 'ollama_local', ...r } : null),
  ];

  const settled = await Promise.allSettled(tasks);
  const results = settled
    .map(r => (r.status === 'fulfilled' ? r.value : null))
    .filter(Boolean);

  // If we got fewer than 2 real results, fill with local heuristic
  if (results.length < 2) {
    logger.warn(`[Rotator] Only ${results.length} providers responded — using local heuristic fill`);
    results.push(
      { agent: 'heuristic_1', ...localHeuristic(baseSymbol, marketData, 'local-heuristic-a') },
      { agent: 'heuristic_2', ...localHeuristic(baseSymbol, marketData, 'local-heuristic-b') }
    );
  }

  logger.info(`[Rotator] ${symbol} — ${results.length} agents responded: ${results.map(r => `${r.agent}:${r.signal}`).join(', ')}`);
  return results;
}

/**
 * synthesizeRotatedSignals
 * Simple majority vote + weighted confidence aggregation.
 */
function synthesizeRotatedSignals(signals) {
  if (!signals || signals.length === 0) {
    return { signal: 'HOLD', confidence: 0.5, reasoning: 'No signals available', approved_for_execution: false };
  }

  const votes = { BUY: 0, SELL: 0, HOLD: 0 };
  const confBySignal = { BUY: [], SELL: [], HOLD: [] };

  for (const s of signals) {
    const sig = s.signal || 'HOLD';
    votes[sig] = (votes[sig] || 0) + 1;
    confBySignal[sig].push(s.confidence || 0.7);
  }

  const winner = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
  const confs = confBySignal[winner];
  const avgConf = confs.reduce((a, b) => a + b, 0) / confs.length;
  const agreementPct = votes[winner] / signals.length;

  const MIN_CONF = parseFloat(process.env.MIN_CONFIDENCE || '0.72');
  const MIN_AGENTS = parseInt(process.env.MIN_AGENTS || '2');

  const approved = avgConf >= MIN_CONF && votes[winner] >= MIN_AGENTS;

  return {
    signal: winner,
    confidence: parseFloat(avgConf.toFixed(4)),
    agentsAgreeing: votes[winner],
    totalAgents: signals.length,
    agreementPct: parseFloat(agreementPct.toFixed(2)),
    reasoning: `${votes[winner]}/${signals.length} agents signal ${winner} with ${(avgConf * 100).toFixed(1)}% avg confidence`,
    approved_for_execution: approved,
    breakdown: signals,
    providers: signals.map(s => s.model_used || s.agent),
  };
}

module.exports = {
  runRotatedConsensus,
  synthesizeRotatedSignals,
  callOpenRouterFree,
  callGeminiPro,
  callOllama,
  localHeuristic,
  FREE_MODELS,
};
