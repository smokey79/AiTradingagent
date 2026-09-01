/**
 * DeepSeek — Quantitative Reasoning & Market Sentiment Agent
 * Powered by DeepSeek R1 (reasoning) & DeepSeek V3 (chat).
 * Supports:
 *   1. Direct DeepSeek API (https://api.deepseek.com/chat/completions) via DEEPSEEK_API_KEY
 *   2. OpenRouter Free Tier (deepseek/deepseek-r1:free, deepseek/deepseek-chat:free) via OPENROUTER_API_KEY
 *   3. Autonomous heuristic fallback with mathematical quantitative models
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const SKILL_PATH = path.resolve(__dirname, '../../agents/skills/SKILL_DEEPSEEK_REASONER.md');

function loadSkillPrompt() {
  try {
    if (fs.existsSync(SKILL_PATH)) {
      return fs.readFileSync(SKILL_PATH, 'utf8');
    }
  } catch (e) {}
  return `You are DeepSeek R1, a premier crypto quantitative analyst and reasoning engine.
Your task is to analyze price action, Smart Money Concepts (SMC), order block liquidity, and risk-reward ratios.
Output strictly valid JSON with no markdown formatting:
{
  "signal": "BUY" | "SELL" | "HOLD",
  "confidence": 0.0 to 1.0,
  "reason": "Clear analytical reasoning based on SMC and market structure",
  "model_used": "deepseek-r1",
  "timeframe": "15m",
  "smc_bias": "BULLISH_ORDER_BLOCK" | "BEARISH_ORDER_BLOCK" | "NEUTRAL_RANGE",
  "key_levels": { "support": 0, "resistance": 0, "invalidation": 0 }
}`;
}

function cleanJson(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    return JSON.parse(match[0]);
  }
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

async function getSignal(symbol, marketData) {
  const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
  const openrouterApiKey = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY_1;
  const ind = marketData?.indicators || {};
  const price = marketData?.price || {};
  const currentPrice = price.price || 0;

  // 1. Try Direct DeepSeek API if key is present
  if (deepseekApiKey && !deepseekApiKey.startsWith('your_') && deepseekApiKey.trim() !== '') {
    try {
      const systemPrompt = loadSkillPrompt();
      const userPrompt = `Evaluate market structure and quantitative indicators for ${symbol}:
Price: $${currentPrice.toFixed(2)}, 24h Change: ${price.change24h?.toFixed(2) || '0'}%, 24h Volume: $${(price.volume24h/1e6)?.toFixed(1) || '0'}M
Technical Indicators: RSI(14)=${ind.rsi14 || 50}, EMA20=$${ind.ema20 || 0}, EMA50=$${ind.ema50 || 0}, EMA200=$${ind.ema200 || 0}
Orderbook & MACD: MACD Hist=${ind.macd?.histogram || 0}, Bias=${ind.orderBook?.bias || 'neutral'}
Provide your quantitative decision in strict JSON.`;

      const res = await axios.post(
        'https://api.deepseek.com/chat/completions',
        {
          model: 'deepseek-reasoner',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 600,
          temperature: 0.2
        },
        {
          headers: {
            'Authorization': `Bearer ${deepseekApiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 3500
        }
      );

      const content = res.data.choices?.[0]?.message?.content;
      const parsed = cleanJson(content);
      if (parsed && parsed.signal) {
        parsed.agent = 'deepseek';
        parsed.provider = 'deepseek_direct';
        return parsed;
      }
    } catch (err) {
      logger.warn(`DeepSeek direct API call failed (${err.message}). Falling back to OpenRouter free models.`);
    }
  }

  // 2. Try OpenRouter DeepSeek Free Tier (deepseek/deepseek-r1:free)
  if (openrouterApiKey && !openrouterApiKey.startsWith('your_') && openrouterApiKey.trim() !== '') {
    try {
      const systemPrompt = loadSkillPrompt();
      const userPrompt = `Evaluate market structure and quantitative indicators for ${symbol}:
Price: $${currentPrice.toFixed(2)}, 24h Change: ${price.change24h?.toFixed(2) || '0'}%
Indicators: RSI(14)=${ind.rsi14 || 50}, EMA20=$${ind.ema20 || 0}, EMA50=$${ind.ema50 || 0}
MACD Hist=${ind.macd?.histogram || 0}, Bias=${ind.orderBook?.bias || 'neutral'}
Respond strictly in valid JSON.`;

      const res = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'deepseek/deepseek-r1:free',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 600,
          temperature: 0.2
        },
        {
          headers: {
            'Authorization': `Bearer ${openrouterApiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/smokey79/aitradingagent',
            'X-Title': 'AiTradingAgent'
          },
          timeout: 3500
        }
      );

      const content = res.data.choices?.[0]?.message?.content;
      const parsed = cleanJson(content);
      if (parsed && parsed.signal) {
        parsed.agent = 'deepseek';
        parsed.provider = 'openrouter_deepseek_r1_free';
        return parsed;
      }
    } catch (err) {
      logger.warn(`OpenRouter DeepSeek-R1 free call failed (${err.message}). Using quantitative fallback.`);
    }
  }

  // 3. Mathematical Quantitative Heuristic Fallback
  return simulateDeepSeekAnalysis(symbol, marketData);
}

function simulateDeepSeekAnalysis(symbol, marketData) {
  const ind = marketData?.indicators || {};
  const price = marketData?.price || {};
  const rsi = ind.rsi14 || 50;
  const change24h = price.change24h || 0;
  const currentPrice = price.price || 50000;
  const ema20 = ind.ema20 || currentPrice;
  const ema50 = ind.ema50 || currentPrice;

  let signal = 'HOLD';
  let confidence = 0.72;
  let reason = '';
  let smcBias = 'NEUTRAL_RANGE';

  // DeepSeek R1 quantitative decision matrix
  if (rsi < 36 && change24h > -4 && currentPrice >= ema20 * 0.98) {
    signal = 'BUY';
    confidence = 0.85;
    smcBias = 'BULLISH_ORDER_BLOCK';
    reason = `DeepSeek R1 quantitative model identified deep oversold confluence (RSI ${rsi.toFixed(1)}) at demand zone support ($${(currentPrice*0.985).toFixed(0)}).`;
  } else if (rsi > 68 && change24h > 4) {
    signal = 'SELL';
    confidence = 0.82;
    smcBias = 'BEARISH_ORDER_BLOCK';
    reason = `DeepSeek R1 identified liquidity sweep into premium supply zone with high mean-reversion probability (RSI ${rsi.toFixed(1)}).`;
  } else if (currentPrice > ema20 && ema20 > ema50 && rsi >= 45 && rsi <= 62) {
    signal = 'BUY';
    confidence = 0.78;
    smcBias = 'BULLISH_ORDER_BLOCK';
    reason = `DeepSeek R1 confirmed trend continuation: Price ($${currentPrice.toFixed(0)}) above 20-EMA/50-EMA with healthy RSI momentum (${rsi.toFixed(1)}).`;
  } else {
    signal = 'HOLD';
    confidence = 0.70;
    smcBias = 'NEUTRAL_RANGE';
    reason = `DeepSeek R1 equilibrium check: Range-bound oscillation around EMA baseline. Preserving capital awaiting clear SMC breakout.`;
  }

  return {
    agent: 'deepseek',
    signal,
    confidence,
    reason,
    model_used: 'deepseek-r1-quantitative',
    provider: 'local_quantitative_engine',
    timeframe: '15m',
    smc_bias: smcBias,
    key_levels: {
      support: +(currentPrice * 0.975).toFixed(2),
      resistance: +(currentPrice * 1.035).toFixed(2),
      invalidation: +(currentPrice * (signal === 'BUY' ? 0.96 : 1.04)).toFixed(2)
    }
  };
}

module.exports = {
  getSignal,
  simulateDeepSeekAnalysis
};
