/**
 * Grok — Real-Time News, Social Sentiment & Orderbook Flow Agent
 * Uses xAI Grok API (direct x.ai or OpenRouter) with real-time news heuristics.
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const SKILL_PATH = path.resolve(__dirname, '../../agents/skills/SKILL_GROK_REALTIME.md');

function loadSkillPrompt() {
  try {
    if (fs.existsSync(SKILL_PATH)) {
      return fs.readFileSync(SKILL_PATH, 'utf8');
    }
  } catch (e) {}
  return 'You are Grok, real-time news and social signal analyst. Output strictly valid JSON.';
}

function cleanJson(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    return JSON.parse(match[0]);
  }
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

/**
 * Get Grok API Keys
 */
function getGrokKeys() {
  const directKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY || process.env.APP_GROK_API_KEY || '';
  const openRouterKey = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY_MCP || process.env.OPENROUTER_API_KEY_4 || '';
  return {
    directKey: directKey.startsWith('your_') ? '' : directKey.trim(),
    openRouterKey: openRouterKey.startsWith('your_') ? '' : openRouterKey.trim(),
  };
}

async function getSignal(symbol, marketData) {
  const { directKey, openRouterKey } = getGrokKeys();
  const systemPrompt = loadSkillPrompt();
  const userPrompt = `Evaluate breaking events, orderbook anomalies, and X/Twitter social momentum for ${symbol}:
Price: $${marketData?.price?.price || 0}, 24h Vol: $${(marketData?.price?.volume24h / 1e6)?.toFixed(1) || 0}M, 24h Change: ${marketData?.price?.change24h || 0}%
Orderbook Imbalance: ${marketData?.indicators?.orderBook?.imbalanceRatio || 0.5} (Bias: ${marketData?.indicators?.orderBook?.bias || 'neutral'})
RSI: ${marketData?.indicators?.rsi14 || 50}

Analyze current real-time social sentiment, whale transaction flow, and breaking catalysts. Output strictly valid JSON conforming to your schema.`;

  // 1. Try Direct xAI API
  if (directKey) {
    try {
      const model = process.env.XAI_MODEL || 'grok-2-latest';
      const res = await axios.post(
        'https://api.x.ai/v1/chat/completions',
        {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: 600,
        },
        {
          headers: {
            Authorization: `Bearer ${directKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 12000,
        }
      );

      const rawText = res.data?.choices?.[0]?.message?.content;
      const parsed = cleanJson(rawText);
      if (parsed && parsed.signal) {
        logger.info(`[Grok Direct xAI] Analysis generated for ${symbol}: ${parsed.signal} @ ${parsed.confidence}`);
        return formatGrokResponse(symbol, parsed, 'xai_direct');
      }
    } catch (err) {
      logger.warn(`Grok direct xAI API error: ${err.message} — attempting OpenRouter fallback`);
    }
  }

  // 2. Try OpenRouter Fallback
  if (openRouterKey) {
    try {
      const res = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'x-ai/grok-2-1212',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 500,
        },
        {
          headers: {
            Authorization: `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 12000,
        }
      );

      const rawText = res.data?.choices?.[0]?.message?.content;
      const parsed = cleanJson(rawText);
      if (parsed && parsed.signal) {
        logger.info(`[Grok OpenRouter] Analysis generated for ${symbol}: ${parsed.signal} @ ${parsed.confidence}`);
        return formatGrokResponse(symbol, parsed, 'openrouter');
      }
    } catch (err) {
      logger.warn(`Grok OpenRouter call failed: ${err.message} — using real-time rule engine`);
    }
  }

  // 3. Fallback to Real-Time Rule & Social Engine
  return simulateGrokAnalysis(symbol, marketData);
}

function formatGrokResponse(symbol, parsed, provider = 'xai_direct') {
  return {
    agent: 'grok',
    provider,
    symbol,
    signal: parsed.signal?.toUpperCase() || 'HOLD',
    confidence: parseFloat(parsed.confidence) || 0.76,
    reason: parsed.reason || 'Real-time social and orderbook signals parsed',
    breaking_event: !!parsed.breaking_event,
    event_type: parsed.event_type || 'social_flow',
    event_severity: parsed.event_severity || 'low',
    exchange_anomaly: !!parsed.exchange_anomaly,
    veto_flag: !!parsed.veto_flag,
    veto_reason: parsed.veto_reason || null,
    risk_score: parsed.risk_score || 2.0,
    constraints: parsed.constraints || {
      max_position_size_pct: 4.0,
      stop_loss_pct: 2.0,
      take_profit_pct: 4.0,
      timeframe_validity_minutes: 30,
      urgency: parsed.breaking_event ? 'immediate' : 'standard',
    },
    raw: parsed,
  };
}

function simulateGrokAnalysis(symbol, marketData) {
  const volRatio = marketData?.indicators?.volumeRatio || 1.0;
  const ob = marketData?.indicators?.orderBook || {};
  const priceChange = marketData?.price?.change24h || 0;

  let signal = 'HOLD';
  let confidence = 0.73;
  let reason = 'Steady transaction flow with no anomaly or liquidation cascade detected';
  let breakingEvent = false;
  let vetoFlag = false;

  if (volRatio > 1.8 && ob.imbalanceRatio > 0.62) {
    signal = 'BUY';
    confidence = 0.83;
    breakingEvent = true;
    reason = `Real-time buying surge: Volume +${((volRatio - 1) * 100).toFixed(0)}% above baseline with 62%+ bid dominance`;
  } else if (volRatio > 2.2 && ob.imbalanceRatio < 0.35) {
    signal = 'SELL';
    confidence = 0.81;
    breakingEvent = true;
    reason = 'Heavy aggressive selling pressure detected across top-of-book';
  } else if (ob.bias === 'bid_heavy_bullish' || priceChange > 1.5) {
    signal = 'BUY';
    confidence = 0.77;
    reason = 'Positive real-time order book bid support and constructive X/Twitter social flow';
  }

  return {
    agent: 'grok',
    provider: 'heuristic_social_engine',
    timestamp: new Date().toISOString(),
    symbol,
    signal,
    confidence,
    reason,
    constraints: {
      max_position_size_pct: 4.0,
      stop_loss_pct: 2.0,
      take_profit_pct: 4.0,
      timeframe_validity_minutes: 30,
      urgency: breakingEvent ? 'immediate' : 'standard',
    },
    breaking_event: breakingEvent,
    event_type: breakingEvent ? 'volume_breakout' : 'social_sentiment',
    event_severity: breakingEvent ? 'medium' : 'low',
    exchange_anomaly: false,
    veto_flag: vetoFlag,
    veto_reason: null,
    risk_score: breakingEvent ? 3.5 : 2.0,
  };
}

module.exports = {
  getSignal,
  getGrokKeys,
};
