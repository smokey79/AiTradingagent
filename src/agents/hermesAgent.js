/**
 * Hermes Agent — Local Ollama & OpenRouter Hermes 3 Validator
 * Multi-tier execution:
 *   1. Local Ollama Hermes (fast, offline, private on localhost:11434)
 *   2. OpenRouter Nous Hermes 3 Cloud LLM (if OpenRouter key is set)
 *   3. Intelligent Hermes Heuristic Consensus Validator (resilient fallback)
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { enqueueOllama } = require('../utils/ollamaQueue');

const SKILL_PATH = path.resolve(__dirname, '../../agents/skills/SKILL_HERMES_VALIDATOR.md');
const OLLAMA_BASE = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const HERMES_MODEL = process.env.HERMES_MODEL || 'llama3.2';
const OPENROUTER_HERMES_MODEL = process.env.OPENROUTER_HERMES_MODEL || 'nousresearch/hermes-3-llama-3.1-8b';

function loadSkillPrompt() {
  try {
    if (fs.existsSync(SKILL_PATH)) {
      return fs.readFileSync(SKILL_PATH, 'utf8');
    }
  } catch (e) {}
  return 'You are Hermes, local consensus validator. Output strictly valid JSON conforming to schema.';
}

function cleanJson(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    return JSON.parse(match[0]);
  }
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

async function callLocalOllama(symbol, marketData, skillPrompt) {
  const price = marketData?.price;
  const ind = marketData?.indicators || {};
  const prompt = `${skillPrompt}

Analyze ${symbol} for a trading decision:
── Price Action ──
Current Price: $${price?.price?.toFixed(2) || '0'}
24h Change: ${price?.change24h?.toFixed(2) || '0'}%
24h Volume: $${((price?.volume24h || 0) / 1e6).toFixed(1)}M
Market Cap Rank: ${price?.marketCapRank || 'N/A'}

── Technical Indicators ──
RSI(14): ${ind.rsi14 || 50}
EMA20: $${ind.ema20 || 0} | EMA50: $${ind.ema50 || 0} | EMA200: $${ind.ema200 || 0}
Price vs EMA50: ${ind.priceVsEma50 || 'N/A'} | Price vs EMA200: ${ind.priceVsEma200 || 'N/A'}
MACD Histogram: ${ind.macd?.histogram || 0} | MACD Line: ${ind.macd?.macd || 0} | Signal: ${ind.macd?.signal || 0}
Bollinger Band Width: ${ind.bbWidth || 'N/A'}
ATR(14): ${ind.atr14 || 'N/A'}
Stochastic K: ${ind.stochK || 'N/A'} | D: ${ind.stochD || 'N/A'}

── On-Chain (if available) ──
SOPR: ${marketData?.onchain?.sopr?.toFixed(3) || '1.0'}
MVRV: ${marketData?.onchain?.mvrv?.toFixed(2) || '1.8'}
Net Flow: ${marketData?.onchain?.netFlow || 'N/A'}

Provide a thorough analysis covering:
1. Trend direction and strength
2. Key support/resistance levels
3. Risk assessment (1-5 scale)
4. Position sizing recommendation
5. Stop loss and take profit levels

Output strictly valid JSON with keys: signal, confidence, reason, constraints, risk_score.`;

  const url = OLLAMA_BASE.includes('/api/') ? OLLAMA_BASE : `${OLLAMA_BASE.replace(/\/+$/, '')}/api/generate`;

  const res = await axios.post(
    url,
    {
      model: HERMES_MODEL,
      prompt,
      stream: false,
      format: 'json',
      options: {
        temperature: 0.3,
        num_predict: 1024,
        num_ctx: 4096,
      },
    },
    // 2026-09-16: was 2500ms. Measured directly (scripts/probeAgentProviders.js):
    // a WARM llama3.2 answers in 591ms, but this machine runs with ~1GB free of
    // 15.4GB, so Ollama evicts the model between calls and the next call pays a
    // cold load of several seconds. At 2.5s that cold load always lost, the agent
    // fell through to Ollama Cloud (15s) then OpenRouter (12s), and the caller
    // saw "Hermes timed out after 30000ms" — the local model was never the
    // problem, the budget was. num_predict is 1024 here too, which needs room.
    { timeout: Number(process.env.OLLAMA_TIMEOUT_MS || 12000), proxy: false }
  );

  const text = res.data?.response?.trim();
  const parsed = cleanJson(text);
  if (!parsed || !parsed.signal) throw new Error('Invalid JSON response from Ollama Hermes');

  return {
    agent: 'hermes',
    symbol,
    signal: parsed.signal.toUpperCase(),
    confidence: Math.max(0, Math.min(1, parseFloat(parsed.confidence) || 0.78)),
    reason: parsed.reason || 'Local Ollama Hermes validation completed',
    constraints: parsed.constraints || { max_position_size_pct: 5.0, stop_loss_pct: 2.0, take_profit_pct: 4.5 },
    risk_score: parsed.risk_score || 3.0,
    source: 'ollama_local',
    model: HERMES_MODEL,
  };
}

async function callOllamaCloud(symbol, marketData, skillPrompt) {
  const apiKey = (process.env.OLLAMA_API_KEY || '').trim();
  if (!apiKey || apiKey.startsWith('your_')) {
    throw new Error('No Ollama Cloud API key configured');
  }

  const cloudUrl = (process.env.OLLAMA_CLOUD_URL || 'https://ollama.com/api').replace(/\/+$/, '') + '/chat';
  const model = process.env.OLLAMA_CLOUD_MODEL || 'gpt-oss:20b';

  const price = marketData?.price;
  const ind = marketData?.indicators || {};
  const userContent = `Analyze ${symbol}: Price=$${price?.price || 0}, RSI=${ind.rsi14 || 50}, EMA50=$${ind.ema50 || 0}, MACD hist=${ind.macd?.histogram || 0}. Output strictly JSON with keys: signal, confidence, reason, constraints, risk_score.`;

  const res = await axios.post(
    cloudUrl,
    {
      model,
      messages: [
        { role: 'system', content: skillPrompt },
        { role: 'user', content: userContent },
      ],
      format: 'json',
      stream: false,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );

  const text = res.data?.message?.content;
  const parsed = cleanJson(text);
  if (!parsed || !parsed.signal) throw new Error('Invalid JSON response from Ollama Cloud');

  return {
    agent: 'hermes',
    symbol,
    signal: parsed.signal.toUpperCase(),
    confidence: Math.max(0, Math.min(1, parseFloat(parsed.confidence) || 0.80)),
    reason: parsed.reason || 'Ollama Cloud validation completed',
    constraints: parsed.constraints || { max_position_size_pct: 5.0, stop_loss_pct: 2.0, take_profit_pct: 4.5 },
    risk_score: parsed.risk_score || 3.0,
    source: 'ollama_cloud',
    model,
  };
}

async function callOpenRouterHermes(symbol, marketData, skillPrompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.startsWith('your_') || apiKey.trim() === '') {
    throw new Error('No OpenRouter API key configured');
  }

  const price = marketData?.price;
  const ind = marketData?.indicators || {};
  const userContent = `Analyze ${symbol}: Price=$${price?.price || 0}, RSI=${ind.rsi14 || 50}, EMA50=$${ind.ema50 || 0}, MACD hist=${ind.macd?.histogram || 0}. Output JSON.`;

  const res = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model: OPENROUTER_HERMES_MODEL,
      messages: [
        { role: 'system', content: skillPrompt },
        { role: 'user', content: userContent },
      ],
      max_tokens: 400,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 12000,
    }
  );

  const text = res.data?.choices?.[0]?.message?.content;
  const parsed = cleanJson(text);
  if (!parsed || !parsed.signal) throw new Error('Invalid JSON response from OpenRouter Hermes');

  return {
    agent: 'hermes',
    symbol,
    signal: parsed.signal.toUpperCase(),
    confidence: Math.max(0, Math.min(1, parseFloat(parsed.confidence) || 0.80)),
    reason: parsed.reason || 'OpenRouter Nous Hermes validation completed',
    constraints: parsed.constraints || { max_position_size_pct: 5.0, stop_loss_pct: 2.0, take_profit_pct: 4.5 },
    risk_score: parsed.risk_score || 3.0,
    source: 'openrouter_cloud',
    model: OPENROUTER_HERMES_MODEL,
  };
}

// 2026-09-27: swapped the default tier order to favour OpenRouter (Alan's
// "configure for OpenRouter" request, to cut local RAM/CPU load) — Ollama's
// keep-alive was just cut from 24h to 10m to free RAM, which means the
// local model now cold-loads more often than before. Trying OpenRouter
// first avoids paying that cold-load latency on most cycles, and only
// falls back to local Ollama (still fully free, just slower/offline) if
// OpenRouter is rate-limited or down. Flip HERMES_PREFER_LOCAL=true in
// .env to restore the old local-first order with zero code changes.
const HERMES_PREFER_LOCAL = String(process.env.HERMES_PREFER_LOCAL || 'false').toLowerCase() === 'true';

async function getSignal(symbol, marketData) {
  const skillPrompt = loadSkillPrompt();
  const hasOpenRouterKey = process.env.OPENROUTER_API_KEY && !process.env.OPENROUTER_API_KEY.startsWith('your_');
  const hasOllamaCloudKey = process.env.OLLAMA_API_KEY && !process.env.OLLAMA_API_KEY.startsWith('your_');

  if (HERMES_PREFER_LOCAL) {
    // Original order: Local Ollama -> Ollama Cloud -> OpenRouter -> heuristic
    try {
      return await callLocalOllama(symbol, marketData, skillPrompt);
    } catch (ollamaErr) {
      try {
        if (hasOllamaCloudKey) return await callOllamaCloud(symbol, marketData, skillPrompt);
      } catch (cloudErr) {
        logger.warn(`Ollama Cloud call failed: ${cloudErr.message} — trying fallbacks`);
      }
      try {
        if (hasOpenRouterKey) return await callOpenRouterHermes(symbol, marketData, skillPrompt);
      } catch (openRouterErr) { /* cloud also unavailable */ }
      return simulateHermesValidation(symbol, marketData);
    }
  }

  // New default order: OpenRouter -> Local Ollama -> Ollama Cloud -> heuristic
  try {
    if (hasOpenRouterKey) return await callOpenRouterHermes(symbol, marketData, skillPrompt);
    throw new Error('No OpenRouter key configured — falling through to local Ollama');
  } catch (openRouterErr) {
    logger.warn(`Hermes OpenRouter call failed: ${openRouterErr.message} — trying local Ollama`);
    try {
      return await callLocalOllama(symbol, marketData, skillPrompt);
    } catch (ollamaErr) {
      try {
        if (hasOllamaCloudKey) return await callOllamaCloud(symbol, marketData, skillPrompt);
      } catch (cloudErr) {
        logger.warn(`Ollama Cloud call failed: ${cloudErr.message} — trying heuristic`);
      }
      return simulateHermesValidation(symbol, marketData);
    }
  }
}

