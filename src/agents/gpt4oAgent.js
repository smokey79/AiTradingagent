/**
 * GPT-4o — Sentiment & Macro Specialist Agent
 * Uses OpenAI API (or OpenRouter) with sentiment & macro heuristic fallback.
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const SKILL_PATH = path.resolve(__dirname, '../../agents/skills/SKILL_GPT4O_SENTIMENT.md');

function loadSkillPrompt() {
  try {
    if (fs.existsSync(SKILL_PATH)) {
      return fs.readFileSync(SKILL_PATH, 'utf8');
    }
  } catch (e) {}
  return 'You are GPT-4o, sentiment and macro specialist. Output strictly valid JSON.';
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
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY;
  const isRouter = !process.env.OPENAI_API_KEY && !!process.env.OPENROUTER_API_KEY;

  if (!apiKey || apiKey.startsWith('your_') || apiKey.trim() === '') {
    return simulateGpt4oAnalysis(symbol, marketData);
  }

  try {
    const systemPrompt = loadSkillPrompt();
    const fg = marketData?.fearGreed || { value: 50, classification: 'Neutral' };
    const price = marketData?.price || {};

    const userPrompt = `Analyse macro and market sentiment for ${symbol}:
Price: $${price.price?.toFixed(2) || '0'}, 24h Change: ${price.change24h?.toFixed(2) || '0'}%
Crypto Fear & Greed Index: ${fg.value} (${fg.classification}, Trend: ${fg.trend || 'neutral'})
On-Chain SOPR: ${marketData?.onchain?.sopr?.toFixed(3) || '1.0'}, MVRV: ${marketData?.onchain?.mvrv?.toFixed(2) || '1.8'}

Output strictly valid JSON matching your schema.`;

    const url = isRouter
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';

    const res = await axios.post(
      url,
      {
        model: isRouter ? 'openai/gpt-4o' : 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 500,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 3500,
      }
    );

    const rawText = res.data?.choices?.[0]?.message?.content;
    const parsed = cleanJson(rawText);

    return {
      agent: 'gpt4o',
      symbol,
      signal: parsed.signal?.toUpperCase() || 'HOLD',
      confidence: parseFloat(parsed.confidence) || 0.75,
      reason: parsed.reason || 'Macro and market sentiment evaluated',
      sentiment_score: parsed.sentiment_score || 0.2,
      fear_greed_index: fg.value,
      macro_risk: parsed.macro_risk || 'low',
      constraints: parsed.constraints || { max_position_size_pct: 5.0, stop_loss_pct: 2.5, take_profit_pct: 5.0 },
      risk_score: parsed.risk_score || 3.0,
      raw: parsed,
    };
  } catch (err) {
    logger.warn(`GPT-4o API call failed: ${err.message} — using sentiment rule engine`);
    return simulateGpt4oAnalysis(symbol, marketData);
  }
}

function simulateGpt4oAnalysis(symbol, marketData) {
  const fg = marketData?.fearGreed || { value: 50, classification: 'Neutral' };
  const change24h = marketData?.price?.change24h || 0;
  const sopr = marketData?.onchain?.sopr || 1.0;

  let signal = 'HOLD';
  let confidence = 0.70;
  let reason = 'Balanced macro sentiment and normal leverage levels';
  let sentimentScore = 0.1;

  if (fg.value <= 25) {
    signal = 'BUY';
    confidence = 0.84;
    sentimentScore = 0.65;
    reason = `Extreme Fear (${fg.value}) presents high-probability contrarian accumulation opportunity`;
  } else if (fg.value >= 78) {
    signal = 'SELL';
    confidence = 0.76;
    sentimentScore = -0.45;
    reason = `Extreme Greed (${fg.value}) warns of elevated liquidation and long-squeeze risk`;
  } else if (change24h > 1.5 && sopr > 1.01) {
    signal = 'BUY';
    confidence = 0.79;
    sentimentScore = 0.45;
    reason = `Positive spot accumulation and healthy on-chain profit realization (SOPR ${sopr.toFixed(3)})`;
  }

  return {
    agent: 'gpt4o',
    timestamp: new Date().toISOString(),
    symbol,
    signal,
    confidence,
    reason,
    sentiment_score: sentimentScore,
    fear_greed_index: fg.value,
    funding_rate_bias: 'neutral',
    macro_risk: 'low',
    social_spike_detected: false,
    constraints: {
      max_position_size_pct: 5.0,
      stop_loss_pct: 2.5,
      take_profit_pct: 5.5,
      timeframe_validity_minutes: 120,
    },
    risk_score: signal === 'BUY' ? 2.5 : 3.0,
  };
}

module.exports = { getSignal };
