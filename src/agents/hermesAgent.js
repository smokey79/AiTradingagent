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

const SKILL_PATH = path.resolve(__dirname, '../../agents/skills/SKILL_HERMES_VALIDATOR.md');
const OLLAMA_BASE = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const HERMES_MODEL = process.env.HERMES_MODEL || 'hermes3';
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

Analyze ${symbol}:
Price: $${price?.price?.toFixed(2) || '0'}, 24h Change: ${price?.change24h?.toFixed(2) || '0'}%, 24h Volume: $${((price?.volume24h || 0) / 1e6).toFixed(1)}M
Indicators: RSI(14)=${ind.rsi14 || 50}, EMA20=$${ind.ema20 || 0}, EMA50=$${ind.ema50 || 0}, EMA200=$${ind.ema200 || 0}
Price vs EMA50: ${ind.priceVsEma50 || 'above'}, Price vs EMA200: ${ind.priceVsEma200 || 'above'}
MACD: hist=${ind.macd?.histogram || 0}, line=${ind.macd?.macd || 0}, signal=${ind.macd?.signal || 0}
On-Chain: SOPR=${marketData?.onchain?.sopr?.toFixed(3) || '1.0'}, MVRV=${marketData?.onchain?.mvrv?.toFixed(2) || '1.8'}

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
        temperature: 0.2,
      },
    },
    { timeout: 1500, proxy: false }
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

async function getSignal(symbol, marketData) {
  const skillPrompt = loadSkillPrompt();

  // Tier 1: Try Local Ollama Hermes
  try {
    return await callLocalOllama(symbol, marketData, skillPrompt);
  } catch (ollamaErr) {
    // Tier 2: Try Cloud OpenRouter Hermes 3 if key is present
    try {
      if (process.env.OPENROUTER_API_KEY && !process.env.OPENROUTER_API_KEY.startsWith('your_')) {
        return await callOpenRouterHermes(symbol, marketData, skillPrompt);
      }
    } catch (openRouterErr) {
      // Cloud also unavailable
    }

    // Tier 3: Heuristic local rule validator (fast, resilient, guaranteed)
    return simulateHermesValidation(symbol, marketData);
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

module.exports = {
  getSignal,
  callLocalOllama,
  callOpenRouterHermes,
  simulateHermesValidation,
};