function simulateHermesValidation(symbol, marketData) {
  const ind = marketData?.indicators || {};
  const rsi = ind.rsi14 || 50;
  const priceVsEma50 = ind.priceVsEma50 === 'above';
  const priceVsEma200 = ind.priceVsEma200 === 'above';
  const macdHist = ind.macd?.histogram || 0;

  let signal = 'HOLD';
  let confidence = 0.72;
  let reason = 'Hermes local validator: Market in balanced equilibrium';

  if (rsi < 40 && priceVsEma200) {
    signal = 'BUY';
    confidence = 0.81;
    reason = 'Hermes local validator: Healthy dip into support on higher timeframe uptrend';
  } else if (rsi > 70) {
    signal = 'SELL';
    confidence = 0.74;
    reason = 'Hermes local validator: Overextended technical indicators';
  } else if (priceVsEma50 && rsi >= 45 && rsi <= 65 && macdHist >= 0) {
    signal = 'BUY';
    confidence = 0.77;
    reason = 'Hermes local validator: Constructive momentum and trend alignment';
  }

  return {
    agent: 'hermes',
    timestamp: new Date().toISOString(),
    symbol,
    signal,
    confidence,
    reason,
    constraints: {
      max_position_size_pct: 5.0,
      stop_loss_pct: 2.0,
      take_profit_pct: 4.5,
    },
    risk_score: signal === 'HOLD' ? 2.0 : 3.0,
    source: 'heuristic_fallback',
  };
}

/**
 * callHermesRaw(prompt) — NEW 2026-09-27, added for the Bear debate agent
 * (src/agents/bearDebateAgent.js), Alan's approved Phase 2 plan item 1.
 * Sends an arbitrary prompt (not the fixed skill-based validator prompt
 * above) straight to local Ollama first (free, unlimited, no internet
 * dependency — matches why bearAgent.js in aitradingagent2 runs on Hermes
 * rather than a cloud model), falling back to the OpenRouter-hosted Hermes
 * 3 model only if local Ollama is unreachable.
 */
async function callHermesRaw(prompt) {
  try {
    // 2026-09-27: bumped from 8000ms after live logs showed "timeout of
    // 8000ms exceeded" on every debate call — this hardware (Radeon iGPU,
    // no dedicated GPU) takes ~15-20s for local Hermes/Llama inference
    // (matches the ~18s figure already noted for the Gemini/Ollama
    // cross-validator elsewhere in this pipeline). 25000ms gives headroom
    // without hanging a whole trading cycle indefinitely.
    //
    // Also routed through enqueueOllama() (src/utils/ollamaQueue.js):
    // live logs showed EVERY concurrent debate call timing out together
    // when several candidates fired in the same cycle — this box serves
    // local Ollama requests one at a time, so a flood of simultaneous
    // calls queues up server-side and outlives any client timeout. The
    // queue makes calls wait their turn instead of racing and losing.
    const { data } = await enqueueOllama(() => axios.post(
      `${OLLAMA_BASE}/api/generate`,
      { model: HERMES_MODEL, prompt, stream: false, options: { temperature: 0.25, num_predict: 200 } },
      { timeout: 40000 }
    ));
    if (data.response) return { text: data.response, model: `ollama:${HERMES_MODEL}` };
  } catch (err) {
    logger.warn(`[Hermes] callHermesRaw local Ollama failed: ${err.message}`);
  }

  const key = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY_1;
  if (key) {
    try {
      const { data } = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        { model: OPENROUTER_HERMES_MODEL, messages: [{ role: 'user', content: prompt }], max_tokens: 300, temperature: 0.25 },
        { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 8000 }
      );
      const text = data.choices?.[0]?.message?.content;
      if (text) return { text, model: OPENROUTER_HERMES_MODEL };
    } catch (err) {
      logger.warn(`[Hermes] callHermesRaw OpenRouter fallback failed: ${err.message}`);
    }
  }

  throw new Error('callHermesRaw: local Ollama and OpenRouter Hermes both unreachable');
}

module.exports = {
  getSignal,
  getHermesRuling: getSignal,
  callLocalOllama,
  callOpenRouterHermes,
  simulateHermesValidation,
  callHermesRaw,
};
